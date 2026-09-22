import { describe, expect, it } from 'vitest'
import type { Quest, Skill, SkyStore, StarComponent, XpEvent } from '../types'
import { layoutConstellation } from './layout'
import { skillXpTotal } from './selectors'
import { isRankAchieved, skillStars } from './stars'
import {
  clampTimelineDay,
  constellationAsOf,
  skyAsOf,
  skyTotals,
  timelineBounds,
  timelineMarks,
  timelineMonths,
  timelineTicks,
} from './timeline'
import type { TimelineMark } from './timeline'

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

describe('constellationAsOf', () => {
  const stars = [
    star('root', '2026-06-01'),
    star('mid', '2026-06-02', { parentStarId: 'root' }),
    star('leaf', '2026-06-03', { parentStarId: 'mid' }),
    star('side', '2026-06-04', { parentStarId: 'root' }),
  ]
  const full = layoutConstellation(skillStars(stars, 's1'), 's1')

  it('полный набор → те же узлы, рёбра и координаты, что в full', () => {
    expect(constellationAsOf(full, stars)).toEqual(full)
  })

  it('подмножество: координаты оставшихся не меняются, рёбра только между оставшимися', () => {
    const past = skyAsOf(sky({ stars }), '2026-06-02').stars // root, mid
    const c = constellationAsOf(full, past)
    expect(c.nodes.map((n) => n.star.id)).toEqual(['root', 'mid'])
    for (const n of c.nodes) {
      const src = full.nodes.find((f) => f.star.id === n.star.id)!
      expect([n.x, n.y, n.depth]).toEqual([src.x, src.y, src.depth])
    }
    expect(c.edges).toEqual([[-1, 0], [0, 1]])
    expect(c.root).toEqual(full.root)
  })

  it('перепривязанная звезда получает ребро к новому родителю, без него — к ядру', () => {
    // mid создана позже leaf: в прошлом leaf висит на root
    const moved = [
      star('root', '2026-06-01'),
      star('mid', '2026-06-20', { parentStarId: 'root' }),
      star('leaf', '2026-06-03', { parentStarId: 'mid' }),
    ]
    const fullMoved = layoutConstellation(skillStars(moved, 's1'), 's1')
    const c = constellationAsOf(fullMoved, skyAsOf(sky({ stars: moved }), '2026-06-10').stars)
    const idx = (id: string) => c.nodes.findIndex((n) => n.star.id === id)
    expect(c.nodes.map((n) => n.star.id).sort()).toEqual(['leaf', 'root'])
    expect(c.edges).toContainEqual([idx('root'), idx('leaf')])
    const onlyLeaf = constellationAsOf(fullMoved, [{ ...moved[2], parentStarId: null }])
    expect(onlyLeaf.edges).toEqual([[-1, 0]])
  })

  it('star в узлах — объект из прошлого (срезанный litAt)', () => {
    const lit = [star('root', '2026-06-01', { litAt: at('2026-06-20') })]
    const fullLit = layoutConstellation(lit, 's1')
    const past = skyAsOf(sky({ stars: lit }), '2026-06-10').stars
    const c = constellationAsOf(fullLit, past)
    expect(c.nodes[0].star).toBe(past[0])
    expect(c.nodes[0].star.litAt).toBeUndefined()
  })

  it('звезда, которой нет в полной раскладке, молча пропускается', () => {
    expect(constellationAsOf(full, [star('ghost', '2026-06-01')]).nodes).toEqual([])
  })
})

