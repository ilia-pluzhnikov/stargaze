/**
 * Не дать экрану уснуть, пока идёт 3D-облёт — заставка, которую смотрят без пульта.
 *
 * Сначала Screen Wake Lock. Браузер телевизоров LG (webOS 22, Chromium 87) API показывает, но
 * `request('screen')` не отвечает вовсе — ни замка, ни отказа, и заставка webOS приходит через
 * ~3 мин без пульта, сколько бы страница ни рисовала. Держит экран только играющее
 * полноэкранное видео (проверено на телевизоре 2026-11-18). Поэтому замок, не пришедший за
 * `LOCK_WAIT_MS`, отказ или браузер без API — запасной путь: беззвучный ролик под холстом облёта.
 */

/** Сколько ждать замок, прежде чем включить видео: на телевизоре ответа не будет никогда. */
export const LOCK_WAIT_MS = 2000

export interface WakeLockLike {
  readonly released: boolean
  release(): Promise<void>
}

export interface KeepAwakeEnv {
  /** Запрос Screen Wake Lock; нет — у браузера нет API. */
  requestLock?: () => Promise<WakeLockLike>
  /** Подписка на возврат вкладки на экран (браузер снимает замок со скрытой); отдаёт отписку. */
  onVisible(fn: () => void): () => void
  /** Включает запасное видео; отдаёт остановку. */
  startVideo(): () => void
  /** Таймер; отдаёт отмену. */
  setTimer(fn: () => void, ms: number): () => void
}

/** Держит экран, пока не вызвана возвращённая остановка. */
export function keepAwake(env: KeepAwakeEnv): () => void {
  let stopped = false
  let lock: WakeLockLike | null = null
  let asking = false
  let stopVideo: (() => void) | null = null
  let cancelWait: (() => void) | null = null

  const clearWait = () => {
    cancelWait?.()
    cancelWait = null
  }

  // Видео, раз включившись, остаётся до конца: на телевизоре замок так и не придёт
  const fallback = () => {
    clearWait()
    if (!stopped && !stopVideo) stopVideo = env.startVideo()
  }

  const takeLock = () => {
    if (stopped || stopVideo || asking || (lock && !lock.released)) return
    const request = env.requestLock
    if (!request) return fallback()
    asking = true
    cancelWait = env.setTimer(fallback, LOCK_WAIT_MS)
    let pending: Promise<WakeLockLike>
    try {
      pending = request()
    } catch {
      asking = false
      return fallback()
    }
    pending.then(
      (got) => {
        asking = false
        // Опоздавший замок (облёт уже закрыт или работает видео) не нужен — отпускаем сразу
        if (stopped || stopVideo) {
          got.release().catch(() => {})
          return
        }
        clearWait()
        lock = got
      },
      () => {
        asking = false
        fallback()
      },
    )
  }

  const unsubscribe = env.onVisible(takeLock)
  takeLock()

  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    clearWait()
    stopVideo?.()
    stopVideo = null
    if (lock && !lock.released) lock.release().catch(() => {})
    lock = null
  }
}

/** Что `startKeepAwakeVideo` трогает в документе — ради тестов без DOM. */
export interface VideoDocument {
  createElement(tag: 'video'): HTMLVideoElement
  readonly body: { appendChild(node: HTMLVideoElement): unknown }
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', fn: () => void): void
  removeEventListener(type: 'visibilitychange', fn: () => void): void
}

/**
 * Ролик — больше экрана: webOS не включает заставку, только пока видео закрывает весь экран.
 * 2×2 и 160×90 px — и прозрачные, и непрозрачные, и со звуковой дорожкой — играли, а заставка
 * всё равно приходила через ~3 мин. Даже `100vw×100vh` не хватает: панель браузера сверху
 * съедает ~10 px (окно 1536×856 при DPR 1,25 — это 1920×1070 из 1920×1080), и такое видео
 * за полноэкранное не считается. Поэтому ролик на 125% окна и выходит за все края. Накрытый
 * непрозрачным слоем, он держит экран так же — под облётом (`.sky3d`, z-index 80) его не видно.
 */
export const VIDEO_STYLE =
  'position:fixed;left:-12.5vw;top:-12.5vh;width:125vw;height:125vh;object-fit:cover;z-index:0;border:0;pointer-events:none'

/**
 * Беззвучный ролик без звуковой дорожки, мимо мыши и фокуса. Пока он играет, webOS не включает
 * заставку. Видео тянет сетевой стек браузера — с cookie входа устройства, как и всё остальное.
 *
 * На webOS повтор ролика возможен только через `load()`: и `loop`, и `currentTime = 0` после
 * конца роняют декодер (MEDIA_ERR_DECODE), и видео встаёт. Ролик длинный (10 мин), чтобы
 * перезапуски с полсекундной паузой случались редко.
 */
export function startKeepAwakeVideo(doc: VideoDocument, src: string): () => void {
  const video = doc.createElement('video')
  video.muted = true
  video.playsInline = true
  video.disablePictureInPicture = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.setAttribute('aria-hidden', 'true')
  video.tabIndex = -1
  video.style.cssText = VIDEO_STYLE

  const play = () => {
    try {
      video.play().catch(() => {})
    } catch {
      // старый браузер без промиса у play() — нечего ловить
    }
  }
  let attached = false
  const attach = () => {
    attached = true
    video.src = src
    play()
  }
  // Отпускает декодер и сеть: без источника load() разбирает медиа-конвейер
  const detach = () => {
    attached = false
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  const restart = () => {
    video.load()
    play()
  }
  // Скрытой вкладке экран держать незачем: ролик разбираем и отпускаем декодер (уход со страницы
  // тоже начинается с hidden). Вкладка вернулась — ставим заново
  const onVisibility = () => {
    if (doc.visibilityState !== 'visible') {
      if (attached) detach()
    } else if (!attached) attach()
    else if (video.paused) play()
  }

  video.addEventListener('ended', restart)
  doc.addEventListener('visibilitychange', onVisibility)
  doc.body.appendChild(video)
  attach()

  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    video.removeEventListener('ended', restart)
    if (attached) detach()
    video.remove()
  }
}
