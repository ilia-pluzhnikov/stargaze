import { describe, expect, it } from 'vitest'
import type { StarComponent, Tier } from '../types'
import {
  CONST_ROOT,
  CONST_W,
  SKY_H,
  SKY_W,
  MAIN_QUEST_ANCHOR,
  constellationPlacements,
  layoutConstellation,
} from './layout'

let seq = 0
/** Звезда-фикстура: createdAt растёт монотонно по порядку вызова — канонический
 * порядок сиблингов детерминирован и не зависит от порядка id/массива. */
function star(id: string, tier: Tier, parentStarId: string | null): StarComponent {
  seq += 1
  return {
    id,
    skillId: 's1',
    parentStarId,
    tier,
    title: id,
    createdAt: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

describe('constellationPlacements', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `skill-${i}`)
  const skills = ids.map((id, i) => ({ id, hue: (i * 137.5) % 360 }))

  it('при 12 навыках все якоря остаются в границах неба', () => {
    for (const { x, y } of constellationPlacements(skills).values()) {
      expect(x).toBeGreaterThanOrEqual(200)
      expect(x).toBeLessThanOrEqual(SKY_W - 200)
      expect(y).toBeGreaterThanOrEqual(150)
      expect(y).toBeLessThanOrEqual(SKY_H - 140)
    }
  })

  it('детерминирован и не зависит от порядка входного массива', () => {
    expect([...constellationPlacements([...skills].reverse())]).toEqual([...constellationPlacements(skills)])
  })

  it('шесть созвездий разведены друг от друга и от Главного квеста', () => {
    const placements = [...constellationPlacements(skills.slice(0, 6)).values()]
    for (let i = 0; i < placements.length; i++) {
      expect(Math.hypot(placements[i].x - MAIN_QUEST_ANCHOR.x, placements[i].y - MAIN_QUEST_ANCHOR.y)).toBeGreaterThanOrEqual(270)
      for (let j = i + 1; j < placements.length; j++) {
        expect(Math.hypot(placements[i].x - placements[j].x, placements[i].y - placements[j].y)).toBeGreaterThanOrEqual(330)
      }
    }
  })

  it('даёт небольшие разные повороты как в лаборатории', () => {
    const rotations = [...constellationPlacements(skills.slice(0, 6)).values()].map((p) => p.rotation)
    expect(new Set(rotations).size).toBeGreaterThan(1)
    for (const angle of rotations) {
      expect(angle).toBeGreaterThanOrEqual(-7)
      expect(angle).toBeLessThanOrEqual(7)
    }
  })

  it('закрепляет Казну в центре, не сдвигая остальные созвездия', () => {
    const plain = constellationPlacements(skills)
    const withTreasury = constellationPlacements(skills.map((skill, i) => (
      i === 4 ? { ...skill, name: 'Казна' } : skill
    )))

    expect(withTreasury.get('skill-4')).toMatchObject({
      x: MAIN_QUEST_ANCHOR.x,
      y: MAIN_QUEST_ANCHOR.y,
    })
    for (const skill of skills) {
      if (skill.id !== 'skill-4') expect(withTreasury.get(skill.id)).toEqual(plain.get(skill.id))
    }
  })

  it('близкие оттенки, включая переход 359° → 1°, образуют кластер', () => {
    const placements = constellationPlacements([
      { id: 'red-a', hue: 359 },
      { id: 'red-b', hue: 1 },
      { id: 'cyan', hue: 180 },
    ])
    const a = placements.get('red-a')!
    const b = placements.get('red-b')!
    const far = placements.get('cyan')!
    const clustered = Math.hypot(a.x - b.x, a.y - b.y)
    expect(clustered).toBeLessThan(Math.hypot(a.x - far.x, a.y - far.y))
    expect(clustered).toBeLessThan(Math.hypot(b.x - far.x, b.y - far.y))
  })
})

