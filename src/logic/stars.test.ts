import { describe, expect, it } from 'vitest'
import type { Quest, StarComponent, Tier, XpEvent } from '../types'
import {
  ancestorsOf,
  childrenOf,
  currentRank,
  galaxyStats,
  galaxySummary,
  isRankAchieved,
  rankAchievedAt,
  rankStars,
  rankTitle,
  requiredStars,
  rootsOf,
  TIER_CLASS,
  skillTiers,
  starProgress,
  starXp,
} from './stars'

const star = (id: string, tier: Tier, parentStarId: string | null = null, litAt?: string): StarComponent =>
  ({ id, skillId: 's1', parentStarId, tier, title: id, createdAt: '2026-07-01T00:00:00.000Z', ...(litAt ? { litAt } : {}) })

describe('дерево', () => {
  const tree = [
    star('root1', 'D'), star('root2', 'D'),
    star('mid', 'C', 'root1'), star('leaf', 'B', 'mid'),
  ]
  it('rootsOf — только parentStarId=null', () =>
    expect(rootsOf(tree, 's1').map((s) => s.id)).toEqual(['root1', 'root2']))
  it('childrenOf — дети в каноническом порядке', () =>
    expect(childrenOf(tree, 'root1').map((s) => s.id)).toEqual(['mid']))
  it('канонический порядок — createdAt, затем id при равенстве', () => {
    const siblings = [
      { ...star('c2', 'D', 'p'), createdAt: '2026-07-02T00:00:00.000Z' },
      { ...star('c3', 'D', 'p'), createdAt: '2026-07-01T00:00:00.000Z' },
      { ...star('c1', 'D', 'p'), createdAt: '2026-07-01T00:00:00.000Z' },
    ]
    expect(childrenOf(siblings, 'p').map((s) => s.id)).toEqual(['c1', 'c3', 'c2'])
  })
  it('ancestorsOf — цепочка от родителя к корню', () =>
    expect(ancestorsOf(tree, 'leaf').map((s) => s.id)).toEqual(['mid', 'root1']))
  it('ancestorsOf не зависает на битом цикле в данных', () => {
    const cyclic = [star('a', 'D', 'b'), star('b', 'D', 'a')]
    expect(ancestorsOf(cyclic, 'a').map((s) => s.id)).toEqual(['b'])
  })
})

