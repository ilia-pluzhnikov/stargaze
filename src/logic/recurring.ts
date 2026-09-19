import type { Quest, XpEvent } from '../types'
import { addDays, dowOf } from './dates'
import { completedDaysForQuest } from './selectors'

export interface RecurringDayHistory {
  day: string
  completed: boolean
}

export interface RecurringWeekCount {
  weekStart: string
  weekEnd: string
  /** Дней с net XP > 0 за неделю. */
  completed: number
}

export interface RecurringQuestHistory {
  questId: string
  days: RecurringDayHistory[]
  weeks: RecurringWeekCount[]
  /** Отметок за всё окно. */
  total: number
}

export interface RecurringDashboard {
  today: string
  startDay: string
  endDay: string
  days: string[]
  quests: RecurringQuestHistory[]
  weeks: RecurringWeekCount[]
  /** Сколько привычек отмечено сегодня. */
  todayCompleted: number
}

/** Понедельник ISO-недели, содержащей day. */
export function isoWeekStart(day: string): string {
  const dow = dowOf(day)
  return addDays(day, dow === 0 ? -6 : 1 - dow)
}

function dayRange(startDay: string, endDay: string): string[] {
  if (startDay > endDay) return []
  const days: string[] = []
  for (let day = startDay; day <= endDay; day = addDays(day, 1)) days.push(day)
  return days
}

function weeksFromDays(days: RecurringDayHistory[]): RecurringWeekCount[] {
  const weeks = new Map<string, RecurringWeekCount>()
  for (const entry of days) {
    const start = isoWeekStart(entry.day)
    const week = weeks.get(start) ?? { weekStart: start, weekEnd: entry.day, completed: 0 }
    week.weekEnd = entry.day
    if (entry.completed) week.completed++
    weeks.set(start, week)
  }
  return [...weeks.values()]
}

/**
 * История отметок одного квеста за включительное окно дат. Нижней границы по дню
 * создания нет: клетка до создания привычки — обычная пустая клетка, её можно отметить.
 */
export function recurringQuestDays(
  xpLog: XpEvent[],
  quest: Quest,
  startDay: string,
  endDay: string,
): RecurringDayHistory[] {
  const completedDays = completedDaysForQuest(xpLog, quest.id)
  return dayRange(startDay, endDay).map((day) => ({ day, completed: completedDays.has(day) }))
}

/** Число отметок по ISO-неделям для одного квеста. */
export function recurringQuestWeeks(
  xpLog: XpEvent[],
  quest: Quest,
  startDay: string,
  endDay: string,
): RecurringWeekCount[] {
  return weeksFromDays(recurringQuestDays(xpLog, quest, startDay, endDay))
}

/**
 * Полная модель Хроники: плотность отметок без расписания, норм и стриков.
 * Статусы active/archived и архивность навыка намеренно остаются ответственностью
 * вызывающего кода: так спящие привычки считаются отдельно от активных.
 */
export function recurringDashboard(
  xpLog: XpEvent[],
  quests: Quest[],
  today: string,
  windowWeeks = 12,
): RecurringDashboard {
  const weeks = Math.max(1, Math.floor(windowWeeks))
  const startDay = addDays(isoWeekStart(today), -(weeks - 1) * 7)
  const endDay = today
  const histories = quests
    .filter((quest) => quest.type === 'repeating')
    .map((quest) => {
      const days = recurringQuestDays(xpLog, quest, startDay, endDay)
      return {
        questId: quest.id,
        days,
        weeks: weeksFromDays(days),
        total: days.filter((entry) => entry.completed).length,
      }
    })

  const days = dayRange(startDay, endDay)
  const aggregateWeeks = weeksFromDays(days.map((day) => ({ day, completed: false })))
  const aggregateByStart = new Map(aggregateWeeks.map((week) => [week.weekStart, week]))
  for (const history of histories)
    for (const source of history.weeks) {
      const target = aggregateByStart.get(source.weekStart)
      if (target) target.completed += source.completed
    }

  const todayCompleted = histories.filter((history) => history.days[history.days.length - 1]?.completed).length

  return { today, startDay, endDay, days, quests: histories, weeks: aggregateWeeks, todayCompleted }
}
