import type { SkyStore, Tier } from '../types'
import { CONST_H, CONST_W, SKY_H, SKY_W, constellationPlacements, hashStr, layoutConstellation, mulberry32 } from './layout'
import { skillStars } from './stars'
import { constellationAsOf } from './timeline'

// 3D-небо: то же небо, что на обзоре, плюс глубина. Чистая математика без DOM —
// сцена, облёт камеры и проекция. Всё детерминировано: третья координата — seeded
// PRNG от id сущностей (как раскладка неба), камера — функция времени, без случайности.
// Мир — в единицах обзорного неба (SKY_W×SKY_H), начало в центре, ось y вниз (как на
// экране), z — от зрителя вглубь.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SkyStar3D {
  id: string
  tier: Tier
  lit: boolean
  pos: Vec3
  /** Индекс звезды-родителя в `stars` галактики; -1 — ребро от ядра. */
  parent: number
}

export interface SkyGalaxy3D {
  id: string
  name: string
  hue: number
  glyphId?: string
  /** Центр фигуры созвездия — сюда смотрит камера. */
  center: Vec3
  /** Ядро галактики — корень созвездия, от него растут треки. */
  core: Vec3
  /** Наклон фигуры в своей плоскости, градусы (тот же, что на обзоре). */
  rotation: number
  /** Радиус сферы вокруг center, в которую помещаются ядро и звёзды. */
  radius: number
  stars: SkyStar3D[]
}

export interface SkyScene3D {
  galaxies: SkyGalaxy3D[]
  /** Радиус всего неба от начала координат — под обзорный план. */
  radius: number
}

/** Глубина неба: галактики расходятся по z в ±SKY_DEPTH. */
export const SKY_DEPTH = 340
/** Масштаб созвездия на небе — как у мини-созвездий обзора (Galaxy.tsx). */
export const GALAXY_3D_SCALE = 0.25
/** Разброс звёзд по глубине внутри галактики (у ядра уже, к краям шире). */
const STAR_DEPTH = 46
const MIN_GALAXY_RADIUS = 70

const seeded = (key: string): number => mulberry32(hashStr(key))()

/** Сцена 3D-неба. Как и на обзоре, раскладка — по `layoutFrom` (сегодняшний набор),
 * видимость и свет — по `store`: в режиме истории store — проекция прошлого, галактики
 * и звёзды стоят на сегодняшних местах. Архивные навыки не рисуются. */
export function buildSkyScene(store: SkyStore, layoutFrom: SkyStore = store): SkyScene3D {
  const layoutSkills = layoutFrom.skills.filter((s) => !s.archived)
  const placements = constellationPlacements(layoutSkills.map(({ id, hue, name }) => ({ id, hue, name })))
  const galaxies: SkyGalaxy3D[] = []
  let sceneRadius = Math.hypot(SKY_W, SKY_H) / 2
  for (const skill of store.skills) {
    if (skill.archived) continue
    const place = placements.get(skill.id)
    if (!place) continue // предусловие store ⊆ layoutFrom нарушено — такой навык некуда ставить
    const center: Vec3 = {
      x: place.x - SKY_W / 2,
      y: place.y - SKY_H / 2,
      z: (seeded(`sky3d-depth:${skill.id}`) * 2 - 1) * SKY_DEPTH,
    }
    const rot = (place.rotation * Math.PI) / 180
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    /** Точка локального пространства созвездия (CONST_W×CONST_H) → мир, в плоскости галактики. */
    const toWorld = (lx: number, ly: number, dz: number): Vec3 => {
      const ox = (lx - CONST_W / 2) * GALAXY_3D_SCALE
      const oy = (ly - CONST_H / 2) * GALAXY_3D_SCALE
      return { x: center.x + ox * cos - oy * sin, y: center.y + ox * sin + oy * cos, z: center.z + dz }
    }
    const full = layoutConstellation(skillStars(layoutFrom.stars, skill.id), skill.id)
    const shown = constellationAsOf(full, skillStars(store.stars, skill.id))
    const reach = Math.max(1, ...full.nodes.map((n) => Math.hypot(n.x - full.root.x, n.y - full.root.y)))
    const stars: SkyStar3D[] = shown.nodes.map((node, i) => {
      const far = Math.hypot(node.x - full.root.x, node.y - full.root.y) / reach
      const dz = (seeded(`sky3d-star:${node.star.id}`) * 2 - 1) * STAR_DEPTH * (0.3 + 0.7 * far)
      return { id: node.star.id, tier: node.star.tier, lit: !!node.star.litAt, pos: toWorld(node.x, node.y, dz), parent: shown.edges[i][0] }
    })
    const core = toWorld(full.root.x, full.root.y, 0)
    const radius = Math.max(MIN_GALAXY_RADIUS, dist(core, center), ...stars.map((s) => dist(s.pos, center)))
    galaxies.push({
      id: skill.id, name: skill.name, hue: skill.hue,
      ...(skill.glyphId !== undefined ? { glyphId: skill.glyphId } : {}),
      center, core, rotation: place.rotation, radius, stars,
    })
    sceneRadius = Math.max(sceneRadius, Math.hypot(center.x, center.y, center.z) + radius)
  }
  return { galaxies, radius: sceneRadius }
}

