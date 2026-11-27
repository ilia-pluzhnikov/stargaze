import { describe, expect, it } from 'vitest'
import type { Skill, SkyStore, StarComponent } from '../types'
import { buildSkyScene, cameraBasis, flightCamera, flightPlan, orbitEye, pickGalaxy, project } from './sky3d'
import type { OrbitPose, Vec3 } from './sky3d'
import {
  ORBIT_MAX_DISTANCE, ORBIT_PITCH_MAX, ORBIT_YAW_MAX, RESUME_BLEND_SEC, RESUME_IDLE_SEC, pilotFlyTo, pilotResume, pilotRotate,
  pilotStartAt, pilotStep, pilotTick, pilotTogglePause, pilotZoom, rebasePilot, startPilot, stopIndexOf,
} from './sky3dPilot'
import type { Pilot } from './sky3dPilot'

const TS = '2026-10-01T05:00:00.000Z'
const skill = (id: string, hue: number): Skill =>
  ({ id, emoji: '⚔️', name: id, wantStatement: '', hue, archived: false, createdAt: TS })
const star = (id: string, skillId: string, tier: StarComponent['tier'], parentStarId: string | null = null): StarComponent =>
  ({ id, skillId, parentStarId, tier, title: id, litAt: TS, createdAt: TS })
const store: SkyStore = {
  skills: [skill('s_run', 210), skill('s_code', 40), skill('s_read', 300)],
  stars: [
    star('c_d1', 's_run', 'D'), star('c_c1', 's_run', 'C', 'c_d1'), star('c_b1', 's_run', 'B', 'c_c1'), star('c_d2', 's_run', 'D'),
    star('k_d1', 's_code', 'D'), star('k_c1', 's_code', 'C', 'k_d1'),
  ],
  quests: [], xpLog: [],
}
const scene = buildSkyScene(store)
const plan = flightPlan(scene)
const step = plan.holdSec + plan.travelSec
const DT = 1 / 30

const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
/** Насколько поза b ушла от a: сдвиг цели и глаза в единицах мира. */
const jump = (a: OrbitPose, b: OrbitPose) => Math.max(gap(a.target, b.target), gap(orbitEye(a), orbitEye(b)))
const run = (p: Pilot, sec: number, holding = false): Pilot => {
  for (let t = 0; t < sec - 1e-9; t += DT) p = pilotTick(p, plan, DT, holding)
  return p
}
const stopOf = (galaxyId: string) => plan.stops.findIndex((s) => s.galaxyId === galaxyId)