describe('ранги', () => {
  it('rankStars — все звёзды ранга по всему навыку, где бы ни висели в дереве', () => {
    const stars = [star('a', 'C'), star('b', 'C', 'a'), star('x', 'D')]
    expect(rankStars(stars, 's1', 'C').map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('isRankAchieved — порог 60% по звёздам ранга всего навыка', () => {
    const stars = [
      star('a', 'C', null, '2026-07-02T00:00:00.000Z'),
      star('b', 'C', 'a', '2026-07-03T00:00:00.000Z'),
      star('c', 'C'), star('d', 'C'), star('e', 'C'),
    ] // 2 из 5 < ceil(3) — не взят
    expect(isRankAchieved(stars, 's1', 'C')).toBe(false)
    expect(isRankAchieved([...stars.slice(0, 2),
      { ...stars[2], litAt: '2026-07-04T00:00:00.000Z' }, stars[3], stars[4]], 's1', 'C')).toBe(true)
  })
  it('ранг без звёзд не существует', () => {
    expect(skillTiers([star('a', 'D')], 's1')).toEqual(['D'])
    expect(isRankAchieved([star('a', 'D')], 's1', 'S')).toBe(false)
  })
  it('currentRank — первый невзятый по порядку D→S среди существующих', () => {
    const stars = [star('a', 'D', null, '2026-07-02T00:00:00.000Z'), star('b', 'A')]
    expect(currentRank(stars, 's1')).toBe('A')
  })
  it('rankAchievedAt — litAt K-й зажжённой', () => {
    const stars = [star('a', 'D', null, '2026-07-05T00:00:00.000Z'), star('b', 'D', null, '2026-07-02T00:00:00.000Z')]
    expect(rankAchievedAt(stars, 's1', 'D')).toBe('2026-07-05T00:00:00.000Z') // ceil(2·0.6)=2
  })
  it('galaxyStats — сводка по рангам', () => {
    const stars = [star('a', 'D', null, '2026-07-02T00:00:00.000Z'), star('b', 'C')]
    expect(galaxyStats(stars, 's1')).toEqual({ ranksDone: 1, ranksTotal: 2, starsLit: 1, starsTotal: 2 })
  })
  it('galaxySummary — сводка галактики: всего рангов и сколько взято', () => {
    const stars = [star('a', 'D', null, '2026-07-02T00:00:00.000Z'), star('b', 'C')]
    expect(galaxySummary(stars, 's1')).toEqual({ total: 2, achieved: 1 })
  })
})

describe('requiredStars', () => {
  it.each([
    [0, 0],
    [5, 3],
    [10, 6],
  ])('для N=%i требуется %i', (total, required) => {
    expect(requiredStars(total)).toBe(required)
  })
})

const quest = (id: string, starId: string | null): Quest => ({
  id, title: 'К', type: 'repeating', skillId: 's1', starId, xpReward: 10, status: 'active', createdAt: 'T0',
})
const xp = (id: string, questId: string, day: string, amount: number): XpEvent => ({
  id, ts: `${day}T00:00:00Z`, day, questId, skillId: 's1', amount,
})

describe('starXp', () => {
  it('суммирует только квесты этой звезды', () => {
    const quests = [quest('q1', 'c1'), quest('q2', 'c2')]
    const log = [xp('e1', 'q1', 'D1', 10), xp('e2', 'q2', 'D1', 20)]
    expect(starXp(log, quests, 'c1')).toBe(10)
  })
  it('учитывает отрицательные события (откаты)', () => {
    const quests = [quest('q1', 'c1')]
    const log = [xp('e1', 'q1', 'D1', 10), xp('e2', 'q1', 'D2', -10)]
    expect(starXp(log, quests, 'c1')).toBe(0)
  })
  it('clamp 0 при отрицательном сальдо', () => {
    const quests = [quest('q1', 'c1')]
    const log = [xp('e1', 'q1', 'D1', 10), xp('e2', 'q1', 'D2', -15)]
    expect(starXp(log, quests, 'c1')).toBe(0)
  })
})

describe('starProgress', () => {
  it('null без xpTarget', () => {
    expect(starProgress(star('c1', 'D'), [], [])).toBeNull()
  })
  it('0.5 при 50/100', () => {
    const s = { ...star('c1', 'D'), xpTarget: 100 }
    const quests = [quest('q1', 'c1')]
    const log = [xp('e1', 'q1', 'D1', 50)]
    expect(starProgress(s, log, quests)).toBe(0.5)
  })
  it('cap 1 при превышении target', () => {
    const s = { ...star('c1', 'D'), xpTarget: 100 }
    const quests = [quest('q1', 'c1')]
    const log = [xp('e1', 'q1', 'D1', 150)]
    expect(starProgress(s, log, quests)).toBe(1)
  })
})

describe('rankTitle', () => {
  it('авторское имя из rankTitles приоритетно', () =>
    expect(rankTitle({ rankTitles: { A: 'Река' } }, 'A')).toBe('Река'))
  it('без rankTitles — класс светимости', () =>
    expect(rankTitle({}, 'A')).toBe('Сверхгигант'))
  it('ранг не назван в rankTitles — класс светимости', () =>
    expect(rankTitle({ rankTitles: { D: 'Полигон' } }, 'S')).toBe('Гипергигант'))
  it('TIER_CLASS покрывает все пять рангов', () =>
    expect(Object.keys(TIER_CLASS).sort()).toEqual(['A', 'B', 'C', 'D', 'S']))
})
