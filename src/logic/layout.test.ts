import { describe, expect, it } from 'vitest'
import type { StarComponent, Tier } from '../types'
import {
  CONST_H,
  CONST_ROOT,
  CONST_W,
  GALAXY_CLEARANCE,
  MINI_LIFT,
  MINI_SCALE,
  SKY_GAP,
  SKY_H,
  SKY_MAX_ZOOM,
  SKY_W,
  constellationPlacements,
  constellationRings,
  crowdedWith,
  galaxyFootprint,
  layoutConstellation,
  mulberry32,
  skySkillsOf,
  skyView,
} from './layout'
import type { SkyPoint, SkySkill } from './layout'

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

/** Момент создания i-й галактики: порядок на небе — по нему. */
const stamp = (i: number): string => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()

/** Небо из n галактик со случайными id, кольцами и глифами, созданных в порядке массива. */
function randomSky(n: number, seed: number): SkySkill[] {
  const rnd = mulberry32(seed)
  return Array.from({ length: n }, (_, i) => ({
    id: `g${i}-${Math.floor(rnd() * 1e6)}`,
    createdAt: stamp(i),
    rings: Math.floor(rnd() * 8),
    ...(rnd() < 0.7 ? { glyph: true } : {}),
  }))
}

/** Самая тесная пара галактик в долях касания. По умолчанию — между местами
 * раскладки (у всех полного размера): < SKY_GAP — воздуха меньше положенного.
 * `drawn` — между тем, что в галактиках нарисовано (`galaxyFootprint`): < 1 —
 * налезают. `among` — только пары, где хотя бы одна галактика из этого набора. */
function tightest(skills: SkySkill[], placements: ReadonlyMap<string, SkyPoint>, among?: ReadonlySet<string>, drawn = false): number {
  const bodies = skills.filter((skill) => placements.has(skill.id)).map((skill) => {
    const place = galaxyFootprint(drawn ? skill : {})
    const at = placements.get(skill.id)!
    return { id: skill.id, x: at.x, y: at.y + (place.top + place.bottom) / 2, a: place.half, b: (place.bottom - place.top) / 2 }
  })
  let min = Infinity
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      if (among && !among.has(bodies[i].id) && !among.has(bodies[j].id)) continue
      const [p, q] = [bodies[i], bodies[j]]
      min = Math.min(min, Math.hypot((p.x - q.x) / (p.a + q.a), (p.y - q.y) / (p.b + q.b)))
    }
  return min
}

/** Запас на арифметику: раскладка считает в сотых. */
const AIR = SKY_GAP - 0.001
/** Рядом с закреплённой раскладка терпит чуть меньше воздуха (`PIN_SLACK`): закрепление
 * по координатам, которые показал `place` (целые числа), не должно сдвигать соседей. */
const PIN_AIR = SKY_GAP - 0.011

/** Небо владельца: id навыков, кольца созвездий и места, на которых галактики
 * стояли до растущей вселенной. Закреплённое, оно обязано остаться снимком. */
const liveSky: SkySkill[] = [
  { id: 's_streams', rings: 5, glyph: true, skyPos: { x: 1459.18, y: 721.71 } },
  { id: 's_b2b', rings: 7, glyph: true, skyPos: { x: 1246.21, y: 486.16 } },
  { id: 's_content', rings: 5, glyph: true, skyPos: { x: 932.54, y: 201.41 } },
  { id: 's_agents', rings: 4, glyph: true, skyPos: { x: 579.83, y: 421.05 } },
  { id: 's_treasury', rings: 5, glyph: true, skyPos: { x: 900, y: 480 } },
  { id: 's_scene', rings: 4, glyph: true, skyPos: { x: 1418.35, y: 237 } },
  { id: 's_crew', rings: 2, glyph: true, skyPos: { x: 237.71, y: 288.29 } },
  { id: 's_siam', rings: 4, glyph: true, skyPos: { x: 354.41, y: 658.18 } },
  { id: 's_regime', rings: 4, glyph: true, skyPos: { x: 575.95, y: 816.85 } },
  { id: 's_product', rings: 7, glyph: true, skyPos: { x: 1574.34, y: 447.48 } },
  { id: 's_body', rings: 5, glyph: true, skyPos: { x: 860, y: 825 } },
  { id: 's_freedom', rings: 4, glyph: true, skyPos: { x: 1159.31, y: 804.88 } },
]
const unpinned = (sky: SkySkill[]): SkySkill[] => sky.map(({ skyPos: _pin, ...skill }) => skill)
/** Насколько галактика сдвинулась между двумя раскладками. */
const shift = (a: SkyPoint, b: SkyPoint): number => Math.hypot(a.x - b.x, a.y - b.y)