describe('layoutConstellation', () => {
  // Общее дерево: один корень → 4 ребёнка → у одного из них 5 детей → у одного
  // из них 6 детей. Три уровня развилок — для инвариантов общего назначения.
  const root = star('root', 'D', null)
  const a1 = star('a1', 'D', 'root')
  const a2 = star('a2', 'D', 'root')
  const a3 = star('a3', 'D', 'root')
  const a4 = star('a4', 'D', 'root')
  const b1 = star('b1', 'D', 'a2')
  const b2 = star('b2', 'D', 'a2')
  const b3 = star('b3', 'D', 'a2')
  const b4 = star('b4', 'D', 'a2')
  const b5 = star('b5', 'D', 'a2')
  const c1 = star('c1', 'D', 'b3')
  const c2 = star('c2', 'D', 'b3')
  const c3 = star('c3', 'D', 'b3')
  const c4 = star('c4', 'D', 'b3')
  const c5 = star('c5', 'D', 'b3')
  const c6 = star('c6', 'D', 'b3')
  const tree = [root, a1, a2, a3, a4, b1, b2, b3, b4, b5, c1, c2, c3, c4, c5, c6]

  // fanTree: 2 корня, у первого 3 ребёнка, у одного из них ещё 3 — три уровня.
  const root1 = star('root1', 'D', null)
  const root2 = star('root2', 'D', null)
  const f1 = star('f1', 'D', 'root1')
  const f2 = star('f2', 'D', 'root1')
  const f3 = star('f3', 'D', 'root1')
  const g1 = star('g1', 'D', 'f1')
  const g2 = star('g2', 'D', 'f1')
  const g3 = star('g3', 'D', 'f1')
  const fanTree = [root1, root2, f1, f2, f3, g1, g2, g3]

  // chainTree: цепочка из 4 звёзд без развилок.
  const chain0 = star('chain0', 'D', null)
  const chain1 = star('chain1', 'D', 'chain0')
  const chain2 = star('chain2', 'D', 'chain1')
  const chain3 = star('chain3', 'D', 'chain2')
  const chainTree = [chain0, chain1, chain2, chain3]

  // deepTree: 5 уровней, по 3 ветки на узлах 1 и 2 уровня, дальше — без развилок.
  const dRoot = star('d-root', 'D', null)
  const d1 = star('d-1', 'D', 'd-root')
  const d2 = [1, 2, 3].map((i) => star(`d-2-${i}`, 'D', 'd-1'))
  const d3 = d2.flatMap((p) => [1, 2, 3].map((i) => star(`d-3-${p.id}-${i}`, 'D', p.id)))
  const d4 = d3.map((p) => star(`d-4-${p.id}`, 'D', p.id))
  const deepTree = [dRoot, d1, ...d2, ...d3, ...d4]

  /** Группирует рёбра по родителю (карта edges); каждая группа — лучи детей
   * одного узла в каноническом порядке. Углы через atan2 от координат родителя. */
  function siblingGroups(c: ReturnType<typeof layoutConstellation>): { angle: number; radius: number }[][] {
    const byParent = new Map<number, number[]>()
    for (const [parent, target] of c.edges) {
      byParent.set(parent, [...(byParent.get(parent) ?? []), target])
    }
    const groups: { angle: number; radius: number }[][] = []
    for (const [parent, targets] of byParent) {
      if (targets.length < 2) continue
      const p = parent < 0 ? c.root : c.nodes[parent]
      groups.push(targets.map((t) => {
        const n = c.nodes[t]
        return { angle: Math.atan2(n.y - p.y, n.x - p.x), radius: Math.hypot(n.x - p.x, n.y - p.y) }
      }))
    }
    return groups
  }

  /** Угол ребра к каждому следующему узлу цепочки (дерево без развилок). */
  function chainDirs(c: ReturnType<typeof layoutConstellation>): number[] {
    const childOf = new Map<number, number>()
    for (const [parent, target] of c.edges) childOf.set(parent, target)
    const dirs: number[] = []
    let cur = -1
    while (childOf.has(cur)) {
      const next = childOf.get(cur)!
      const p = cur < 0 ? c.root : c.nodes[cur]
      const n = c.nodes[next]
      dirs.push(Math.atan2(n.y - p.y, n.x - p.x))
      cur = next
    }
    return dirs
  }

  function unwrap(angles: number[]): number[] {
    const result = [...angles]
    for (let i = 1; i < result.length; i++) {
      while (result[i] < result[i - 1] - Math.PI) result[i] += Math.PI * 2
      while (result[i] > result[i - 1] + Math.PI) result[i] -= Math.PI * 2
    }
    return result
  }

  it('детерминирован: одинаковые входы — идентичный результат', () => {
    expect(layoutConstellation(tree, 'seed-x')).toEqual(layoutConstellation(tree, 'seed-x'))
  })

  it('другой seed — другая раскладка', () => {
    const a = layoutConstellation(tree, 'seed-x')
    const b = layoutConstellation(tree, 'seed-y')
    expect(b.nodes.map((n) => [n.x, n.y])).not.toEqual(a.nodes.map((n) => [n.x, n.y]))
  })

  it('каждая звезда получает ровно одно входящее ребро; первое — от корня', () => {
    const c = layoutConstellation(tree, 'seed-x')
    expect(c.nodes).toHaveLength(tree.length)
    expect(c.edges).toHaveLength(tree.length)
    expect(c.edges[0][0]).toBe(-1)
    const targets = c.edges.map(([, b]) => b).sort((x, y) => x - y)
    expect(targets).toEqual(c.nodes.map((_, i) => i))
  })

  it('не зависит от порядка входного массива', () => {
    const shuffled = [...tree].reverse()
    expect(layoutConstellation(shuffled, 'seed-x')).toEqual(layoutConstellation(tree, 'seed-x'))
  })

  it('звёзды не слипаются: попарная дистанция ≥ 24', () => {
    const c = layoutConstellation(tree, 'seed-x')
    for (let i = 0; i < c.nodes.length; i++)
      for (let j = i + 1; j < c.nodes.length; j++) {
        const d = Math.hypot(c.nodes[j].x - c.nodes[i].x, c.nodes[j].y - c.nodes[i].y)
        expect(d).toBeGreaterThanOrEqual(24)
      }
  })

  it('всё в границах локального пространства с полями', () => {
    const c = layoutConstellation(tree, 'seed-x')
    for (const n of c.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(40)
      expect(n.x).toBeLessThanOrEqual(CONST_W - 40)
      expect(n.y).toBeGreaterThanOrEqual(50)
      expect(n.y).toBeLessThanOrEqual(CONST_ROOT.y - 20)
    }
  })

  it('вырожденные случаи не падают: пусто, одна корневая звезда', () => {
    expect(layoutConstellation([], 'e')).toEqual({ root: { x: 500, y: 810 }, nodes: [], edges: [] })
    const solo = layoutConstellation([star('solo', 'D', null)], 'e')
    expect(solo.nodes).toHaveLength(1)
    expect(solo.edges).toEqual([[-1, 0]])
  })

  it('глубже — выше: средний y уровня убывает с depth', () => {
    const c = layoutConstellation(fanTree, 'seed-x')
    const mean = (d: number) => {
      const own = c.nodes.filter((n) => n.depth === d)
      return own.reduce((a, n) => a + n.y, 0) / own.length
    }
    expect(mean(1)).toBeLessThan(mean(0) + 10)
    expect(mean(2)).toBeLessThan(mean(1) + 10)
  })

  it('дети одного узла образуют веер: монотонные углы, зазор ≥8°', () => {
    const minGap = 8 * Math.PI / 180
    for (const seed of ['seed-x', 'abc', 'seed-a']) {
      const c = layoutConstellation(fanTree, seed)
      for (const group of siblingGroups(c)) { // лучи детей одного родителя, канонический порядок
        const angles = unwrap(group.map((r) => r.angle))
        for (let i = 1; i < angles.length; i++) {
          expect(angles[i], `seed=${seed}`).toBeGreaterThan(angles[i - 1])
          expect(angles[i] - angles[i - 1], `seed=${seed}`).toBeGreaterThanOrEqual(minGap)
        }
      }
    }
  })

  it('цепочка без развилок тянется вдоль одного направления (стык ≤15°)', () => {
    const c = layoutConstellation(chainTree, 'seed-x')
    const dirs = chainDirs(c) // угол ребра к каждому следующему узлу цепочки
    for (let i = 1; i < dirs.length; i++) {
      let d = Math.abs(dirs[i] - dirs[i - 1])
      if (d > Math.PI) d = Math.PI * 2 - d
      expect(d).toBeLessThanOrEqual(Math.PI / 12)
    }
  })

  it('глубокое дерево (5 уровней, по 3 ветки на узлах 1–2 уровня) помещается в границы', () => {
    for (const seed of ['seed-x', 'abc', 'stress1']) {
      const c = layoutConstellation(deepTree, seed)
      for (const n of c.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(40)
        expect(n.x).toBeLessThanOrEqual(CONST_W - 40)
        expect(n.y).toBeGreaterThanOrEqual(50)
        expect(n.y).toBeLessThanOrEqual(CONST_ROOT.y - 20)
      }
    }
  })

  it('верхний ярус не расплющивается в горизонталь у границы кадра', () => {
    // Реальный прод-баг (см. v2-версию этого теста: git show 2bf0700:src/logic/layout.test.ts):
    // широкая, но неглубокая структура давит на верхнюю границу кадра. До фикса
    // «Вписывание в кадр» (см. комментарий в layoutConstellation) жёсткий кламп
    // складывал всю верхнюю ступень на линию y=78 — «горизонт» вместо рисунка.
    // v3-профиль того же случая: ствол из 7 узких ступеней по 5 звёзд — средний
    // ребёнок продолжает ствол БЕЗ бокового отклонения (его угол в веере совпадает
    // с входящим лучом), поэтому высота копится по стволу, а не тратится на изгиб —
    // и финальный веер из 5 звёзд на самой глубокой ступени упирается в верх кадра.
    const levels = 7
    const branching = 5
    const mid = Math.floor(branching / 2)
    let prev: string | null = null
    const flatTree: StarComponent[] = []
    for (let lvl = 0; lvl < levels; lvl++) {
      const kids = Array.from({ length: branching }, (_, i) => star(`flat-L${lvl}-${i}`, 'D', prev))
      flatTree.push(...kids)
      prev = kids[mid].id
    }
    flatTree.push(...Array.from({ length: 5 }, (_, i) => star(`flat-fan-${i}`, 'D', prev)))

    for (const seed of ['s_streams', 'seed-x', 'abc', 'stress1', 'seed-a', 'seed-b', 'q', 'zz']) {
      const c = layoutConstellation(flatTree, seed)
      const flat = c.nodes.filter((n) => n.y <= 80).length
      expect(flat, `seed=${seed}: ${flat} звёзд легло на верхнюю границу`).toBeLessThanOrEqual(1)
    }
  })

  it('рёбра не пересекаются ни в одной форме дерева', () => {
    // Прод-баг 2026-07-20: рекурсивный веер не резервировал угловые сектора
    // поддеревьям — соседние ветки влезали друг в друга, а relax/кламп
    // доталкивали звёзды через чужие рёбра. Скрещенные ветки ломают чтение
    // дерева прогрессии. Проверяем строгое пересечение отрезков (общие концы
    // у родителя/сиблингов пересечением не считаются).
    const cross = (
      p1: { x: number; y: number }, p2: { x: number; y: number },
      p3: { x: number; y: number }, p4: { x: number; y: number },
    ): boolean => {
      const d = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const d1 = d(p3, p4, p1)
      const d2 = d(p3, p4, p2)
      const d3 = d(p1, p2, p3)
      const d4 = d(p1, p2, p4)
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }

    // Профили реальных вселенных дня X вдобавок к общим фикстурам:
    // Режим — 5 корней-цепочек по 2–4 звезды; Казна — 3 корня, средний ветвится.
    const regime: StarComponent[] = []
    for (let t = 0; t < 5; t++) {
      let prev: string | null = null
      for (let i = 0; i < [4, 4, 3, 2, 3][t]; i++) {
        const s = star(`reg-${t}-${i}`, 'D', prev)
        regime.push(s)
        prev = s.id
      }
    }
    const treasury: StarComponent[] = []
    {
      let prev: string | null = null
      for (let i = 0; i < 5; i++) { const s = star(`tre-a-${i}`, 'D', prev); treasury.push(s); prev = s.id }
      const inc0 = star('tre-b-0', 'C', null)
      const inc1 = star('tre-b-1', 'B', inc0.id)
      const inc2 = star('tre-b-2', 'A', inc1.id)
      const inc3 = star('tre-b-3', 'S', inc2.id)
      const inc4 = star('tre-b-4', 'A', inc1.id)
      const inc5 = star('tre-b-5', 'B', inc0.id)
      treasury.push(inc0, inc1, inc2, inc3, inc4, inc5)
      prev = null
      for (let i = 0; i < 3; i++) { const s = star(`tre-c-${i}`, 'A', prev); treasury.push(s); prev = s.id }
    }

    // Широкая плоская структура (v2-профиль): ствол из 7 ярусов по 5 звёзд —
    // худший случай для relax, проверяет страховку-откат к клиновой геометрии.
    const wide: StarComponent[] = []
    {
      let prev: string | null = null
      for (let lvl = 0; lvl < 7; lvl++) {
        const level = Array.from({ length: 5 }, (_, i) => star(`wide-L${lvl}-${i}`, 'D', prev))
        wide.push(...level)
        prev = level[2].id
      }
    }

    const shapes: [string, StarComponent[]][] = [
      ['tree', tree], ['fanTree', fanTree], ['deepTree', deepTree],
      ['regime', regime], ['treasury', treasury], ['wide', wide],
    ]
    for (const [name, shape] of shapes) {
      for (const seed of ['s_regime', 's_treasury', 's_streams', 's_body', 'seed-x', 'abc', 'stress1']) {
        const c = layoutConstellation(shape, seed)
        const pt = (i: number) => (i < 0 ? c.root : c.nodes[i])
        for (let i = 0; i < c.edges.length; i++)
          for (let j = i + 1; j < c.edges.length; j++) {
            const [a1, b1] = c.edges[i]
            const [a2, b2] = c.edges[j]
            expect(
              cross(pt(a1), pt(b1), pt(a2), pt(b2)),
              `${name}, seed=${seed}: рёбра ${a1}→${b1} и ${a2}→${b2} пересекаются`,
            ).toBe(false)
          }
      }
    }
  })

  it('лучи ступени имеют сопоставимые радиусы', () => {
    for (const seed of ['seed-x', 'abc', 'seed-a']) {
      const c = layoutConstellation(fanTree, seed)
      for (const group of siblingGroups(c)) {
        if (group.length < 2) continue
        const radii = group.map((r) => r.radius)
        expect(Math.max(...radii) / Math.min(...radii), `seed=${seed}`).toBeLessThanOrEqual(2.2)
      }
    }
  })
})
