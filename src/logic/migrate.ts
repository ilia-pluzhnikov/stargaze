import type { Store } from '../types'
import { validateStore } from './validate'

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

type Step = (store: Record<string, unknown>) => Record<string, unknown>

/** v3 → v4: у привычек больше нет расписания — ключ daysOfWeek снимается с каждого квеста. */
const v3toV4: Step = (store) => ({
  ...store,
  quests: Array.isArray(store.quests)
    ? store.quests.map((q: unknown) =>
        isObj(q) && 'daysOfWeek' in q
          ? Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'daysOfWeek'))
          : q,
      )
    : store.quests,
  version: 4,
})

/** Ступени по исходной версии. Новая версия формата = новая запись здесь (v4 → v5 и далее). */
const STEPS: Record<number, Step> = { 3: v3toV4 }

/**
 * Единственное место миграций формата store: ступени применяются цепочкой до актуальной
 * версии. Чистая и идемпотентная; актуальная или неизвестная версия, не-объект и мусор
 * возвращаются тем же значением по ссылке. Сама не валидирует — следом всегда идёт
 * validateStore. Append-only логи (xpLog, ledger) не трогает.
 */
export function migrateStore(raw: unknown): unknown {
  let current = raw
  while (isObj(current) && typeof current.version === 'number' && STEPS[current.version])
    current = STEPS[current.version](current)
  return current
}

// Ключи localStorage. Пишем только в STORE_KEY; прежние ключи читаются вечно (фолбэк)
// и никогда не удаляются — как и questlog.v1/v2: это бэкапы прежних версий store.
export const STORE_KEY = 'stargaze.v4'
export const V3_STORE_KEY = 'stargaze.v3'
export const LEGACY_STORE_KEY = 'questlog.v3'

/** Значение из localStorage: parse → migrateStore → validateStore. Битое или немигрируемое — null. */
export function resolveStoredStore(raw: string | null): Store | null {
  if (!raw) return null
  try {
    const current = migrateStore(JSON.parse(raw) as unknown)
    return validateStore(current).length === 0 ? (current as Store) : null
  } catch {
    return null
  }
}

/** Store из KV: stargaze.v4 → stargaze.v3 → questlog.v3, первое валидное после миграции. */
export function loadStoredStore(kv: { getItem(k: string): string | null }): Store | null {
  for (const key of [STORE_KEY, V3_STORE_KEY, LEGACY_STORE_KEY]) {
    const store = resolveStoredStore(kv.getItem(key))
    if (store) return store
  }
  return null
}
