import { describe, expect, it } from 'vitest'
import type { Quest } from '../types'
import { computeStreak, isScheduled } from './streak'

const rep = (days?: number[]): Quest => ({
  id: 'q1',
  title: 'тест',
  type: 'repeating',
  skillId: null,
  xpReward: 10,
  daysOfWeek: days,
  status: 'active',
  createdAt: '2026-07-01T00:00:00Z',
})

// Календарь: 2026-07-05 — воскресенье, 2026-07-06 — понедельник, 2026-07-07 — вторник.

describe('computeStreak — ежедневный квест', () => {
  const q = rep()
  it('нет выполнений → 0', () => {
    expect(computeStreak(q, new Set(), '2026-07-07')).toBe(0)
  })
  it('выполнен сегодня → 1', () => {
    expect(computeStreak(q, new Set(['2026-07-07']), '2026-07-07')).toBe(1)
  })
  it('сегодня ещё не выполнен, вчера выполнен → 1 (день не закончился, стрик жив)', () => {
    expect(computeStreak(q, new Set(['2026-07-06']), '2026-07-07')).toBe(1)
  })
  it('сегодня + вчера → 2', () => {
    expect(computeStreak(q, new Set(['2026-07-06', '2026-07-07']), '2026-07-07')).toBe(2)
  })
  it('пропуск вчера отрезает хвост', () => {
    expect(computeStreak(q, new Set(['2026-07-05', '2026-07-07']), '2026-07-07')).toBe(1)
  })
  it('граница месяца: 30.06 + 01.07 подряд → 2', () => {
    expect(computeStreak(q, new Set(['2026-06-30', '2026-07-01']), '2026-07-01')).toBe(2)
  })
  it('откат сегодняшней отметки (день исчез из выполненных) → стрик по вчера', () => {
    expect(computeStreak(q, new Set(['2026-07-05', '2026-07-06']), '2026-07-07')).toBe(2)
  })
  it('неположенный тип (не repeating) → 0', () => {
    const oneShot: Quest = { ...q, type: 'short' }
    expect(computeStreak(oneShot, new Set(['2026-07-07']), '2026-07-07')).toBe(0)
  })
})

describe('computeStreak — дни недели', () => {
  const sundays = rep([0])
  it('непо­ложенные дни между воскресеньями не рвут стрик', () => {
    expect(computeStreak(sundays, new Set(['2026-06-28', '2026-07-05']), '2026-07-07')).toBe(2)
  })
  it('пропущенное воскресенье обнуляет', () => {
    expect(computeStreak(sundays, new Set(['2026-06-28']), '2026-07-07')).toBe(0)
  })
  it('выполнение в неположенный день не ломает счёт положенных', () => {
    expect(
      computeStreak(sundays, new Set(['2026-06-28', '2026-07-01', '2026-07-05']), '2026-07-07'),
    ).toBe(2)
  })
})

describe('isScheduled', () => {
  it('пустые дни = каждый день', () => {
    expect(isScheduled(rep(), '2026-07-07')).toBe(true)
    expect(isScheduled(rep([]), '2026-07-07')).toBe(true)
  })
  it('[0] — только воскресенья', () => {
    expect(isScheduled(rep([0]), '2026-07-05')).toBe(true)
    expect(isScheduled(rep([0]), '2026-07-07')).toBe(false)
  })
})
