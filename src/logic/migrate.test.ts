import { describe, expect, it } from 'vitest'
import { LEGACY_STORE_KEY, loadStoredStore, migrateStore, resolveStoredStore, STORE_KEY, V3_STORE_KEY } from './migrate'
import { seedStore } from '../data/seed'

const v4 = seedStore()

/** Сид в формате v3: с расписанием у q_sketch — как лежит у пользователей 0.2. */
const v3of = (name: string) => ({
  ...v4,
  version: 3,
  character: { ...v4.character, name },
  quests: v4.quests.map((q) => (q.id === 'q_sketch' ? { ...q, daysOfWeek: [1, 3, 5] } : q)),
})

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
  it('валидный v4-JSON → Store', () => {
    expect(resolveStoredStore(JSON.stringify(v4))).toEqual(v4)
  })

  it('v3-JSON → мигрированный v4 без daysOfWeek', () => {
    const got = resolveStoredStore(JSON.stringify(v3of('Старый')))
    expect(got).toEqual({ ...v4, character: { ...v4.character, name: 'Старый' } })
  })

  it('v2-JSON (со stages) → null — миграции с v2 нет', () => {
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

describe('loadStoredStore (stargaze.v4 → stargaze.v3 → questlog.v3)', () => {
  const kvOf = (entries: Record<string, string>) => ({
    getItem: (k: string) => entries[k] ?? null,
  })
  const named = (name: string) => ({ ...v4, character: { ...v4.character, name } })

  it('ключи: пишем в stargaze.v4, прежние читаются вечно', () => {
    expect(STORE_KEY).toBe('stargaze.v4')
    expect(V3_STORE_KEY).toBe('stargaze.v3')
    expect(LEGACY_STORE_KEY).toBe('questlog.v3')
  })

  it('только legacy questlog.v3 → читается и мигрируется', () => {
    expect(loadStoredStore(kvOf({ [LEGACY_STORE_KEY]: JSON.stringify(v3of('Легаси')) }))).toEqual(named('Легаси'))
  })

  it('только stargaze.v3 → читается и мигрируется', () => {
    expect(loadStoredStore(kvOf({ [V3_STORE_KEY]: JSON.stringify(v3of('Три')) }))).toEqual(named('Три'))
  })

  it('все три ключа → выигрывает stargaze.v4', () => {
    const kv = kvOf({
      [STORE_KEY]: JSON.stringify(named('Четыре')),
      [V3_STORE_KEY]: JSON.stringify(v3of('Три')),
      [LEGACY_STORE_KEY]: JSON.stringify(v3of('Легаси')),
    })
    expect(loadStoredStore(kv)).toEqual(named('Четыре'))
  })

  it('stargaze.v4 битый → фолбэк на stargaze.v3, затем на questlog.v3', () => {
    expect(loadStoredStore(kvOf({
      [STORE_KEY]: '{оборвано',
      [V3_STORE_KEY]: JSON.stringify(v3of('Три')),
      [LEGACY_STORE_KEY]: JSON.stringify(v3of('Легаси')),
    }))).toEqual(named('Три'))
    expect(loadStoredStore(kvOf({
      [STORE_KEY]: '{оборвано',
      [V3_STORE_KEY]: '{тоже',
      [LEGACY_STORE_KEY]: JSON.stringify(v3of('Легаси')),
    }))).toEqual(named('Легаси'))
  })

  it('все пустые → null', () => {
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
