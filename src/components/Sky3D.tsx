import { useEffect, useMemo, useRef, useState } from 'react'
import { TIERS } from '../types'
import type { SkyStore, Tier } from '../types'
import { formatDayLong } from '../logic/dates'
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
import { useKeepAwake } from '../hooks/useKeepAwake'
import { ROOT_MINI_SCALE } from './Galaxy'
import { glyphById } from './skyGlyphs'
import { sky, tierStyle } from './skyColors'
import { bloomStops, coronaStops, glow, nebulaStops, rootBloomStops, rootCoronaStops, spikeStops } from './skyGlow'
import type { GlowStop } from './skyGlow'

interface Props {
  store: SkyStore
  /** Сегодняшнее небо для раскладки; нет = то же, что store (см. Sky). */
  layoutFrom?: SkyStore
  /** Галактика из адреса страницы: облёт начинается с неё и переходит к ней, когда адрес
   * меняется. null или нет — с обзора всего неба. */
  startAt?: string | null
  /** День неба в режиме истории: облёт показывает прошлое и называет его дату. Нет — сегодня. */
  asOfDay?: string
  onClose: () => void
}

/** Кадров в секунду: заставке хватает, слабому браузеру телевизора — посильно. */
const FPS = 30
/** Плотность пикселей холста сверху ограничена: 4K-телевизор не рисует вчетверо больше. */
const MAX_DPR = 1.5
/** Сколько секунд после движения мыши или клавиши видны кнопки. */
const CONTROLS_SEC = 4
/** Глиф рисуется в спрайт в такой доле своего пространства 1000×900: вблизи — почти 1:1. */
const GLYPH_SPRITE_SCALE = 0.75
/** Подпись галактики рисуется в спрайт этим шрифтом, в кадре только масштабируется. */
const LABEL_PX = 36
const LABEL_FONT = `600 ${LABEL_PX}px Inter, system-ui, sans-serif`
/** Фон — сфера без «затылка»: ручная камера поворачивается шире облёта, но назад не смотрит. */
const BACKDROP = backdropStars(1700, 'stargaze-sky3d', -0.5)
/** Радиан поворота камеры на пиксель перетаскивания. */
const DRAG_RAD_PER_PX = 0.005
/** Чувствительность колеса: показатель множителя расстояния на пиксель прокрутки. */
const WHEEL_ZOOM = 0.0014
/** Нажатие, не ушедшее дальше стольких пикселей, — клик, а не перетаскивание. */
const CLICK_SLOP_PX = 6
/** Звёзды в 3D чуть крупнее, чем мини-созвездия обзора: смотрят издалека, с дивана. */
const STAR_SIZE = 1.2
/** 3D — то же обзорное небо с глубиной: свет берёт пропорции мини-созвездий обзора
 * (рецепт — skyGlow.ts), единица созвездия переводится в мир через GALAXY_3D_SCALE. */
const LIGHT = glow.sizes.overview
/** Ореол и точка незажжённой звезды в единицах созвездия — как в Galaxy.tsx. */
const UNLIT = { halo: 15, dot: 5, stroke: 1.2, opacity: 0.45 } as const
/** Кольца и крест ядра галактики в единицах созвездия — как в Galaxy.tsx. */
const ROOT_RINGS = [[42, 0.12], [29, 0.24], [18, 0.48]] as const
const ROOT_CROSS = { length: 24, width: 1.4, opacity: 0.6 } as const

type Sprite = HTMLCanvasElement

/** Квадратный спрайт: рисуется один раз, в кадре только масштабируется (drawImage дешевле
 * градиента). paint получает контекст с началом координат в центре и половину стороны. */
function sprite(size: number, paint: (ctx: CanvasRenderingContext2D, half: number) => void): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.translate(size / 2, size / 2)
  paint(ctx, size / 2)
  return canvas
}