describe('автопролёт', () => {
  it('стартует с обзора; тик двигает время облёта и ставит камеру по flightCamera', () => {
    const p = run(startPilot(plan), 3)
    expect(p).toMatchObject({ mode: 'auto', stopIndex: 0, travelling: false })
    expect(p.clockSec).toBeCloseTo(3, 6)
    const frame = flightCamera(plan, p.clockSec)
    expect(jump(p.pose, frame)).toBeLessThan(1e-9)
  })

  it('фокус и перелёт — как у flightCamera: со второй половины перелёта фокус на следующей остановке', () => {
    const p = run(startPilot(plan), plan.holdSec + plan.travelSec * 0.75)
    expect(p).toMatchObject({ travelling: true, stopIndex: 1 })
  })

  it('пробел ставит облёт на паузу и снимает с неё', () => {
    const paused = pilotTogglePause(run(startPilot(plan), 2), plan)
    const later = run(paused, 5)
    expect(later.clockSec).toBeCloseTo(2, 6)
    expect(jump(later.pose, paused.pose)).toBeLessThan(1e-9)
    expect(run(pilotTogglePause(later, plan), 1).clockSec).toBeCloseTo(3, 6)
  })

  it('автопролёт никогда не выходит за пределы ручной камеры — перехват управления не дёргает камеру', () => {
    for (let t = 0; t < plan.loopSec; t += 0.21) {
      const f = flightCamera(plan, t)
      expect(Math.abs(f.yaw)).toBeLessThan(ORBIT_YAW_MAX)
      expect(Math.abs(f.pitch)).toBeLessThan(ORBIT_PITCH_MAX)
      expect(f.distance).toBeLessThan(ORBIT_MAX_DISTANCE)
      expect(f.distance).toBeGreaterThan(plan.stops[f.focusIndex].minDistance)
    }
    expect(plan.maxDistance).toBe(ORBIT_MAX_DISTANCE)
  })

  it('выросшее небо: дальний предел отходит вместе с обзором — перехват управления не стягивает камеру', () => {
    const many: SkyStore = {
      skills: Array.from({ length: 60 }, (_, i) => ({ ...skill(`s_${i}`, (i * 37) % 360), glyphId: 'delta' })),
      stars: [], quests: [], xpLog: [],
    }
    const big = flightPlan(buildSkyScene(many))
    // обзор такого неба дальше прежнего предела ручной камеры
    expect(big.stops[0].distance).toBeGreaterThan(ORBIT_MAX_DISTANCE)
    for (let t = 0; t < big.loopSec; t += 0.37) {
      const f = flightCamera(big, t)
      expect(f.distance).toBeLessThan(big.maxDistance)
      expect(f.distance).toBeGreaterThan(big.stops[f.focusIndex].minDistance)
    }
    // взяли управление на обзоре — камера остаётся где была; в перелёте цель доезжает до
    // остановки (так задумано), но расстояние не стягивается к прежнему пределу
    for (const sec of [1, big.holdSec + big.travelSec * 0.2]) {
      let auto = startPilot(big)
      for (let t = 0; t < sec - 1e-9; t += DT) auto = pilotTick(auto, big, DT)
      let manual = pilotRotate(auto, big, 0, 0)
      expect(manual.mode).toBe('manual')
      for (let i = 0; i < 60; i++) manual = pilotTick(manual, big, DT, true)
      expect(Math.abs(manual.pose.distance - auto.pose.distance), `t=${sec}`).toBeLessThan(1e-6)
      if (!auto.travelling) expect(jump(manual.pose, auto.pose), `t=${sec}`).toBeLessThan(1e-6)
    }
    // и руками можно отойти до обзора всего неба, но не дальше предела
    let far = pilotRotate(startPilot(big), big, 0, 0)
    for (let i = 0; i < 80; i++) far = pilotZoom(far, big, 1.3)
    for (let i = 0; i < 240; i++) far = pilotTick(far, big, DT, true)
    expect(far.pose.distance).toBeCloseTo(big.maxDistance, 2)
  })
})

