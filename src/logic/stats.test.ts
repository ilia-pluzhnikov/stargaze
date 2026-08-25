import { describe, expect, it } from 'vitest'
import type { XpEvent } from '../types'
import { weeklyXp } from './stats'

const ev = (day: string, amount: number, skillId: string | null = 'sk1'): XpEvent => ({
  id: `e-${day}-${amount}`, ts: `${day}T10:00:00.000Z`, day, questId: 'q1', skillId, amount,
})

describe('weeklyXp', () => {
  // 2026-07-07 — вторник; понедельник текущей недели — 2026-07-06
  it('раскладывает события по неделям Пн..Вс', () => {
    const log = [ev('2026-07-06', 10), ev('2026-07-05', 20), ev('2026-06-29', 5)]
    const w = weeklyXp(log, 2, '2026-07-07')
    expect(w.map((x) => x.weekStart)).toEqual(['2026-06-29', '2026-07-06'])
    expect(w[0].total).toBe(25) // 05.07 — воскресенье недели 29.06
    expect(w[1].total).toBe(10)
  })
  it('откаты уменьшают total и bySkill', () => {
    const log = [ev('2026-07-06', 10), ev('2026-07-06', -10)]
    const w = weeklyXp(log, 1, '2026-07-07')
    expect(w[0].total).toBe(0)
    expect(w[0].bySkill.get('sk1')).toBe(0)
  })
  it('события старше окна не попадают', () => {
    const w = weeklyXp([ev('2026-01-01', 100)], 2, '2026-07-07')
    expect(w[0].total + w[1].total).toBe(0)
  })
  it('skillId null агрегируется отдельной строкой', () => {
    const w = weeklyXp([ev('2026-07-06', 7, null)], 1, '2026-07-07')
    expect(w[0].bySkill.get(null)).toBe(7)
  })
})
