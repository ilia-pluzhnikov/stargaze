import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedStore } from '../data/seed'
import { fetchServerStore, postAction, probeServer } from './api'
import { appendQueue, drainQueue, loadQueue, type KV } from './sync'

// Страница открыта по адресу с логином в userinfo (https://user:pass@host/ — так открывали
// прод на телевизоре, чтобы не вводить basic auth с пульта). Относительный путь fetch
// резолвится от адреса документа и наследует userinfo, а Request с кредами в URL по Fetch
// spec бросает TypeError — пробинг молча возвращал false, и вкладка навсегда оставалась
// в локальном режиме со старой копией из localStorage.

const DOC_URL = 'https://user:pass@stargaze.example/'
const canon = seedStore()

/** fetch как в браузере: путь резолвится от адреса документа, userinfo в итоговом URL — TypeError. */
function browserFetch(docUrl: string) {
  const calls: string[] = []
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), docUrl)
    if (url.username || url.password) {
      throw new TypeError('Request cannot be constructed from a URL that includes credentials')
    }
    calls.push(url.href)
    return new Response(JSON.stringify(canon), { status: 200 })
  }
  return { fetch, calls }
}

function openedAt(docUrl: string) {
  const b = browserFetch(docUrl)
  vi.stubGlobal('location', new URL(docUrl))
  vi.stubGlobal('fetch', b.fetch)
  return b.calls
}

afterEach(() => void vi.unstubAllGlobals())

describe('api: страница открыта с кредами в URL', () => {
  it('probeServer находит сервер', async () => {
    openedAt(DOC_URL)
    expect(await probeServer()).toBe(true)
  })

  it('fetchServerStore получает канон', async () => {
    openedAt(DOC_URL)
    expect(await fetchServerStore()).toEqual(canon)
  })

  it('postAction уходит на тот же origin без userinfo', async () => {
    const calls = openedAt(DOC_URL)
    const res = await postAction({ type: 'acceptQuest', questId: 'q1', ts: '2026-09-25T00:00:00.000Z' })
    expect(res).toEqual(canon)
    expect(calls).toEqual(['https://stargaze.example/api/action'])
  })
})

describe('api: отказ сервера не стопорит очередь', () => {
  // сервер отвечает на POST заданным статусом, GET /api/store — каноном
  function serverAnswering(statusFor: (action: { type: string }) => number) {
    const calls: string[] = []
    vi.stubGlobal('location', new URL('https://stargaze.example/'))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${new URL(String(input)).pathname}`)
      if (method === 'GET') return new Response(JSON.stringify(canon), { status: 200 })
      const status = statusFor(JSON.parse(String(init?.body)) as { type: string })
      return new Response(JSON.stringify(status === 200 ? canon : { error: 'отказ' }), { status })
    })
    return calls
  }
  const memKv = (): KV => {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  it.each([400, 422])('%i → postAction отдаёт канон, а не null', async (status) => {
    const calls = serverAnswering(() => status)
    expect(await postAction({ type: 'rejectQuest', questId: 'q1' })).toEqual(canon)
    expect(calls).toEqual(['POST /api/action', 'GET /api/store'])
  })

  it('5xx → null: очередь ждёт сервер', async () => {
    serverAnswering(() => 503)
    expect(await postAction({ type: 'rejectQuest', questId: 'q1' })).toBeNull()
  })

  it('отвергнутые формой и гейтом действия выбрасываются, очередь дренируется до конца', async () => {
    serverAnswering((a) => (a.type === 'acceptQuest' ? 200 : a.type === 'rejectQuest' ? 400 : 422))
    const kv = memKv()
    appendQueue(kv, { type: 'rejectQuest', questId: 'q1' })
    appendQueue(kv, { type: 'completeQuest', questId: 'q2', day: '2026-10-30', ts: '2026-10-30T05:00:00.000Z' })
    appendQueue(kv, { type: 'acceptQuest', questId: 'q3', ts: '2026-10-30T05:00:00.000Z' })
    expect(await drainQueue(kv, postAction)).toEqual({ last: canon, drained: true })
    expect(loadQueue(kv)).toEqual([])
  })
})

describe('api: обычный адрес', () => {
  it('запросы идут в корень origin, как и раньше', async () => {
    const calls = openedAt('https://stargaze.example/sub/page?x=1')
    expect(await probeServer()).toBe(true)
    expect(calls).toEqual(['https://stargaze.example/api/store'])
  })
})
