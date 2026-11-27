import type { Skill, StarComponent } from '../types'

export const SKY_W = 1800
export const SKY_H = 1000

export const GALAXY_W = 1800
export const GALAXY_H = 1000

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SkyPlacement {
  x: number
  y: number
  rotation: number
}

export interface SkyPoint {
  x: number
  y: number
}

export interface SkySkill {
  id: string
  /** Когда навык создан (`Skill.createdAt`): в этом порядке галактики встают на
   * небо, при равенстве — по id. Нет или не читается — раньше всех. */
  createdAt?: string
  /** Число колец созвездия — глубина дерева звёзд навыка (`constellationRings`):
   * чем их больше, тем больше галактика в кадре обзора. Нет — полный размер. */
  rings?: number
  /** У галактики есть глиф-фигура (`Skill.glyphId`): она занимает место и без звёзд. */
  glyph?: boolean
  /** Закреплённая позиция галактики (`Skill.skyPos`); нет — место выбирает раскладка. */
  skyPos?: SkyPoint
  /** Навык в архиве с этого момента (`Skill.archivedAt`): на небе его нет. Для
   * галактик, созданных раньше, его место по-прежнему занято — от архивации они
   * не сдвигаются; созданным позже оно свободно. */
  archivedAt?: string
}

/** Центр неба: здесь встаёт первая галактика, остальные — вокруг. Небо не
 * ограничено — `SKY_W`×`SKY_H` задают только пропорции кадра и его размер при
 * масштабе 1. */
export const SKY_CENTER = { x: SKY_W / 2, y: SKY_H / 2 } as const

/** Дальше этого от начала координат галактику не закрепить (`Skill.skyPos`):
 * опечатка в координате не должна унести галактику в бесконечность, а обзор —
 * уменьшить небо до невидимого. */
export const SKY_REACH = 10000

/** Место галактики полного размера — ширина и высота её овала: веер созвездия
 * во всю коробку и подпись под ним. Центры двух таких галактик ближе этого
 * овала — (dx/x)² + (dy/y)² < 1 — значит, веера или подписи налезают.
 * Откалибровано по живому небу: его самая тесная пара (Сцена и Продукт) даёт
 * ≈1,03 и на экране стоит чисто. */
export const GALAXY_CLEARANCE = { x: 240, y: 270 } as const

/** Мини-созвездие обзорного неба: масштаб фигуры `CONST_W`×`CONST_H` и её
 * подъём над точкой галактики. */
export const MINI_SCALE = 0.25
export const MINI_LIFT = 12

/** Низ полоски опыта под подписью — от точки галактики. */
const LABEL_BOTTOM = 165
/** Полуширина подписи: имя и полоска опыта есть у любой галактики. */
const LABEL_HALF = 95
/** На столько веер вырастает вверх с каждым кольцом звёзд: шаг кольца 130 и
 * джиттер до 1,15 (`layoutConstellation`) в масштабе мини-созвездия. */
const RING_REACH = 37.5
/** Запас вокруг звезды: её гало и ядро галактики. */
const STAR_MARGIN = 14
/** Глиф-фигура за созвездием (components/skyGlyphs.ts) в масштабе мини-созвездия:
 * самые высокие поднимаются над ядром на 141 (Дельта, Перо, Кадуцей), самый
 * широкий — Штурвал, по 60 в стороны; здесь — с запасом на толщину линии. */
const GLYPH_REACH = 146
const GLYPH_HALF = 64

/** Место галактики на небе относительно её точки: веер созвездия растёт вверх
 * от ядра, подпись и полоска опыта — под ним. `top` — вверх, отрицательный. */
export interface GalaxyFootprint {
  top: number
  bottom: number
  half: number
}

/** Место галактики по тому, что в ней нарисовано. Без звёзд это ядро с подписью
 * (и глиф, если он есть); с каждым кольцом звёзд веер выше и шире — до полного
 * размера `GALAXY_CLEARANCE` (дальше звёзды уплотняются внутри той же коробки).
 * Число колец неизвестно — место полного размера. */
