import { describe, expect, it } from 'vitest'
import type { Quest, XpEvent } from '../types'
import { compareDueUrgency, epicProgress, isDueToday, isDueWithin, questChildren, weekActivity } from './selectors'

const xp = (id: string, questId: string, day: string, amount: number): XpEvent => ({
  id, ts: `${day}T00:00:00Z`, day, questId, skillId: 's1', amount,
})

describe('weekActivity', () => {
  const today = '2026-07-07' // вторник; неделя Пн 07-06 .. Вс 07-12

  it('понедельник первой ячейкой, воскресенье последней, isToday только у today', () => {
    const week = weekActivity([], today)
    expect(week).toHaveLength(7)
    expect(week[0].day).toBe('2026-07-06')
    expect(week[6].day).toBe('2026-07-12')
    expect(week.filter((d) => d.isToday)).toEqual([{ day: today, active: false, isToday: true }])
  })

  it('active по net>0 в тот день', () => {
    const log = [xp('e1', 'q1', '2026-07-06', 10)]
    const week = weekActivity(log, today)
    expect(week[0].active).toBe(true)
    expect(week[1].active).toBe(false)
  })

  it('компенсированный день (net=0 после отката) не active', () => {
    const log = [xp('e1', 'q1', '2026-07-06', 10), xp('e2', 'q1', '2026-07-06', -10)]
    const week = weekActivity(log, today)
    expect(week[0].active).toBe(false)
  })
})

describe('подквесты: questChildren / epicProgress', () => {
  const mq = (id: string, over: Partial<Quest> = {}): Quest => ({
    id, title: 'К', type: 'mid', skillId: null, xpReward: 10, status: 'active', createdAt: `2026-07-0${id.length}`, ...over,
  })

  it('questChildren: active/done/proposed по createdAt, archived выпадают', () => {
    const quests = [
      mq('p'),
      mq('bb', { parentQuestId: 'p', createdAt: '2026-07-02' }),
      mq('a', { parentQuestId: 'p', createdAt: '2026-07-01' }),
      mq('zzz', { parentQuestId: 'p', status: 'archived', createdAt: '2026-07-03' }),
      mq('d', { parentQuestId: 'p', status: 'done', result: { summary: 'и' }, createdAt: '2026-07-04' }),
      mq('pr', { parentQuestId: 'p', status: 'proposed', proposalNote: 'n', createdAt: '2026-07-05' }),
      mq('x'),
    ]
    expect(questChildren(quests, 'p').map((q) => q.id)).toEqual(['a', 'bb', 'd', 'pr'])
  })

  it('epicProgress: proposed и archived вне знаменателя', () => {
    const quests = [
      mq('p'),
      mq('c1', { parentQuestId: 'p', status: 'done', result: { summary: 'и' } }),
      mq('c2', { parentQuestId: 'p' }),
      mq('c3', { parentQuestId: 'p', status: 'proposed', proposalNote: 'n' }),
      mq('c4', { parentQuestId: 'p', status: 'archived' }),
    ]
    expect(epicProgress(quests, 'p')).toEqual({ done: 1, total: 2 })
  })

  it('epicProgress: без учитываемых детей — null (не эпик)', () => {
    expect(epicProgress([mq('p')], 'p')).toBeNull()
    expect(epicProgress([mq('p'), mq('c', { parentQuestId: 'p', status: 'proposed', proposalNote: 'n' })], 'p')).toBeNull()
  })
})

describe('сроки: isDueToday / isDueWithin / compareDueUrgency', () => {
  const today = '2026-08-17' // понедельник (dow 1)
  const mq = (over: Partial<Quest> = {}): Quest => ({
    id: 'q1', title: 'К', type: 'mid', skillId: null, xpReward: 10, status: 'active', createdAt: '2026-08-01T00:00:00Z', ...over,
  })

  it('isDueToday: контракт с дедлайном — сегодня и просроченный да, будущий нет', () => {
    expect(isDueToday(mq({ dueDate: today }), today)).toBe(true)
    expect(isDueToday(mq({ dueDate: '2026-08-10' }), today)).toBe(true)
    expect(isDueToday(mq({ type: 'short', dueDate: '2026-08-30' }), today)).toBe(false)
  })

  it('isDueToday: без срока — short да (бессрочная мелочь), mid/long нет', () => {
    expect(isDueToday(mq({ type: 'short' }), today)).toBe(true)
    expect(isDueToday(mq(), today)).toBe(false)
    expect(isDueToday(mq({ type: 'long' }), today)).toBe(false)
  })

  it('isDueToday: повторяющийся — по расписанию', () => {
    expect(isDueToday(mq({ type: 'repeating', daysOfWeek: [1] }), today)).toBe(true)
    expect(isDueToday(mq({ type: 'repeating', daysOfWeek: [2] }), today)).toBe(false)
  })

  it('isDueWithin: граница включается, просрочка включается, бессрочные и повторяющиеся мимо', () => {
    expect(isDueWithin(mq({ dueDate: '2026-08-24' }), today, 7)).toBe(true)
    expect(isDueWithin(mq({ dueDate: '2026-08-25' }), today, 7)).toBe(false)
    expect(isDueWithin(mq({ dueDate: '2026-08-01' }), today, 7)).toBe(true)
    expect(isDueWithin(mq({ type: 'short' }), today, 7)).toBe(false)
    expect(isDueWithin(mq({ type: 'repeating', dueDate: today }), today, 7)).toBe(false)
  })

  it('compareDueUrgency: датированные по возрастанию срока → повторяющиеся → бессрочные', () => {
    const overdue = mq({ id: 'a', dueDate: '2026-08-10' })
    const soon = mq({ id: 'b', dueDate: '2026-08-20' })
    const rep = mq({ id: 'c', type: 'repeating' })
    const dateless = mq({ id: 'd', type: 'short' })
    const sorted = [dateless, rep, soon, overdue].sort(compareDueUrgency).map((q) => q.id)
    expect(sorted).toEqual(['a', 'b', 'c', 'd'])
  })
})