describe('constellationPlacements', () => {
  const skills = Array.from({ length: 12 }, (_, i) => ({ id: `skill-${i}`, createdAt: stamp(i) }))

  it('пустое небо — пустая раскладка; вход не мутируется', () => {
    expect(constellationPlacements([]).size).toBe(0)
    const before = structuredClone(liveSky)
    constellationPlacements(liveSky)
    expect(liveSky).toEqual(before)
  })

  it('детерминирован и не зависит от порядка входного массива', () => {
    expect([...constellationPlacements([...skills].reverse())]).toEqual([...constellationPlacements(skills)])
    const mixed = randomSky(17, 3)
    expect([...constellationPlacements([...mixed].reverse())]).toEqual([...constellationPlacements(mixed)])
  })

  it('первая галактика встаёт в центр неба', () => {
    expect(constellationPlacements([{ id: 'one' }]).get('one')).toMatchObject({ x: SKY_W / 2, y: 470 })
    expect(constellationPlacements(skills).get('skill-0')).toMatchObject({ x: SKY_W / 2, y: 470 })
  })

  it('порядок на небе — по времени создания, при равенстве и без него — по id', () => {
    const first = (sky: SkySkill[]) => [...constellationPlacements(sky).keys()][0]
    expect(first([{ id: 'a', createdAt: stamp(2) }, { id: 'b', createdAt: stamp(1) }, { id: 'c', createdAt: stamp(3) }])).toBe('b')
    expect(first([{ id: 'b', createdAt: stamp(1) }, { id: 'a', createdAt: stamp(1) }])).toBe('a')
    expect(first([{ id: 'б' }, { id: 'Z' }, { id: 'a' }])).toBe('Z')
    // без даты — раньше всех
    expect(first([{ id: 'a', createdAt: stamp(0) }, { id: 'z' }])).toBe('z')
    // от порядка создания зависят и места
    const [early, late] = [stamp(1), stamp(2)]
    const ab = constellationPlacements([{ id: 'a', createdAt: early }, { id: 'b', createdAt: late }])
    const ba = constellationPlacements([{ id: 'a', createdAt: late }, { id: 'b', createdAt: early }])
    expect(ab.get('a')).toMatchObject({ x: SKY_W / 2, y: 470 })
    expect(ba.get('b')).toMatchObject({ x: SKY_W / 2, y: 470 })
  })

  it('новая галактика никого не двигает: небо из n галактик — начало неба из n+1', () => {
    for (const seed of [1, 2, 3, 4]) {
      const sky = randomSky(40, seed)
      const whole = [...constellationPlacements(sky)]
      for (const n of [1, 2, 3, 5, 8, 13, 21, 34, 39])
        expect([...constellationPlacements(sky.slice(0, n))], `seed=${seed}, n=${n}`).toEqual(whole.slice(0, n))
    }
  })

  it('новая галактика встаёт рядом с небом: до ближайшей соседки — воздух и немного сверху', () => {
    for (const n of [2, 3, 6, 12, 25, 40]) {
      const sky = randomSky(n, n + 11)
      const newest = new Set([sky[n - 1].id])
      const gap = tightest(sky, constellationPlacements(sky), newest)
      expect(gap, `n=${n}`).toBeGreaterThanOrEqual(AIR)
      expect(gap, `n=${n}`).toBeLessThan(SKY_GAP * 1.36)
    }
  })

  it('новые звёзды небо не двигают: от колец и глифа места не зависят', () => {
    for (const seed of [1, 2, 3]) {
      const sky = randomSky(15, seed * 7)
      const before = [...constellationPlacements(sky)]
      const grown = sky.map((skill) => ({ ...skill, rings: skill.rings! + 1 + (seed % 2), glyph: true }))
      expect([...constellationPlacements(grown)]).toEqual(before)
      expect([...constellationPlacements(sky.map(({ id, createdAt }) => ({ id, createdAt })))]).toEqual(before)
    }
  })

  it('поворот галактики — от её id: небольшой, разный и не зависит от неба вокруг', () => {
    const six = constellationPlacements(skills.slice(0, 6))
    const rotations = [...six.values()].map((p) => p.rotation)
    expect(new Set(rotations).size).toBeGreaterThan(1)
    for (const angle of rotations) {
      expect(angle).toBeGreaterThanOrEqual(-7)
      expect(angle).toBeLessThanOrEqual(7)
    }
    const shuffled = constellationPlacements(skills.map((skill, i) => ({ ...skill, createdAt: stamp(99 - i) })))
    for (const [id, place] of six) expect(shuffled.get(id)!.rotation).toBe(place.rotation)
  })

  it('между местами галактик всегда воздух SKY_GAP, нарисованное не соприкасается: от 2 до 60 галактик', () => {
    for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 13, 15, 18, 20, 24, 25, 30, 40, 60])
      for (const seed of [1, 2, 3]) {
        const sky = randomSky(n, seed * 100 + n)
        const at = constellationPlacements(sky)
        expect(tightest(sky, at), `n=${n}, seed=${seed}`).toBeGreaterThanOrEqual(AIR)
        // галактика рисуется внутри своего места — между рисунками воздуха не меньше, чем на касание с запасом
        expect(tightest(sky, at, undefined, true), `n=${n}, seed=${seed}`).toBeGreaterThanOrEqual(1.15)
      }
  })

  it('небо не уплотняется: оно растёт как корень из числа галактик', () => {
    const sky = Array.from({ length: 48 }, (_, i) => ({ id: `w-${i}`, createdAt: stamp(i) }))
    const widthOf = (n: number) => skyView(sky.slice(0, n), constellationPlacements(sky.slice(0, n))).w
    const [w12, w24, w48] = [widthOf(12), widthOf(24), widthOf(48)]
    expect(w24).toBeGreaterThan(w12)
    expect(w48).toBeGreaterThan(w24)
    // вчетверо больше галактик — кадр примерно вдвое шире (галактики вдвое мельче)
    expect(w48 / w12).toBeGreaterThan(1.7)
    expect(w48 / w12).toBeLessThan(2.3)
    // двенадцать галактик полного размера занимают примерно кадр масштаба 1
    expect(SKY_W / w12).toBeGreaterThan(0.85)
    expect(SKY_W / w12).toBeLessThan(1.15)
  })

  it('небо заполняет кадр, а не тянется в одну сторону: и ширина, и высота кадра заняты', () => {
    for (const n of [8, 12, 20, 40])
      for (const seed of [1, 2, 3]) {
        const sky = randomSky(n, seed * 13 + n).map(({ id, createdAt }) => ({ id, createdAt }))
        const at = constellationPlacements(sky)
        const view = skyView(sky, at)
        const xs = [...at.values()].map((p) => p.x)
        const ys = [...at.values()].map((p) => p.y)
        const place = galaxyFootprint({})
        expect((Math.max(...xs) - Math.min(...xs) + place.half * 2) / view.w, `n=${n}, seed=${seed}`).toBeGreaterThan(0.75)
        expect((Math.max(...ys) - Math.min(...ys) + place.bottom - place.top) / view.h, `n=${n}, seed=${seed}`).toBeGreaterThan(0.75)
      }
  })

  // Снимок незакреплённого неба: правка констант раскладки (воздух, разброс, веса цены
  // места) молча переставила бы галактики всем — тест заставляет её заметить.
  it('небольшое небо закреплено снимком', () => {
    const sky: SkySkill[] = [
      { id: 's_run', createdAt: stamp(0), rings: 3, glyph: true },
      { id: 's_code', createdAt: stamp(1), rings: 1 },
      { id: 's_read', createdAt: stamp(2), rings: 0, glyph: true },
      { id: 's_cook', createdAt: stamp(3), rings: 5, glyph: true },
      { id: 's_draw', createdAt: stamp(4), rings: 2 },
    ]
    const at = constellationPlacements(sky)
    expect(Object.fromEntries(at)).toEqual({
      s_run: { x: 900, y: 470, rotation: -5.66 },
      s_code: { x: 1243.93, y: 439.99, rotation: -6.53 },
      s_read: { x: 1532.87, y: 313.83, rotation: -3.07 },
      s_cook: { x: 678.24, y: 221.56, rotation: -5.04 },
      s_draw: { x: 1094.63, y: 119.36, rotation: 3.01 },
    })
    expect(skyView(sky, at)).toEqual({ x: 518.24, y: 52.34, w: 1149.63, h: 638.68 })
  })

  it('рядов нет: на большом небе галактики не выстраиваются по одной высоте', () => {
    for (const n of [13, 18, 24, 40]) {
      const sky = Array.from({ length: n }, (_, i) => ({ id: `row-${n}-${i}` }))
      const at = [...constellationPlacements(sky).values()]
      const heights = at.map((p) => Math.round(p.y / 5))
      expect(new Set(heights).size, `n=${n}`).toBeGreaterThanOrEqual(n * 0.7)
      // и соседки по горизонтали стоят на разной высоте
      const level = at.filter((p) => at.some((q) => q !== p && Math.abs(q.x - p.x) < GALAXY_CLEARANCE.x * 1.7 && Math.abs(q.y - p.y) < 30))
      expect(level.length, `n=${n}`).toBeLessThanOrEqual(n * 0.25)
    }
  })

  it('у маленьких созвездий кадр теснее, а места те же', () => {
    const young = Array.from({ length: 12 }, (_, i) => ({ id: `y-${i}`, rings: 1 }))
    const grown = young.map((skill) => ({ ...skill, rings: 7 }))
    expect([...constellationPlacements(young)]).toEqual([...constellationPlacements(grown)])
    expect(skyView(young, constellationPlacements(young)).w).toBeLessThan(skyView(grown, constellationPlacements(grown)).w)
  })

  describe('архив', () => {
    /** Воздух между точкой `spot` и галактикой `id` — в долях касания мест. */
    const airTo = (spot: SkyPoint, at: ReadonlyMap<string, SkyPoint>, id: string): number =>
      tightest([{ id: 'spot' }, { id }], new Map([['spot', spot], [id, at.get(id)!]]))

    it('архивной галактики на небе нет, остальные от архивации не двигаются', () => {
      const sky = randomSky(14, 8)
      const plain = constellationPlacements(sky)
      const gone = new Set([sky[0].id, sky[3].id, sky[9].id])
      // в архив ушли позже, чем созданы все остальные: их места для остальных по-прежнему заняты
      const archived = sky.map((skill) => (gone.has(skill.id) ? { ...skill, archivedAt: stamp(500) } : skill))
      const at = constellationPlacements(archived)
      expect(at.size).toBe(11)
      for (const skill of sky) expect(at.get(skill.id)).toEqual(gone.has(skill.id) ? undefined : plain.get(skill.id))
    })

    it('место архивной свободно для созданных после архивации и занято для созданных до', () => {
      const sky = randomSky(10, 21)
      const plain = constellationPlacements(sky)
      // в архив уходит первая галактика — её место в самой середине неба
      const hole = plain.get(sky[0].id)!
      const archived = sky.map((skill, i) => (i === 0 ? { ...skill, archivedAt: stamp(50) } : skill))
      let took = 0
      for (let k = 0; k < 8; k++) {
        const before = { id: `fresh-${k}`, createdAt: stamp(40) }
        const after = { id: `fresh-${k}`, createdAt: stamp(60) }
        expect(airTo(hole, constellationPlacements([...archived, before]), before.id), `k=${k}`).toBeGreaterThanOrEqual(AIR)
        const sky2 = [...archived, after]
        const at = constellationPlacements(sky2)
        if (airTo(hole, at, after.id) < 1) took++
        // а живым соседкам воздух оставляет, и никого не двигает
        expect(tightest(sky2, at, new Set([after.id])), `k=${k}`).toBeGreaterThanOrEqual(AIR)
        for (const skill of sky.slice(1)) expect(at.get(skill.id)).toEqual(plain.get(skill.id))
      }
      // свободное место в середине неба — самое дешёвое: новые галактики встают в него
      expect(took).toBeGreaterThanOrEqual(4)
    })

    it('небо, где в архив ушли все, начинается заново с центра', () => {
      const old = randomSky(4, 2).map((skill) => ({ ...skill, archivedAt: stamp(50) }))
      const at = constellationPlacements([...old, { id: 'again', createdAt: stamp(60) }])
      expect([...at.keys()]).toEqual(['again'])
      expect(at.get('again')).toMatchObject({ x: SKY_W / 2, y: 470 })
    })

    it('моменты сравниваются как время, а не как строки: пояса и доли секунды в записи не мешают', () => {
      // 12:00+07:00 — это 05:00Z: раньше, чем 06:00Z, хотя строка «больше»
      const zones = constellationPlacements([
        { id: 'a', createdAt: '2026-07-13T12:00:00+07:00' },
        { id: 'b', createdAt: '2026-07-13T06:00:00.000Z' },
        { id: 'c', createdAt: '2026-07-13T05:30:00.123456+00:00' },
      ])
      expect([...zones.keys()]).toEqual(['a', 'c', 'b'])
      // нечитаемая дата — как её отсутствие: раньше всех, порядок по id
      expect([...constellationPlacements([{ id: 'z', createdAt: 'вчера' }, { id: 'y' }, { id: 'x', createdAt: stamp(0) }]).keys()]).toEqual(['y', 'z', 'x'])
      // нечитаемый момент архивации: галактика в архиве, а место держит для всех
      const sky = randomSky(6, 3)
      const plain = constellationPlacements(sky)
      const odd = sky.map((skill, i) => (i === 2 ? { ...skill, archivedAt: 'когда-то' } : skill))
      const at = constellationPlacements([...odd, { id: 'late', createdAt: stamp(900) }])
      expect(at.has(sky[2].id)).toBe(false)
      expect(airTo(plain.get(sky[2].id)!, at, 'late')).toBeGreaterThanOrEqual(AIR)
    })

    it('кадр обзора архивную не учитывает', () => {
      const sky = randomSky(9, 5)
      const far = sky.map((skill, i) => (i === 2 ? { ...skill, skyPos: { x: 7000, y: 500 } } : skill))
      const hidden = far.map((skill, i) => (i === 2 ? { ...skill, archivedAt: stamp(500) } : skill))
      expect(skyView(far, constellationPlacements(far)).w).toBeGreaterThan(5000)
      expect(skyView(hidden, constellationPlacements(hidden)).w).toBeLessThan(2500)
    })
  })

  describe('закрепления', () => {
    it('небо владельца, закреплённое целиком, остаётся снимком', () => {
      expect(Object.fromEntries(constellationPlacements(liveSky))).toEqual({
        s_content: { x: 932.54, y: 201.41, rotation: -5.97 },
        s_scene: { x: 1418.35, y: 237, rotation: 6.42 },
        s_b2b: { x: 1246.21, y: 486.16, rotation: 3.75 },
        s_product: { x: 1574.34, y: 447.48, rotation: -6.18 },
        s_streams: { x: 1459.18, y: 721.71, rotation: 0.06 },
        s_freedom: { x: 1159.31, y: 804.88, rotation: -6.57 },
        s_treasury: { x: 900, y: 480, rotation: 5.01 },
        s_body: { x: 860, y: 825, rotation: 0.24 },
        s_regime: { x: 575.95, y: 816.85, rotation: 2.93 },
        s_siam: { x: 354.41, y: 658.18, rotation: -0.15 },
        s_agents: { x: 579.83, y: 421.05, rotation: -4.92 },
        s_crew: { x: 237.71, y: 288.29, rotation: 6.06 },
      })
    })

    it('особых id нет: без skyPos небо владельца раскладывается как любое другое', () => {
      const free = unpinned(liveSky)
      const at = constellationPlacements(free)
      expect(at.get('s_treasury')).not.toMatchObject({ x: 900, y: 480 })
      expect(at.get('s_body')).not.toMatchObject({ x: 860, y: 825 })
      expect(tightest(free, at)).toBeGreaterThanOrEqual(AIR)
    })

    it('skyPos ставит галактику ровно в точку — и за пределами прежнего кадра; поворот прежний', () => {
      const sky = randomSky(8, 4)
      const plain = constellationPlacements(sky)
      for (const pin of [{ x: 820.123, y: 517.5 }, { x: -340, y: 2600 }, { x: 0, y: 0 }]) {
        const pinned = constellationPlacements(sky.map((skill, i) => (i === 3 ? { ...skill, skyPos: pin } : skill)))
        expect(pinned.get(sky[3].id)).toEqual({ ...pin, rotation: plain.get(sky[3].id)!.rotation })
      }
    })

    it('закрепление галактики на её же месте небо не меняет — и по целым координатам из вывода place', () => {
      for (const n of [3, 8, 15, 24])
        for (const which of [0, 1, n - 1]) {
          const sky = randomSky(n, n + 40)
          const plain = constellationPlacements(sky)
          const { x, y } = plain.get(sky[which].id)!
          const pinned = constellationPlacements(sky.map((skill, i) => (i === which ? { ...skill, skyPos: { x, y } } : skill)))
          expect([...pinned], `n=${n}`).toEqual([...plain])
          const rounded = constellationPlacements(sky.map((skill, i) => (i === which ? { ...skill, skyPos: { x: Math.round(x), y: Math.round(y) } } : skill)))
          for (const skill of sky) if (skill.id !== sky[which].id) expect(rounded.get(skill.id), `n=${n}`).toEqual(plain.get(skill.id))
        }
    })

    it('всё небо, закреплённое на своих местах, стоит как стояло — и новая галактика встаёт туда же, куда встала бы без закреплений', () => {
      const sky = randomSky(15, 6)
      const plain = constellationPlacements(sky)
      const pinnedAll = sky.map((skill) => ({ ...skill, skyPos: { x: plain.get(skill.id)!.x, y: plain.get(skill.id)!.y } }))
      expect([...constellationPlacements(pinnedAll)]).toEqual([...plain])
      const fresh = { id: 'fresh', createdAt: stamp(50) }
      expect(constellationPlacements([...pinnedAll, fresh]).get('fresh')).toEqual(constellationPlacements([...sky, fresh]).get('fresh'))
    })

    it('закреплённая вдали никому не мешает: остальные стоят как стояли, её место пустует', () => {
      const sky = randomSky(10, 9)
      const plain = constellationPlacements(sky)
      const pinned = constellationPlacements(sky.map((skill, i) => (i === 0 ? { ...skill, skyPos: { x: 6000, y: -4000 } } : skill)))
      for (const skill of sky.slice(1)) expect(pinned.get(skill.id)).toEqual(plain.get(skill.id))
    })

    it('закреплённая на чужом месте: сосед отходит на воздух SKY_GAP; созданные раньше него стоят, позже — уступают', () => {
      for (const n of [3, 8, 15, 24]) {
        const sky = randomSky(n, n + 70)
        const plain = constellationPlacements(sky)
        const target = plain.get(sky[2].id)!
        const withPin = sky.map((skill, i) => (i === 0 ? { ...skill, skyPos: { x: target.x, y: target.y } } : skill))
        const pinned = constellationPlacements(withPin)
        const free = new Set(sky.slice(1).map((skill) => skill.id))
        expect(tightest(withPin, pinned, free), `n=${n}`).toBeGreaterThanOrEqual(PIN_AIR)
        expect(pinned.get(sky[2].id), `n=${n}`).not.toEqual(plain.get(sky[2].id))
        // созданная раньше сдвинутого соседа не двигается: места выбирают по порядку создания
        expect(pinned.get(sky[1].id), `n=${n}`).toEqual(plain.get(sky[1].id))
        // сосед встаёт рядом и может потеснить созданных позже — но большинство на месте
        const stayed = sky.slice(1).filter((skill) => shift(plain.get(skill.id)!, pinned.get(skill.id)!) === 0)
        expect(stayed.length, `n=${n}`).toBeGreaterThanOrEqual(Math.floor((n - 1) / 2))
        expect(shift(plain.get(sky[2].id)!, pinned.get(sky[2].id)!), `n=${n}`).toBeLessThan(600)
      }
    })

    it('несколько закреплённых где попало: незакреплённые ни на кого не налезают', () => {
      for (const n of [4, 9, 16, 25, 40])
        for (const pins of [1, 3, 6]) {
          const sky = randomSky(n, n * 10 + pins)
          const plain = constellationPlacements(sky)
          const spots = [...plain.values()]
          const rnd = mulberry32(n * 31 + pins)
          // закрепляем первые pins галактик на случайных чужих местах — с заведомыми конфликтами
          const withPins = sky.map((skill, i) => {
            if (i >= Math.min(pins, n - 1)) return skill
            const spot = spots[Math.floor(rnd() * spots.length)]
            return { ...skill, skyPos: { x: spot.x + Math.round(rnd() * 60 - 30), y: spot.y + Math.round(rnd() * 60 - 30) } }
          })
          const free = new Set(withPins.filter((skill) => !skill.skyPos).map((skill) => skill.id))
          const placed = constellationPlacements(withPins)
          expect(tightest(withPins, placed, free), `n=${n}, pins=${pins}`).toBeGreaterThanOrEqual(PIN_AIR)
          for (const skill of withPins) if (skill.skyPos) expect(placed.get(skill.id)).toMatchObject(skill.skyPos)
          // порядок входа не влияет и с закреплениями
          expect([...constellationPlacements([...withPins].reverse())], `n=${n}, pins=${pins}`).toEqual([...placed])
        }
    })

    it('новая галактика на закреплённом небе владельца встаёт без наложений, закреплённые на месте', () => {
      for (const k of [0, 1, 2, 3]) {
        const sky = [...liveSky, { id: `s_new_${k}`, createdAt: stamp(k), rings: 1, glyph: true }, { id: `s_bare_${k}`, createdAt: stamp(k + 1), rings: 0 }]
        const at = constellationPlacements(sky)
        for (const skill of liveSky) expect(at.get(skill.id)).toMatchObject(skill.skyPos!)
        expect(tightest(sky, at, new Set([`s_new_${k}`, `s_bare_${k}`])), `k=${k}`).toBeGreaterThanOrEqual(PIN_AIR)
      }
    })

    it('новая галактика не двигает и тех, кого отодвинули закреплённые', () => {
      for (const n of [9, 16, 25]) {
        const sky = randomSky(n, n + 3)
        const plain = constellationPlacements(sky)
        const spots = [...plain.values()]
        // три закрепления рядом с чужими местами: кому-то из незакреплённых придётся отойти
        const withPins = sky.map((skill, i) => (i < 3 ? { ...skill, skyPos: { x: spots[n - 1 - i * 2].x + 40, y: spots[n - 1 - i * 2].y - 30 } } : skill))
        const before = constellationPlacements(withPins)
        expect(sky.slice(3).some((skill) => shift(plain.get(skill.id)!, before.get(skill.id)!) > 0), `n=${n}`).toBe(true)
        const late: SkySkill[] = []
        for (let k = 0; k < 6; k++) {
          late.push({ id: `late-${n}-${k}`, createdAt: stamp(1000 + k), rings: k % 4 })
          const after = constellationPlacements([...withPins, ...late])
          for (const skill of withPins) expect(after.get(skill.id), `n=${n}, k=${k}`).toEqual(before.get(skill.id))
          expect(tightest([...withPins, ...late], after, new Set(late.map((skill) => skill.id))), `n=${n}, k=${k}`).toBeGreaterThanOrEqual(PIN_AIR)
        }
      }
    })

    it('архивная закреплённая: кого она отодвинула, тот не возвращается; созданным после архивации её точка не мешает', () => {
      const sky = randomSky(8, 14)
      const plain = constellationPlacements(sky)
      const target = plain.get(sky[5].id)!
      const pin = { x: target.x + 20, y: target.y }
      const withPin = sky.map((skill, i) => (i === 1 ? { ...skill, skyPos: pin } : skill))
      const visible = constellationPlacements(withPin)
      expect(visible.get(sky[5].id)).not.toEqual(plain.get(sky[5].id))
      const archived = withPin.map((skill, i) => (i === 1 ? { ...skill, archivedAt: stamp(500) } : skill))
      const hidden = constellationPlacements(archived)
      expect(hidden.has(sky[1].id)).toBe(false)
      for (const skill of sky) if (skill.id !== sky[1].id) expect(hidden.get(skill.id)).toEqual(visible.get(skill.id))
      // галактике, созданной после архивации, закреплённая точка архивной не мешает: она встаёт на своё место
      const late = { id: 'late', createdAt: stamp(900) }
      const at = constellationPlacements([...archived, late])
      for (const skill of sky) if (skill.id !== sky[1].id) expect(at.get(skill.id)).toEqual(visible.get(skill.id))
      expect(tightest([...archived, late], at, new Set(['late']))).toBeGreaterThanOrEqual(PIN_AIR)
    })

    it('закреплённые в одной точке стоят в ней: это воля владельца, раскладка их не разводит', () => {
      const all = randomSky(13, 5).map((skill, i) => ({ ...skill, skyPos: { x: 100 + (i % 2) * 10, y: 100 } }))
      const placements = constellationPlacements(all)
      all.forEach((skill) => expect(placements.get(skill.id)).toMatchObject(skill.skyPos))
    })

    it('снятое закрепление возвращает галактику на её место', () => {
      const sky = randomSky(9, 12)
      const pinned = sky.map((skill, i) => (i === 4 ? { ...skill, skyPos: { x: 300, y: 300 } } : skill))
      constellationPlacements(pinned)
      expect([...constellationPlacements(unpinned(pinned))]).toEqual([...constellationPlacements(sky)])
    })
  })
})

