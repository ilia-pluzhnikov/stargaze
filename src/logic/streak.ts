import type { Quest } from '../types'
import { addDays, dowOf } from './dates'

/** Положен ли квест в этот день (по daysOfWeek; пусто = каждый день). */
export function isScheduled(quest: Quest, day: string): boolean {
  if (!quest.daysOfWeek || quest.daysOfWeek.length === 0) return true
  return quest.daysOfWeek.includes(dowOf(day))
}

const MAX_LOOKBACK_DAYS = 730

/**
 * Стрик повторяющегося квеста: подряд идущие «положенные» дни с выполнением,
 * считая назад от сегодня. Сегодняшний положенный, но ещё не выполненный день
 * стрик не рвёт (он ещё не закончился) — просто не учитывается.
 * Пропуск положенного дня в прошлом обнуляет.
 */
export function computeStreak(quest: Quest, completedDays: Set<string>, today: string): number {
  if (quest.type !== 'repeating') return 0
  let streak = 0
  let day = today
  if (isScheduled(quest, day)) {
    if (completedDays.has(day)) streak++
    // не выполнен сегодня — день ещё идёт, не рвём
  }
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    day = addDays(day, -1)
    if (!isScheduled(quest, day)) continue
    if (completedDays.has(day)) streak++
    else break
  }
  return streak
}
