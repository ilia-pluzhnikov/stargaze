import { describe, expect, it, vi } from 'vitest'
import { LOCK_WAIT_MS, VIDEO_STYLE, keepAwake, startKeepAwakeVideo } from './keepAwake'
import type { KeepAwakeEnv, VideoDocument, WakeLockLike } from './keepAwake'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function fakeLock(): WakeLockLike & { released: boolean; release: ReturnType<typeof vi.fn> } {
  const lock = {
    released: false,
    release: vi.fn(async () => {
      lock.released = true
    }),
  }
  return lock
}

/** Окружение с ручным таймером и ручным ответом на запрос замка. */
function env(opts: { lockApi?: boolean } = {}) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = []
  const answers: { resolve: (l: WakeLockLike) => void; reject: (e: Error) => void }[] = []
  let visible: (() => void) | null = null
  const stopVideo = vi.fn()
  const e: KeepAwakeEnv = {
    requestLock: opts.lockApi === false ? undefined : () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    onVisible: (fn) => {
      visible = fn
      return () => {
        visible = null
      }
    },
    startVideo: vi.fn(() => stopVideo),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true }
      timers.push(t)
      return () => {
        t.live = false
      }
    },
  }
  const fire = () => timers.filter((t) => t.live).forEach((t) => {
    t.live = false
    t.fn()
  })
  return { e, answers, fire, stopVideo, timers, showAgain: () => visible?.(), subscribed: () => visible !== null }
}

describe('keepAwake', () => {
  it('замок пришёл вовремя — видео не нужно, остановка отпускает замок', async () => {
    const t = env()
    const stop = keepAwake(t.e)
    const lock = fakeLock()
    t.answers[0].resolve(lock)
    await flush()
    t.fire() // таймер ожидания уже отменён
    expect(t.e.startVideo).not.toHaveBeenCalled()
    stop()
    expect(lock.release).toHaveBeenCalledOnce()
    expect(t.subscribed()).toBe(false)
  })

  it('замок молчит (webOS) — через LOCK_WAIT_MS включается видео, опоздавший замок отпускается', async () => {
    const t = env()
    const stop = keepAwake(t.e)
    expect(t.timers[0].ms).toBe(LOCK_WAIT_MS)
    t.fire()
    expect(t.e.startVideo).toHaveBeenCalledOnce()
    const late = fakeLock()
    t.answers[0].resolve(late)
    await flush()
    expect(late.release).toHaveBeenCalledOnce()
    stop()
    expect(t.stopVideo).toHaveBeenCalledOnce()
  })

  it('отказ в замке — видео сразу', async () => {
    const t = env()
    keepAwake(t.e)
    t.answers[0].reject(new Error('NotAllowedError'))
    await flush()
    expect(t.e.startVideo).toHaveBeenCalledOnce()
    t.fire() // таймер отменён — второго видео нет
    expect(t.e.startVideo).toHaveBeenCalledOnce()
  })

  it('браузер без Wake Lock — видео сразу, без таймера', () => {
    const t = env({ lockApi: false })
    keepAwake(t.e)
    expect(t.e.startVideo).toHaveBeenCalledOnce()
    expect(t.timers).toHaveLength(0)
  })

  it('запрос бросил синхронно — видео', () => {
    const t = env()
    t.e.requestLock = () => {
      throw new Error('SecurityError')
    }
    keepAwake(t.e)
    expect(t.e.startVideo).toHaveBeenCalledOnce()
  })

  it('браузер снял замок со скрытой вкладки — по возвращении замок берётся снова', async () => {
    const t = env()
    keepAwake(t.e)
    const first = fakeLock()
    t.answers[0].resolve(first)
    await flush()
    t.showAgain() // замок ещё держится — повторного запроса нет
    expect(t.answers).toHaveLength(1)
    first.released = true
    t.showAgain()
    expect(t.answers).toHaveLength(2)
    t.answers[1].resolve(fakeLock())
    await flush()
    expect(t.e.startVideo).not.toHaveBeenCalled()
  })

  it('пока запрос в пути, возврат вкладки второй запрос не шлёт', () => {
    const t = env()
    keepAwake(t.e)
    t.showAgain()
    expect(t.answers).toHaveLength(1)
  })

  it('видео уже играет — возврат вкладки замок не просит', () => {
    const t = env()
    keepAwake(t.e)
    t.fire()
    t.showAgain()
    expect(t.answers).toHaveLength(1)
  })

  it('остановка до ответа: таймер отменён, пришедший замок отпущен, видео не включается', async () => {
    const t = env()
    const stop = keepAwake(t.e)
    stop()
    t.fire()
    const late = fakeLock()
    t.answers[0].resolve(late)
    await flush()
    expect(t.e.startVideo).not.toHaveBeenCalled()
    expect(late.release).toHaveBeenCalledOnce()
    stop() // повторная остановка безвредна
  })
})