export function galaxyFootprint({ rings, glyph }: Pick<SkySkill, 'rings' | 'glyph'>): GalaxyFootprint {
  const full = { top: LABEL_BOTTOM - GALAXY_CLEARANCE.y, bottom: LABEL_BOTTOM, half: GALAXY_CLEARANCE.x / 2 }
  if (rings === undefined) return full
  const count = Math.max(0, rings)
  const root = CONST_ROOT.y * MINI_SCALE - (CONST_H * MINI_SCALE) / 2 - MINI_LIFT
  const fan = RING_REACH * count
  const reach = Math.max(STAR_MARGIN + fan, glyph ? GLYPH_REACH : 0)
  const half = Math.max(LABEL_HALF, STAR_MARGIN + fan * Math.sin((70 * Math.PI) / 180), glyph ? GLYPH_HALF : 0)
  return { top: Math.max(full.top, root - reach), bottom: LABEL_BOTTOM, half: Math.min(full.half, half) }
}

/** Число колец созвездия — глубина дерева звёзд навыка: корневые звёзды — первое
 * кольцо, их потомки — второе. Считает то же, что рисует `layoutConstellation`:
 * звезда с родителем не из набора в дерево не попадает. */
export function constellationRings(stars: readonly Pick<StarComponent, 'id' | 'parentStarId'>[]): number {
  const kids = new Map<string | null, string[]>()
  for (const star of stars) {
    const key = star.parentStarId ?? null
    const list = kids.get(key)
    if (list) list.push(star.id)
    else kids.set(key, [star.id])
  }
  const seen = new Set<string>()
  let rings = 0
  let level = kids.get(null) ?? []
  for (;;) {
    level = level.filter((id) => !seen.has(id))
    if (!level.length) return rings
    for (const id of level) seen.add(id)
    rings++
    level = level.flatMap((id) => kids.get(id) ?? [])
  }
}

/** Навыки неба из навыков и звёзд store — то, от чего зависит небо: порядок
 * создания и закрепление (место галактики), число колец созвездия и глиф (её
 * размер в кадре обзора). Архивные с моментом архивации тоже здесь: их места
 * заняты для галактик, созданных раньше. Архивный без момента (ушёл в архив до
 * появления `archivedAt`) на небо не влияет. Общий вход для 2D-неба, 3D-облёта
 * и машинных срезов. */
export function skySkillsOf(
  skills: readonly Pick<Skill, 'id' | 'createdAt' | 'archived' | 'archivedAt' | 'skyPos' | 'glyphId'>[],
  stars: readonly Pick<StarComponent, 'id' | 'skillId' | 'parentStarId'>[],
): SkySkill[] {
  const bySkill = new Map<string, Pick<StarComponent, 'id' | 'parentStarId'>[]>()
  for (const star of stars) {
    const list = bySkill.get(star.skillId)
    if (list) list.push(star)
    else bySkill.set(star.skillId, [star])
  }
  return skills
    .filter((skill) => !skill.archived || skill.archivedAt !== undefined)
    .map(({ id, createdAt, archived, archivedAt, skyPos, glyphId }) => ({
      id, createdAt,
      rings: constellationRings(bySkill.get(id) ?? []),
      ...(glyphId !== undefined ? { glyph: true } : {}),
      ...(skyPos ? { skyPos } : {}),
      ...(archived && archivedAt !== undefined ? { archivedAt } : {}),
    }))
}

/** Галактика как овал на плоскости: центр и полуоси. Овал — её место
 * (`galaxyFootprint`); его центр ниже точки галактики на `drop`. */
interface Body {
  id: string
  x: number
  y: number
  a: number
  b: number
  drop: number
}

function bodyOf(skill: SkySkill): Body {
  const place = galaxyFootprint(skill)
  return { id: skill.id, x: 0, y: 0, a: place.half, b: (place.bottom - place.top) / 2, drop: (place.top + place.bottom) / 2 }
}

/** Расстояние между двумя овалами в долях касания: 1 — касаются, меньше — налезают.
 * Для двух галактик полного размера это метрика `GALAXY_CLEARANCE`. */
const separation = (p: Body, q: Body): number => Math.hypot((p.x - q.x) / (p.a + q.a), (p.y - q.y) / (p.b + q.b))

/** С кем галактика `id` налезает на небе (овалы `galaxyFootprint` касаются или
 * пересекаются): пусто — стоит чисто. Для предупреждения после закрепления:
 * закреплённая точка — воля владельца, раскладка её не двигает. */