describe('ручное управление', () => {
  it('вращение забирает управление без скачка: цель и расстояние те же, угол — ровно на сдвиг, облёт стоит', () => {
    const auto = run(startPilot(plan), step + 4) // стоим у первой галактики
    const m = pilotRotate(auto, plan, 0.2, -0.1)
    expect(m.mode).toBe('manual')
    expect(m.pose.target).toEqual(auto.pose.target)
    expect(m.pose.distance).toBe(auto.pose.distance)
    expect(m.pose.yaw).toBeCloseTo(auto.pose.yaw + 0.2, 12)
    expect(m.pose.pitch).toBeCloseTo(auto.pose.pitch - 0.1, 12)
    const later = run(m, 5)
    expect(later.clockSec).toBe(auto.clockSec)
    expect(jump(later.pose, m.pose)).toBeLessThan(1e-6) // сам никуда не едет
  })

  it('углы упираются в пределы: за спину неба и «через зенит» не повернуть', () => {
    let p = startPilot(plan)
    for (let i = 0; i < 200; i++) p = pilotRotate(p, plan, 0.1, 0.1)
    expect([p.pose.yaw, p.pose.pitch]).toEqual([ORBIT_YAW_MAX, ORBIT_PITCH_MAX])
    for (let i = 0; i < 400; i++) p = pilotRotate(p, plan, -0.1, -0.1)
    expect([p.pose.yaw, p.pose.pitch]).toEqual([-ORBIT_YAW_MAX, -ORBIT_PITCH_MAX])
  })

  it('зум плавный и ограничен: ближе minDistance остановки и дальше общего предела не уйти', () => {
    const at = run(startPilot(plan), step + 2)
    const stop = plan.stops[at.stopIndex]
    let near = at
    for (let i = 0; i < 80; i++) near = pilotZoom(near, plan, 0.8)
    expect(near.goal.distance).toBe(stop.minDistance)
    expect(near.pose.distance).toBe(at.pose.distance) // цель сменилась сразу, камера ещё не поехала
    let prev = near.pose.distance
    for (let i = 0; i < 90; i++) {
      near = pilotTick(near, plan, DT)
      expect(near.pose.distance).toBeLessThanOrEqual(prev) // без перелёта и качаний
      expect(near.pose.distance).toBeGreaterThanOrEqual(stop.minDistance - 1e-9)
      prev = near.pose.distance
    }
    expect(near.pose.distance).toBeCloseTo(stop.minDistance, 3)
    let far = at
    for (let i = 0; i < 80; i++) far = pilotZoom(far, plan, 1.3)
    expect(run(far, 4).pose.distance).toBeCloseTo(ORBIT_MAX_DISTANCE, 3)
  })

  it('как ни крути и ни приближай — камера остаётся снаружи сферы звёзд галактики', () => {
    for (const g of scene.galaxies) {
      let p = pilotFlyTo(startPilot(plan), plan, stopOf(g.id))
      for (let i = 0; i < 60; i++) p = pilotZoom(p, plan, 0.7)
      for (const [yaw, pitch] of [[0, 0], [2, 0], [-2, 2], [2, -2], [0, 2]]) {
        const turned = run(pilotRotate(p, plan, yaw, pitch), 4)
        expect(gap(orbitEye(turned.pose), g.center), `${g.id} ${yaw}/${pitch}`).toBeGreaterThan(g.radius)
      }
    }
  })

  it('клик по галактике: камера долетает до неё плавно, углы остаются за человеком, фокус и пределы — её', () => {
    const turned = pilotRotate(run(startPilot(plan), 2), plan, 0.4, 0.2)
    const idx = stopOf('s_code')
    let p = pilotFlyTo(turned, plan, idx)
    expect(p).toMatchObject({ mode: 'manual', stopIndex: idx })
    let worst = 0
    for (let i = 0; i < 120; i++) {
      const next = pilotTick(p, plan, DT)
      worst = Math.max(worst, jump(p.pose, next.pose))
      p = next
    }
    expect(worst).toBeLessThan(220) // первый кадр подлёта через всё небо — самый быстрый; дальше замедление
    expect(gap(p.pose.target, plan.stops[idx].target)).toBeLessThan(0.01)
    expect(p.pose.distance).toBeCloseTo(plan.stops[idx].distance, 2)
    expect([p.pose.yaw, p.pose.pitch]).toEqual([turned.pose.yaw, turned.pose.pitch])
  })

  it('перехват в перелёте: камера не прыгает и доезжает до галактики, к которой летела', () => {
    const flying = run(startPilot(plan), plan.holdSec + plan.travelSec * 0.7)
    const m = pilotZoom(flying, plan, 1)
    expect(jump(m.pose, flying.pose)).toBe(0)
    expect(m.goal.target).toEqual(plan.stops[1].target)
    expect(gap(run(m, 4).pose.target, plan.stops[1].target)).toBeLessThan(0.01)
  })

  it('ход ручной камеры не зависит от частоты кадров', () => {
    const start = pilotFlyTo(pilotRotate(startPilot(plan), plan, 0.3, 0.1), plan, stopOf('s_run'))
    let slow = start
    for (let i = 0; i < 2; i++) slow = pilotTick(slow, plan, 0.5)
    expect(jump(slow.pose, run(start, 1).pose)).toBeLessThan(1e-6)
  })
})

