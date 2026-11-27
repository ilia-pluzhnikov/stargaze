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
  hue: number
  name?: string
  /** Число колец созвездия — глубина дерева звёзд навыка (`constellationRings`):
   * чем их больше, тем больше места галактика занимает на небе. Нет — полный размер. */
  rings?: number
  /** У галактики есть глиф-фигура (`Skill.glyphId`): она занимает место и без звёзд. */
  glyph?: boolean
  /** Закреплённая позиция галактики (`Skill.skyPos`); нет — место выбирает раскладка. */
  skyPos?: SkyPoint
}

/** Центр вселенной: вокруг него рассыпаются галактики. Небо не ограничено —
 * `SKY_W`×`SKY_H` задают только пропорции кадра и его размер при масштабе 1. */
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

/** Навыки неба из навыков и звёзд store: архивные не светят, остальное — то, от
 * чего зависит раскладка (оттенок, число колец созвездия, глиф, закрепление).
 * Общий вход для 2D-неба, 3D-облёта и машинных срезов. */
export function skySkillsOf(
  skills: readonly Pick<Skill, 'id' | 'hue' | 'name' | 'archived' | 'skyPos' | 'glyphId'>[],
  stars: readonly Pick<StarComponent, 'id' | 'skillId' | 'parentStarId'>[],
): SkySkill[] {
  const bySkill = new Map<string, Pick<StarComponent, 'id' | 'parentStarId'>[]>()
  for (const star of stars) {
    const list = bySkill.get(star.skillId)
    if (list) list.push(star)
    else bySkill.set(star.skillId, [star])
  }
  return skills
    .filter((skill) => !skill.archived)
    .map(({ id, hue, name, skyPos, glyphId }) => ({
      id, hue, name,
      rings: constellationRings(bySkill.get(id) ?? []),
      ...(glyphId !== undefined ? { glyph: true } : {}),
      ...(skyPos ? { skyPos } : {}),
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

/** Воздух между галактиками: центры соседей не ближе этой доли касания. Небо
 * не уплотняется — с ростом числа галактик растёт вселенная, а не теснота. */
export const SKY_GAP = 1.24
/** Поле вокруг неба в кадре обзора. */
const VIEW_PAD = 40
/** Доля вселенной, занятая галактиками с их воздухом, с которой начинается
 * подбор её размера; не уложилось — вселенная растёт шагами `UNIVERSE_GROWTH`. */
const SKY_FILL = 0.6
const UNIVERSE_GROWTH = 1.04
const UNIVERSE_ATTEMPTS = 80
/** Сколько случайных точек пробуется на каждую галактику («лучший кандидат»). */
const CANDIDATES = 40
const RELAX_ITERATIONS = 120

/** Вселенная — горизонтальный овал, вписанный в кадр шириной `w` с пропорциями
 * `SKY_W`:`SKY_H`: в нём лежат центры галактик, поля — под саму галактику. */
function universeOf(w: number): { rx: number; ry: number } {
  const h = (w * SKY_H) / SKY_W
  return {
    rx: Math.max(1, w / 2 - GALAXY_CLEARANCE.x / 2 - VIEW_PAD),
    ry: Math.max(1, h / 2 - GALAXY_CLEARANCE.y / 2 - VIEW_PAD),
  }
}

/** Ширина кадра, с которой начинается подбор вселенной: площадь овала вместе с
 * каймой под галактики равна площади всех галактик с воздухом, делённой на
 * `SKY_FILL`. Больше галактик или колец — шире вселенная (как корень из площади). */
function universeStart(bodies: readonly Body[]): number {
  let area = 0
  let a = 0
  let b = 0
  for (const body of bodies) {
    area += body.a * body.b
    a += body.a
    b += body.b
  }
  const need = (area * SKY_GAP * SKY_GAP) / SKY_FILL
  const ratio = SKY_H / SKY_W
  // (X + p)(X·ratio + q) = need, X — половина ширины кадра
  const p = (SKY_GAP * a) / bodies.length - GALAXY_CLEARANCE.x / 2 - VIEW_PAD
  const q = (SKY_GAP * b) / bodies.length - GALAXY_CLEARANCE.y / 2 - VIEW_PAD
  const k = q + p * ratio
  return (-k + Math.sqrt(k * k - 4 * ratio * (p * q - need))) / ratio
}

/** Во сколько раз расстояние по горизонтали весит больше при выборе точек
 * россыпи: вселенная шире, чем выше (`SKY_W`:`SKY_H`), а место галактики выше,
 * чем шире. Постоянное число, а не размеры вселенной: рисунок россыпи не должен
 * зависеть от того, насколько она выросла. */
const SPOT_STRETCH = ((SKY_W / SKY_H) * GALAXY_CLEARANCE.y) / GALAXY_CLEARANCE.x

/** Рисунок россыпи: n точек единичного круга, случайных, но детерминированных
 * от `seed`. «Лучший кандидат» — из `CANDIDATES` случайных берётся самая далёкая
 * от уже поставленных, поэтому россыпь ровная, но без рядов. Точки идут по углу
 * вокруг центра, начиная за самым широким просветом: галактики в круговом
 * порядке hue встают на них подряд, и похожие цвета остаются соседями.
 *
 * Рисунок зависит только от набора id и числа галактик — не от их размеров:
 * когда созвездие вырастает, вселенная растягивается, а галактики остаются на
 * своих местах россыпи. */
function scatterSpots(n: number, seed: string): SkyPoint[] {
  const rnd = mulberry32(hashStr(`sky-scatter:${seed}`))
  const spots: { x: number; y: number; angle: number }[] = []
  for (let i = 0; i < n; i++) {
    let best = { x: 0, y: 0, angle: 0 }
    let bestScore = -1
    for (let k = 0; k < CANDIDATES; k++) {
      // равномерно по площади круга: корень из случайного радиуса
      const radius = Math.sqrt(rnd())
      const angle = rnd() * Math.PI * 2
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      let score = Infinity
      for (const spot of spots) score = Math.min(score, ((x - spot.x) * SPOT_STRETCH) ** 2 + (y - spot.y) ** 2)
      if (score > bestScore) {
        best = { x, y, angle }
        bestScore = score
      }
    }
    spots.push(best)
  }
  spots.sort((p, q) => p.angle - q.angle || p.x - q.x || p.y - q.y)
  let start = 0
  let largestGap = -1
  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? spots[0].angle + Math.PI * 2 : spots[i + 1].angle
    if (next - spots[i].angle > largestGap) {
      largestGap = next - spots[i].angle
      start = (i + 1) % n
    }
  }
  return spots.map((_, i) => spots[(start + i) % n])
}

/** Одна попытка россыпи во вселенной шириной `w`: галактики встают на точки
 * рисунка `spots` (по порядку), растянутого на овал вселенной, и расталкиваются
 * до воздуха `SKY_GAP`. false — не уложились, вселенная мала. */
function scatter(bodies: Body[], spots: readonly SkyPoint[], w: number): boolean {
  const n = bodies.length
  const { rx, ry } = universeOf(w)
  bodies.forEach((body, i) => {
    body.x = SKY_CENTER.x + spots[i].x * rx
    body.y = SKY_CENTER.y + spots[i].y * ry
  })

  // Расталкивание: пары ближе воздуха расходятся (Якоби — все сдвиги считаются
  // от прежних позиций), центры остаются в овале вселенной. Плоские массивы и
  // пары i<j: расчёт идёт в рендере, на телевизоре каждая попытка на счету.
  const reach = SKY_GAP + 0.02
  const sx = new Float64Array(n)
  const sy = new Float64Array(n)
  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    sx.fill(0)
    sy.fill(0)
    let crowded = false
    for (let i = 0; i < n; i++) {
      const p = bodies[i]
      for (let j = i + 1; j < n; j++) {
        const q = bodies[j]
        const spanX = p.a + q.a
        const spanY = p.b + q.b
        const nx = (p.x - q.x) / spanX
        const ny = (p.y - q.y) / spanY
        const d = Math.sqrt(nx * nx + ny * ny)
        if (d >= reach) continue
        crowded = true
        // совпали — расходятся по x в разные стороны
        const ux = d < 1e-9 ? 1 : nx / d
        const uy = d < 1e-9 ? 0 : ny / d
        const push = (reach - d) / 2
        sx[i] += ux * push * spanX
        sy[i] += uy * push * spanY
        sx[j] -= ux * push * spanX
        sy[j] -= uy * push * spanY
      }
    }
    if (!crowded) return true
    for (let i = 0; i < n; i++) {
      const dx = bodies[i].x + sx[i] - SKY_CENTER.x
      const dy = bodies[i].y + sy[i] - SKY_CENTER.y
      const out = (dx / rx) ** 2 + (dy / ry) ** 2
      const back = out > 1 ? 1 / Math.sqrt(out) : 1
      bodies[i].x = SKY_CENTER.x + dx * back
      bodies[i].y = SKY_CENTER.y + dy * back
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (separation(bodies[i], bodies[j]) < SKY_GAP) return false
  return true
}

/** Шаг сетки, по которой ищется свободное место галактике, налезшей на закреплённую. */
const FREE_SPOT_STEP = 10
const FREE_SPOT_RINGS = 2000

/** Закреплённые галактики стоят где стоят, остальные — на своих местах россыпи.
 * Незакреплённая, которой закреплённая не оставила воздуха, переезжает в
 * ближайшую свободную точку: небо не ограничено, такая точка есть всегда.
 * Кому закреплённые не мешают, не двигается — закрепление галактики на её же
 * месте небо не меняет. */
function settle(bodies: readonly Body[], pinned: ReadonlySet<string>): void {
  const placed = bodies.filter((body) => pinned.has(body.id))
  const moving: Body[] = []
  // допуск: закреплённая точка округлена до сотых, россыпь — нет
  for (const body of bodies) {
    if (pinned.has(body.id)) continue
    if (placed.some((pin) => separation(body, pin) < SKY_GAP - 0.01)) moving.push(body)
  }
  for (const body of bodies) if (!pinned.has(body.id) && !moving.includes(body)) placed.push(body)
  for (const body of moving) {
    const x0 = body.x
    const y0 = body.y
    let bestX = x0
    let bestY = y0
    let bestDist = Infinity
    const tryAt = (ix: number, iy: number): void => {
      const dist = ix * ix + iy * iy
      if (dist >= bestDist) return
      body.x = x0 + ix * FREE_SPOT_STEP
      body.y = y0 + iy * FREE_SPOT_STEP
      if (placed.some((other) => separation(body, other) < SKY_GAP)) return
      bestX = body.x
      bestY = body.y
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
    body.x = bestX
    body.y = bestY
    placed.push(body)
  }
}

/** Раскладка обзорного неба. Вселенная — горизонтальный овал, который растёт
 * вместе с небом: у каждой галактики своё место-овал (`galaxyFootprint`, растёт
 * с числом колец созвездия), между местами — воздух `SKY_GAP`, и размер
 * вселенной подбирается под их общую площадь. Небо не уплотняется и не
 * выстраивается в ряды: больше галактик — шире вселенная, а кадр обзора
 * (`skyView`) отъезжает, чтобы показать её целиком.
 *
 * Галактики рассыпаются по овалу случайно, но детерминированно от набора id;
 * по кругу — в порядке hue, поворот — от id. Закреплённая (`skyPos`) встаёт
 * в свою точку, а её место в россыпи остаётся пустым: остальные не сдвигаются,
 * пока она им не мешает (`settle`). */
export function constellationPlacements(skills: SkySkill[]): Map<string, SkyPlacement> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const unique = [...byId.values()]
  const result = new Map<string, SkyPlacement>()
  if (!unique.length) return result

  const hueOf = (skill: SkySkill) => ((skill.hue % 360) + 360) % 360
  const byHue = unique.sort((a, b) => hueOf(a) - hueOf(b) || a.id.localeCompare(b.id))
  let hueStart = 0
  let largestHueGap = -1
  for (let i = 0; i < byHue.length; i++) {
    const current = hueOf(byHue[i])
    const next = i === byHue.length - 1 ? hueOf(byHue[0]) + 360 : hueOf(byHue[i + 1])
    const gap = next - current
    if (gap > largestHueGap) {
      largestHueGap = gap
      hueStart = (i + 1) % byHue.length
    }
  }
  const ordered = [...byHue.slice(hueStart), ...byHue.slice(0, hueStart)]

  const bodies = ordered.map(bodyOf)
  const spots = scatterSpots(bodies.length, ordered.map(({ id }) => id).sort().join('|'))
  let w = universeStart(bodies)
  for (let attempt = 0; attempt < UNIVERSE_ATTEMPTS && !scatter(bodies, spots, w); attempt++) w *= UNIVERSE_GROWTH

  const pinned = new Set<string>()
  ordered.forEach((skill, i) => {
    if (!skill.skyPos) return
    pinned.add(skill.id)
    bodies[i].x = skill.skyPos.x
    bodies[i].y = skill.skyPos.y + bodies[i].drop
  })
  if (pinned.size > 0 && pinned.size < bodies.length) settle(bodies, pinned)

  ordered.forEach((skill, i) => {
    const angleRng = mulberry32(hashStr(`sky-rotation:${skill.id}`))
    const rotation = Number(((angleRng() * 2 - 1) * 7).toFixed(2))
    // закреплённая точка — ровно та, что в store; раскладка округляет свои до сотых
    const at = skill.skyPos ?? { x: Number(bodies[i].x.toFixed(2)), y: Number((bodies[i].y - bodies[i].drop).toFixed(2)) }
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