// ── камера ──

export interface FlightStop {
  /** Куда смотрит камера на остановке. */
  target: Vec3
  /** Расстояние до цели на остановке. */
  distance: number
  /** Ближе к цели камеру не пускает и ручной зум: у галактики это сфера её звёзд с запасом. */
  minDistance: number
  /** Галактика остановки; null — обзор всего неба. */
  galaxyId: string | null
}

/** Камера на орбите вокруг цели: рыскание и тангаж в радианах, 0/0 — взгляд спереди. */
export interface OrbitPose {
  target: Vec3
  distance: number
  yaw: number
  pitch: number
}

/** Точка, из которой смотрит камера в позе. */
export function orbitEye(pose: OrbitPose): Vec3 {
  return {
    x: pose.target.x + pose.distance * Math.sin(pose.yaw) * Math.cos(pose.pitch),
    y: pose.target.y - pose.distance * Math.sin(pose.pitch),
    z: pose.target.z - pose.distance * Math.cos(pose.yaw) * Math.cos(pose.pitch),
  }
}

export interface FlightPlan {
  stops: FlightStop[]
  /** Секунд у каждой остановки и на перелёт к следующей; holdSec + travelSec — один шаг облёта. */
  holdSec: number
  travelSec: number
  /** Период облёта: камера в t и t + loopSec совпадает. */
  loopSec: number
}

export interface FlightFrame extends OrbitPose {
  eye: Vec3
  /** Остановка, у которой камера стоит или от которой улетает. */
  stopIndex: number
  /** Остановка в фокусе: в перелёте со второй половины пути — уже следующая. */
  focusIndex: number
  /** Галактика в фокусе (остановки focusIndex); null — обзор. */
  galaxyId: string | null
  travelling: boolean
}

export const FLIGHT_HOLD_SEC = 15
export const FLIGHT_TRAVEL_SEC = 7
/** Дистанция обзорного плана: небо целиком помещается в кадр 16:9 (см. FOCAL_K). */
const OVERVIEW_DISTANCE = 1200
/** Дистанция до галактики в её радиусах: фигура занимает около двух третей кадра. */
const GALAXY_DISTANCE_K = 3.3
/** Ближний предел у галактики в её радиусах: камера остаётся снаружи сферы звёзд. */
const GALAXY_MIN_DISTANCE_K = 1.25
/** Ближний предел на обзорной остановке. */
const OVERVIEW_MIN_DISTANCE = 400
/** Покачивание камеры вокруг цели: рыскание и тангаж, радианы. Небо всегда видно
 * «спереди» — фигуры созвездий читаются как на обзоре, глубину даёт параллакс. */
const YAW_SWING = 0.55
const PITCH_SWING = 0.16
/** У остановки камера медленно наезжает: от HOLD_FAR до HOLD_NEAR дистанции остановки. */
const HOLD_FAR = 1.12
const HOLD_NEAR = 0.92
/** В перелёте камера отходит назад — видно, откуда и куда летим. */
const TRAVEL_PULLBACK = 0.45

