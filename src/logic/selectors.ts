import type { Quest, XpEvent } from '../types'
import { addDays, dowOf } from './dates'
import { isScheduled } from './streak'

/** Суммарный XP по квесту за день (учитывает откаты). */
export function netForQuestOnDay(xpLog: XpEvent[], questId: string, day: string): number {
  let net = 0
  for (const e of xpLog) if (e.questId === questId && e.day === day) net += e.amount
  return net
}

export function questDoneOnDay(xpLog: XpEvent[], questId: string, day: string): boolean {
  return netForQuestOnDay(xpLog, questId, day) > 0
}

/** Суммарный XP по квесту за всю историю. */
export function netForQuest(xpLog: XpEvent[], questId: string): number {
  let net = 0
  for (const e of xpLog) if (e.questId === questId) net += e.amount
  return net
}

/** Дни, в которые квест реально выполнен (net > 0) — вход для стриков. */
export function completedDaysForQuest(xpLog: XpEvent[], questId: string): Set<string> {
  const byDay = new Map<string, number>()
  for (const e of xpLog) {
    if (e.questId !== questId) continue
    byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.amount)
  }
  const days = new Set<string>()
  for (const [day, net] of byDay) if (net > 0) days.add(day)
  return days
}

export function skillXpTotal(xpLog: XpEvent[], skillId: string): number {
  let total = 0
  for (const e of xpLog) if (e.skillId === skillId) total += e.amount
  return Math.max(0, total)
}

export function charXpTotal(xpLog: XpEvent[]): number {
  let total = 0
  for (const e of xpLog) total += e.amount
  return Math.max(0, total)
}

/** День последнего выполнения (для секции «Выполненные»). */
export function lastCompletionDay(xpLog: XpEvent[], questId: string): string | null {
  let last: string | null = null
  for (const e of xpLog) {
    if (e.questId !== questId || e.amount <= 0) continue
    if (!last || e.day > last) last = e.day
  }
  return last
}

/** Неделя Пн..Вс вокруг today: в какие дни был хоть один выполненный квест (net>0). */
export function weekActivity(xpLog: XpEvent[], today: string): { day: string; active: boolean; isToday: boolean }[] {
  const dow = dowOf(today)
  const monOffset = dow === 0 ? -6 : 1 - dow
  const net = new Map<string, number>()
  for (const e of xpLog) net.set(`${e.questId}|${e.day}`, (net.get(`${e.questId}|${e.day}`) ?? 0) + e.amount)
  const activeDays = new Set<string>()
  for (const [k, v] of net) if (v > 0) activeDays.add(k.slice(k.indexOf('|') + 1))
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, monOffset + i)
    return { day, active: activeDays.has(day), isToday: day === today }
  })
}

/**
 * «Положен сегодня»: повторяющийся — по расписанию; контракт с дедлайном —
 * сегодня или просрочен (просроченный капает — прятать нельзя); short без
 * срока — тоже сегодня (бессрочная мелочь). mid/long без срока — нет.
 */
export function isDueToday(quest: Quest, today: string): boolean {
  if (quest.type === 'repeating') return isScheduled(quest, today)
  if (quest.dueDate) return quest.dueDate <= today
  return quest.type === 'short'
}

/** Контракт с дедлайном в горизонте days дней (просроченные включаются); повторяющиеся и бессрочные — нет. */
export function isDueWithin(quest: Quest, today: string, days: number): boolean {
  if (quest.type === 'repeating' || !quest.dueDate) return false
  return quest.dueDate <= addDays(today, days)
}

/** Порядок по горящести: датированные контракты по возрастанию срока → повторяющиеся → бессрочные. */
export function compareDueUrgency(a: Quest, b: Quest): number {
  const key = (q: Quest) => (q.type === 'repeating' ? '1' : q.dueDate ? `0:${q.dueDate}` : '2')
  return key(a).localeCompare(key(b))
}

/** Дети эпика (archived выпадают), по createdAt — порядок структурно не хранится. */
export function questChildren(quests: Quest[], parentId: string): Quest[] {
  return quests
    .filter((q) => q.parentQuestId === parentId && q.status !== 'archived')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Прогресс эпика по active+done детям; не хранится — вычисляется, как ранги звёзд. */
export function epicProgress(quests: Quest[], parentId: string): { done: number; total: number } | null {
  let done = 0
  let total = 0
  for (const q of quests) {
    if (q.parentQuestId !== parentId) continue
    if (q.status === 'done') { done++; total++ }
    else if (q.status === 'active') total++
  }
  return total > 0 ? { done, total } : null
}
