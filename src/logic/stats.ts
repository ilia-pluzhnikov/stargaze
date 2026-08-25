import type { XpEvent } from '../types'
import { addDays, dowOf } from './dates'

export interface WeekStat {
  weekStart: string // понедельник, YYYY-MM-DD
  total: number
  bySkill: Map<string | null, number>
}

const mondayOf = (day: string): string => {
  const dow = dowOf(day)
  return addDays(day, dow === 0 ? -6 : 1 - dow)
}

/** XP по неделям Пн..Вс: последние `weeks` недель, включая текущую, от старой к новой. */
export function weeklyXp(xpLog: XpEvent[], weeks: number, today: string): WeekStat[] {
  const cur = mondayOf(today)
  const starts: string[] = []
  const byWeek = new Map<string, WeekStat>()
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(cur, -7 * i)
    starts.push(weekStart)
    byWeek.set(weekStart, { weekStart, total: 0, bySkill: new Map() })
  }
  for (const e of xpLog) {
    const w = byWeek.get(mondayOf(e.day))
    if (!w) continue
    w.total += e.amount
    w.bySkill.set(e.skillId, (w.bySkill.get(e.skillId) ?? 0) + e.amount)
  }
  return starts.map((s) => byWeek.get(s)!)
}
