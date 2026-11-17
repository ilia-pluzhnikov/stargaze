import { useEffect, useMemo, useRef, useState } from 'react'
import { TIERS } from '../types'
import type { SkyStore, Tier } from '../types'
import { CONST_H, CONST_W } from '../logic/layout'
import {
  GALAXY_3D_SCALE, backdropStars, buildSkyScene, cameraBasis, flightPlan, orbitEye, pickGalaxy, project, projectDirection,
} from '../logic/sky3d'
import type { CameraBasis, SkyGalaxy3D, Vec3 } from '../logic/sky3d'
import {
  RESUME_IDLE_SEC, pilotFlyTo, pilotResume, pilotRotate, pilotStartAt, pilotStep, pilotTick, pilotTogglePause, pilotZoom,
  rebasePilot, startPilot, stopIndexOf,
} from '../logic/sky3dPilot'
import type { Pilot } from '../logic/sky3dPilot'
import { glyphById } from './skyGlyphs'
import { sky, tierStyle } from './skyColors'
import { rootCoronaStops } from './skyGlow'

interface Props {
  store: SkyStore
  /** Сегодняшнее небо для раскладки; нет = то же, что store (см. Sky). */
  layoutFrom?: SkyStore
  /** Галактика из адреса страницы: облёт начинается с неё и переходит к ней, когда адрес
   * меняется. null или нет — с обзора всего неба. */
  startAt?: string | null
  onClose: () => void
}

/** Кадров в секунду: заставке хватает, слабому браузеру телевизора — посильно. */
const FPS = 30
/** Плотность пикселей холста сверху ограничена: 4K-телевизор не рисует вчетверо больше. */
const MAX_DPR = 1.5
/** Сколько секунд после движения мыши или клавиши видны кнопки. */
const CONTROLS_SEC = 4
/** Фон — сфера без «затылка»: ручная камера поворачивается шире облёта, но назад не смотрит. */
const BACKDROP = backdropStars(2400, 'stargaze-sky3d', -0.5)
/** Радиан поворота камеры на пиксель перетаскивания. */
const DRAG_RAD_PER_PX = 0.005
/** Чувствительность колеса: показатель множителя расстояния на пиксель прокрутки. */
const WHEEL_ZOOM = 0.0014
/** Нажатие, не ушедшее дальше стольких пикселей, — клик, а не перетаскивание. */
const CLICK_SLOP_PX = 6
/** Звёзды в 3D чуть крупнее, чем мини-созвездия обзора: смотрят издалека, с дивана. */
const STAR_SIZE = 1.3

type Sprite = HTMLCanvasElement

/** Круглое свечение — рисуется один раз, в кадре только масштабируется (drawImage дешевле градиента). */
function glowSprite(stops: [number, string][], size = 64): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return canvas
}

interface Sprites {
  halo: Record<Tier, Sprite>
  nebula: Map<number, Sprite>
  root: Map<number, Sprite>
}