export function crowdedWith(skills: readonly SkySkill[], placements: ReadonlyMap<string, SkyPoint>, id: string): string[] {
  const bodies = new Map<string, Body>()
  for (const skill of skills) {
    const at = placements.get(skill.id)
    if (!at) continue
    const body = bodyOf(skill)
    bodies.set(skill.id, { ...body, x: at.x, y: at.y + body.drop })
  }
  const own = bodies.get(id)
  if (!own) return []
  return [...bodies.values()].filter((other) => other.id !== id && separation(own, other) < 1).map((other) => other.id)
}

/** Воздух между галактиками: места соседей не ближе этой доли касания. Небо
 * не уплотняется — с ростом числа галактик оно растёт вширь, а не в тесноту. */
export const SKY_GAP = 1.24
/** Поле вокруг неба в кадре обзора. */
const VIEW_PAD = 40

/** Место галактики в раскладке — полного размера `GALAXY_CLEARANCE`, у всех
 * одинаковое: сколько в галактике звёзд, раскладке неважно, поэтому новые
 * звёзды небо не двигают. Расстояние между местами — в долях касания: 1 —
 * касаются, `SKY_GAP` — между ними положенный воздух. */
const apart = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot((ax - bx) / GALAXY_CLEARANCE.x, (ay - by) / GALAXY_CLEARANCE.y)
/** Центр места ниже точки галактики: веер над ней выше, чем подпись под ней. */
const PLACE_DROP = LABEL_BOTTOM - GALAXY_CLEARANCE.y / 2

/** Раскладка считает в сотых: те же числа уходят в срезы и в закрепления. */
const cents = (value: number): number => Math.round(value * 100) / 100 || 0

/** Сколько мест пробуется вокруг каждой уже стоящей галактики. */
const SPOT_TRIES = 12
/** Новая галактика встаёт к соседке не вплотную: от воздуха `SKY_GAP` до этой
 * доли сверх него — иначе небо складывалось бы в соты. */
const SPOT_SPREAD = 0.35
/** Случайная (от id галактики) добавка к цене места: без неё небо росло бы
 * ровными кольцами вокруг середины. */
const SPOT_NOISE = 0.5
/** Вес кадра в цене места: место, из-за которого обзору пришлось бы отъехать,
 * дороже — небо заполняет экран, а не тянется в одну сторону. */
const SPOT_FRAME = 0.7
/** Цена места на одной высоте с соседкой (ближе `ROW_SPAN` мест по горизонтали,
 * в полосе `ROW_BAND` высоты места): галактики не выстраиваются в ряды. */
const SPOT_ROW = 1
const ROW_SPAN = 3
const ROW_BAND = 0.3
/** Небо растёт овалом, вписанным в кадр `SKY_W`:`SKY_H`: его полуоси в местах
 * галактик связаны как rx = `OVAL_STRETCH`·ry + `OVAL_CORE` (поля кадра и само
 * место по высоте съедают больше, чем по ширине). */
const OVAL_STRETCH = ((SKY_W / SKY_H) * GALAXY_CLEARANCE.y) / GALAXY_CLEARANCE.x
const OVAL_CORE = ((SKY_W / SKY_H) * (GALAXY_CLEARANCE.y / 2 + VIEW_PAD) - (GALAXY_CLEARANCE.x / 2 + VIEW_PAD)) / GALAXY_CLEARANCE.x

/** Галактика в очереди на небо: когда создана и с какого момента в архиве
 * (`Infinity` — не в архиве). Время — миллисекунды: строки ISO с разными
 * поясами как строки не сравнить. */
interface Arrival {
  id: string
  born: number
  gone: number
}

/** Момент из строки ISO; дробные секунды длиннее миллисекунд обрезаются — их
 * разбирают не все движки. Нет строки или она не читается — `fallback`. */
function momentOf(iso: string | undefined, fallback: number): number {
  if (iso === undefined) return fallback
  const ms = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isNaN(ms) ? fallback : ms
}

/** Места галактик без оглядки на закрепления: точки неба в порядке очереди.
 * Галактики встают по одной. Первая — в центр; каждая следующая пробует места
 * вокруг уже стоящих (случайные, но детерминированные от её id) и берёт самое
 * дешёвое из свободных: ближе к середине неба, не раздвигает кадр, не в ряд с
 * соседками. Место зависит только от галактик, вставших раньше, — поэтому новая
 * галактика никого не двигает: небо из n галактик — начало неба из n+1.
 * Галактика, ушедшая в архив до появления новой, для неё уже не стоит. */