describe('timelineBounds', () => {
  it('пустой store → null', () => expect(timelineBounds(sky({ skills: [] }))).toBeNull())

  it('самый ранний день среди навыков, звёзд и xpLog', () => {
    const store = sky({
      skills: [skill('s1', '2026-06-05')],
      stars: [star('a', '2026-06-07')],
      xpLog: [xp('e1', '2026-06-02', 10)],
    })
    expect(timelineBounds(store)).toEqual({ first: '2026-06-02' })
  })

  it('архивный навык и его звёзды границу не дают', () => {
    const store = sky({
      skills: [skill('old', '2026-01-01', { archived: true }), skill('s1', '2026-06-05')],
      stars: [star('x', '2026-01-02', { skillId: 'old' })],
    })
    expect(timelineBounds(store)).toEqual({ first: '2026-06-05' })
  })

  it('событие xpLog архивного навыка, более раннее, чем всё живое, границу даёт: xpLog по архиву не фильтруется', () => {
    const store = sky({
      skills: [skill('old', '2026-01-01', { archived: true }), skill('s1', '2026-06-05')],
      stars: [star('a', '2026-06-07')],
      xpLog: [{ ...xp('e1', '2026-01-03', 10), skillId: 'old' }],
    })
    expect(timelineBounds(store)).toEqual({ first: '2026-01-03' })
  })

  it('со skillId — день создания навыка; нет такого навыка → null', () => {
    const store = sky({ skills: [skill('s1', '2026-06-05'), skill('s2', '2026-07-01')], xpLog: [xp('e1', '2026-06-02', 10)] })
    expect(timelineBounds(store, 's2')).toEqual({ first: '2026-07-01' })
    expect(timelineBounds(store, 'nope')).toBeNull()
  })
})

describe('clampTimelineDay', () => {
  it('день внутри диапазона не меняется, границы включены', () => {
    expect(clampTimelineDay('2026-06-10', '2026-06-01', '2026-06-20')).toBe('2026-06-10')
    expect(clampTimelineDay('2026-06-01', '2026-06-01', '2026-06-20')).toBe('2026-06-01')
    expect(clampTimelineDay('2026-06-20', '2026-06-01', '2026-06-20')).toBe('2026-06-20')
  })

  it('ниже first → first', () => expect(clampTimelineDay('2026-05-31', '2026-06-01', '2026-06-20')).toBe('2026-06-01'))

  it('выше today → today', () => expect(clampTimelineDay('2026-06-21', '2026-06-01', '2026-06-20')).toBe('2026-06-20'))

  it('first > today (навык с createdAt из будущего) → today: зажим к today — последний', () => {
    expect(clampTimelineDay('2026-06-10', '2026-07-01', '2026-06-20')).toBe('2026-06-20')
    expect(clampTimelineDay('2026-06-25', '2026-07-01', '2026-06-20')).toBe('2026-06-20')
    expect(clampTimelineDay('2026-07-05', '2026-07-01', '2026-06-20')).toBe('2026-06-20')
  })
})

describe('timelineMarks', () => {
  const starDays = (marks: TimelineMark[]) => marks.filter((m) => m.kind === 'star').map((m) => `${m.day}:${m.skillId}`)
  const rankDays = (marks: TimelineMark[]) => marks.filter((m) => m.kind === 'rank').map((m) => m.day)

  it('пустой store → []', () => expect(timelineMarks(sky({ skills: [] }))).toEqual([]))

  it('засечка звезды — в день зажигания, label — название звезды', () => {
    const store = sky({ stars: [
      star('a', '2026-06-01', { title: 'A1', litAt: at('2026-06-10') }),
      star('b', '2026-06-01'),
      star('c', '2026-06-01'),
    ] }) // 1 из 3 — ранг не взят, засечка одна
    expect(timelineMarks(store)).toEqual([{ day: '2026-06-10', kind: 'star', skillId: 's1', label: 'A1' }])
  })

  it('засечка ранга — в день перехода «нет → да»', () => {
    const store = sky({
      skills: [skill('s1', '2026-06-01', { name: 'Английский' })],
      stars: [
        star('a', '2026-06-01', { litAt: at('2026-06-05') }),
        star('b', '2026-06-01', { litAt: at('2026-06-08') }),
        star('c', '2026-06-01'),
      ],
    })
    expect(timelineMarks(store).filter((m) => m.kind === 'rank')).toEqual([
      { day: '2026-06-08', kind: 'rank', skillId: 's1', label: 'ранг D · Английский' },
    ])
  })

  it('ранг взят, отобран добавлением звёзд и взят снова — две засечки', () => {
    const store = sky({ stars: [
      star('a', '2026-06-01', { litAt: at('2026-06-05') }), // 1 из 1 — взят
      star('b', '2026-06-10', { litAt: at('2026-06-20') }), // с 06-10: 1 из 3 — потерян; 06-20: 2 из 3 — снова взят
      star('c', '2026-06-10'),
    ] })
    expect(rankDays(timelineMarks(store))).toEqual(['2026-06-05', '2026-06-20'])
  })

  it('архивный навык засечек не даёт; фильтр по skillId; сортировка по дню', () => {
    const store = sky({
      skills: [skill('s1', '2026-06-01'), skill('s2', '2026-06-01'), skill('old', '2026-06-01', { archived: true })],
      stars: [
        star('late', '2026-06-01', { litAt: at('2026-06-20') }),
        star('early', '2026-06-01', { skillId: 's2', litAt: at('2026-06-03') }),
        star('gone', '2026-06-01', { skillId: 'old', litAt: at('2026-06-02') }),
      ],
    })
    expect(starDays(timelineMarks(store))).toEqual(['2026-06-03:s2', '2026-06-20:s1'])
    expect(starDays(timelineMarks(store, 's1'))).toEqual(['2026-06-20:s1'])
  })

  it('звезда, зажжённая раньше создания навыка, даёт засечки в день, когда стала видна на небе', () => {
    const store = sky({ skills: [skill('s1', '2026-06-10')], stars: [star('a', '2026-06-01', { litAt: at('2026-06-02') })] })
    expect(timelineMarks(store).map((m) => `${m.kind}:${m.day}`)).toEqual(['star:2026-06-10', 'rank:2026-06-10'])
  })
})