/** Минимальный документ и <video> — ровно то, что трогает startKeepAwakeVideo. */
function fakeDoc() {
  const listeners = new Map<string, () => void>()
  const docListeners = new Set<() => void>()
  const video = {
    muted: false, playsInline: false, disablePictureInPicture: false, tabIndex: 0, paused: true, src: '',
    style: { cssText: '' },
    attrs: new Map<string, string>(),
    setAttribute(k: string, v: string) { this.attrs.set(k, v) },
    removeAttribute(k: string) { this.attrs.delete(k); if (k === 'src') this.src = '' },
    addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn) },
    removeEventListener: (type: string) => { listeners.delete(type) },
    play: vi.fn(() => {
      video.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      video.paused = true
    }),
    load: vi.fn(),
    remove: vi.fn(),
  }
  const appended: unknown[] = []
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    createElement: () => video as unknown as HTMLVideoElement,
    body: { appendChild: (n: unknown) => appended.push(n) },
    addEventListener: (_: string, fn: () => void) => { docListeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { docListeners.delete(fn) },
  }
  return { doc: doc as VideoDocument & typeof doc, video, listeners, docListeners, appended }
}

describe('startKeepAwakeVideo', () => {
  it('беззвучный ролик под облётом, вне фокуса, сразу играет', () => {
    const f = fakeDoc()
    startKeepAwakeVideo(f.doc, '/clip.mp4')
    expect(f.video.muted).toBe(true)
    expect(f.video.playsInline).toBe(true)
    expect(f.video.tabIndex).toBe(-1)
    expect(f.video.attrs.get('aria-hidden')).toBe('true')
    expect(f.video.style.cssText).toBe(VIDEO_STYLE)
    // webOS засчитывает только видео, закрывающее весь экран: 2×2 и 160×90 px не держали, и
    // 100vw×100vh тоже — панель браузера съедает край. Прозрачность не нужна — ролик под облётом
    expect(f.video.style.cssText).toContain('width:125vw')
    expect(f.video.style.cssText).toContain('height:125vh')
    expect(f.video.style.cssText).toContain('top:-12.5vh')
    expect(f.video.style.cssText).not.toContain('opacity')
    expect(f.video.style.cssText).toContain('pointer-events:none')
    expect(f.video.src).toBe('/clip.mp4')
    expect(f.appended).toEqual([f.video])
    expect(f.video.play).toHaveBeenCalledOnce()
  })

  it('конец ролика — перезапуск через load(), не loop и не перемоткой (webOS роняет декодер)', () => {
    const f = fakeDoc()
    startKeepAwakeVideo(f.doc, '/clip.mp4')
    expect((f.video as { loop?: boolean }).loop).toBeUndefined()
    f.listeners.get('ended')!()
    expect(f.video.load).toHaveBeenCalledOnce()
    expect(f.video.play).toHaveBeenCalledTimes(2)
  })

  it('скрытие вкладки (и уход со страницы) разбирает ролик, возврат ставит заново', () => {
    const f = fakeDoc()
    startKeepAwakeVideo(f.doc, '/clip.mp4')
    const changeVisibility = (state: DocumentVisibilityState) => {
      f.doc.visibilityState = state
      f.docListeners.forEach((fn) => fn())
    }
    changeVisibility('hidden')
    expect(f.video.pause).toHaveBeenCalledOnce()
    expect(f.video.src).toBe('')
    expect(f.video.load).toHaveBeenCalledOnce()
    changeVisibility('hidden') // повторное скрытие ничего не трогает
    expect(f.video.load).toHaveBeenCalledOnce()
    changeVisibility('visible')
    expect(f.video.src).toBe('/clip.mp4')
    expect(f.video.play).toHaveBeenCalledTimes(2)
  })

  it('вкладка видна, ролик встал на паузу — запускается снова, без перезагрузки источника', () => {
    const f = fakeDoc()
    startKeepAwakeVideo(f.doc, '/clip.mp4')
    f.video.paused = true
    f.docListeners.forEach((fn) => fn())
    expect(f.video.play).toHaveBeenCalledTimes(2)
    expect(f.video.load).not.toHaveBeenCalled()
  })

  it('остановка после скрытия не разбирает ролик второй раз', () => {
    const f = fakeDoc()
    const stop = startKeepAwakeVideo(f.doc, '/clip.mp4')
    f.doc.visibilityState = 'hidden'
    f.docListeners.forEach((fn) => fn())
    stop()
    expect(f.video.load).toHaveBeenCalledOnce()
    expect(f.video.remove).toHaveBeenCalledOnce()
  })

  it('остановка: пауза, без источника, элемент убран, подписки сняты', () => {
    const f = fakeDoc()
    const stop = startKeepAwakeVideo(f.doc, '/clip.mp4')
    stop()
    expect(f.video.pause).toHaveBeenCalledOnce()
    expect(f.video.src).toBe('')
    expect(f.video.load).toHaveBeenCalledOnce()
    expect(f.video.remove).toHaveBeenCalledOnce()
    expect(f.listeners.has('ended')).toBe(false)
    expect(f.docListeners.size).toBe(0)
  })

  it('play() без промиса (старый браузер) не роняет', () => {
    const f = fakeDoc()
    f.video.play = vi.fn(() => undefined as unknown as Promise<void>)
    expect(() => startKeepAwakeVideo(f.doc, '/clip.mp4')).not.toThrow()
  })
})