/** Круг с радиальным градиентом по стопам рецепта света, центр в (0, 0). */
function disc(ctx: CanvasRenderingContext2D, r: number, stops: readonly GlowStop[]) {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  for (const stop of stops) gradient.addColorStop(stop.offset, stop.color)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Луч-ромб длиной 2·length и толщиной 2·width, сходящийся в остриё. Стопы ложатся на рамку
 * ромба, как градиент SVG в 2D: вдоль луча — весь ход, поперёк — он же, сжатый. */
function spike(ctx: CanvasRenderingContext2D, length: number, width: number, angle: number, fill: readonly GlowStop[] | string) {
  ctx.save()
  ctx.rotate(angle)
  ctx.scale(1, width / length)
  if (typeof fill === 'string') ctx.fillStyle = fill
  else {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, length)
    for (const stop of fill) gradient.addColorStop(stop.offset, stop.color)
    ctx.fillStyle = gradient
  }
  ctx.beginPath()
  ctx.moveTo(-length, 0)
  ctx.lineTo(0, -length)
  ctx.lineTo(length, 0)
  ctx.lineTo(0, length)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Глиф галактики — штрихи широких кривых; в кадре это был самый дорогой растр вблизи. */
function glyphSprite(paths: string[], hue: number): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = CONST_W * GLYPH_SPRITE_SCALE
  canvas.height = CONST_H * GLYPH_SPRITE_SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(GLYPH_SPRITE_SCALE, GLYPH_SPRITE_SCALE)
  ctx.strokeStyle = sky.glyphStroke(hue)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const shapes = paths.map((d) => new Path2D(d))
  for (const [alpha, width] of [[0.1, 15], [0.42, 4.2]] as const) {
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    for (const shape of shapes) ctx.stroke(shape)
  }
  return canvas
}

/** Имя галактики — текст растрируется один раз: при полёте размер подписи меняется каждый
 * кадр, и браузер телевизора заново набирал её шрифтом. */
function labelSprite(text: string): Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = LABEL_FONT
  canvas.width = Math.ceil(ctx.measureText(text).width) + 8
  canvas.height = Math.ceil(LABEL_PX * 1.4)
  ctx.font = LABEL_FONT // смена размера холста сбрасывает состояние контекста
  ctx.fillStyle = sky.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(text, canvas.width / 2, 2)
  return canvas
}

interface Sprites {
  lit: Record<Tier, Sprite>
  unlit: Record<Tier, Sprite>
  nebula: Map<number, Sprite>
  root: Map<number, Sprite>
  /** По id галактики; есть только у галактик с глифом. */
  glyph: Map<string, Sprite>
  /** По id галактики; заполняется, когда шрифт подписи загружен. */
  label: Map<string, Sprite>
}