describe('timelineTicks', () => {
  const mark = (day: string, kind: TimelineMark['kind'], label: string): TimelineMark => ({ day, kind, skillId: 's1', label })

  it('пустой вход → []', () => expect(timelineTicks([], '2026-06-01', '2026-06-30')).toEqual([]))

  it('несколько событий одного дня — одна засечка: rank: true, порядок marks сохранён', () => {
    const a = mark('2026-06-05', 'star', 'A1')
    const b = mark('2026-06-10', 'star', 'A2')
    const c = mark('2026-06-10', 'star', 'B1')
    const d = mark('2026-06-10', 'rank', 'ранг D · s1')
    expect(timelineTicks([a, b, c, d], '2026-06-01', '2026-06-30')).toEqual([
      { day: '2026-06-05', rank: false, marks: [a] },
      { day: '2026-06-10', rank: true, marks: [b, c, d] },
    ])
  })

  it('события вне [first, last] отброшены, границы включены', () => {
    const marks = ['2026-05-31', '2026-06-01', '2026-06-30', '2026-07-01'].map((day) => mark(day, 'star', day))
    expect(timelineTicks(marks, '2026-06-01', '2026-06-30').map((t) => t.day)).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('вход не мутируется', () => {
    const marks = [mark('2026-06-10', 'star', 'A2'), mark('2026-06-10', 'rank', 'ранг D · s1')]
    const snapshot = JSON.parse(JSON.stringify(marks))
    timelineTicks(marks, '2026-06-01', '2026-06-30')
    expect(marks).toEqual(snapshot)
  })
})

describe('skyTotals', () => {
  it('считает звёзды только неархивных навыков', () => {
    const store = sky({
      skills: [skill('s1', '2026-06-01'), skill('old', '2026-06-01', { archived: true })],
      stars: [
        star('a', '2026-06-01', { litAt: at('2026-06-02') }),
        star('b', '2026-06-01'),
        star('x', '2026-06-01', { skillId: 'old', litAt: at('2026-06-02') }),
      ],
    })
    expect(skyTotals(store)).toEqual({ starsLit: 1, starsTotal: 2 })
  })

  it('пустое небо → нули', () => expect(skyTotals(sky({ skills: [] }))).toEqual({ starsLit: 0, starsTotal: 0 }))
})

describe('timelineMonths', () => {
  it('первая подпись — в день начала, дальше — первые числа месяцев; январь подписан годом', () => {
    expect(timelineMonths('2026-11-20', '2027-02-03')).toEqual([
      { day: '2026-11-20', label: 'ноя' },
      { day: '2026-12-01', label: 'дек' },
      { day: '2027-01-01', label: '2027' },
      { day: '2027-02-01', label: 'фев' },
    ])
  })

  it('один день — одна подпись; перевёрнутый диапазон — пусто', () => {
    expect(timelineMonths('2026-06-14', '2026-06-14')).toEqual([{ day: '2026-06-14', label: 'июн' }])
    expect(timelineMonths('2026-06-14', '2026-06-13')).toEqual([])
  })
})
