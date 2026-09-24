import type { Store } from '../types'
import type { Action } from './store'
import { validateStore } from './validate'

const isValidStore = (x: unknown): x is Store => validateStore(x).length === 0

// Клиент мини-API. Все функции «мягкие»: сеть упала → false/null, не исключение.

// Адрес — от location.origin, не относительный путь: относительный резолвится от адреса
// документа и наследует userinfo (https://user:pass@host/), а fetch на URL с кредами
// бросает TypeError — вкладка навсегда оставалась в локальном режиме. В origin userinfo нет.
const apiUrl = (path: string) => location.origin + path

export async function probeServer(timeoutMs = 1200): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    // Гейт по /api/store, а не /api/health: в окне «сервер жив, store не
    // инициализирован» health отвечает 200, но канона нет — серверный режим
    // без канона оставил бы веб с очередью действий и без данных.
    const r = await fetch(apiUrl('/api/store'), { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return false
    return isValidStore((await r.json()) as unknown)
  } catch {
    return false
  }
}

export async function fetchServerStore(): Promise<Store | null> {
  try {
    const r = await fetch(apiUrl('/api/store'))
    if (!r.ok) return null
    const data = (await r.json()) as unknown
    return isValidStore(data) ? data : null
  } catch {
    return null
  }
}

export async function postAction(action: Action): Promise<Store | null> {
  try {
    const r = await fetch(apiUrl('/api/action'), { method: 'POST', body: JSON.stringify(action) })
    if (!r.ok) {
      // 4xx = действие сервер отверг (битый JSON, неизвестный type, отказ validate) —
      // выбрасываем его из очереди, вернув текущий канон, чтобы очередь не застряла навечно
      if (r.status >= 400 && r.status < 500) return await fetchServerStore()
      return null
    }
    const data = (await r.json()) as unknown
    return isValidStore(data) ? data : null
  } catch {
    return null
  }
}
