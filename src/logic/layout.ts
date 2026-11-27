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
  /** Закреплённая позиция галактики (`Skill.skyPos`); нет — место выбирает раскладка. */
  skyPos?: SkyPoint
}

/** «Личное пространство» галактики: центры двух галактик ближе этого эллипса —
 * (dx/x)² + (dy/y)² < 1 — значит, веера или подписи налезают друг на друга.
 * Мини-созвездие — веер ~200 px шириной, от −125 до +80 по y, подпись до +165.
 * Откалибровано по живому небу: его самая тесная пара (Сцена и Продукт) даёт
 * ≈1,03 и на экране стоит чисто. */
export const GALAXY_CLEARANCE = { x: 240, y: 270 } as const

/** Рамка, из которой раскладка не выводит незакреплённые галактики: веер
 * (±100 по x, вверх до −125) и подпись (вниз до +165) целиком внутри мира 1800×1000. */
export const SKY_BOUNDS = { x0: 170, x1: SKY_W - 170, y0: 150, y1: SKY_H - 160 } as const

const clampToBounds = (p: SkyPoint): SkyPoint => ({
  x: Math.min(Math.max(p.x, SKY_BOUNDS.x0), SKY_BOUNDS.x1),
  y: Math.min(Math.max(p.y, SKY_BOUNDS.y0), SKY_BOUNDS.y1),
})

/** Навыки неба из навыков store: архивные не светят, остальное — то, от чего
 * зависит раскладка. Общий вход для 2D-неба, 3D-облёта и машинных срезов. */
export function skySkillsOf(skills: readonly Pick<Skill, 'id' | 'hue' | 'name' | 'archived' | 'skyPos'>[]): SkySkill[] {
  return skills
    .filter((skill) => !skill.archived)
    .map(({ id, hue, name, skyPos }) => (skyPos ? { id, hue, name, skyPos } : { id, hue, name }))
}

export const MAIN_QUEST_ANCHOR = { x: SKY_W / 2, y: SKY_H / 2 - 20 } as const

/** Мягкая сетка из режима «Всё небо» лаборатории, пересчитанная с 4200×2400
 * на продуктовый мир 1800×1000. Порядок намеренно заполняет сначала далеко
 * разнесённые слоты, поэтому при 4–8 навыках решётка не читается буквально. */
const SOFT_SKY_SLOTS = [
  { x: 240, y: 300 },
  { x: 1430, y: 230 },
  { x: 1490, y: 700 },
  { x: 350, y: 680 },
  { x: 900, y: 185 },
  { x: 1130, y: 790 },
  { x: 1230, y: 470 },
  { x: 560, y: 830 },
  { x: 550, y: 410 },
  { x: 1010, y: 850 },
  { x: 1580, y: 460 },
  { x: 700, y: 735 },
] as const

/** Якоря, которые жили в коде до поля `skyPos`: небо владельца не сдвигается,
 * пока он не перенёс их в store. `skyPos` навыка важнее. */
const LEGACY_PINS: Readonly<Record<string, SkyPoint>> = {
  // Финансы — смысловой центр обзорного неба; якорь по постоянному id.
  s_treasury: { x: MAIN_QUEST_ANCHOR.x, y: MAIN_QUEST_ANCHOR.y },
  // Тело — нижний ряд между Режимом и Капиталом и свободой.
  s_body: { x: 860, y: 825 },
}

/** Слот раскладки и полный размах джиттера вокруг него (по x и по y). */
interface Slot extends SkyPoint {
  jitterX: number
  jitterY: number
}

/** Больше 12 галактик мягкая сетка не вмещает: ряды во всю ширину рамки.
 * До 18 галактик — три ряда; вертикального запаса хватает, и каждый ряд
 * растягивается на всю ширину, а джиттер по x ограничен запасом между соседями.
 * Дальше — по ряду на каждые шесть, и ряды встают плотно: точки берутся из
 * правильной решётки вразбежку (нечётные ряды сдвинуты на полшага), лишние
 * снимаются с концов разных рядов, джиттера нет. Ряды без наложений по
 * построению; так помещается 24 галактики — больше мир 1800×1000 не вмещает. */