function naturalSpots(queue: readonly Arrival[]): SkyPoint[] {
  const all: SkyPoint[] = []
  const ratio = SKY_W / SKY_H
  for (const { id, born } of queue) {
    const spots = all.filter((_, i) => queue[i].gone > born)
    let spot: SkyPoint | null = null
    if (!spots.length) spot = { x: SKY_CENTER.x, y: SKY_CENTER.y - PLACE_DROP }
    else {
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const at of spots) {
        x0 = Math.min(x0, at.x)
        x1 = Math.max(x1, at.x)
        y0 = Math.min(y0, at.y)
        y1 = Math.max(y1, at.y)
      }
      const rnd = mulberry32(hashStr(`sky-spot:${id}`))
      const midX = (x0 + x1) / 2
      const midY = (y0 + y1) / 2
      let bestCost = Infinity
      for (const near of spots) {
        for (let k = 0; k < SPOT_TRIES; k++) {
          const angle = rnd() * Math.PI * 2
          const reach = SKY_GAP * (1 + SPOT_SPREAD * rnd())
          const noise = SPOT_NOISE * rnd()
          const x = cents(near.x + Math.cos(angle) * reach * GALAXY_CLEARANCE.x)
          const y = cents(near.y + Math.sin(angle) * reach * GALAXY_CLEARANCE.y)
          const away = Math.hypot(
            Math.max(0, Math.abs(x - midX) / GALAXY_CLEARANCE.x - OVAL_CORE) / OVAL_STRETCH,
            (y - midY) / GALAXY_CLEARANCE.y,
          )
          // ширина кадра, в который небо поместится вместе с этим местом, — в ширинах места
          const frame = Math.max(
            Math.max(x1, x) - Math.min(x0, x) + GALAXY_CLEARANCE.x + VIEW_PAD * 2,
            (Math.max(y1, y) - Math.min(y0, y) + GALAXY_CLEARANCE.y + VIEW_PAD * 2) * ratio,
          ) / GALAXY_CLEARANCE.x
          let cost = away + noise + SPOT_FRAME * frame
          if (cost >= bestCost) continue
          let free = true
          for (const other of spots) {
            if (apart(x, y, other.x, other.y) < SKY_GAP) {
              free = false
              break
            }
            if (Math.abs(x - other.x) < ROW_SPAN * GALAXY_CLEARANCE.x)
              cost += SPOT_ROW * Math.max(0, 1 - Math.abs(y - other.y) / (ROW_BAND * GALAXY_CLEARANCE.y))
          }
          if (!free || cost >= bestCost) continue
          spot = { x, y }
          bestCost = cost
        }
      }
      // все пробы заняты (небо не ограничено, так что это теория) — правее всех
      spot ??= { x: cents(x1 + SKY_GAP * GALAXY_CLEARANCE.x + 1), y: cents(midY) }
    }
    all.push(spot)
  }
  return all
}

/** Шаг сетки, по которой ищется свободное место галактике, которой не хватило воздуха. */
const FREE_SPOT_STEP = 10
const FREE_SPOT_RINGS = 2000
/** Рядом с закреплённой раскладка терпит чуть меньше воздуха: закрепление по
 * целым координатам (их показывает `place`) не должно сдвигать соседей. */
const PIN_SLACK = 0.01

/** Занятая точка неба: закреплена ли и до какого момента занята (архив). */
interface Taken extends SkyPoint {
  pinned: boolean
  gone: number
}

/** Ближайшая к точке `from` точка, где месту галактики хватает воздуха до всех
 * `taken`: небо не ограничено, такая точка есть всегда. */