/** Маршрут облёта: обзор всего неба, затем галактики по кругу (по углу вокруг центра
 * неба — соседние остановки рядом, перелёты короткие), и снова обзор. */
export function flightPlan(scene: SkyScene3D): FlightPlan {
  const tour = [...scene.galaxies].sort((a, b) =>
    Math.atan2(a.center.y, a.center.x) - Math.atan2(b.center.y, b.center.x) || a.id.localeCompare(b.id))
  const stops: FlightStop[] = [
    { target: { x: 0, y: 0, z: 0 }, distance: OVERVIEW_DISTANCE, minDistance: OVERVIEW_MIN_DISTANCE, galaxyId: null },
    ...tour.map((g) => ({
      target: g.center, distance: g.radius * GALAXY_DISTANCE_K, minDistance: g.radius * GALAXY_MIN_DISTANCE_K, galaxyId: g.id,
    })),
  ]
  return {
    stops,
    holdSec: FLIGHT_HOLD_SEC,
    travelSec: FLIGHT_TRAVEL_SEC,
    loopSec: stops.length * (FLIGHT_HOLD_SEC + FLIGHT_TRAVEL_SEC),
  }
}

/** Плавный ход 0..1 с нулевой скоростью на концах. */
export const smooth = (u: number): number => u * u * (3 - 2 * u)
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) })
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Поза между a и b: u = 0 — a, u = 1 — b. Расстояние идёт по логарифму — зум ощущается ровным. */
export function mixPose(a: OrbitPose, b: OrbitPose, u: number): OrbitPose {
  return {
    target: lerp3(a.target, b.target, u),
    distance: Math.exp(lerp(Math.log(a.distance), Math.log(b.distance), u)),
    yaw: lerp(a.yaw, b.yaw, u),
    pitch: lerp(a.pitch, b.pitch, u),
  }
}

/** Камера облёта в момент t (секунды, любое число — облёт цикличен). Чистая функция
 * времени: непрерывна по t, включая стык цикла, и периодична с периодом plan.loopSec. */
export function flightCamera(plan: FlightPlan, tSec: number): FlightFrame {
  const step = plan.holdSec + plan.travelSec
  const count = plan.stops.length
  const t = ((tSec % plan.loopSec) + plan.loopSec) % plan.loopSec
  const stopIndex = Math.min(count - 1, Math.floor(t / step))
  const local = t - stopIndex * step
  const from = plan.stops[stopIndex]
  const to = plan.stops[(stopIndex + 1) % count]
  const travelling = local >= plan.holdSec

  let target: Vec3
  let distance: number
  let focusIndex = stopIndex
  if (!travelling) {
    target = from.target
    distance = from.distance * lerp(HOLD_FAR, HOLD_NEAR, local / plan.holdSec)
  } else {
    const raw = (local - plan.holdSec) / plan.travelSec
    const u = smooth(raw)
    target = lerp3(from.target, to.target, u)
    distance = lerp(from.distance * HOLD_NEAR, to.distance * HOLD_FAR, u) * (1 + TRAVEL_PULLBACK * Math.sin(Math.PI * raw))
    if (raw >= 0.5) focusIndex = (stopIndex + 1) % count
  }
  // один оборот покачивания на шаг облёта: каждая остановка начинается с одной и той же фазы
  const phase = (2 * Math.PI * t) / step
  const yaw = YAW_SWING * Math.sin(phase)
  const pitch = PITCH_SWING * Math.cos(phase)
  const pose: OrbitPose = { target, distance, yaw, pitch }
  return { ...pose, eye: orbitEye(pose), stopIndex, focusIndex, galaxyId: plan.stops[focusIndex].galaxyId, travelling }
}

// ── проекция ──

export interface CameraBasis {
  eye: Vec3
  right: Vec3
  up: Vec3
  forward: Vec3
  /** Фокусное расстояние в пикселях экрана. */
  focal: number
  cx: number
  cy: number
}

export interface Projected {
  x: number
  y: number
  /** Пикселей экрана на единицу мира на глубине точки. */
  scale: number
  /** Расстояние вдоль взгляда; больше — дальше. */
  depth: number
}

