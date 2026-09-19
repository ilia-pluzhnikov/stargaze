import { describe, expect, it } from 'vitest'
import { LEGACY_STORE_KEY, loadStoredStore, migrateStore, resolveStoredStore, STORE_KEY } from './migrate'
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

describe('migrateStore', () => {
  const v3raw = () => ({
    version: 3,
    character: { name: 'Т', avatar: '🧙' },
    skills: [],
    stars: [],
    quests: [
      { id: 'h1', title: 'Зал', type: 'repeating', skillId: null, xpReward: 20, daysOfWeek: [2, 4, 6], status: 'active', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'h2', title: 'Прогулка', type: 'repeating', skillId: null, xpReward: 10, status: 'active', createdAt: '2026-08-01T00:00:00.000Z' },
    ],
    xpLog: [{ id: 'e1', ts: '2026-09-01T05:00:00.000Z', day: '2026-09-01', questId: 'h1', skillId: null, amount: 20 }],
    ledger: [{ id: 'l1', ts: '2026-09-01T05:00:00.000Z', day: '2026-09-01', kind: 'earn', amount: 20, questId: 'h1' }],
  })
  type Raw = ReturnType<typeof v3raw>

  it('v3 с daysOfWeek → v4 без поля, остальные поля квеста на месте', () => {
    const out = migrateStore(v3raw()) as Raw
    expect(out.version).toBe(4)
    expect(out.quests.some((q) => 'daysOfWeek' in q)).toBe(false)
    expect(out.quests[0]).toMatchObject({ id: 'h1', title: 'Зал', xpReward: 20, status: 'active' })
  })

  it('v3 без daysOfWeek → v4', () => {
    const raw = v3raw()
    raw.quests = [raw.quests[1]]
    expect((migrateStore(raw) as Raw).version).toBe(4)
  })

  it('исходный объект не мутируется', () => {
    const raw = v3raw()
    migrateStore(raw)
    expect(raw.version).toBe(3)
    expect(raw.quests[0].daysOfWeek).toEqual([2, 4, 6])
  })

  it('append-only логи проходят без изменений — теми же ссылками', () => {
    const raw = v3raw()
    const out = migrateStore(raw) as Raw
    expect(out.xpLog).toBe(raw.xpLog)
    expect(out.ledger).toBe(raw.ledger)
  })

  it('v4 возвращается тем же объектом', () => {
    const v4 = { ...v3raw(), version: 4 }
    expect(migrateStore(v4)).toBe(v4)
  })

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    const once = migrateStore(v3raw())
    expect(migrateStore(once)).toBe(once)
  })

  it('чужая версия, мусор и не-объект — насквозь, без исключений', () => {
    const v2 = { version: 2, quests: [] }
    expect(migrateStore(v2)).toBe(v2)
    const v99 = { version: 99 }
    expect(migrateStore(v99)).toBe(v99)
    expect(migrateStore(null)).toBeNull()
    expect(migrateStore('мусор')).toBe('мусор')
    const arr: unknown[] = []
    expect(migrateStore(arr)).toBe(arr)
  })

  it('v3 с битым quests не роняет миграцию — судить будет валидатор', () => {
    expect(migrateStore({ version: 3 })).toEqual({ version: 4, quests: undefined })
    expect(migrateStore({ version: 3, quests: [null, 5] })).toEqual({ version: 4, quests: [null, 5] })
  })
})