function makeSprites(galaxies: SkyGalaxy3D[]): Sprites {
  const perTier = (make: (tier: Tier) => Sprite) => Object.fromEntries(TIERS.map((tier) => [tier, make(tier)])) as Record<Tier, Sprite>
  // Зажжённая звезда целиком — корона, лучи, блум с раскалённым ядром — один спрайт на ранг:
  // слои внутри звезды ложатся как в 2D, а между собой звёзды складываются уже на сцене
  const lit = perTier((tier) => sprite(256, (ctx, half) => {
    const u = half / LIGHT.corona // пикселей спрайта на единицу созвездия
    const k = tierStyle[tier].scale // спрайт потом растянут на k: толщина луча от ранга не зависит
    disc(ctx, half, coronaStops(tier))
    for (const angle of [0, Math.PI / 2]) spike(ctx, LIGHT.spikeLong * u, (LIGHT.spikeLongWidth / k) * u, angle, spikeStops(tier))
    disc(ctx, LIGHT.bloom * u, bloomStops(tier))
  }))
  const unlit = perTier((tier) => sprite(64, (ctx, half) => {
    const u = half / UNLIT.halo
    const halo = sky.rarityHalo(tier)
    ctx.globalAlpha = UNLIT.opacity
    disc(ctx, half, [{ offset: 0, color: halo.inner }, { offset: 0.34, color: halo.mid }, { offset: 1, color: halo.outer }])
    ctx.globalAlpha = 1
    ctx.fillStyle = sky.starFill(false, tier)
    ctx.strokeStyle = sky.starStroke(false, tier)
    ctx.lineWidth = (UNLIT.stroke / tierStyle[tier].scale) * u
    ctx.beginPath()
    ctx.arc(0, 0, UNLIT.dot * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }))
  const nebula = new Map<number, Sprite>()
  const root = new Map<number, Sprite>()
  for (const { hue } of galaxies) {
    if (nebula.has(hue)) continue
    nebula.set(hue, sprite(256, (ctx, half) => disc(ctx, half, nebulaStops(hue, 'overview'))))
    root.set(hue, sprite(256, (ctx, half) => {
      const u = half / (glow.root.corona * ROOT_MINI_SCALE)
      ctx.globalAlpha = ROOT_CROSS.opacity
      for (const angle of [0, Math.PI / 2]) spike(ctx, ROOT_CROSS.length * u, ROOT_CROSS.width * u, angle, sky.flare)
      ctx.globalAlpha = 1
      disc(ctx, half, rootCoronaStops(hue))
      disc(ctx, glow.root.bloom * ROOT_MINI_SCALE * u, rootBloomStops(hue))
    }))
  }
  const glyph = new Map<string, Sprite>()
  for (const g of galaxies) {
    const shape = glyphById(g.glyphId)
    if (shape) glyph.set(g.id, glyphSprite(shape.paths, g.hue))
  }
  return { lit, unlit, nebula, root, glyph, label: new Map() }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
/** Дальнее тусклее: глубина читается и без теней. */
const depthFade = (depth: number) => clamp(1.3 - depth / 2400, 0.3, 1)

function drawGalaxy(
  ctx: CanvasRenderingContext2D, g: SkyGalaxy3D, basis: CameraBasis, sprites: Sprites,
  /** Пикселей холста на пиксель страницы. */
  px: number,
  /** Имя галактики в фокусе уже стоит в подписи режима — на сцене его не дублируем. */
  named: boolean,
) {
  const center = project(g.center, basis)
  if (!center) return
  // галактика целиком за кадром — не рисуем: холст её обрежет, но штрихи и спрайты уже посчитаны
  const reach = Math.max(g.radius, glow.nebula.radius.overview[0]) * 1.25 * center.scale
  if (center.x + reach < 0 || center.x - reach > basis.cx * 2 || center.y + reach < 0 || center.y - reach > basis.cy * 2) return
  const fade = depthFade(center.depth)
  const blit = (sprite: Sprite, x: number, y: number, r: number, alpha: number) => {
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)
  }

  const unit = GALAXY_3D_SCALE // единица созвездия → единица мира

  // Небула — обычным наложением и ровно до видимого края созвездия: это самая большая заливка
  // кадра, а широкий слабый хвост белит небо вместо того, чтобы его красить
  const [nebulaRx, nebulaRy] = glow.nebula.radius.overview
  ctx.globalAlpha = fade
  ctx.drawImage(
    sprites.nebula.get(g.hue)!,
    center.x - nebulaRx * center.scale, center.y - (10 + nebulaRy) * center.scale,
    nebulaRx * 2 * center.scale, nebulaRy * 2 * center.scale,
  )

  // Глиф лежит в плоскости галактики: аффинное приближение перспективы по трём точкам
  const glyph = sprites.glyph.get(g.id)
  if (glyph) {
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
        a * px, b * px, c * px, d * px,
        (center.x - a * (CONST_W / 2) - c * (CONST_H / 2)) * px,
        (center.y - b * (CONST_W / 2) - d * (CONST_H / 2)) * px,
      )
      ctx.globalAlpha = fade
      ctx.drawImage(glyph, 0, 0, CONST_W, CONST_H)
      ctx.setTransform(px, 0, 0, px, 0, 0)
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

  // незажжённые — матовые точки своего ранга, обычным наложением
  g.stars.forEach((s, i) => {
    const p = points[i]
    if (!p || s.lit) return
    blit(sprites.unlit[s.tier], p.x, p.y, Math.max(2.2, UNLIT.halo * unit * tierStyle[s.tier].scale * STAR_SIZE * p.scale), fade)
  })

  if (core) {
    ctx.strokeStyle = sky.galaxyStroke(g.hue)
    ctx.lineWidth = 1
    for (const [r, alpha] of ROOT_RINGS) {
      ctx.globalAlpha = alpha * fade
      ctx.beginPath()
      ctx.arc(core.x, core.y, r * unit * core.scale, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Свет складывается (glow.blend.canvas): перекрывшиеся короны разгораются, а не белят друг друга
  ctx.globalCompositeOperation = glow.blend.canvas
  if (core) blit(sprites.root.get(g.hue)!, core.x, core.y, glow.root.corona * ROOT_MINI_SCALE * unit * core.scale, fade)
  g.stars.forEach((s, i) => {
    const p = points[i]
    if (!p || !s.lit) return
    const r = LIGHT.corona * unit * tierStyle[s.tier].scale * STAR_SIZE * p.scale
    blit(sprites.lit[s.tier], p.x, p.y, r, fade)
    // издалека раскалённое ядро меньше пикселя — держим его видимой точкой
    if (r * ((LIGHT.bloom * glow.bloom.plateau) / LIGHT.corona) < 0.8) {
      ctx.fillStyle = sky.litCore
      ctx.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4)
    }
  })
  ctx.globalCompositeOperation = 'source-over'

  const label = named ? project({ x: g.center.x, y: g.center.y + (CONST_H * GALAXY_3D_SCALE) / 2 + 22, z: g.center.z }, basis) : null
  // левый нижний угол занят подписью режима — имя соседней галактики туда не кладём
  const name = sprites.label.get(g.id)
  if (name && label && !(label.x < 340 && label.y > basis.cy * 2 - 130)) {
    const height = clamp(14 * label.scale, 11, 18) * (name.height / LABEL_PX)
    const width = height * (name.width / name.height)
    ctx.globalAlpha = 0.85 * fade
    ctx.drawImage(name, label.x - width / 2, label.y, width, height)
  }
}

/** 3D-небо — режим просмотра: камера сама облетает галактики (заставка), а мышью или
 * пальцем её можно взять в руки — вращать, приближать, подлетать к галактике кликом.
 * Действий над миром нет; выход — кнопка или Esc. Геометрия и правила полёта — в
 * logic/sky3d и logic/sky3dPilot, здесь только ввод и отрисовка на Canvas 2D. */
export function Sky3D({ store, layoutFrom, startAt = null, asOfDay, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scene = useMemo(() => buildSkyScene(store, layoutFrom ?? store), [store, layoutFrom])
  const plan = useMemo(() => flightPlan(scene), [scene])
  // Клавиши и таймер кнопок вешаются один раз и читают свежие onClose и план отсюда: иначе
  // каждый перерендер App и каждая синхронизация store заново показывали бы кнопки на заставке
  const latest = useRef({ onClose, plan })
  latest.current = { onClose, plan }
  // пилот переживает пересборку сцены: синхронизация store не отбрасывает камеру к началу
  const pilot = useRef<Pilot | null>(null)
  const startedAt = useRef(startAt) // галактика, с которой облёт начат или на которую его перевёл адрес
  const [focusId, setFocusId] = useState<string | null>(null)
  const [hud, setHud] = useState({ manual: false, paused: false })
  const [controls, setControls] = useState(true)
  // Облёт смотрят без пульта: пока он на экране, телевизор не уходит в заставку
  useKeepAwake(true)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    pilot.current = pilot.current ? rebasePilot(pilot.current, plan) : startPilot(plan, stopIndexOf(plan, startedAt.current))
    const sprites = makeSprites(scene.galaxies)
    // подписи — после загрузки шрифта: иначе в спрайт на весь сеанс попал бы запасной
    let alive = true
    const nameGalaxies = () => {
      if (alive) for (const g of scene.galaxies) sprites.label.set(g.id, labelSprite(g.name))
    }
    if (document.fonts?.load) document.fonts.load(LABEL_FONT).then(nameGalaxies, nameGalaxies)
    else nameGalaxies()
    const slow = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    let px = 1 // пикселей холста на пиксель страницы
    let width = 0
    let height = 0
    const resize = () => {
      px = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * px)
      canvas.height = Math.round(height * px)
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

      ctx.setTransform(px, 0, 0, px, 0, 0)
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
      for (const g of order) drawGalaxy(ctx, g, view, sprites, px, g.id !== focus || p.travelling)
      ctx.globalAlpha = 1

      const manual = p.mode === 'manual'
      if (!shown || shown.focus !== focus) setFocusId(focus)
      if (!shown || shown.manual !== manual || shown.paused !== p.paused) setHud({ manual, paused: p.paused })
      shown = { focus, manual, paused: p.paused }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
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
      const { onClose, plan } = latest.current
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
  }, [])

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
        <div className="sky3d-kicker">
          3D-небо · {asOfDay ? `${formatDayLong(asOfDay)} · ` : ''}{hud.manual ? 'ручной полёт' : hud.paused ? 'облёт · пауза' : 'облёт'}
        </div>
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
