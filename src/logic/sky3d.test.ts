import { describe, expect, it } from 'vitest'
import type { Skill, SkyStore, StarComponent } from '../types'
import {
  FLIGHT_HOLD_SEC, FLIGHT_TRAVEL_SEC, SKY_DEPTH, backdropStars, buildSkyScene, cameraBasis, flightCamera, flightPlan, project,
  projectDirection,
} from './sky3d'
import type { Vec3 } from './sky3d'
import { SKY_MAX_ZOOM } from './layout'

const TS = '2026-10-01T05:00:00.000Z'
const skill = (id: string, over: Partial<Skill> = {}): Skill =>
  ({ id, emoji: '⚔️', name: id, wantStatement: '', hue: 0, archived: false, createdAt: TS, ...over })
const star = (id: string, skillId: string, tier: StarComponent['tier'], parentStarId: string | null = null, lit = false): StarComponent =>
  ({ id, skillId, parentStarId, tier, title: id, ...(lit ? { litAt: TS } : {}), createdAt: TS })
const world = (over: Partial<SkyStore> = {}): SkyStore => ({ skills: [], stars: [], quests: [], xpLog: [], ...over })

const sky = (): SkyStore => world({
  skills: [
    skill('s_run', { hue: 210, glyphId: 'delta' }), skill('s_code', { hue: 40 }), skill('s_read', { hue: 300 }),
    skill('s_old', { hue: 120, archived: true }),
  ],
  stars: [
    star('c_d1', 's_run', 'D', null, true), star('c_c1', 's_run', 'C', 'c_d1', true), star('c_b1', 's_run', 'B', 'c_c1'),
    star('c_d2', 's_run', 'D'),
    star('k_d1', 's_code', 'D', null, true),
    star('o_d1', 's_old', 'D', null, true),
  ],
})

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z)
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('buildSkyScene', () => {
  it('детерминирована: та же сцена на тот же store, порядок навыков в store роли не играет для мест', () => {
    const a = buildSkyScene(sky())
    expect(buildSkyScene(sky())).toEqual(a)
    const shuffled = sky()
    shuffled.skills.reverse()
    const byId = (scene: typeof a) => new Map(scene.galaxies.map((g) => [g.id, g]))
    for (const [id, g] of byId(buildSkyScene(shuffled))) expect(g, id).toEqual(byId(a).get(id))
  })

  it('начало координат сцены — центр неба, где бы оно ни стояло: галактики лежат вокруг нуля', () => {
    const many = world({ skills: Array.from({ length: 40 }, (_, i) => skill(`s_${i}`, { hue: i * 9, glyphId: 'delta' })) })
    const shifted = world({ skills: many.skills.map((sk, i) => ({ ...sk, skyPos: { x: 5000 + (i % 8) * 400, y: -3000 + Math.floor(i / 8) * 400 } })) })
    for (const scene of [buildSkyScene(many), buildSkyScene(shifted)]) {
      const xs = scene.galaxies.map((g) => g.center.x)
      const ys = scene.galaxies.map((g) => g.center.y)
      expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(120)
      expect(Math.abs(Math.min(...ys) + Math.max(...ys))).toBeLessThan(120)
    }
  })

  it('архив не рисуется; hue и glyphId — как у навыка, без глифа ключа нет', () => {
    const scene = buildSkyScene(sky())
    expect(scene.galaxies.map((g) => g.id).sort()).toEqual(['s_code', 's_read', 's_run'])
    const run = scene.galaxies.find((g) => g.id === 's_run')!
    expect([run.hue, run.glyphId]).toEqual([210, 'delta'])
    expect(scene.galaxies.find((g) => g.id === 's_code')).not.toHaveProperty('glyphId')
  })

  it('глубина галактик — в ±SKY_DEPTH и у разных галактик разная', () => {
    const depths = buildSkyScene(sky()).galaxies.map((g) => g.center.z)
    for (const z of depths) expect(Math.abs(z)).toBeLessThanOrEqual(SKY_DEPTH)
    expect(new Set(depths).size).toBe(depths.length)
  })

  it('звёзды: свет и ранг из store, parent — индекс родителя, корневые растут от ядра (-1)', () => {
    const run = buildSkyScene(sky()).galaxies.find((g) => g.id === 's_run')!
    const at = (id: string) => run.stars.findIndex((s) => s.id === id)
    expect(run.stars.map((s) => s.id).sort()).toEqual(['c_b1', 'c_c1', 'c_d1', 'c_d2'])
    expect(run.stars[at('c_d1')]).toMatchObject({ tier: 'D', lit: true, parent: -1 })
    expect(run.stars[at('c_c1')]).toMatchObject({ tier: 'C', lit: true, parent: at('c_d1') })
    expect(run.stars[at('c_b1')]).toMatchObject({ tier: 'B', lit: false, parent: at('c_c1') })
    expect(run.stars[at('c_d2')].parent).toBe(-1)
  })

  it('звёзды разнесены по глубине и вместе с ядром лежат в сфере radius вокруг center', () => {
    const run = buildSkyScene(sky()).galaxies.find((g) => g.id === 's_run')!
    expect(new Set(run.stars.map((s) => s.pos.z)).size).toBe(run.stars.length)
    for (const s of run.stars) expect(gap(s.pos, run.center), s.id).toBeLessThanOrEqual(run.radius + 1e-9)
    expect(gap(run.core, run.center)).toBeLessThanOrEqual(run.radius + 1e-9)
    expect(run.core.z).toBe(run.center.z) // ядро — в плоскости галактики
  })

  it('галактика без звёзд есть в сцене: ядро на месте, радиус не нулевой', () => {
    const read = buildSkyScene(sky()).galaxies.find((g) => g.id === 's_read')!
    expect(read.stars).toEqual([])
    expect(read.radius).toBeGreaterThan(0)
  })

  it('история — проекция: в прошлом звёзд меньше и света нет, но места те же, что сегодня', () => {
    const today = sky()
    const past: SkyStore = {
      ...today,
      skills: today.skills.filter((s) => s.id !== 's_read'), // навыка ещё не было
      stars: today.stars.filter((s) => s.id !== 'c_b1').map(({ litAt: _litAt, ...s }) => s),
    }
    const now = buildSkyScene(today)
    const then = buildSkyScene(past, today)
    expect(then.galaxies.map((g) => g.id).sort()).toEqual(['s_code', 's_run'])
    const runNow = now.galaxies.find((g) => g.id === 's_run')!
    const runThen = then.galaxies.find((g) => g.id === 's_run')!
    expect(runThen.center).toEqual(runNow.center)
    expect(runThen.stars.map((s) => s.id).sort()).toEqual(['c_c1', 'c_d1', 'c_d2'])
    for (const s of runThen.stars) {
      expect(s.lit, s.id).toBe(false)
      expect(s.pos, s.id).toEqual(runNow.stars.find((x) => x.id === s.id)!.pos)
    }
  })

  it('пустой мир — пустая сцена без NaN', () => {
    const scene = buildSkyScene(world())
    expect(scene.galaxies).toEqual([])
    expect(Number.isFinite(scene.radius)).toBe(true)
  })
})