function freeSpotNear(from: SkyPoint, taken: readonly SkyPoint[]): SkyPoint {
  let best = from
  let bestDist = Infinity
  const tryAt = (ix: number, iy: number): void => {
    const dist = ix * ix + iy * iy
    if (dist >= bestDist) return
    const x = cents(from.x + ix * FREE_SPOT_STEP)
    const y = cents(from.y + iy * FREE_SPOT_STEP)
    if (taken.some((other) => apart(x, y, other.x, other.y) < SKY_GAP)) return
    best = { x, y }
    bestDist = dist
  }
  // Квадратные кольца вокруг своей точки; нашлось в кольце k — до k·√2 может
  // лежать точка ближе по прямой, дальше искать незачем.
  let last = FREE_SPOT_RINGS
  for (let ring = 1; ring <= last; ring++) {
    for (let i = -ring; i <= ring; i++) {
      tryAt(i, -ring)
      tryAt(i, ring)
    }
    for (let i = -ring + 1; i < ring; i++) {
      tryAt(-ring, i)
      tryAt(ring, i)
    }
    if (bestDist < Infinity) last = Math.min(last, Math.ceil(ring * Math.SQRT2))
  }
  return best
}

/** Раскладка обзорного неба. Галактики встают на небо по одной, в порядке
 * создания навыков: каждая берёт свободное место рядом с уже стоящими
 * (`naturalSpots`) и больше с него не уходит. Новая галактика небо не
 * переставляет; новые звёзды — тоже: место у всех одного размера
 * `GALAXY_CLEARANCE`, между местами воздух `SKY_GAP`. Небо не ограничено и не
 * уплотняется: больше галактик — шире небо, кадр обзора (`skyView`) отъезжает.
 *
 * Закреплённая (`skyPos`) стоит в своей точке, а её место остаётся пустым.
 * Незакреплённая, которой закреплённые не оставили воздуха, отходит в ближайшую
 * свободную точку; выбирают по порядку создания, так что и здесь новая
 * галактика прежних не двигает. Архивной (`archivedAt`) на небе нет; её место —
 * собственное или закреплённое — занято для галактик, созданных до архивации
 * (они не сдвигаются), и свободно для созданных после. Поворот — от id. */
export function constellationPlacements(skills: SkySkill[]): Map<string, SkyPlacement> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const result = new Map<string, SkyPlacement>()
  if (!byId.size) return result

  const queue = [...byId.values()]
    .map((skill) => ({ skill, id: skill.id, born: momentOf(skill.createdAt, -Infinity), gone: momentOf(skill.archivedAt, Infinity) }))
    .sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const spots = naturalSpots(queue)

  // занятые точки: сначала все закреплённые, потом — незакреплённые по мере расстановки
  const taken: Taken[] = []
  for (const { skill, gone } of queue) if (skill.skyPos) taken.push({ ...skill.skyPos, pinned: true, gone })
  const pins = taken.length

  queue.forEach(({ skill, born, gone }, i) => {
    let at = skill.skyPos
    if (!at) {
      at = spots[i]
      // без закреплений все стоят на своих местах — воздух между ними уже есть
      if (pins) {
        const { x, y } = at
        // ушедшие в архив до появления этой галактики ей не мешают
        const around = taken.filter((other) => other.gone > born)
        if (around.some((other) => apart(x, y, other.x, other.y) < (other.pinned ? SKY_GAP - PIN_SLACK : SKY_GAP)))
          at = freeSpotNear(at, around)
      }
      taken.push({ x: at.x, y: at.y, pinned: false, gone })
    }
    if (skill.archivedAt !== undefined) return
    const angleRng = mulberry32(hashStr(`sky-rotation:${skill.id}`))
    const rotation = Number(((angleRng() * 2 - 1) * 7).toFixed(2))
    result.set(skill.id, { x: at.x, y: at.y, rotation })
  })
  return result
}

/** Кадр обзора — какой кусок неба виден целиком. */
export interface SkyView {
  x: number
  y: number
  w: number
  h: number
}

/** Сильнее этого обзор не приближает: одна галактика не растягивается на весь экран. */
export const SKY_MAX_ZOOM = 1.6

/** Кадр, в который помещается всё небо: места всех галактик (`galaxyFootprint`)
 * с полем вокруг, в пропорциях `SKY_W`:`SKY_H`. Небо выросло — кадр шире и
 * галактики на экране мельче (отъезд камеры); небо маленькое — кадр уже и они
 * крупнее, но не больше `SKY_MAX_ZOOM`. Пустое небо — кадр масштаба 1. */