describe('galaxyFootprint', () => {
  it('число колец неизвестно — место полного размера GALAXY_CLEARANCE', () => {
    const full = galaxyFootprint({})
    expect(full.half * 2).toBe(GALAXY_CLEARANCE.x)
    expect(full.bottom - full.top).toBe(GALAXY_CLEARANCE.y)
  })

  it('без звёзд и глифа — ядро с подписью: место ниже точки галактики', () => {
    const bare = galaxyFootprint({ rings: 0 })
    expect(bare.top).toBeGreaterThan(0)
    expect(bare.bottom - bare.top).toBeLessThan(GALAXY_CLEARANCE.y / 2)
    expect(galaxyFootprint({ rings: -3 })).toEqual(bare)
  })

  it('растёт с каждым кольцом и упирается в полный размер', () => {
    const sizes = [0, 1, 2, 3, 4, 5, 6, 12].map((rings) => galaxyFootprint({ rings }))
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i].top).toBeLessThanOrEqual(sizes[i - 1].top)
      expect(sizes[i].half).toBeGreaterThanOrEqual(sizes[i - 1].half)
    }
    expect(sizes[1].top).toBeLessThan(sizes[0].top)
    expect(sizes[4].top).toBeLessThan(sizes[3].top)
    expect(sizes[5]).toEqual(galaxyFootprint({}))
    expect(sizes[7]).toEqual(galaxyFootprint({}))
  })

  it('глиф занимает место и без звёзд; у выросшего созвездия место то же', () => {
    const bare = galaxyFootprint({ rings: 0 })
    const glyph = galaxyFootprint({ rings: 0, glyph: true })
    expect(glyph.top).toBeLessThan(bare.top)
    expect(glyph.top).toBeGreaterThan(galaxyFootprint({}).top)
    expect(galaxyFootprint({ rings: 2, glyph: true })).toEqual(glyph)
    expect(galaxyFootprint({ rings: 6, glyph: true })).toEqual(galaxyFootprint({ rings: 6 }))
  })

  it('веер созвездия любой формы помещается в место по числу своих колец', () => {
    /** Точка созвездия → небо, как её рисует Galaxy.tsx (без поворота). */
    const toSky = (x: number, y: number) => ({
      x: (x - CONST_W / 2) * MINI_SCALE,
      y: y * MINI_SCALE - (CONST_H * MINI_SCALE) / 2 - MINI_LIFT,
    })
    const chain = (depth: number) => Array.from({ length: depth }, (_, i) => star(`ch${depth}-${i}`, 'D', i === 0 ? null : `ch${depth}-${i - 1}`))
    const bush = (depth: number) => {
      const stars: StarComponent[] = []
      let level: (string | null)[] = [null]
      for (let d = 0; d < depth; d++) {
        const next: string[] = []
        level.forEach((parent, p) => {
          for (let k = 0; k < (d < 2 ? 4 : 2); k++) {
            const id = `b${depth}-${d}-${p}-${k}`
            stars.push(star(id, 'D', parent))
            next.push(id)
          }
        })
        level = next.slice(0, 6)
      }
      return stars
    }
    const wide = Array.from({ length: 14 }, (_, i) => star(`wide-${i}`, 'D', null))
    const trees = [wide, ...[1, 2, 3, 4, 5, 6, 7].flatMap((depth) => [chain(depth), bush(depth)])]
    for (const stars of trees) {
      const rings = constellationRings(stars)
      const place = galaxyFootprint({ rings })
      for (const seed of ['s1', 's_body', 'x', 'галактика']) {
        const { nodes, root } = layoutConstellation(stars, seed)
        expect(Math.max(...nodes.map((n) => n.depth)) + 1).toBe(rings)
        for (const node of [...nodes, root]) {
          const at = toSky(node.x, node.y)
          expect(at.y, `rings=${rings}, seed=${seed}`).toBeGreaterThanOrEqual(place.top + 2)
          expect(at.y).toBeLessThanOrEqual(place.bottom)
          expect(Math.abs(at.x), `rings=${rings}, seed=${seed}`).toBeLessThanOrEqual(place.half - 2)
        }
      }
    }
  })
})

