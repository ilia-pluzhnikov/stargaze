import { flightCamera, mixPose, smooth } from './sky3d'
import type { FlightPlan, OrbitPose } from './sky3d'

// Пилот 3D-неба: кто ведёт камеру — автопролёт или человек. Чистые функции от
// (состояние, план облёта, прошедшее время): время приходит снаружи шагом dt, случайности нет.
//
// Автопролёт — заставка: камера идёт по flightCamera. Любой ручной ввод (вращение, зум,
// подлёт к галактике) забирает управление: облёт замирает, камера остаётся там, где была.
// Через RESUME_IDLE_SEC покоя облёт сам продолжается с остановки, на которую смотрели, —
// заставка возвращается без кнопок.

export interface Pilot {
  mode: 'auto' | 'manual'
  /** Время облёта, секунды. В ручном режиме стоит. */
  clockSec: number
  /** Пауза автопролёта (пробел). */
  paused: boolean
  /** Поза камеры в кадре. */
  pose: OrbitPose
  /** Куда ручная камера плавно стремится: цель и расстояние догоняются, углы — сразу. */
  goal: OrbitPose
  /** Остановка в фокусе: её галактика — в подписи, её ближний предел — у зума. */
  stopIndex: number
  /** Автопролёт сейчас в перелёте между остановками. */
  travelling: boolean
  /** Секунд без ручного ввода (в ручном режиме). */
  idleSec: number
  /** Плавный возврат к автопролёту: от позы from к летящей камере, u — 0..1. */
  blend: { from: OrbitPose; u: number } | null
}

/** Пределы ручной камеры. Небо всегда видно «спереди»: сбоку созвездия вырождаются в
 * линию, сзади — зеркальны; дальше MAX_DISTANCE небо превращается в точку. */
export const ORBIT_YAW_MAX = 1.25
export const ORBIT_PITCH_MAX = 0.85
export const ORBIT_MAX_DISTANCE = 2600
/** Секунд покоя, после которых автопролёт продолжается сам. */
export const RESUME_IDLE_SEC = 30
/** Секунд на плавный возврат от ручной позы к автопролёту. */
export const RESUME_BLEND_SEC = 2.4
/** Скорость, с которой ручная камера догоняет цель: за 1/RATE секунды остаётся ~37% пути. */
const APPROACH_RATE = 4.5

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const copyPose = ({ target, distance, yaw, pitch }: OrbitPose): OrbitPose => ({ target, distance, yaw, pitch })

function limited(pose: OrbitPose, plan: FlightPlan, stopIndex: number): OrbitPose {
  return {
    target: pose.target,
    distance: clamp(pose.distance, plan.stops[stopIndex].minDistance, ORBIT_MAX_DISTANCE),
    yaw: clamp(pose.yaw, -ORBIT_YAW_MAX, ORBIT_YAW_MAX),
    pitch: clamp(pose.pitch, -ORBIT_PITCH_MAX, ORBIT_PITCH_MAX),
  }
}

/** Остановка галактики в плане облёта; такой нет (или null — общее небо) — обзор. */
export function stopIndexOf(plan: FlightPlan, galaxyId: string | null | undefined): number {
  const at = galaxyId ? plan.stops.findIndex((s) => s.galaxyId === galaxyId) : -1
  return at < 0 ? 0 : at
}

/** Пилот в начале облёта: автопролёт с начала остановки stopIndex (по умолчанию — с обзора). */
export function startPilot(plan: FlightPlan, stopIndex = 0): Pilot {
  const clockSec = stopIndex * (plan.holdSec + plan.travelSec)
  const frame = flightCamera(plan, clockSec)
  const pose = copyPose(frame)
  return { mode: 'auto', clockSec, paused: false, pose, goal: pose, stopIndex: frame.focusIndex, travelling: false, idleSec: 0, blend: null }
}

/** План облёта сменился (store обновился, навык добавили или убрали): пилот остаётся на
 * своём месте во времени, но не ссылается на остановку, которой больше нет. */
export function rebasePilot(p: Pilot, plan: FlightPlan): Pilot {
  const stopIndex = Math.min(p.stopIndex, plan.stops.length - 1)
  if (p.mode === 'auto') return { ...p, stopIndex }
  const goal = limited({ ...p.goal, target: plan.stops[stopIndex].target }, plan, stopIndex)
  return { ...p, stopIndex, goal }
}

/** Шаг времени: dt секунд прошло. holding — человек держит камеру (кнопка мыши или палец
 * нажаты): пока держит, покой не считается и облёт не возвращается. */