/** Фокус в долях меньшей стороны кадра: вертикальный угол обзора около 49°. */
const FOCAL_K = 1.1
/** Кадр уже 16:10 считается по ширине — небо не обрезается на узких экранах. */
const FRAME_ASPECT = 1.6
const NEAR = 8

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.y, v.z)
  return len === 0 ? { x: 0, y: 0, z: 1 } : { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** Базис камеры «взгляд из eye на target» для кадра width×height. «Верх» мира — −y. */
export function cameraBasis(camera: { eye: Vec3; target: Vec3 }, width: number, height: number): CameraBasis {
  const forward = normalize(sub(camera.target, camera.eye))
  const side = cross(forward, { x: 0, y: -1, z: 0 })
  // взгляд строго по вертикали — вырожденный случай: «право» берём по оси x
  const right = Math.hypot(side.x, side.y, side.z) < 1e-9 ? { x: 1, y: 0, z: 0 } : normalize(side)
  const up = cross(right, forward)
  return {
    eye: camera.eye, right, up, forward,
    focal: FOCAL_K * Math.min(width / FRAME_ASPECT, height),
    cx: width / 2, cy: height / 2,
  }
}

/** Точка мира → экран. null — точка за камерой или вплотную к ней: рисовать нечего. */
export function project(point: Vec3, basis: CameraBasis): Projected | null {
  const rel = sub(point, basis.eye)
  const depth = dot(rel, basis.forward)
  if (depth < NEAR) return null
  const scale = basis.focal / depth
  return { x: basis.cx + dot(rel, basis.right) * scale, y: basis.cy - dot(rel, basis.up) * scale, scale, depth }
}

/** Галактика под точкой экрана: клик попадает, если он внутри видимого круга галактики
 * (не меньше minPx — в далёкую тоже можно попасть). Из перекрывшихся — ближняя. null — мимо. */
export function pickGalaxy(scene: SkyScene3D, basis: CameraBasis, x: number, y: number, minPx = 28): string | null {
  let best: { id: string; depth: number } | null = null
  for (const g of scene.galaxies) {
    const p = project(g.center, basis)
    if (!p || Math.hypot(x - p.x, y - p.y) > Math.max(minPx, g.radius * p.scale)) continue
    if (!best || p.depth < best.depth) best = { id: g.id, depth: p.depth }
  }
  return best ? best.id : null
}

/** Направление на бесконечно далёкую точку → экран (фоновые звёзды: поворачиваются
 * вместе с камерой, но не смещаются при её движении). null — позади камеры. */
export function projectDirection(direction: Vec3, basis: CameraBasis): { x: number; y: number } | null {
  const depth = dot(direction, basis.forward)
  if (depth < 0.05) return null
  const k = basis.focal / depth
  return { x: basis.cx + dot(direction, basis.right) * k, y: basis.cy - dot(direction, basis.up) * k }
}

export interface BackdropStar {
  /** Единичный вектор на звезду. */
  direction: Vec3
  /** Радиус точки в пикселях и базовая яркость 0..1. */
  size: number
  alpha: number
  /** Фаза и скорость мерцания. */
  phase: number
  speed: number
}

/** Фоновые звёзды — равномерно по небесной сфере, детерминированно от seed. `minZ` срезает
 * сферу до шапки вокруг оси взгляда (z ≥ minZ): камера облёта назад не смотрит, и те же
 * count звёзд ложатся плотнее там, где их видно. */
export function backdropStars(count: number, seed: string, minZ = -1): BackdropStar[] {
  const rng = mulberry32(hashStr(seed))
  return Array.from({ length: count }, () => {
    const z = minZ + rng() * (1 - minZ)
    const angle = rng() * Math.PI * 2
    const ring = Math.sqrt(1 - z * z)
    const bright = rng()
    return {
      direction: { x: ring * Math.cos(angle), y: ring * Math.sin(angle), z },
      size: 0.6 + bright * bright * 1.4,
      alpha: 0.25 + bright * 0.55,
      phase: rng() * Math.PI * 2,
      speed: 0.4 + rng() * 1.1,
    }
  })
}