function makeSprites(galaxies: SkyGalaxy3D[]): Sprites {
  const halo = Object.fromEntries(TIERS.map((tier) => {
    const h = sky.rarityHalo(tier)
    return [tier, glowSprite([[0, h.inner], [0.34, h.mid], [1, h.outer]])]
  })) as Record<Tier, Sprite>
  const nebula = new Map<number, Sprite>()
  const root = new Map<number, Sprite>()
  for (const { hue } of galaxies) {
    if (nebula.has(hue)) continue
    // пологий спад в несколько стопов: у двух линейных участков на стыке виден ободок
    const falloff: [number, number][] = [[0, 0.2], [0.2, 0.145], [0.4, 0.09], [0.6, 0.045], [0.8, 0.014], [1, 0]]
    nebula.set(hue, glowSprite(falloff.map(([at, alpha]) => [at, `hsla(${hue}, 60%, 54%, ${alpha})`]), 256))
    root.set(hue, glowSprite(rootCoronaStops(hue).map((s): [number, string] => [s.offset, s.color])))
  }
  return { halo, nebula, root }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
/** Дальнее тусклее: глубина читается и без теней. */
const depthFade = (depth: number) => clamp(1.3 - depth / 2400, 0.3, 1)

function drawGalaxy(
  ctx: CanvasRenderingContext2D, g: SkyGalaxy3D, basis: CameraBasis, sprites: Sprites, glyphs: Map<string, Path2D[]>, dpr: number,
  /** Имя галактики в фокусе уже стоит в подписи режима — на сцене его не дублируем. */
  named: boolean,
) {
  const center = project(g.center, basis)
  if (!center) return
  const fade = depthFade(center.depth)
  const blit = (sprite: Sprite, x: number, y: number, r: number, alpha: number) => {
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)
  }

  blit(sprites.nebula.get(g.hue)!, center.x, center.y, g.radius * 1.9 * center.scale, fade)

  // Глиф лежит в плоскости галактики: аффинное приближение перспективы по трём точкам
  const paths = g.glyphId ? glyphs.get(g.glyphId) : undefined
  if (paths) {
    const rot = (g.rotation * Math.PI) / 180
    const k = 100 * GALAXY_3D_SCALE
    const ax = project({ x: g.center.x + Math.cos(rot) * k, y: g.center.y + Math.sin(rot) * k, z: g.center.z }, basis)
    const ay = project({ x: g.center.x - Math.sin(rot) * k, y: g.center.y + Math.cos(rot) * k, z: g.center.z }, basis)
    if (ax && ay) {
      const a = (ax.x - center.x) / 100
      const b = (ax.y - center.y) / 100
      const c = (ay.x - center.x) / 100
      const d = (ay.y - center.y) / 100
      ctx.setTransform(
        a * dpr, b * dpr, c * dpr, d * dpr,
        (center.x - a * (CONST_W / 2) - c * (CONST_H / 2)) * dpr,
        (center.y - b * (CONST_W / 2) - d * (CONST_H / 2)) * dpr,
      )
      ctx.strokeStyle = sky.glyphStroke(g.hue)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.1 * fade
      ctx.lineWidth = 15
      for (const path of paths) ctx.stroke(path)
      ctx.globalAlpha = 0.42 * fade
      ctx.lineWidth = 4.2
      for (const path of paths) ctx.stroke(path)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  const core = project(g.core, basis)
  const points = g.stars.map((s) => project(s.pos, basis))

  ctx.lineCap = 'round'
  g.stars.forEach((s, i) => {
    const to = points[i]
    const from = s.parent < 0 ? core : points[s.parent]
    if (!to || !from) return
    const lit = s.lit && (s.parent < 0 || g.stars[s.parent].lit)
    ctx.globalAlpha = fade
    ctx.strokeStyle = sky.edge(g.hue, lit)
    ctx.lineWidth = Math.max(0.6, (lit ? 0.8 : 0.6) * to.scale)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  })

  g.stars.forEach((s, i) => {
    const p = points[i]
    if (!p) return
    const size = tierStyle[s.tier].scale * p.scale * STAR_SIZE
    blit(sprites.halo[s.tier], p.x, p.y, (s.lit ? 7 : 3.75) * size, (s.lit ? 0.9 : 0.45) * fade)
    ctx.globalAlpha = fade
    if (s.lit && p.scale > 0.9) {
      const arm = 4.5 * size
      ctx.fillStyle = sky.flare
      ctx.fillRect(p.x - arm, p.y - 0.5, arm * 2, 1)
      ctx.fillRect(p.x - 0.5, p.y - arm, 1, arm * 2)
    }
    ctx.fillStyle = sky.starFill(s.lit, s.tier)
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0.7, (s.lit ? 1.75 : 1.25) * size), 0, Math.PI * 2)
    ctx.fill()
  })

  if (core) {
    blit(sprites.root.get(g.hue)!, core.x, core.y, 15 * core.scale, fade)
    ctx.strokeStyle = sky.galaxyStroke(g.hue)
    ctx.lineWidth = 1
    for (const [r, alpha] of [[10.5, 0.12], [7.25, 0.24], [4.5, 0.48]] as const) {
      ctx.globalAlpha = alpha * fade
      ctx.beginPath()
      ctx.arc(core.x, core.y, r * core.scale, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = fade
    ctx.fillStyle = sky.litCore
    ctx.beginPath()
    ctx.arc(core.x, core.y, Math.max(1, 1.75 * core.scale), 0, Math.PI * 2)
    ctx.fill()
  }

  const label = named ? project({ x: g.center.x, y: g.center.y + (CONST_H * GALAXY_3D_SCALE) / 2 + 22, z: g.center.z }, basis) : null
  // левый нижний угол занят подписью режима — имя соседней галактики туда не кладём
  if (label && !(label.x < 340 && label.y > basis.cy * 2 - 130)) {
    ctx.globalAlpha = 0.85 * fade
    ctx.fillStyle = sky.label
    ctx.font = `600 ${Math.round(clamp(14 * label.scale, 11, 18))}px Inter, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(g.name, label.x, label.y)
  }
}

/** 3D-небо — режим просмотра: камера сама облетает галактики (заставка), а мышью или
 * пальцем её можно взять в руки — вращать, приближать, подлетать к галактике кликом.
 * Действий над миром нет; выход — кнопка или Esc. Геометрия и правила полёта — в
 * logic/sky3d и logic/sky3dPilot, здесь только ввод и отрисовка на Canvas 2D. */
export function Sky3D({ store, layoutFrom, startAt = null, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scene = useMemo(() => buildSkyScene(store, layoutFrom ?? store), [store, layoutFrom])
  const plan = useMemo(() => flightPlan(scene), [scene])
  // пилот переживает пересборку сцены: синхронизация store не отбрасывает камеру к началу
  const pilot = useRef<Pilot | null>(null)
  const startedAt = useRef(startAt) // галактика, с которой облёт начат или на которую его перевёл адрес
  const [focusId, setFocusId] = useState<string | null>(null)
  const [hud, setHud] = useState({ manual: false, paused: false })
  const [controls, setControls] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    pilot.current = pilot.current ? rebasePilot(pilot.current, plan) : startPilot(plan, stopIndexOf(plan, startedAt.current))
    const sprites = makeSprites(scene.galaxies)
    const glyphs = new Map<string, Path2D[]>()
    for (const g of scene.galaxies) {
      const glyph = glyphById(g.glyphId)
      if (glyph && !glyphs.has(glyph.id)) glyphs.set(glyph.id, glyph.paths.map((d) => new Path2D(d)))
    }
    const slow = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    let dpr = 1
    let width = 0
    let height = 0
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    // ── ввод: одна точка — вращение, две — щипок-зум, короткое нажатие — подлёт к галактике ──
    const pointers = new Map<number, { x: number; y: number }>()
    let press: { x: number; y: number; moved: boolean } | null = null
    let pinchSpan = 0
    let basis: CameraBasis | null = null // базис последнего кадра — по нему клик ищет галактику
    const pointAt = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      return { x: e.clientX - box.left, y: e.clientY - box.top }
    }
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, pointAt(e))
      press = pointers.size === 1 ? { ...pointAt(e), moved: false } : null
      pinchSpan = 0
    }
    const onMove = (e: PointerEvent) => {
      const now = pointAt(e)
      const prev = pointers.get(e.pointerId)
      if (!prev) { // курсор просто ведут: над галактикой он подсказывает, что по ней можно кликнуть
        canvas.classList.toggle('over-galaxy', !!basis && pickGalaxy(scene, basis, now.x, now.y) !== null)
        return
      }
      if (pointers.size === 1) {
        if (press && !press.moved && Math.hypot(now.x - press.x, now.y - press.y) < CLICK_SLOP_PX) return
        if (press) press.moved = true
        // «тянем небо за собой»: вправо — камера уходит влево, вниз — поднимается
        pilot.current = pilotRotate(pilot.current!, plan, -(now.x - prev.x) * DRAG_RAD_PER_PX, (now.y - prev.y) * DRAG_RAD_PER_PX)
      }
      pointers.set(e.pointerId, now)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const span = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchSpan > 0 && span > 0) pilot.current = pilotZoom(pilot.current!, plan, pinchSpan / span)
        pinchSpan = span
      }
    }
    const onUp = (e: PointerEvent) => {
      const click = e.type === 'pointerup' && pointers.size === 1 && press && !press.moved ? press : null
      pointers.delete(e.pointerId)
      press = null
      pinchSpan = 0
      const hit = click && basis ? pickGalaxy(scene, basis, click.x, click.y) : null
      const stop = hit ? plan.stops.findIndex((s) => s.galaxyId === hit) : -1
      if (stop >= 0) pilot.current = pilotFlyTo(pilot.current!, plan, stop)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY // мышь со «строками» → пиксели
      pilot.current = pilotZoom(pilot.current!, plan, Math.exp(clamp(delta, -400, 400) * WHEEL_ZOOM))
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    let shown: { focus: string | null; manual: boolean; paused: boolean } | null = null
    let raf = 0
    let lastDraw = 0
    let last = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - lastDraw < 1000 / FPS - 2) return
      lastDraw = now
      // полёт идёт по настоящему времени и при редких кадрах (слабый браузер, окно в фоне);
      // пауза дольше секунды — вкладку прятали — камеру не перебрасывает
      const dt = last ? Math.min(1, (now - last) / 1000) * slow : 0
      last = now
      const p = pilotTick(pilot.current!, plan, dt, pointers.size > 0)
      pilot.current = p
      const view = cameraBasis({ eye: orbitEye(p.pose), target: p.pose.target }, width, height)
      basis = view
      const focus = plan.stops[p.stopIndex].galaxyId

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#dfe6ff'
      const twinkle = now / 1000
      for (const s of BACKDROP) {
        const dot = projectDirection(s.direction, view)
        if (!dot || dot.x < 0 || dot.y < 0 || dot.x > width || dot.y > height) continue
        ctx.globalAlpha = s.alpha * (0.72 + 0.28 * Math.sin(twinkle * s.speed + s.phase))
        ctx.fillRect(dot.x, dot.y, s.size, s.size)
      }
      const depthOf = (v: Vec3) =>
        (v.x - view.eye.x) * view.forward.x + (v.y - view.eye.y) * view.forward.y + (v.z - view.eye.z) * view.forward.z
      const order = [...scene.galaxies].sort((a, b) => depthOf(b.center) - depthOf(a.center))
      for (const g of order) drawGalaxy(ctx, g, view, sprites, glyphs, dpr, g.id !== focus || p.travelling)
      ctx.globalAlpha = 1

      const manual = p.mode === 'manual'
      if (!shown || shown.focus !== focus) setFocusId(focus)
      if (!shown || shown.manual !== manual || shown.paused !== p.paused) setHud({ manual, paused: p.paused })
      shown = { focus, manual, paused: p.paused }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [scene, plan])

  // Адрес назвал другую галактику — агент сменил ссылку на экране или приехал канон с целью
  // ссылки, которой не было в копии из браузера: облёт плавно переходит к ней
  useEffect(() => {
    if (startedAt.current === startAt) return
    startedAt.current = startAt
    if (pilot.current) pilot.current = pilotStartAt(pilot.current, plan, startAt)
  }, [startAt, plan])

  // Кнопки видны, пока человек шевелится; в покое остаётся чистая заставка без курсора
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setControls(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setControls(false), CONTROLS_SEC * 1000)
    }
    const onKey = (e: KeyboardEvent) => {
      const p = pilot.current
      if (e.key === 'Escape') onClose()
      else if (!p) return
      else if (e.key === 'ArrowRight') pilot.current = pilotStep(p, plan, 1)
      else if (e.key === 'ArrowLeft') pilot.current = pilotStep(p, plan, -1)
      else if (e.key === ' ') {
        e.preventDefault()
        pilot.current = pilotTogglePause(p, plan)
      }
      wake()
    }
    wake()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [onClose, plan])

  const focus = scene.galaxies.find((g) => g.id === focusId)
  const total = focus ? focus.stars.length : scene.galaxies.reduce((sum, g) => sum + g.stars.length, 0)
  const lit = focus
    ? focus.stars.filter((s) => s.lit).length
    : scene.galaxies.reduce((sum, g) => sum + g.stars.filter((s) => s.lit).length, 0)
  const steer = (move: (p: Pilot) => Pilot) => () => {
    if (pilot.current) pilot.current = move(pilot.current)
  }

  return (
    <div className={controls ? 'sky3d' : 'sky3d idle'} role="dialog" aria-label="3D-небо">
      <canvas ref={canvasRef} />
      <div className="sky3d-caption">
        <div className="sky3d-kicker">3D-небо · {hud.manual ? 'ручной полёт' : hud.paused ? 'облёт · пауза' : 'облёт'}</div>
        <div className="sky3d-name">{focus ? focus.name : 'Всё небо'}</div>
        <div className="sky3d-meta">
          {total > 0 ? `зажжено ${lit} из ${total}` : focus ? 'без звёзд' : scene.galaxies.length ? 'звёзд пока нет' : 'навыков пока нет'}
        </div>
      </div>
      <div className="sky3d-controls">
        <span className="sky3d-hint">тяни — вращать · колесо — зум · клик по галактике — подлететь</span>
        {hud.manual && (
          <button className="sky-reset" onClick={steer((p) => pilotResume(p, plan))}
            title={`Вернуть автопролёт сейчас; сам он вернётся через ${RESUME_IDLE_SEC} с покоя`}>▶ Облёт</button>
        )}
        <button className="sky-reset" onClick={steer((p) => pilotFlyTo(p, plan, 0))} title="Отлететь и увидеть всё небо">⌖ Обзор</button>
        <button className="sky-reset" onClick={onClose} title="Вернуться к обычному небу (Esc)">✕ Выйти из 3D</button>
      </div>
    </div>
  )
}