describe('flightPlan / flightCamera', () => {
  const plan = flightPlan(buildSkyScene(sky()))
  const step = FLIGHT_HOLD_SEC + FLIGHT_TRAVEL_SEC

  describe('обзорная остановка вписывает небо в кадр', () => {
    const glyphSky = (n: number) => world({ skills: Array.from({ length: n }, (_, i) => skill(`g_${i}`, { hue: (i * 37) % 360, glyphId: 'delta' })) })
    const farPin = glyphSky(12)
    farPin.skills[0] = { ...farPin.skills[0], skyPos: { x: 900, y: -1500 } }
    const skies: [string, SkyStore][] = [
      ['3 галактики', sky()], ['12 галактик', glyphSky(12)], ['40 галактик', glyphSky(40)], ['закрепление вдали', farPin],
    ]

    it('центры всех галактик в кадре 16:9 всё время стоянки — при любом размере неба', () => {
      for (const [name, store] of skies) {
        const scene = buildSkyScene(store)
        const overview = flightPlan(scene)
        for (let t = 0; t < FLIGHT_HOLD_SEC; t += 0.25) {
          const basis = cameraBasis(flightCamera(overview, t), 1920, 1080)
          for (const g of scene.galaxies) {
            const p = project(g.center, basis)
            expect(p, `${name}, t=${t}, ${g.id}`).not.toBeNull()
            expect(p!.x, `${name}, t=${t}, ${g.id}`).toBeGreaterThanOrEqual(-0.5)
            expect(p!.x).toBeLessThanOrEqual(1920.5)
            expect(p!.y, `${name}, t=${t}, ${g.id}`).toBeGreaterThanOrEqual(-0.5)
            expect(p!.y).toBeLessThanOrEqual(1080.5)
          }
        }
      }
    })

    it('небо выросло — обзор отходит; маленькое небо — подходит, но не ближе обзора 2D', () => {
      const distance = (store: SkyStore) => flightPlan(buildSkyScene(store)).stops[0].distance
      const [d3, d12, d40] = [distance(sky()), distance(glyphSky(12)), distance(glyphSky(40))]
      expect(d3).toBeCloseTo(1200 / SKY_MAX_ZOOM, 6)
      expect(d12).toBeGreaterThan(d3)
      expect(d40).toBeGreaterThan(d12 * 1.5)
      expect(distance(farPin)).toBeGreaterThan(d12 * 1.5)
      expect(distance(world())).toBeCloseTo(1200 / SKY_MAX_ZOOM, 6)
    })

    it('ручное приближение на обзоре не уводит галактики за камеру: ближний предел дальше глубины неба', () => {
      for (const [, store] of skies) expect(flightPlan(buildSkyScene(store)).stops[0].minDistance).toBeGreaterThan(SKY_DEPTH)
    })

    it('дальний предел ручной камеры — не ближе, чем уходит автопролёт', () => {
      for (const [name, store] of skies) {
        const overview = flightPlan(buildSkyScene(store))
        for (let t = 0; t < overview.loopSec; t += 0.31) expect(flightCamera(overview, t).distance, name).toBeLessThan(overview.maxDistance)
      }
    })
  })

  it('маршрут: обзор, потом каждая живая галактика по разу; период — шаг × остановки', () => {
    expect(plan.stops[0].galaxyId).toBeNull()
    expect(plan.stops.slice(1).map((s) => s.galaxyId).sort()).toEqual(['s_code', 's_read', 's_run'])
    expect(plan.loopSec).toBe(4 * step)
  })

  it('у остановки камера смотрит в её цель и держится на расстоянии, пока не начнётся перелёт', () => {
    plan.stops.forEach((stop, i) => {
      for (const local of [0, FLIGHT_HOLD_SEC / 2, FLIGHT_HOLD_SEC - 0.01]) {
        const frame = flightCamera(plan, i * step + local)
        expect(frame).toMatchObject({ stopIndex: i, galaxyId: stop.galaxyId, travelling: false, target: stop.target })
        const d = gap(frame.eye, frame.target)
        expect(d).toBeGreaterThan(stop.distance * 0.9)
        expect(d).toBeLessThan(stop.distance * 1.13)
      }
    })
  })

  it('в перелёте фокус переходит на следующую галактику с середины пути; после последней — снова обзор', () => {
    const early = flightCamera(plan, FLIGHT_HOLD_SEC + FLIGHT_TRAVEL_SEC * 0.25)
    const late = flightCamera(plan, FLIGHT_HOLD_SEC + FLIGHT_TRAVEL_SEC * 0.75)
    expect([early.travelling, early.galaxyId]).toEqual([true, null])
    expect([late.travelling, late.galaxyId]).toEqual([true, plan.stops[1].galaxyId])
    expect(flightCamera(plan, plan.loopSec - FLIGHT_TRAVEL_SEC * 0.25).galaxyId).toBeNull()
  })

  it('периодична и определена для любого t, в том числе отрицательного', () => {
    for (const t of [0, 3.7, step, plan.loopSec - 0.5]) {
      const a = flightCamera(plan, t)
      for (const other of [t + plan.loopSec, t + 5 * plan.loopSec, t - plan.loopSec]) {
        const b = flightCamera(plan, other)
        expect(gap(a.eye, b.eye)).toBeLessThan(1e-6)
        expect(gap(a.target, b.target)).toBeLessThan(1e-6)
      }
    }
  })

  it('непрерывна: за 1/30 с камера не прыгает нигде, включая стык цикла и границы остановок', () => {
    const dt = 1 / 30
    let worst = 0
    for (let t = -1; t < plan.loopSec + 1; t += dt) {
      const a = flightCamera(plan, t)
      const b = flightCamera(plan, t + dt)
      worst = Math.max(worst, gap(a.eye, b.eye), gap(a.target, b.target))
    }
    expect(worst).toBeLessThan(40) // самый быстрый участок — середина перелёта через всё небо
  })

  it('камера не влетает в цель и не уходит ей за спину: цель всегда впереди, в центре кадра', () => {
    for (let t = 0; t < plan.loopSec; t += 0.37) {
      const frame = flightCamera(plan, t)
      const p = project(frame.target, cameraBasis(frame, 1920, 1080))
      expect(p, `t=${t}`).not.toBeNull()
      expect(p!.depth).toBeGreaterThan(150)
      expect(Math.hypot(p!.x - 960, p!.y - 540)).toBeLessThan(1e-6)
    }
  })

  it('пустое небо: одна остановка-обзор, камера без NaN', () => {
    const empty = flightPlan(buildSkyScene(world()))
    expect(empty.stops).toHaveLength(1)
    for (const t of [0, 10, 21.9, 22, 1000]) {
      const frame = flightCamera(empty, t)
      expect([frame.eye.x, frame.eye.y, frame.eye.z].every(Number.isFinite)).toBe(true)
      expect(frame.galaxyId).toBeNull()
    }
  })

  it('обзорный план вмещает всё небо в кадр 16:9', () => {
    const scene = buildSkyScene(sky())
    const basis = cameraBasis(flightCamera(plan, 0), 1920, 1080)
    for (const g of scene.galaxies)
      for (const p of [g.center, g.core, ...g.stars.map((s) => s.pos)]) {
        const at = project(p, basis)!
        expect(at.x).toBeGreaterThan(0)
        expect(at.x).toBeLessThan(1920)
        expect(at.y).toBeGreaterThan(0)
        expect(at.y).toBeLessThan(1080)
      }
  })
})