export function skyView(skills: readonly SkySkill[], placements: ReadonlyMap<string, SkyPoint>): SkyView {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const skill of skills) {
    const at = placements.get(skill.id)
    if (!at) continue
    const place = galaxyFootprint(skill)
    x0 = Math.min(x0, at.x - place.half)
    x1 = Math.max(x1, at.x + place.half)
    y0 = Math.min(y0, at.y + place.top)
    y1 = Math.max(y1, at.y + place.bottom)
  }
  if (x0 > x1) return { x: 0, y: 0, w: SKY_W, h: SKY_H }
  const w = Math.max(x1 - x0 + VIEW_PAD * 2, ((y1 - y0 + VIEW_PAD * 2) * SKY_W) / SKY_H, SKY_W / SKY_MAX_ZOOM)
  const h = (w * SKY_H) / SKY_W
  const round = (value: number) => Number(value.toFixed(2))
  return { x: round((x0 + x1) / 2 - w / 2), y: round((y0 + y1) / 2 - h / 2), w: round(w), h: round(h) }
}

export const CONST_W = 1000
export const CONST_H = 900
/** Корень созвездия — ядро галактики внизу фигуры (локальное пространство лаборатории). */
export const CONST_ROOT = { x: 500, y: 810 } as const

export interface ConstellationNode {
  star: StarComponent
  depth: number
  x: number
  y: number
}

export interface Constellation {
  root: { x: number; y: number }
  nodes: ConstellationNode[]
  /** [a, b] — индексы в nodes; a = -1 означает ребро от корня */
  edges: [number, number][]
}

function relax(nodes: ConstellationNode[], iters: number): void {
  const MIN_D = 34
  for (let iter = 0; iter < iters; iter++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x
        const dy = nodes[j].y - nodes[i].y
        const d = Math.hypot(dx, dy)
        if (d >= MIN_D) continue
        const ux = d === 0 ? 1 : dx / d // полное совпадение — детерминированный сдвиг вбок
        const uy = d === 0 ? 0 : dy / d
        const push = (MIN_D - d) / 2
        nodes[i].x -= ux * push
        nodes[i].y -= uy * push
        nodes[j].x += ux * push
        nodes[j].y += uy * push
        moved = true
      }
    }
    if (!moved) break
  }
}

/** Скелет дерева звёзд навыка: радиальная раскладка вложенными угловыми
 * клиньями. Каждое поддерево получает клин пропорционально числу листьев,
 * клинья детей рекурсивно делят клин родителя — поддеревья живут в
 * непересекающихся секторах, и рёбра не скрещиваются по построению
 * (прод-баг 2026-07-20: свободный веер давал скрещенные ветки).
 * Глубина = кольцо радиуса от якоря над корнем. Детерминировано от seed. */
