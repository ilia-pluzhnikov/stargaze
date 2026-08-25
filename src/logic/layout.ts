import type { StarComponent } from '../types'

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

export interface SkySkill {
  id: string
  hue: number
  name?: string
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

/** Созвездия занимают мягкую смещённую сетку как в лаборатории. Навыки
 * назначаются слотам в круговом порядке hue: похожие цвета остаются соседями,
 * а id добавляет небольшой джиттер и поворот без прыжков между загрузками. */
export function constellationPlacements(skills: SkySkill[]): Map<string, SkyPlacement> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const unique = [...byId.values()]
  const result = new Map<string, SkyPlacement>()
  if (!unique.length) return result

  const slotsByAngle = Array.from({ length: unique.length }, (_, i) => {
    if (i < SOFT_SKY_SLOTS.length) return SOFT_SKY_SLOTS[i]
    const angle = i * 2.399963229728653 // золотой угол — фолбэк для >12 навыков
    return {
      x: MAIN_QUEST_ANCHOR.x + Math.cos(angle) * 690,
      y: MAIN_QUEST_ANCHOR.y + Math.sin(angle) * 320,
    }
  }).sort((a, b) =>
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

  for (let i = 0; i < ordered.length; i++) {
    const { id } = ordered[i]
    const slot = slots[i]
    const jitter = mulberry32(hashStr(`sky-jitter:${id}`))
    const angleRng = mulberry32(hashStr(`sky-rotation:${id}`))
    const placement = {
      x: Number((slot.x + (jitter() - 0.5) * 80).toFixed(2)),
      y: Number((slot.y + (jitter() - 0.5) * 54).toFixed(2)),
      rotation: Number(((angleRng() * 2 - 1) * 7).toFixed(2)),
    }
    result.set(id, placement)
  }

  // Казна — смысловой центр обзорного неба. Перезаписываем только её якорь:
  // распределение остальных навыков и цветовые кластеры не пересчитываются.
  const treasury = unique.find((skill) => skill.name?.trim().toLocaleLowerCase('ru-RU').startsWith('казна'))
  if (treasury) {
    result.set(treasury.id, {
      x: MAIN_QUEST_ANCHOR.x,
      y: MAIN_QUEST_ANCHOR.y,
      rotation: result.get(treasury.id)?.rotation ?? 0,
    })
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