describe('возврат автопролёта', () => {
  const manual = () => run(pilotFlyTo(pilotRotate(startPilot(plan), plan, 0.6, 0.3), plan, stopOf('s_read')), 5)

  it('после RESUME_IDLE_SEC покоя облёт продолжается сам — с начала остановки, на которую смотрели', () => {
    const m = manual()
    const still = run(m, RESUME_IDLE_SEC - 5 - 0.2)
    expect(still.mode).toBe('manual')
    const back = run(still, 0.5)
    expect(back).toMatchObject({ mode: 'auto', paused: false, stopIndex: stopOf('s_read') })
    expect(back.clockSec).toBeGreaterThanOrEqual(stopOf('s_read') * step)
    expect(back.clockSec).toBeLessThan(stopOf('s_read') * step + 1)
  })

  it('пока человек держит камеру, покой не считается', () => {
    const held = run(manual(), RESUME_IDLE_SEC + 10, true)
    expect(held.mode).toBe('manual')
    expect(run(held, RESUME_IDLE_SEC - 1).mode).toBe('manual') // отсчёт пошёл только после отпускания
    expect(run(held, RESUME_IDLE_SEC + 0.1).mode).toBe('auto')
  })

  it('любой ввод сбрасывает отсчёт покоя', () => {
    let p = run(manual(), RESUME_IDLE_SEC - 6)
    p = run(pilotZoom(p, plan, 1.05), RESUME_IDLE_SEC - 1)
    expect(p.mode).toBe('manual')
  })

  it('возврат плавный: ни в кадре переключения, ни в переходе камера не прыгает, в конце — ровно автопролёт', () => {
    let p = manual()
    const before = p.pose
    p = pilotResume(p, plan)
    expect(jump(p.pose, before)).toBe(0)
    let worst = 0
    for (let t = 0; t < RESUME_BLEND_SEC + 1; t += DT) {
      const next = pilotTick(p, plan, DT)
      worst = Math.max(worst, jump(p.pose, next.pose))
      p = next
    }
    expect(worst).toBeLessThan(40)
    expect(p.blend).toBeNull()
    expect(jump(p.pose, flightCamera(plan, p.clockSec))).toBeLessThan(1e-9)
  })

  it('ввод во время возврата снова отдаёт управление — с той позы, что в кадре', () => {
    const mid = run(pilotResume(manual(), plan), RESUME_BLEND_SEC / 2)
    const again = pilotRotate(mid, plan, 0, 0)
    expect(again).toMatchObject({ mode: 'manual', blend: null })
    expect(jump(again.pose, mid.pose)).toBeLessThan(1e-9)
  })

  it('пробел в ручном режиме возвращает облёт сразу', () => {
    expect(pilotTogglePause(manual(), plan)).toMatchObject({ mode: 'auto', paused: false })
  })
})

describe('pilotStep', () => {
  it('в автопролёте: вперёд — к следующей остановке, назад из середины — к началу текущей, из начала — к предыдущей', () => {
    const mid = run(startPilot(plan), step + 5)
    expect(pilotStep(mid, plan, 1).clockSec).toBe(2 * step)
    expect(pilotStep(mid, plan, -1).clockSec).toBe(step)
    expect(pilotStep(pilotStep(mid, plan, -1), plan, -1).clockSec).toBe(0)
  })

  it('по кругу: с последней остановки вперёд — на обзор, с обзора назад — на последнюю', () => {
    const last = plan.stops.length - 1
    expect(pilotStep(pilotStep(startPilot(plan), plan, -1), plan, 1)).toMatchObject({ stopIndex: 0, clockSec: 0 })
    expect(pilotStep(startPilot(plan), plan, -1)).toMatchObject({ stopIndex: last, clockSec: last * step })
  })

  it('из ручного режима — к соседней остановке и обратно в автопролёт, плавно', () => {
    const m = run(pilotFlyTo(startPilot(plan), plan, 2), 3)
    const next = pilotStep(m, plan, 1)
    expect(next).toMatchObject({ mode: 'auto', stopIndex: 3, clockSec: 3 * step })
    expect(jump(next.pose, m.pose)).toBe(0)
  })
})