export function layoutConstellation(stars: StarComponent[], seed: string): Constellation {
  const rng = mulberry32(hashStr(seed + ':constellation'))
  const nodes: ConstellationNode[] = []
  const edges: [number, number][] = []
  const canonical = (a: StarComponent, b: StarComponent) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  const kids = new Map<string | null, StarComponent[]>()
  for (const s of [...stars].sort(canonical)) {
    const key = s.parentStarId ?? null
    kids.set(key, [...(kids.get(key) ?? []), s])
  }
  const depthOf = (list: StarComponent[] | undefined, d: number): number =>
    !list?.length ? d : Math.max(...list.map((s) => depthOf(kids.get(s.id), d + 1)))
  const maxDepth = depthOf(kids.get(null), 0)
  const leavesOf = (s: StarComponent): number => {
    const own = kids.get(s.id)
    return own?.length ? own.reduce((acc, k) => acc + leavesOf(k), 0) : 1
  }

  const anchor = { x: CONST_ROOT.x, y: CONST_ROOT.y - 26 }
  const TOP = 88
  const SIDE = 70
  // Кольцо на уровень глубины: бюджет высоты делится на глубину дерева.
  const step = Math.min(130, (anchor.y - TOP) / Math.max(maxDepth, 1))
  const maxRadius = step * Math.max(maxDepth, 1)
  const tilt = (rng() - 0.5) * 0.16
  // Полураствор кроны: не шире 70° и не шире, чем позволяет рамка по x
  // на максимальном радиусе (с поправкой на наклон оси).
  const halfSpread = Math.min(
    (70 * Math.PI) / 180,
    Math.asin(Math.min(1, (CONST_W / 2 - SIDE) / maxRadius)) - Math.abs(tilt),
  )
  const axis = -Math.PI / 2 + tilt

  const place = (children: StarComponent[], from: number, to: number, parentIdx: number, parentR: number, depth: number): void => {
    if (!children.length) return
    const weights = children.map(leavesOf)
    const totalWeight = weights.reduce((acc, w) => acc + w, 0)
    // Пол ширины клина: сиблинги на кольце не ближе ~34px по хорде, но не
    // шире равной доли; остаток клина делится пропорционально листьям.
    const ringR = parentR + step
    const minShare = Math.min(2 * Math.asin(Math.min(1, 17 / ringR)), (to - from) / children.length)
    const rest = to - from - minShare * children.length
    let a = from
    children.forEach((star, i) => {
      const w = minShare + rest * (weights[i] / totalWeight)
      const r = parentR + step * (0.85 + rng() * 0.3)
      // Джиттер угла ограничен своим клином и ±6px по дуге — цепочки без
      // развилок остаются почти прямыми лучами.
      const angle = a + w / 2 + (rng() - 0.5) * Math.min(w, 12 / r)
      const x = anchor.x + Math.cos(angle) * r
      const y = anchor.y + Math.sin(angle) * r
      nodes.push({ star, depth, x, y })
      edges.push([parentIdx, nodes.length - 1])
      place(kids.get(star.id) ?? [], a, a + w, nodes.length - 1, r, depth + 1)
      a += w
    })
  }
  place(kids.get(null) ?? [], axis - halfSpread, axis + halfSpread, -1, 0, 0)

  // Вписывание в кадр: без него жёсткий кламп ниже складывал все звёзды
  // верхней ступени на одну линию y=78 — «горизонт» вместо рисунка. Равномерное
  // сжатие к якорю над корнем сохраняет форму лестницы (подобие — рёбра не
  // скрещиваются); поля глубже клампа, чтобы relax не выталкивал узлы на границу.
  let fit = 1
  for (const n of nodes) {
    if (n.y < TOP) fit = Math.min(fit, (anchor.y - TOP) / (anchor.y - n.y))
    if (n.x > CONST_W - SIDE) fit = Math.min(fit, (CONST_W - SIDE - anchor.x) / (n.x - anchor.x))
    if (n.x < SIDE) fit = Math.min(fit, (anchor.x - SIDE) / (anchor.x - n.x))
  }
  if (fit < 1)
    for (const n of nodes) {
      n.x = anchor.x + (n.x - anchor.x) * fit
      n.y = anchor.y + (n.y - anchor.y) * fit
    }

  const clamp = (): void => {
    for (const n of nodes) {
      n.x = Math.min(Math.max(n.x, 60), CONST_W - 60)
      n.y = Math.min(Math.max(n.y, 78), CONST_ROOT.y - 40)
    }
  }

  // relax слеп к рёбрам и в плотных деревьях может протолкнуть звезду через
  // чужое ребро. Клиновая раскладка скрещиваний не даёт — если после
  // relax/клампа они появились, откатываемся к чистой клиновой геометрии:
  // отсутствие скрещиваний важнее идеального зазора между звёздами.
  const hasCrossings = (): boolean => {
    const pt = (i: number) => (i < 0 ? CONST_ROOT : nodes[i])
    const side = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const [p1, p2] = [pt(edges[i][0]), pt(edges[i][1])]
        const [p3, p4] = [pt(edges[j][0]), pt(edges[j][1])]
        const d1 = side(p3, p4, p1)
        const d2 = side(p3, p4, p2)
        const d3 = side(p1, p2, p3)
        const d4 = side(p1, p2, p4)
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
      }
    return false
  }
  const snapshot = nodes.map((n) => ({ x: n.x, y: n.y }))

  relax(nodes, 12)
  clamp()
  relax(nodes, 12) // после клампа возможны новые касания у границ
  clamp() // второй relax мог вытолкнуть узлы обратно за границы — гарантия границ важнее
  if (hasCrossings()) {
    nodes.forEach((n, i) => {
      n.x = snapshot[i].x
      n.y = snapshot[i].y
    })
    clamp()
  }

  return { root: { x: CONST_ROOT.x, y: CONST_ROOT.y }, nodes, edges }
}