function denseSlots(n: number): Slot[] {
  const { x: A, y: B } = GALAXY_CLEARANCE
  const { x0, x1 } = SKY_BOUNDS
  const rows = Math.max(3, Math.ceil(n / 6))
  const slots: Slot[] = []
  if (rows === 3) {
    const [y0, y1] = [170, 810]
    const gapY = (y1 - y0) / 2
    const base = Math.floor(n / 3)
    const extra = n % 3
    // Лишняя точка — в средний ряд, две — в крайние: небо симметрично.
    const fuller = extra === 1 ? [1] : extra === 2 ? [0, 2] : []
    for (let r = 0; r < 3; r++) {
      const count = base + (fuller.includes(r) ? 1 : 0)
      const step = (x1 - x0) / (count - 0.5)
      const shift = r % 2 === 0 ? 0 : 0.5
      // Соседи по ряду сближаются не больше чем на размах — запас до эллипса.
      const jitterX = Math.max(0, Math.min(40, step - A - 2))
      const jitterY = Math.max(0, Math.min(28, gapY - B - 2))
      for (let k = 0; k < count; k++) slots.push({ x: x0 + (k + shift) * step, y: y0 + gapY * r, jitterX, jitterY })
    }
    return slots
  }
  const perRow = Math.ceil(n / rows)
  const step = (x1 - x0) / (perRow - 0.5)
  const { y0, y1 } = SKY_BOUNDS
  // Снимаемые точки — по одной в равномерно разнесённых рядах, попеременно справа и слева.
  const drop = rows * perRow - n
  const dropped = new Map(Array.from({ length: drop }, (_, k) => [Math.floor(((k + 0.5) * rows) / drop), k % 2 === 0 ? perRow - 1 : 0]))
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 === 0 ? 0 : 0.5
    for (let k = 0; k < perRow; k++) {
      if (dropped.get(r) === k) continue
      slots.push({ x: x0 + (k + shift) * step, y: y0 + ((y1 - y0) * r) / (rows - 1), jitterX: 0, jitterY: 0 })
    }
  }
  return slots
}

/** Шаг сетки, по которой ищется свободное место налезшей галактике. */
const FREE_SPOT_STEP = 10

/** Разводит налезающие галактики. Закреплённые стоят где стоят; незакреплённые
 * по очереди сверяются с уже поставленными, и налезшая (эллипс `GALAXY_CLEARANCE`)
 * переезжает в ближайшую точку `SKY_BOUNDS`, свободную от всех поставленных с
 * небольшим запасом. Кто ни на кого не налез, не двигается — такое небо остаётся
 * байт в байт. Свободного места нет (галактик больше, чем вмещает мир) — галактика
 * остаётся на своём. Очередь — упорядоченный список, а не вход: результат
 * детерминирован. */
function settle(order: readonly string[], pos: Map<string, SkyPoint>, pinned: ReadonlySet<string>): void {
  const { x: A, y: B } = GALAXY_CLEARANCE
  const placed = order.filter((id) => pinned.has(id)).map((id) => pos.get(id)!)
  const clear = (p: SkyPoint, margin: number) =>
    placed.every((q) => Math.hypot((p.x - q.x) / A, (p.y - q.y) / B) >= margin)
  for (const id of order) {
    if (pinned.has(id)) continue
    const p = pos.get(id)!
    if (!clear(p, 1)) {
      let best: SkyPoint | null = null
      let bestDist = Infinity
      for (let x = SKY_BOUNDS.x0; x <= SKY_BOUNDS.x1; x += FREE_SPOT_STEP) {
        for (let y = SKY_BOUNDS.y0; y <= SKY_BOUNDS.y1; y += FREE_SPOT_STEP) {
          const dist = (x - p.x) ** 2 + (y - p.y) ** 2
          // Запас сверх касания: соседи по сетке не встают вплотную.
          if (dist < bestDist && clear({ x, y }, 1.01)) {
            best = { x, y }
            bestDist = dist
          }
        }
      }
      if (best) pos.set(id, best)
    }
    placed.push(pos.get(id)!)
  }
}