describe('constellationRings', () => {
  it('глубина дерева звёзд: нет звёзд — 0, корни — 1, цепочка — её длина', () => {
    expect(constellationRings([])).toBe(0)
    expect(constellationRings([star('r1', 'D', null), star('r2', 'D', null)])).toBe(1)
    expect(constellationRings([star('a', 'D', null), star('b', 'D', 'a'), star('c', 'D', 'b'), star('d', 'D', null)])).toBe(3)
  })

  it('звезда без родителя в наборе в дерево не попадает; цикл не зацикливает', () => {
    expect(constellationRings([star('a', 'D', null), star('lost', 'D', 'нет такой'), star('deep', 'D', 'lost')])).toBe(1)
    expect(constellationRings([star('x', 'D', 'y'), star('y', 'D', 'x')])).toBe(0)
    expect(constellationRings([star('dup', 'D', null), star('dup', 'D', 'dup')])).toBe(1)
  })
})

describe('skyView', () => {
  const ratio = SKY_W / SKY_H

  it('пустое небо — кадр масштаба 1', () => {
    expect(skyView([], new Map())).toEqual({ x: 0, y: 0, w: SKY_W, h: SKY_H })
  })

  it('одна галактика: кадр вокруг неё, приближение не больше SKY_MAX_ZOOM', () => {
    const sky = [{ id: 'one', rings: 2 }]
    const at = constellationPlacements(sky)
    const view = skyView(sky, at)
    expect(view.w).toBeCloseTo(SKY_W / SKY_MAX_ZOOM, 1)
    expect(view.w / view.h).toBeCloseTo(ratio, 3)
    const place = galaxyFootprint(sky[0])
    const { x, y } = at.get('one')!
    expect(view.x + view.w / 2).toBeCloseTo(x, 1)
    expect(view.y + view.h / 2).toBeCloseTo(y + (place.top + place.bottom) / 2, 1)
  })

  it('в кадре помещаются места всех галактик с полем, пропорции кадра постоянны', () => {
    for (const n of [2, 7, 12, 20, 40]) {
      const sky = randomSky(n, n + 5)
      const at = constellationPlacements(sky)
      const view = skyView(sky, at)
      expect(view.w / view.h, `n=${n}`).toBeCloseTo(ratio, 2)
      for (const skill of sky) {
        const place = galaxyFootprint(skill)
        const { x, y } = at.get(skill.id)!
        expect(x - place.half).toBeGreaterThan(view.x + 30)
        expect(x + place.half).toBeLessThan(view.x + view.w - 30)
        expect(y + place.top).toBeGreaterThan(view.y + 30)
        expect(y + place.bottom).toBeLessThan(view.y + view.h - 30)
      }
    }
  })

  it('закреплённое небо владельца видно почти как раньше: масштаб около 1', () => {
    const view = skyView(liveSky, constellationPlacements(liveSky))
    expect(SKY_W / view.w).toBeGreaterThan(0.97)
    expect(SKY_W / view.w).toBeLessThan(1.06)
    expect(Math.abs(view.x)).toBeLessThan(60)
    expect(Math.abs(view.y)).toBeLessThan(60)
  })

  it('галактика, закреплённая далеко, раздвигает кадр; навык без места в раскладке не учитывается', () => {
    const sky = randomSky(6, 2)
    const near = skyView(sky, constellationPlacements(sky))
    const far = sky.map((skill, i) => (i === 0 ? { ...skill, skyPos: { x: 5200, y: 480 } } : skill))
    const wide = skyView(far, constellationPlacements(far))
    expect(wide.w).toBeGreaterThan(near.w * 2)
    expect(wide.x + wide.w).toBeGreaterThan(5200)
    expect(skyView([...sky, { id: 'ghost' }], constellationPlacements(sky))).toEqual(near)
  })
})

