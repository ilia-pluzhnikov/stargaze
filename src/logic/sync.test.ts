import { describe, expect, it } from 'vitest'
import type { Store } from '../types'
import type { Action } from './store'
import { appendQueue, drainQueue, LEGACY_QUEUE_KEY, loadQueue, QUEUE_KEY, type KV } from './sync'

const fakeKv = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}
const act: Action = { type: 'acceptQuest', questId: 'q1', ts: 'T1' }
const actB: Action = { type: 'acceptQuest', questId: 'q2', ts: 'T1' }
const actLegacy: Action = { type: 'acceptQuest', questId: 'q-legacy', ts: 'T1' }
const setKey = (kv: KV, key: string, queue: Action[]) => kv.setItem(key, JSON.stringify(queue))
// Заглушки «канонического» стора — drainQueue с ними работает непрозрачно,
// важно только различать «после A» от «после B».
const storeAfterA = { marker: 'after-A' } as unknown as Store
const storeAfterB = { marker: 'after-B' } as unknown as Store

describe('очередь синхронизации', () => {
  it('пустая по умолчанию', () => expect(loadQueue(fakeKv())).toEqual([]))
  it('append → load roundtrip', () => {
    const kv = fakeKv()
    appendQueue(kv, act)
    appendQueue(kv, act)
    expect(loadQueue(kv)).toEqual([act, act])
  })
  it('appendQueue пишет только в новый ключ, legacy не трогает', () => {
    const kv = fakeKv()
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy])
    appendQueue(kv, act)
    expect(kv.data.get(LEGACY_QUEUE_KEY)).toBe(JSON.stringify([actLegacy]))
    expect(JSON.parse(kv.data.get(QUEUE_KEY)!)).toEqual([act])
  })
  it('loadQueue объединяет ключи: legacy впереди (он старше)', () => {
    const kv = fakeKv()
    setKey(kv, QUEUE_KEY, [act])
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy])
    expect(loadQueue(kv)).toEqual([actLegacy, act])
  })
  it('битый JSON в любом ключе — этот ключ пуст, не исключение', () => {
    const kv = fakeKv()
    kv.setItem(QUEUE_KEY, '{оборвано')
    kv.setItem(LEGACY_QUEUE_KEY, '{оборвано')
    expect(loadQueue(kv)).toEqual([])
  })
  it('не-массив в ключе — пустая очередь', () => {
    const kv = fakeKv()
    kv.setItem(QUEUE_KEY, '{"a":1}')
    expect(loadQueue(kv)).toEqual([])
  })
})

describe('drainQueue', () => {
  it('действие, добавленное во время in-flight post, не теряется', async () => {
    const kv = fakeKv()
    appendQueue(kv, act)
    const calls: Action[] = []
    const post = async (a: Action) => {
      calls.push(a)
      if (JSON.stringify(a) === JSON.stringify(act)) {
        // Конкурентный dispatch дописал B в очередь, пока A летит на сервер.
        appendQueue(kv, actB)
        return storeAfterA
      }
      return storeAfterB
    }
    const result = await drainQueue(kv, post)
    expect(calls).toEqual([act, actB])
    expect(loadQueue(kv)).toEqual([])
    expect(result).toEqual({ last: storeAfterB, drained: true })
  })

  it('сервер недоступен — очередь не трогаем, дренаж останавливается', async () => {
    const kv = fakeKv()
    appendQueue(kv, act)
    const post = async (_a: Action) => null
    const result = await drainQueue(kv, post)
    expect(loadQueue(kv)).toEqual([act])
    expect(result).toEqual({ last: null, drained: false })
  })

  it('пустая очередь — post не вызывается', async () => {
    const kv = fakeKv()
    let called = false
    const post = async (_a: Action) => {
      called = true
      return storeAfterA
    }
    const result = await drainQueue(kv, post)
    expect(called).toBe(false)
    expect(result).toEqual({ last: null, drained: true })
  })

  it('только legacy-ключ — дренируется полностью, ключ удаляется', async () => {
    const kv = fakeKv()
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy, act])
    const calls: Action[] = []
    const post = async (a: Action) => {
      calls.push(a)
      return storeAfterA
    }
    const result = await drainQueue(kv, post)
    expect(calls).toEqual([actLegacy, act])
    expect(kv.data.has(LEGACY_QUEUE_KEY)).toBe(false)
    expect(result).toEqual({ last: storeAfterA, drained: true })
  })

  it('оба ключа — сначала legacy, потом новый; голова уходит из своего ключа', async () => {
    const kv = fakeKv()
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy])
    setKey(kv, QUEUE_KEY, [act, actB])
    const calls: Action[] = []
    const post = async (a: Action) => {
      calls.push(a)
      return storeAfterB
    }
    const result = await drainQueue(kv, post)
    expect(calls).toEqual([actLegacy, act, actB])
    expect(kv.data.has(LEGACY_QUEUE_KEY)).toBe(false)
    expect(kv.data.has(QUEUE_KEY)).toBe(false)
    expect(result).toEqual({ last: storeAfterB, drained: true })
  })

  it('сбой на середине: legacy уже пуст, новый ключ цел — без потерь и дублей', async () => {
    const kv = fakeKv()
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy])
    setKey(kv, QUEUE_KEY, [act])
    const calls: Action[] = []
    // Первый POST (legacy) проходит, второй (новый ключ) — сервер упал.
    const post = async (a: Action) => {
      calls.push(a)
      return calls.length === 1 ? storeAfterA : null
    }
    const result = await drainQueue(kv, post)
    expect(calls).toEqual([actLegacy, act])
    expect(kv.data.has(LEGACY_QUEUE_KEY)).toBe(false) // подтверждённое — удалено
    expect(loadQueue(kv)).toEqual([act]) // неподтверждённое — на месте
    expect(result).toEqual({ last: storeAfterA, drained: false })
  })

  it('дозапись во время дренажа legacy попадает в новый ключ и не теряется', async () => {
    const kv = fakeKv()
    setKey(kv, LEGACY_QUEUE_KEY, [actLegacy])
    const calls: Action[] = []
    const post = async (a: Action) => {
      calls.push(a)
      if (JSON.stringify(a) === JSON.stringify(actLegacy)) {
        appendQueue(kv, actB) // конкурентный dispatch, пока legacy-голова в полёте
        return storeAfterA
      }
      return storeAfterB
    }
    const result = await drainQueue(kv, post)
    expect(calls).toEqual([actLegacy, actB])
    expect(loadQueue(kv)).toEqual([])
    expect(result).toEqual({ last: storeAfterB, drained: true })
  })
})