describe('старт облёта с галактики из адреса', () => {
  it('stopIndexOf: остановка галактики; нет такой, null, пусто — обзор', () => {
    for (const g of scene.galaxies) expect(plan.stops[stopIndexOf(plan, g.id)].galaxyId).toBe(g.id)
    for (const id of ['нет-такой', null, undefined, '']) expect(stopIndexOf(plan, id), String(id)).toBe(0)
  })

  it('startPilot с остановкой: автопролёт сразу стоит у этой галактики, без подлёта', () => {
    const idx = stopOf('s_code')
    const p = startPilot(plan, idx)
    expect(p).toMatchObject({ mode: 'auto', stopIndex: idx, clockSec: idx * step, travelling: false, blend: null })
    expect(p.pose.target).toEqual(plan.stops[idx].target)
    expect(run(p, 1)).toMatchObject({ mode: 'auto', stopIndex: idx })
  })

  it('pilotStartAt: из ручного режима и из автопролёта — плавно к названной галактике, дальше облёт идёт сам', () => {
    const idx = stopOf('s_read')
    for (const from of [run(startPilot(plan), 4), run(pilotRotate(pilotFlyTo(startPilot(plan), plan, stopOf('s_run')), plan, 0.5, 0.2), 3)]) {
      const moved = pilotStartAt(from, plan, 's_read')
      expect(moved).toMatchObject({ mode: 'auto', paused: false, stopIndex: idx, clockSec: idx * step })
      expect(jump(moved.pose, from.pose)).toBe(0) // в кадре переключения камера на месте
      const there = run(moved, 5)
      expect(gap(there.pose.target, plan.stops[idx].target)).toBeLessThan(1e-9)
      expect(there.stopIndex).toBe(idx)
    }
  })

  it('pilotStartAt: галактики нет в плане или адрес вернулся на общее небо — к обзору', () => {
    const at = run(startPilot(plan, 2), 3)
    expect(pilotStartAt(at, plan, 'нет-такой')).toMatchObject({ stopIndex: 0, clockSec: 0 })
    expect(pilotStartAt(at, plan, null)).toMatchObject({ stopIndex: 0, clockSec: 0 })
  })
})

describe('rebasePilot', () => {
  it('остановок стало меньше — фокус не указывает за край, ручная цель переезжает на живую остановку', () => {
    const small = flightPlan(buildSkyScene({ ...store, skills: store.skills.slice(0, 1) }))
    const auto = rebasePilot(run(startPilot(plan), 3 * step + 1), small)
    expect(auto.stopIndex).toBe(1)
    expect(() => pilotTick(auto, small, DT)).not.toThrow()
    const manual = rebasePilot(pilotFlyTo(startPilot(plan), plan, 3), small)
    expect(manual.stopIndex).toBe(1)
    expect(manual.goal.target).toEqual(small.stops[1].target)
  })
})

describe('pickGalaxy', () => {
  const basis = cameraBasis(flightCamera(plan, 0), 1920, 1080)

  it('клик в центр галактики на обзоре попадает в неё; в пустоту — мимо', () => {
    for (const g of scene.galaxies) {
      const p = project(g.center, basis)!
      expect(pickGalaxy(scene, basis, p.x, p.y), g.id).toBe(g.id)
      expect(pickGalaxy(scene, basis, p.x + 3, p.y - 3), g.id).toBe(g.id)
    }
    expect(pickGalaxy(scene, basis, 2, 2)).toBeNull()
  })

  it('из двух перекрывшихся на экране выбирается ближняя к камере', () => {
    const [a, b] = scene.galaxies
    // камера на луче за a, смотрит на b: обе в центре кадра
    const eye = { x: a.center.x * 2 - b.center.x, y: a.center.y * 2 - b.center.y, z: a.center.z * 2 - b.center.z }
    const lined = cameraBasis({ eye, target: b.center }, 1920, 1080)
    expect(pickGalaxy(scene, lined, 960, 540)).toBe(a.id)
  })

  it('галактика за камерой не выбирается', () => {
    const g = scene.galaxies[0]
    const away = cameraBasis({ eye: g.center, target: { x: g.center.x, y: g.center.y, z: g.center.z + 500 } }, 1920, 1080)
    const behind = { ...scene, galaxies: [{ ...g, center: { ...g.center, z: g.center.z - 300 } }] }
    expect(pickGalaxy(behind, away, 960, 540)).toBeNull()
  })
})
