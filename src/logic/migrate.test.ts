import { describe, expect, it } from 'vitest'
import { LEGACY_STORE_KEY, loadStoredStore, resolveStoredStore, STORE_KEY } from './migrate'
import { seedStore } from '../data/seed'

const v3 = seedStore()

const v2 = {
  version: 2,
  character: { name: 'Тест', avatar: '⚔️' },
  skills: [],
  stages: [],
  stars: [],
  quests: [],
  xpLog: [],
}

describe('resolveStoredStore', () => {
  it('валидный v3-JSON → Store', () => {
    const got = resolveStoredStore(JSON.stringify(v3))
    expect(got).toEqual(v3)
  })

  it('v2-JSON (со stages) → null — автомиграции нет', () => {
    expect(resolveStoredStore(JSON.stringify(v2))).toBeNull()
  })

  it('мусор → null', () => {
    expect(resolveStoredStore('{оборвано')).toBeNull()
    expect(resolveStoredStore('null')).toBeNull()
    expect(resolveStoredStore('{}')).toBeNull()
  })

  it('пусто → null', () => {
    expect(resolveStoredStore(null)).toBeNull()
  })
})

describe('loadStoredStore (stargaze.v3 → фолбэк questlog.v3)', () => {
  const kvOf = (entries: Record<string, string>) => ({
    getItem: (k: string) => entries[k] ?? null,
  })
  // Различимые сторы: у legacy-версии другое имя персонажа
  const fresh = v3
  const legacy = { ...v3, character: { ...v3.character, name: 'Легаси' } }

  it('только legacy questlog.v3 → читается (вечный фолбэк)', () => {
    expect(loadStoredStore(kvOf({ [LEGACY_STORE_KEY]: JSON.stringify(legacy) }))).toEqual(legacy)
  })

  it('только новый stargaze.v3 → читается', () => {
    expect(loadStoredStore(kvOf({ [STORE_KEY]: JSON.stringify(fresh) }))).toEqual(fresh)
  })

  it('оба ключа → выигрывает stargaze.v3', () => {
    const kv = kvOf({
      [STORE_KEY]: JSON.stringify(fresh),
      [LEGACY_STORE_KEY]: JSON.stringify(legacy),
    })
    expect(loadStoredStore(kv)).toEqual(fresh)
  })

  it('новый ключ битый → фолбэк на legacy', () => {
    const kv = kvOf({
      [STORE_KEY]: '{оборвано',
      [LEGACY_STORE_KEY]: JSON.stringify(legacy),
    })
    expect(loadStoredStore(kv)).toEqual(legacy)
  })

  it('оба пустые → null', () => {
    expect(loadStoredStore(kvOf({}))).toBeNull()
  })
})
