import { describe, expect, it } from 'vitest'
import type { Quest, XpEvent } from '../types'
import {
  isoWeekStart,
  isRecurringQuestScheduled,
  recurringDashboard,
  recurringQuestDays,
  recurringQuestStreaks,
  recurringQuestWeeks,
} from './recurring'

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
  it('пустой лог даёт пустые отметки и не придумывает стрики', () => {
    const q = quest()
    const days = recurringQuestDays([], q, '2026-07-06', '2026-07-08')
    expect(days).toEqual([
      { day: '2026-07-06', scheduled: true, completed: false },
      { day: '2026-07-07', scheduled: true, completed: false },
      { day: '2026-07-08', scheduled: true, completed: false },
    ])
    expect(recurringQuestStreaks([], q, '2026-07-08')).toEqual({ current: 0, best: 0 })
    expect(recurringQuestWeeks([], q, '2026-07-06', '2026-07-08')).toEqual([
      {
        weekStart: '2026-07-06',
        weekEnd: '2026-07-08',
        completed: 0,
        scheduled: 3,
        scheduledCompleted: 0,
      },
    ])
  })

  it('откат в ноль снова делает день незакрытым', () => {
    const log = [event('e1', '2026-07-06', 10), event('e2', '2026-07-06', -10)]
    expect(recurringQuestDays(log, quest(), '2026-07-06', '2026-07-06')[0].completed).toBe(false)
    expect(recurringQuestWeeks(log, quest(), '2026-07-06', '2026-07-12')[0]).toMatchObject({
      completed: 0,
      scheduledCompleted: 0,
    })
  })

  it('частичный откат оставляет день закрытым, пока net положительный', () => {
    const log = [event('e1', '2026-07-06', 10), event('e2', '2026-07-06', -5)]
    expect(recurringQuestDays(log, quest(), '2026-07-06', '2026-07-06')[0].completed).toBe(true)
  })

  it('дни до создания квеста не выглядят пропусками', () => {
    const q = quest({ createdAt: '2026-07-07T12:00:00.000Z' })
    expect(recurringQuestDays([], q, '2026-07-06', '2026-07-08').map((day) => day.scheduled)).toEqual([
      false,
      true,
      true,
    ])
  })

  // Граница дня создания считается в игровом поясе (UTC+7), как и `day` в xpLog:
  // по локальному дню машины ответ зависел бы от пояса, где открыт браузер.
  it('день создания берётся в игровом поясе, а не в поясе машины', () => {
    // 18:00 UTC = 01:00 следующих суток в игровом поясе ⇒ создан 07-07
    const q = quest({ createdAt: '2026-07-06T18:00:00.000Z' })
    expect(recurringQuestDays([], q, '2026-07-06', '2026-07-08').map((day) => day.scheduled)).toEqual([
      false,
      true,
      true,
    ])
  })
})

describe('расписание и стрики', () => {
  const sundays = quest({ daysOfWeek: [0] })

  it('неположенные дни пусты и не разрывают серию', () => {
    const log = [event('e1', '2026-06-28'), event('e2', '2026-07-05')]
    const days = recurringQuestDays(log, sundays, '2026-07-05', '2026-07-07')
    expect(days.map((day) => [day.day, day.scheduled])).toEqual([
      ['2026-07-05', true],
      ['2026-07-06', false],
      ['2026-07-07', false],
    ])
    expect(recurringQuestStreaks(log, sundays, '2026-07-07')).toEqual({ current: 2, best: 2 })
  })

  // Восточнее UTC+7 локальный день опережает игровой: по старой мерке отметка
  // дня создания вылетала из окна и bestStreak показывался на день короче
  it('отметка в день создания входит в лучший стрик (граница — игровой день)', () => {
    // 16:30 UTC = 23:30 того же дня в игровом поясе ⇒ создан 07-06
    const q = quest({ createdAt: '2026-07-06T16:30:00.000Z' })
    const log = [event('e1', '2026-07-06'), event('e2', '2026-07-07')]
    expect(recurringQuestStreaks(log, q, '2026-07-07')).toEqual({ current: 2, best: 2 })
  })

  it('лучший стрик сохраняется после провала, текущий начинается заново', () => {
    const log = [
      event('e1', '2026-07-01'),
      event('e2', '2026-07-02'),
      event('e3', '2026-07-03'),
      event('e4', '2026-07-05'),
      event('e5', '2026-07-06'),
    ]
    expect(recurringQuestStreaks(log, quest(), '2026-07-07')).toEqual({ current: 2, best: 3 })
  })

  it('откат удаляет день и из текущего, и из лучшего стрика', () => {
    const log = [
      event('e1', '2026-07-05'),
      event('e2', '2026-07-06'),
      event('e3', '2026-07-06', -10),
    ]
    expect(recurringQuestStreaks(log, quest(), '2026-07-07')).toEqual({ current: 0, best: 1 })
  })

  it('проверка положенного дня работает только для repeating', () => {
    expect(isRecurringQuestScheduled(sundays, '2026-07-05')).toBe(true)
    expect(isRecurringQuestScheduled(sundays, '2026-07-06')).toBe(false)
    expect(isRecurringQuestScheduled(quest({ type: 'short' }), '2026-07-05')).toBe(false)
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

  it('dashboard агрегирует только переданные квесты и заканчивает окно сегодня', () => {
    const q2 = quest({ id: 'q2' })
    const log = [event('e1', '2026-07-06'), event('e2', '2026-07-06', 10, 'q2')]
    const dashboard = recurringDashboard(log, [quest(), q2, quest({ id: 'once', type: 'short' })], '2026-07-07', 2)

    expect(dashboard.startDay).toBe('2026-06-29')
    expect(dashboard.endDay).toBe('2026-07-07')
    expect(dashboard.quests).toHaveLength(2)
    expect(dashboard.weeks.map((week) => week.scheduledCompleted)).toEqual([0, 2])
    expect(dashboard.todayScheduled).toBe(2)
    expect(dashboard.todayCompleted).toBe(0)
    expect(dashboard.todayOpenQuestIds).toEqual(['q1', 'q2'])
  })
})
