import { describe, expect, it } from 'vitest'
import type { Quest, Skill, SkyStore, StarComponent, XpEvent } from '../types'
import { skillXpTotal } from './selectors'
import { isRankAchieved } from './stars'
import { skyAsOf } from './timeline'

// Полдень UTC = 19:00 игрового пояса (UTC+7): тот же календарный день
const at = (day: string) => `${day}T12:00:00.000Z`

const skill = (id: string, createdDay: string, over: Partial<Skill> = {}): Skill =>
  ({ id, emoji: '✦', name: id, wantStatement: '', hue: 200, archived: false, createdAt: at(createdDay), ...over })

const star = (id: string, createdDay: string, over: Partial<StarComponent> = {}): StarComponent =>
  ({ id, skillId: 's1', parentStarId: null, tier: 'D', title: id, createdAt: at(createdDay), ...over })

const quest = (id: string, createdDay: string, over: Partial<Quest> = {}): Quest =>
  ({ id, title: id, type: 'short', skillId: 's1', xpReward: 50, status: 'active', createdAt: at(createdDay), ...over })

const xp = (id: string, day: string, amount: number): XpEvent =>
  ({ id, ts: at(day), day, questId: 'q1', skillId: 's1', amount })

const sky = (over: Partial<SkyStore> = {}): SkyStore =>
  ({ skills: [skill('s1', '2026-06-01')], stars: [], quests: [], xpLog: [], ...over })

