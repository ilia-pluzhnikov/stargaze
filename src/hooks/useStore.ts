import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Store } from '../types'
import { reducer, type Action } from '../logic/store'
import { loadStoredStore, STORE_KEY } from '../logic/migrate'
import { fetchServerStore, postAction, probeServer } from '../logic/api'
import { appendQueue, drainQueue, lastServerSeen, loadQueue, markServerSeen } from '../logic/sync'
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
  // Не null — пробинг провалился, а этот браузер бывал на сервере: на экране копия,
  // правки на сервер не попадут. Значение — время последней связи (для баннера)
  const [offlineSince, setOfflineSince] = useState<string | null>(null)
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
    if (server) markServerSeen(localStorage, new Date().toISOString())
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
  // refresh замещает их серверной версией. Поэтому браузеру, который бывал на
  // сервере, локальный режим показывает баннер (offlineSince), а не тихий бейдж.
  useEffect(() => {
    let cancelled = false
    let probing = false
    const tryEnterServerMode = async () => {
      if (cancelled || serverMode.current || probing) return
      probing = true
      try {
        if (!(await probeServer())) {
          if (!cancelled) setOfflineSince(lastServerSeen(localStorage))
          return
        }
        if (cancelled) return
        serverMode.current = true
        markServerSeen(localStorage, new Date().toISOString())
        setMode('server')
        setOfflineSince(null)
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

  // Персист в localStorage в обоих режимах. В серверном это копия последнего канона:
  // отвалится сервер — вкладка покажет её, а не реликт давней локальной сессии.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, storeJson.current)
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

  return [store, dispatch, mode, offlineSince] as const
}