describe('crowdedWith', () => {
  it('называет налезающих соседей, чистое небо — пусто', () => {
    const sky = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const placements = new Map([['a', { x: 500, y: 500 }], ['b', { x: 600, y: 520 }], ['c', { x: 1400, y: 500 }]])
    expect(crowdedWith(sky, placements, 'a')).toEqual(['b'])
    expect(crowdedWith(sky, placements, 'c')).toEqual([])
    expect(crowdedWith(sky, placements, 'нет')).toEqual([])
  })

  it('считает по местам галактик: маленькие созвездия рядом не налезают, большие — налезают', () => {
    const placements = new Map([['a', { x: 500, y: 500 }], ['b', { x: 500, y: 700 }]])
    expect(crowdedWith([{ id: 'a' }, { id: 'b' }], placements, 'a')).toEqual(['b'])
    expect(crowdedWith([{ id: 'a', rings: 0 }, { id: 'b', rings: 0 }], placements, 'a')).toEqual([])
  })
})

describe('skySkillsOf', () => {
  it('несёт порядок создания, кольца созвездия, глиф и skyPos только у закреплённых; архивный — с моментом архивации', () => {
    const base = { emoji: '✨', name: 'Навык', hue: 10, wantStatement: '', archived: false }
    const own = (id: string, skillId: string, parentStarId: string | null) => ({ ...star(id, 'D', parentStarId), skillId })
    const skills = [
      { ...base, id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { ...base, id: 'b', createdAt: '2026-01-02T00:00:00.000Z', skyPos: { x: 1, y: 2 }, glyphId: 'delta' },
      { ...base, id: 'c', createdAt: '2026-01-03T00:00:00.000Z', archived: true, archivedAt: '2026-02-01T00:00:00.000Z' },
      // в архиве с тех времён, когда момент не записывался: на небо не влияет
      { ...base, id: 'd', createdAt: '2026-01-04T00:00:00.000Z', archived: true },
      // момент без архива редьюсер не пишет; чужой store — не повод прятать живую галактику
      { ...base, id: 'e', createdAt: '2026-01-05T00:00:00.000Z', archivedAt: '2026-02-01T00:00:00.000Z' },
    ]
    expect(skySkillsOf(skills, [own('a1', 'a', null), own('a2', 'a', 'a1'), own('b1', 'b', null), own('c1', 'c', null), own('z1', 'нет такого', null)])).toEqual([
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', rings: 2 },
      { id: 'b', createdAt: '2026-01-02T00:00:00.000Z', rings: 1, glyph: true, skyPos: { x: 1, y: 2 } },
      { id: 'c', createdAt: '2026-01-03T00:00:00.000Z', rings: 1, archivedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'e', createdAt: '2026-01-05T00:00:00.000Z', rings: 0 },
    ])
  })

  it('оттенок и имя навыка на небо не влияют', () => {
    const base = { emoji: '✨', wantStatement: '', archived: false }
    const sky = (hue: number, name: string) =>
      skySkillsOf(['a', 'b', 'c', 'd'].map((id, i) => ({ ...base, id, name: `${name} ${id}`, hue: hue + i * 40, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` })), [])
    expect([...constellationPlacements(sky(200, 'Казна'))]).toEqual([...constellationPlacements(sky(15, 'Тело'))])
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