export function pilotTick(p: Pilot, plan: FlightPlan, dtSec: number, holding = false): Pilot {
  if (p.mode === 'manual') {
    const idleSec = holding ? 0 : p.idleSec + dtSec
    if (idleSec >= RESUME_IDLE_SEC) return pilotResume(p, plan)
    // экспоненциальное сближение: шаги складываются точно, результат не зависит от частоты кадров
    const pose = mixPose(p.pose, p.goal, 1 - Math.exp(-APPROACH_RATE * dtSec))
    return { ...p, pose, idleSec }
  }
  const clockSec = p.paused ? p.clockSec : p.clockSec + dtSec
  const frame = flightCamera(plan, clockSec)
  const auto = copyPose(frame)
  const u = p.blend ? Math.min(1, p.blend.u + dtSec / RESUME_BLEND_SEC) : 1
  const blend = p.blend && u < 1 ? { from: p.blend.from, u } : null
  const pose = p.blend ? mixPose(p.blend.from, auto, smooth(u)) : auto
  return { ...p, clockSec, pose, goal: pose, stopIndex: frame.focusIndex, travelling: frame.travelling, blend }
}

/** Человек берёт управление: облёт замирает, камера остаётся в текущей позе, а её цель
 * доезжает до остановки в фокусе (взяли в перелёте — долетит до галактики, к которой летела). */
function takeOver(p: Pilot, plan: FlightPlan): Pilot {
  if (p.mode === 'manual') return { ...p, idleSec: 0 }
  const goal = limited({ ...p.pose, target: plan.stops[p.stopIndex].target }, plan, p.stopIndex)
  return { ...p, mode: 'manual', goal, travelling: false, idleSec: 0, blend: null }
}

/** Вращение перетаскиванием: углы меняются сразу, рука ведёт камеру без запаздывания. */
export function pilotRotate(p: Pilot, plan: FlightPlan, dYaw: number, dPitch: number): Pilot {
  const m = takeOver(p, plan)
  const goal = limited({ ...m.goal, yaw: m.goal.yaw + dYaw, pitch: m.goal.pitch + dPitch }, plan, m.stopIndex)
  return { ...m, goal, pose: { ...m.pose, yaw: goal.yaw, pitch: goal.pitch } }
}

/** Зум: factor < 1 — ближе, > 1 — дальше. Камера доезжает плавно, пределы — остановки в фокусе. */
export function pilotZoom(p: Pilot, plan: FlightPlan, factor: number): Pilot {
  const m = takeOver(p, plan)
  return { ...m, goal: limited({ ...m.goal, distance: m.goal.distance * factor }, plan, m.stopIndex) }
}

/** Подлететь к остановке (клик по галактике, кнопка «Обзор»): углы остаются за человеком. */
export function pilotFlyTo(p: Pilot, plan: FlightPlan, stopIndex: number): Pilot {
  const m = takeOver(p, plan)
  const stop = plan.stops[stopIndex]
  return { ...m, stopIndex, goal: limited({ ...m.goal, target: stop.target, distance: stop.distance }, plan, stopIndex) }
}

/** Вернуть автопролёт: облёт продолжается с начала остановки в фокусе, камера плавно
 * переходит от текущей позы к летящей. */
export function pilotResume(p: Pilot, plan: FlightPlan): Pilot {
  const step = plan.holdSec + plan.travelSec
  return { ...p, mode: 'auto', clockSec: p.stopIndex * step, paused: false, goal: p.pose, idleSec: 0, blend: { from: p.pose, u: 0 } }
}

/** Адрес страницы назвал галактику (null — общее небо): автопролёт плавно переходит к её
 * остановке, кто бы ни вёл камеру. Галактики нет в плане — к обзору. */
export function pilotStartAt(p: Pilot, plan: FlightPlan, galaxyId: string | null): Pilot {
  return pilotResume({ ...p, stopIndex: stopIndexOf(plan, galaxyId) }, plan)
}

/** К следующей (1) или предыдущей (-1) остановке: автопролёт продолжается с неё. */
export function pilotStep(p: Pilot, plan: FlightPlan, dir: 1 | -1): Pilot {
  const step = plan.holdSec + plan.travelSec
  const count = plan.stops.length
  // в автопролёте «назад» из середины остановки — к её началу, из начала — к предыдущей
  const at = p.mode === 'manual' ? p.stopIndex + dir : dir > 0 ? Math.floor(p.clockSec / step) + 1 : Math.ceil(p.clockSec / step) - 1
  const stopIndex = ((at % count) + count) % count
  return pilotResume({ ...p, stopIndex }, plan)
}

/** Пробел: в автопролёте — пауза и снятие с паузы, в ручном режиме — вернуть автопролёт. */
export function pilotTogglePause(p: Pilot, plan: FlightPlan): Pilot {
  return p.mode === 'manual' ? pilotResume(p, plan) : { ...p, paused: !p.paused }
}