/** Созвездия занимают мягкую смещённую сетку как в лаборатории (больше 12 —
 * ряды `denseSlots`). Навыки назначаются слотам в круговом порядке hue: похожие
 * цвета остаются соседями, а id добавляет небольшой джиттер и поворот без
 * прыжков между загрузками. Закреплённая галактика (`skyPos`, иначе
 * `LEGACY_PINS`) встаёт на свою точку, не сдвигая остальным слоты; последним
 * проходом `settle` разводит тех, кто всё же налез. */
export function constellationPlacements(skills: SkySkill[]): Map<string, SkyPlacement> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const unique = [...byId.values()]
  const result = new Map<string, SkyPlacement>()
  if (!unique.length) return result

  const dense = unique.length > SOFT_SKY_SLOTS.length
  const base: Slot[] = dense
    ? denseSlots(unique.length)
    : SOFT_SKY_SLOTS.slice(0, unique.length).map((slot) => ({ ...slot, jitterX: 80, jitterY: 54 }))
  const slotsByAngle = base.sort((a, b) =>
    Math.atan2(a.y - MAIN_QUEST_ANCHOR.y, a.x - MAIN_QUEST_ANCHOR.x)
    - Math.atan2(b.y - MAIN_QUEST_ANCHOR.y, b.x - MAIN_QUEST_ANCHOR.x),
  )
  const slotAngles = slotsByAngle.map((slot) => Math.atan2(slot.y - MAIN_QUEST_ANCHOR.y, slot.x - MAIN_QUEST_ANCHOR.x))
  let slotStart = 0
  let largestSlotGap = -1
  for (let i = 0; i < slotAngles.length; i++) {
    const next = i === slotAngles.length - 1 ? slotAngles[0] + Math.PI * 2 : slotAngles[i + 1]
    const gap = next - slotAngles[i]
    if (gap > largestSlotGap) {
      largestSlotGap = gap
      slotStart = (i + 1) % slotAngles.length
    }
  }
  const slots = [...slotsByAngle.slice(slotStart), ...slotsByAngle.slice(0, slotStart)]

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

  const pos = new Map<string, SkyPoint>()
  const rotation = new Map<string, number>()
  const pinned = new Set<string>()
  for (let i = 0; i < ordered.length; i++) {
    const { id, skyPos } = ordered[i]
    const slot = slots[i]
    const jitter = mulberry32(hashStr(`sky-jitter:${id}`))
    const angleRng = mulberry32(hashStr(`sky-rotation:${id}`))
    const jittered = {
      x: Number((slot.x + (jitter() - 0.5) * slot.jitterX).toFixed(2)),
      y: Number((slot.y + (jitter() - 0.5) * slot.jitterY).toFixed(2)),
    }
    // Мягкая сетка исторически шире рамки на джиттер — её не трогаем, чтобы
    // старые небеса не сдвинулись; плотные ряды держим в рамке сразу.
    const auto = dense ? clampToBounds(jittered) : jittered
    rotation.set(id, Number(((angleRng() * 2 - 1) * 7).toFixed(2)))
    // Закреплённая галактика занимает свой слот в общей раскладке и уходит на свою
    // точку: остальные слоты не пересдаются, слот остаётся пустым.
    const pin = skyPos ?? LEGACY_PINS[id]
    if (pin) pinned.add(id)
    pos.set(id, pin ? { x: pin.x, y: pin.y } : auto)
  }

  settle(ordered.map(({ id }) => id), pos, pinned)

  for (const { id } of ordered) {
    const p = pos.get(id)!
    // закреплённая точка — ровно та, что в store; раскладка округляет свои до сотых
    const [x, y] = pinned.has(id) ? [p.x, p.y] : [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))]
    result.set(id, { x, y, rotation: rotation.get(id)! })
  }
  return result
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