describe('skyAsOf', () => {
  it('звезда, созданная ровно в день среза, входит; на день позже — нет', () => {
    const store = sky({ stars: [star('a', '2026-06-10'), star('b', '2026-06-11')] })
    expect(skyAsOf(store, '2026-06-10').stars.map((s) => s.id)).toEqual(['a'])
  })

  it('зажжённая ровно в день среза горит; позже — litAt и evidence сняты', () => {
    const store = sky({ stars: [
      star('a', '2026-06-01', { litAt: at('2026-06-10'), evidence: 'сертификат' }),
      star('b', '2026-06-01', { litAt: at('2026-06-11'), evidence: 'видео' }),
    ] })
    const [a, b] = skyAsOf(store, '2026-06-10').stars
    expect(a.litAt).toBe(at('2026-06-10'))
    expect(a.evidence).toBe('сертификат')
    expect('litAt' in b).toBe(false)
    expect('evidence' in b).toBe(false)
  })

  it('полночь игрового пояса: 17:30Z — уже следующий игровой день', () => {
    const store = sky({ stars: [star('a', '2026-06-01', { litAt: '2026-06-10T17:30:00.000Z' })] })
    expect(skyAsOf(store, '2026-06-10').stars[0].litAt).toBeUndefined()
    expect(skyAsOf(store, '2026-06-11').stars[0].litAt).toBe('2026-06-10T17:30:00.000Z')
  })

  it('звезда навыка, созданного позже среза, не входит, даже если сама старше', () => {
    const store = sky({ skills: [skill('s1', '2026-06-20')], stars: [star('a', '2026-06-05')] })
    const past = skyAsOf(store, '2026-06-10')
    expect(past.skills).toEqual([])
    expect(past.stars).toEqual([])
  })

  it('архивный навык проходит как есть — скрывает его потребитель', () => {
    const store = sky({ skills: [skill('s1', '2026-06-01', { archived: true })] })
    expect(skyAsOf(store, '2026-06-10').skills[0].archived).toBe(true)
  })

  it('перенос под более новую звезду: родитель → ближайший существовавший предок, иначе ядро', () => {
    const store = sky({ stars: [
      star('root', '2026-06-01'),
      star('newMid', '2026-06-20', { parentStarId: 'root' }),
      star('old', '2026-06-05', { parentStarId: 'newMid' }),
      star('newRoot', '2026-06-21'),
      star('orphan', '2026-06-06', { parentStarId: 'newRoot' }),
    ] })
    const past = skyAsOf(store, '2026-06-10')
    const parentOf = (id: string) => past.stars.find((s) => s.id === id)?.parentStarId
    expect(past.stars.map((s) => s.id).sort()).toEqual(['old', 'orphan', 'root'])
    expect(parentOf('old')).toBe('root')
    expect(parentOf('orphan')).toBeNull()
  })

  it('цикл в parentStarId не зацикливает проекцию и не привязывает звезду к самой себе', () => {
    const store = sky({ stars: [
      star('a', '2026-06-01', { parentStarId: 'b' }),
      star('b', '2026-06-20', { parentStarId: 'a' }),
    ] })
    expect(skyAsOf(store, '2026-06-10').stars).toEqual([star('a', '2026-06-01')])
  })

  it('xpLog режется по day, а не по ts: отметка задним числом живёт в своём дне', () => {
    const backfilled: XpEvent = { ...xp('e1', '2026-06-10', 20), ts: at('2026-06-15') }
    const store = sky({ xpLog: [backfilled] })
    expect(skyAsOf(store, '2026-06-10').xpLog).toEqual([backfilled])
    expect(skyAsOf(store, '2026-06-09').xpLog).toEqual([])
  })

  it('отметка и откат одного дня дают 0 XP по любую сторону среза', () => {
    const store = sky({ xpLog: [xp('e1', '2026-06-10', 20), { ...xp('e2', '2026-06-10', -20), ts: at('2026-06-12') }] })
    expect(skillXpTotal(skyAsOf(store, '2026-06-09').xpLog, 's1')).toBe(0)
    expect(skillXpTotal(skyAsOf(store, '2026-06-10').xpLog, 's1')).toBe(0)
  })

  it('контракт, откатанный позже сдачи: XP виден между сдачей и откатом', () => {
    const store = sky({ xpLog: [xp('e1', '2026-06-10', 50), xp('e2', '2026-06-14', -50)] })
    expect(skillXpTotal(skyAsOf(store, '2026-06-09').xpLog, 's1')).toBe(0)
    expect(skillXpTotal(skyAsOf(store, '2026-06-13').xpLog, 's1')).toBe(50)
    expect(skillXpTotal(skyAsOf(store, '2026-06-14').xpLog, 's1')).toBe(0)
  })

  it('ранг на дату считается от числа звёзд, существовавших на дату', () => {
    const early = [
      star('d1', '2026-06-01', { litAt: at('2026-06-05') }),
      star('d2', '2026-06-01', { litAt: at('2026-06-06') }),
      star('d3', '2026-06-01'),
    ]
    const late = ['d4', 'd5', 'd6', 'd7', 'd8'].map((id) => star(id, '2026-07-01'))
    const store = sky({ stars: [...early, ...late] })
    expect(isRankAchieved(skyAsOf(store, '2026-06-10').stars, 's1', 'D')).toBe(true) // 2 из 3
    expect(isRankAchieved(skyAsOf(store, '2026-07-01').stars, 's1', 'D')).toBe(false) // 2 из 8, нужно 5
  })

  it('квест, созданный позже среза, не входит; поля остальных не проецируются', () => {
    const done = quest('q1', '2026-06-01', { status: 'done' })
    const store = sky({ quests: [done, quest('q2', '2026-06-11')] })
    expect(skyAsOf(store, '2026-06-10').quests).toEqual([done])
  })

  it('вход не мутируется; срез позже всех событий эквивалентен исходному небу', () => {
    const store = sky({
      stars: [
        star('a', '2026-06-01', { litAt: at('2026-06-05'), evidence: 'ok' }),
        star('b', '2026-06-02', { parentStarId: 'a' }),
      ],
      quests: [quest('q1', '2026-06-01')],
      xpLog: [xp('e1', '2026-06-03', 50)],
    })
    const snapshot = JSON.parse(JSON.stringify(store))
    expect(skyAsOf(store, '2026-12-31')).toEqual(store)
    skyAsOf(store, '2026-06-01')
    expect(store).toEqual(snapshot)
  })
})
