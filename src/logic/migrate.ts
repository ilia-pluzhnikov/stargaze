import type { Store } from '../types'
import { validateStore } from './validate'

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
