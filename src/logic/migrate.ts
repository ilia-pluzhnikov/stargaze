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

// Ключи localStorage после ренейма 2026-07: пишем только в новый,
// legacy-ключ читается вечно (фолбэк) и никогда не удаляется —
// как и questlog.v1/v2 (бэкапы прежних версий store).
export const STORE_KEY = 'stargaze.v3'
export const LEGACY_STORE_KEY = 'questlog.v3'

/** Чтение из localStorage: только v3, без автомиграции. Битое/чужой версии — null. */
export function resolveStoredStore(rawV3: string | null): Store | null {
  if (!rawV3) return null
  try {
    const parsed = JSON.parse(rawV3) as unknown
    return validateStore(parsed).length === 0 ? (parsed as Store) : null
  } catch {
    return null
  }
}

/** Store из KV: primary stargaze.v3, иначе legacy questlog.v3. */
export function loadStoredStore(kv: { getItem(k: string): string | null }): Store | null {
  return resolveStoredStore(kv.getItem(STORE_KEY)) ?? resolveStoredStore(kv.getItem(LEGACY_STORE_KEY))
}
