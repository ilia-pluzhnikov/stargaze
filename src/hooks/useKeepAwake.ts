import { useEffect } from 'react'
import clip from '../assets/keep-awake.mp4'
import { keepAwake, startKeepAwakeVideo } from './keepAwake'

/** Пока `active`, экран не гаснет и телевизор не уходит в заставку (см. `keepAwake`). */
export function useKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) return
    const wakeLock = navigator.wakeLock as WakeLock | undefined
    return keepAwake({
      requestLock: wakeLock ? () => wakeLock.request('screen') : undefined,
      onVisible: (fn) => {
        const onChange = () => {
          if (document.visibilityState === 'visible') fn()
        }
        document.addEventListener('visibilitychange', onChange)
        return () => document.removeEventListener('visibilitychange', onChange)
      },
      startVideo: () => startKeepAwakeVideo(document, clip),
      setTimer: (fn, ms) => {
        const id = window.setTimeout(fn, ms)
        return () => window.clearTimeout(id)
      },
    })
  }, [active])
}
