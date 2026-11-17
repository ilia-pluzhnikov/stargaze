import { useEffect, useMemo, useRef, useState } from 'react'
import { TIERS } from '../types'
import type { SkyStore, Tier } from '../types'
import { CONST_H, CONST_W } from '../logic/layout'
import {
  GALAXY_3D_SCALE, backdropStars, buildSkyScene, cameraBasis, flightCamera, flightPlan, project, projectDirection,
} from '../logic/sky3d'
import type { CameraBasis, SkyGalaxy3D, Vec3 } from '../logic/sky3d'
import { glyphById } from './skyGlyphs'
import { sky, tierStyle } from './skyColors'
import { rootCoronaStops } from './skyGlow'

interface Props {
  store: SkyStore
  /** Сегодняшнее небо для раскладки; нет = то же, что store (см. Sky). */
  layoutFrom?: SkyStore
  onClose: () => void
}

/** Кадров в секунду: заставке хватает, слабому браузеру телевизора — посильно. */
const FPS = 30
/** Плотность пикселей холста сверху ограничена: 4K-телевизор не рисует вчетверо больше. */
const MAX_DPR = 1.5
/** Сколько секунд после движения мыши или клавиши видны кнопки. */
const CONTROLS_SEC = 4
/** Фон — шапка сферы: камера качается вокруг взгляда «спереди» и назад не смотрит. */
const BACKDROP = backdropStars(1100, 'stargaze-sky3d', 0.3)
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

/** 3D-небо — режим просмотра: камера сама облетает галактики (заставка). Действий нет;
 * выход — кнопка или Esc. Вся геометрия — в logic/sky3d, здесь только отрисовка на Canvas 2D. */
export function Sky3D({ store, layoutFrom, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scene = useMemo(() => buildSkyScene(store, layoutFrom ?? store), [store, layoutFrom])
  const plan = useMemo(() => flightPlan(scene), [scene])
  // время облёта переживает пересборку сцены: синхронизация store не отбрасывает камеру к началу
  const clock = useRef({ sec: 0, last: 0, paused: false })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [controls, setControls] = useState(true)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
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

    let shownFocus: string | null | undefined
    let raf = 0
    let lastDraw = 0
    clock.current.last = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - lastDraw < 1000 / FPS - 2) return
      lastDraw = now
      const c = clock.current
      // облёт идёт по настоящему времени и при редких кадрах (слабый браузер, окно в фоне);
      // пауза дольше секунды — вкладку прятали — камеру не перебрасывает
      if (c.last && !c.paused) c.sec += Math.min(1, (now - c.last) / 1000) * slow
      c.last = now
      const camera = flightCamera(plan, c.sec)
      const basis = cameraBasis(camera, width, height)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#dfe6ff'
      for (const s of BACKDROP) {
        const p = projectDirection(s.direction, basis)
        if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue
        ctx.globalAlpha = s.alpha * (0.72 + 0.28 * Math.sin(c.sec * s.speed + s.phase))
        ctx.fillRect(p.x, p.y, s.size, s.size)
      }
      const depthOf = (p: Vec3) =>
        (p.x - basis.eye.x) * basis.forward.x + (p.y - basis.eye.y) * basis.forward.y + (p.z - basis.eye.z) * basis.forward.z
      const order = [...scene.galaxies].sort((a, b) => depthOf(b.center) - depthOf(a.center))
      for (const g of order) drawGalaxy(ctx, g, basis, sprites, glyphs, dpr, g.id !== camera.galaxyId || camera.travelling)
      ctx.globalAlpha = 1

      if (camera.galaxyId !== shownFocus) {
        shownFocus = camera.galaxyId
        setFocusId(camera.galaxyId)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [scene, plan])

  // Кнопки видны, пока человек шевелится; в покое остаётся чистая заставка без курсора
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setControls(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setControls(false), CONTROLS_SEC * 1000)
    }
    const onKey = (e: KeyboardEvent) => {
      const step = plan.holdSec + plan.travelSec
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') clock.current.sec = (Math.floor(clock.current.sec / step) + 1) * step
      else if (e.key === 'ArrowLeft') clock.current.sec = (Math.ceil(clock.current.sec / step) - 1) * step
      else if (e.key === ' ') {
        e.preventDefault()
        clock.current.paused = !clock.current.paused
        setPaused(clock.current.paused)
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

  return (
    <div className={controls ? 'sky3d' : 'sky3d idle'} role="dialog" aria-label="3D-небо">
      <canvas ref={canvasRef} />
      <div className="sky3d-caption">
        <div className="sky3d-kicker">3D-небо · облёт{paused ? ' · пауза' : ''}</div>
        <div className="sky3d-name">{focus ? focus.name : 'Всё небо'}</div>
        <div className="sky3d-meta">
          {total > 0 ? `зажжено ${lit} из ${total}` : focus ? 'без звёзд' : scene.galaxies.length ? 'звёзд пока нет' : 'навыков пока нет'}
        </div>
      </div>
      <div className="sky3d-controls">
        <span className="sky3d-hint">← → галактики · пробел — пауза · Esc — выход</span>
        <button className="sky-reset" onClick={onClose} title="Вернуться к обычному небу">✕ Выйти из 3D</button>
      </div>
    </div>
  )
}
