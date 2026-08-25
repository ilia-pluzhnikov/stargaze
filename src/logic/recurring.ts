import type { Quest, XpEvent } from '../types'
import { addDays, dowOf, isCalendarDay } from './dates'
import { completedDaysForQuest } from './selectors'
import { dayInGameTz } from './sparks'
import { computeStreak, isScheduled } from './streak'

export interface RecurringDayHistory {
  day: string
  scheduled: boolean
  completed: boolean
}

export interface RecurringWeekCount {
  weekStart: string
  weekEnd: string
  /** Все дни с net XP > 0, включая редкие отметки вне текущего расписания. */
  completed: number
  /** Сколько положенных дней попало в окно. */
  scheduled: number
  /** Сколько положенных дней закрыто. */
  scheduledCompleted: number
}

export interface RecurringQuestHistory {
  questId: string
  days: RecurringDayHistory[]
  weeks: RecurringWeekCount[]
  currentStreak: number
  bestStreak: number
}

export interface RecurringDashboard {
  today: string
  startDay: string
  endDay: string
  days: string[]
  quests: RecurringQuestHistory[]
  weeks: RecurringWeekCount[]
  todayScheduled: number
  todayCompleted: number
  todayOpenQuestIds: string[]
}

/** Положен ли повторяющийся квест в этот день по текущему daysOfWeek. */
export function isRecurringQuestScheduled(quest: Quest, day: string): boolean {
  return quest.type === 'repeating' && isScheduled(quest, day)
}

/** Понедельник ISO-недели, содержащей day. */
export function isoWeekStart(day: string): string {
  const dow = dowOf(day)
  return addDays(day, dow === 0 ? -6 : 1 - dow)
}

/** День создания в игровом поясе — той же меркой, что `day` в xpLog и `today`
 * Хроники. По локальному дню машины нижняя граница окна съезжала на сутки
 * относительно отметок и резала bestStreak / завышала scheduled.
 * Нераспознанный createdAt по-прежнему даёт null = «без нижней границы». */
function questCreatedDay(quest: Quest): string | null {
  const day = dayInGameTz(quest.createdAt)
  return isCalendarDay(day) ? day : null
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
    const week = weeks.get(start) ?? {
      weekStart: start,
      weekEnd: entry.day,
      completed: 0,
      scheduled: 0,
      scheduledCompleted: 0,
    }
    week.weekEnd = entry.day
    if (entry.completed) week.completed++
    if (entry.scheduled) {
      week.scheduled++
      if (entry.completed) week.scheduledCompleted++
    }
    weeks.set(start, week)
  }
  return [...weeks.values()]
}

/** История отметок одного квеста за включительное окно дат. */
export function recurringQuestDays(
  xpLog: XpEvent[],
  quest: Quest,
  startDay: string,
  endDay: string,
): RecurringDayHistory[] {
  const completedDays = completedDaysForQuest(xpLog, quest.id)
  const createdDay = questCreatedDay(quest)
  return dayRange(startDay, endDay).map((day) => ({
    day,
    scheduled: (!createdDay || day >= createdDay) && isRecurringQuestScheduled(quest, day),
    completed: completedDays.has(day),
  }))
}

/** Текущий (с сегодняшней льготой) и лучший исторический стрик. */
export function recurringQuestStreaks(
  xpLog: XpEvent[],
  quest: Quest,
  today: string,
): { current: number; best: number } {
  if (quest.type !== 'repeating') return { current: 0, best: 0 }
  const completedDays = completedDaysForQuest(xpLog, quest.id)
  const createdDay = questCreatedDay(quest)
  const eligibleDays = [...completedDays]
    .filter((day) => day <= today && (!createdDay || day >= createdDay) && isRecurringQuestScheduled(quest, day))
    .sort()

  let best = 0
  let run = 0
  let previous: string | null = null
  for (const day of eligibleDays) {
    let followsPrevious = false
    if (previous) {
      for (let offset = 1; offset <= 7; offset++) {
        const candidate = addDays(previous, offset)
        if (!isRecurringQuestScheduled(quest, candidate)) continue
        followsPrevious = candidate === day
        break
      }
    }
    run = followsPrevious ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }

  return {
    current: computeStreak(quest, completedDays, today),
    best,
  }
}

/** Число отметок и положенных дней по ISO-неделям для одного квеста. */
export function recurringQuestWeeks(
  xpLog: XpEvent[],
  quest: Quest,
  startDay: string,
  endDay: string,
): RecurringWeekCount[] {
  return weeksFromDays(recurringQuestDays(xpLog, quest, startDay, endDay))
}

/**
 * Полная модель Хроники. Статусы active/archived и архивность навыка намеренно
 * остаются ответственностью вызывающего кода: так спящие привычки можно считать
 * отдельно и не смешивать с операционной сводкой.
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
  const repeating = quests.filter((quest) => quest.type === 'repeating')
  const histories = repeating.map((quest) => {
    const days = recurringQuestDays(xpLog, quest, startDay, endDay)
    const streaks = recurringQuestStreaks(xpLog, quest, today)
    return {
      questId: quest.id,
      days,
      weeks: weeksFromDays(days),
      currentStreak: streaks.current,
      bestStreak: streaks.best,
    }
  })

  const days = dayRange(startDay, endDay)
  const aggregateWeeks = weeksFromDays(days.map((day) => ({ day, scheduled: false, completed: false })))
  const aggregateByStart = new Map(aggregateWeeks.map((week) => [week.weekStart, week]))
  for (const history of histories) {
    for (const source of history.weeks) {
      const target = aggregateByStart.get(source.weekStart)
      if (!target) continue
      target.completed += source.completed
      target.scheduled += source.scheduled
      target.scheduledCompleted += source.scheduledCompleted
    }
  }

  let todayScheduled = 0
  let todayCompleted = 0
  const todayOpenQuestIds: string[] = []
  for (const history of histories) {
    const entry = history.days[history.days.length - 1]
    if (!entry?.scheduled) continue
    todayScheduled++
    if (entry.completed) todayCompleted++
    else todayOpenQuestIds.push(history.questId)
  }

  return {
    today,
    startDay,
    endDay,
    days,
    quests: histories,
    weeks: aggregateWeeks,
    todayScheduled,
    todayCompleted,
    todayOpenQuestIds,
  }
}