describe('cameraBasis / project', () => {
  const front = { eye: { x: 0, y: 0, z: -1000 }, target: { x: 0, y: 0, z: 0 } }
  const basis = cameraBasis(front, 1600, 900)

  it('базис ортонормирован; взгляд спереди: право — +x, экранный низ — +y мира', () => {
    for (const v of [basis.right, basis.up, basis.forward]) expect(len(v)).toBeCloseTo(1, 12)
    const dots = [
      basis.right.x * basis.up.x + basis.right.y * basis.up.y + basis.right.z * basis.up.z,
      basis.right.x * basis.forward.x + basis.right.y * basis.forward.y + basis.right.z * basis.forward.z,
      basis.up.x * basis.forward.x + basis.up.y * basis.forward.y + basis.up.z * basis.forward.z,
    ]
    for (const d of dots) expect(d).toBeCloseTo(0, 12)
    expect(project({ x: 100, y: 0, z: 0 }, basis)!.x).toBeGreaterThan(800)
    expect(project({ x: 0, y: 100, z: 0 }, basis)!.y).toBeGreaterThan(450)
  })

  it('цель — в центре кадра; масштаб обратно пропорционален глубине', () => {
    expect(project(front.target, basis)).toMatchObject({ x: 800, y: 450, depth: 1000 })
    const near = project({ x: 0, y: 0, z: -500 }, basis)!
    const far = project({ x: 0, y: 0, z: 1000 }, basis)!
    expect(near.scale / far.scale).toBeCloseTo(4, 9)
  })

  it('точка за камерой или вплотную к ней не рисуется', () => {
    expect(project({ x: 0, y: 0, z: -2000 }, basis)).toBeNull()
    expect(project({ x: 5, y: 5, z: -999 }, basis)).toBeNull()
  })

  it('узкий кадр считает фокус по ширине: небо не обрезается в портрете', () => {
    expect(cameraBasis(front, 900, 1600).focal).toBeLessThan(cameraBasis(front, 1600, 900).focal)
  })

  it('взгляд строго по вертикали не даёт NaN', () => {
    const down = cameraBasis({ eye: { x: 0, y: -500, z: 0 }, target: { x: 0, y: 0, z: 0 } }, 800, 600)
    expect([down.right, down.up, down.forward].flatMap((v) => [v.x, v.y, v.z]).every(Number.isFinite)).toBe(true)
  })

  it('projectDirection: поворот камеры двигает фон, перенос камеры — нет', () => {
    const dir = { x: 0.1, y: 0.1, z: 0.99 }
    const moved = cameraBasis({ eye: { x: 300, y: 0, z: -1000 }, target: { x: 300, y: 0, z: 0 } }, 1600, 900)
    const turned = cameraBasis({ eye: { x: 600, y: 0, z: -1000 }, target: { x: 0, y: 0, z: 0 } }, 1600, 900)
    expect(projectDirection(dir, moved)).toEqual(projectDirection(dir, basis))
    expect(projectDirection(dir, turned)!.x).not.toBeCloseTo(projectDirection(dir, basis)!.x, 3)
    expect(projectDirection({ x: 0, y: 0, z: -1 }, basis)).toBeNull()
  })
})

describe('backdropStars', () => {
  it('детерминированы от seed, направления единичные, разные seed — разное небо', () => {
    const a = backdropStars(200, 'sky3d')
    expect(backdropStars(200, 'sky3d')).toEqual(a)
    expect(backdropStars(200, 'другое')).not.toEqual(a)
    for (const s of a) expect(len(s.direction)).toBeCloseTo(1, 9)
  })

  it('minZ оставляет только шапку сферы вокруг оси взгляда', () => {
    const cap = backdropStars(300, 'sky3d', 0.3)
    for (const s of cap) {
      expect(s.direction.z).toBeGreaterThanOrEqual(0.3)
      expect(len(s.direction)).toBeCloseTo(1, 9)
    }
    expect(backdropStars(300, 'sky3d').some((s) => s.direction.z < 0)).toBe(true)
  })
})
