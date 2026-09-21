import { describe, expect, it } from 'vitest'
import type { Quest, XpEvent } from '../types'
import { isoWeekStart, recurringDashboard, recurringQuestDays, recurringQuestWeeks } from './recurring'

const quest = (overrides: Partial<Quest> = {}): Quest => ({
  id: 'q1',
  title: 'Ритуал',
  type: 'repeating',
  skillId: 's1',
  xpReward: 10,
  status: 'active',
  createdAt: '2026-01-01T12:00:00.000Z',
  ...overrides,
})

const event = (id: string, day: string, amount = 10, questId = 'q1'): XpEvent => ({
  id,
  ts: `${day}T12:00:00.000Z`,
  day,
  questId,
  skillId: 's1',
  amount,
})

describe('recurringQuestDays', () => {
  it('пустой лог даёт пустые клетки и нулевые недели', () => {
    expect(recurringQuestDays([], quest(), '2026-07-06', '2026-07-08')).toEqual([
      { day: '2026-07-06', completed: false },
      { day: '2026-07-07', completed: false },
      { day: '2026-07-08', completed: false },
    ])
    expect(recurringQuestWeeks([], quest(), '2026-07-06', '2026-07-08')).toEqual([
      { weekStart: '2026-07-06', weekEnd: '2026-07-08', completed: 0 },
    ])
  })

  it('откат в ноль снова делает день пустым', () => {
    const log = [event('e1', '2026-07-06', 10), event('e2', '2026-07-06', -10)]
    expect(recurringQuestDays(log, quest(), '2026-07-06', '2026-07-06')[0].completed).toBe(false)
    expect(recurringQuestWeeks(log, quest(), '2026-07-06', '2026-07-12')[0].completed).toBe(0)
  })

  it('частичный откат оставляет день отмеченным, пока net положительный', () => {
    const log = [event('e1', '2026-07-06', 10), event('e2', '2026-07-06', -5)]
    expect(recurringQuestDays(log, quest(), '2026-07-06', '2026-07-06')[0].completed).toBe(true)
  })

  // завёл «Зал» сегодня — закрасил прошлую пятницу: нижней границы по дню создания нет
  it('отметка до дня создания привычки — обычная отметка', () => {
    const q = quest({ createdAt: '2026-07-07T12:00:00.000Z' })
    const log = [event('e1', '2026-07-03')]
    expect(recurringQuestDays(log, q, '2026-07-03', '2026-07-04')).toEqual([
      { day: '2026-07-03', completed: true },
      { day: '2026-07-04', completed: false },
    ])
  })

  it('перевёрнутое окно даёт пустой список', () => {
    expect(recurringQuestDays([], quest(), '2026-07-08', '2026-07-06')).toEqual([])
  })
})

describe('ISO-недели', () => {
  it('воскресенье остаётся в неделе предыдущего понедельника, понедельник открывает новую', () => {
    expect(isoWeekStart('2027-01-03')).toBe('2026-12-28')
    expect(isoWeekStart('2027-01-04')).toBe('2027-01-04')

    const log = [event('e1', '2027-01-03'), event('e2', '2027-01-04')]
    const weeks = recurringQuestWeeks(log, quest(), '2026-12-28', '2027-01-04')
    expect(weeks.map((week) => [week.weekStart, week.weekEnd, week.completed])).toEqual([
      ['2026-12-28', '2027-01-03', 1],
      ['2027-01-04', '2027-01-04', 1],
    ])
  })
})

describe('recurringDashboard', () => {
  it('окно по умолчанию — 12 ISO-недель, заканчивается сегодня', () => {
    const d = recurringDashboard([], [quest()], '2026-07-07') // вторник
    expect(d.startDay).toBe('2026-04-20') // понедельник за 11 недель до понедельника 07-06
    expect(d.endDay).toBe('2026-07-07')
    expect(d.days).toHaveLength(79)
    expect(d.weeks).toHaveLength(12)
  })

  it('агрегирует только repeating-квесты; total и недели считаются по отметкам', () => {
    const q2 = quest({ id: 'q2' })
    const log = [
      event('e1', '2026-06-30'), // q1, прошлая неделя
      event('e2', '2026-07-06'), // q1, эта неделя
      event('e3', '2026-07-06', 10, 'q2'),
      event('e4', '2026-07-07', 10, 'q2'), // q2, сегодня
      event('e5', '2026-07-07', 10, 'once'), // short — мимо
    ]
    const d = recurringDashboard(log, [quest(), q2, quest({ id: 'once', type: 'short' })], '2026-07-07', 2)
    expect(d.startDay).toBe('2026-06-29')
    expect(d.quests.map((h) => [h.questId, h.total])).toEqual([['q1', 2], ['q2', 2]])
    expect(d.weeks.map((week) => week.completed)).toEqual([1, 3])
    expect(d.todayCompleted).toBe(1)
  })

  it('отметки вне окна в total не входят', () => {
    const log = [event('e1', '2026-01-05'), event('e2', '2026-07-06')]
    expect(recurringDashboard(log, [quest()], '2026-07-07', 2).quests[0].total).toBe(1)
  })

  it('день с откатом в ноль не считается ни в total, ни в todayCompleted', () => {
    const log = [event('e1', '2026-07-07'), event('e2', '2026-07-07', -10)]
    const d = recurringDashboard(log, [quest()], '2026-07-07', 2)
    expect(d.quests[0].total).toBe(0)
    expect(d.todayCompleted).toBe(0)
  })

  it('нецелое и нулевое окно нормализуются до целых недель ≥ 1', () => {
    expect(recurringDashboard([], [quest()], '2026-07-07', 0).weeks).toHaveLength(1)
    expect(recurringDashboard([], [quest()], '2026-07-07', 2.9).weeks).toHaveLength(2)
  })
})
