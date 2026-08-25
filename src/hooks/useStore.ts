import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Store } from '../types'
import { reducer, type Action } from '../logic/store'
import { loadStoredStore, STORE_KEY } from '../logic/migrate'
import { fetchServerStore, postAction, probeServer } from '../logic/api'
import { appendQueue, drainQueue, loadQueue } from '../logic/sync'
import { seedStore } from '../data/seed'

const POLL_MS = 30_000
const RETRY_MS = 5_000
const REPROBE_MS = 10_000

function load(): Store {
  try {
    return loadStoredStore(localStorage) ?? seedStore()
  } catch {
    return seedStore()
  }
}

export function useStore() {
  const [store, dispatchLocal] = useReducer(reducer, undefined, load)
  const [mode, setMode] = useState<'local' | 'server'>('local')
  const serverMode = useRef(false)
  const flushing = useRef(false)
  const storeJson = useRef('')
  storeJson.current = JSON.stringify(store)

  /** Отправить очередь по одному действию, в порядке постановки.
   * Дренаж перечитывает KV между отправками (см. drainQueue) — конкурентный
   * dispatch во время in-flight POST не теряется. importStore применяем
   * только когда очередь реально опустела: если сервер умер на середине,
   * очередь цела и остаётся оптимистичная UI-версия до следующей попытки. */
  const flush = useCallback(async () => {
    if (!serverMode.current || flushing.current) return
    flushing.current = true
    try {
      const { last, drained } = await drainQueue(localStorage, postAction)
      if (drained && last && JSON.stringify(last) !== storeJson.current) {
        dispatchLocal({ type: 'importStore', store: last })
      }
    } finally {
      flushing.current = false
    }
  }, [])

  /** Подтянуть канон с сервера (только при пустой очереди — иначе сперва flush). */
  const refresh = useCallback(async () => {
    if (!serverMode.current) return
    if (loadQueue(localStorage).length > 0) return void flush()
    const server = await fetchServerStore()
    // За время ожидания могли дописать в очередь — тогда сервер уже не канон
    if (loadQueue(localStorage).length > 0) return
    if (server && JSON.stringify(server) !== storeJson.current) {
      dispatchLocal({ type: 'importStore', store: server })
    }
  }, [flush])

  // Пробинг при старте + фоновый ре-пробинг, пока живём в локальном режиме.
  // Без повторных попыток вкладка, открытая до подъёма ssh-туннеля, навсегда
  // залипала на localStorage-сиде («всё пусто», канон при этом цел).
  // Правки, сделанные в локальном режиме до переключения, канон не мержит —
  // refresh замещает их серверной версией (localStorage остаётся бэкапом).
  useEffect(() => {
    let cancelled = false
    let probing = false
    const tryEnterServerMode = async () => {
      if (cancelled || serverMode.current || probing) return
      probing = true
      try {
        if (!(await probeServer()) || cancelled) return
        serverMode.current = true
        setMode('server')
        await flush() // остаток очереди с прошлой сессии
        await refresh()
      } finally {
        probing = false
      }
    }
    void tryEnterServerMode()
    const timer = setInterval(() => void tryEnterServerMode(), REPROBE_MS)
    const onWake = () => void tryEnterServerMode()
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [flush, refresh])

  // Локальный режим: персист в localStorage, как раньше. Серверный: канон на сервере.
  useEffect(() => {
    if (serverMode.current) return
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store))
    } catch {
      // квота/приватный режим — молча живём в памяти
    }
  }, [store])

  // Поллинг + фокус + возврат сети
  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_MS)
    const retry = setInterval(() => {
      if (loadQueue(localStorage).length > 0) void flush()
    }, RETRY_MS)
    const onWake = () => void refresh()
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    return () => {
      clearInterval(timer)
      clearInterval(retry)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [refresh, flush])

  const dispatch = useCallback(
    (action: Action) => {
      dispatchLocal(action) // оптимистично — интерфейс не ждёт сеть
      if (serverMode.current) {
        appendQueue(localStorage, action)
        void flush()
      }
    },
    [flush],
  )

  return [store, dispatch, mode] as const
}
