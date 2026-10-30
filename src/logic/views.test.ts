import { describe, expect, it } from 'vitest'
import type { LedgerEvent, Quest, Skill, StarComponent, Store, XpEvent } from '../types'
import {
  ViewError, parseWeeks, questView, questsView, ranksView, resolveIdPrefix, skillsView, starsView, statsView, statusView,
  walletView, wishlistView,
} from './views'

const TODAY = '2026-10-30' // пятница; неделя Пн 10-26 .. Вс 11-01
const TS = '2026-10-01T05:00:00.000Z'

const skill = (id: string, over: Partial<Skill> = {}): Skill =>
  ({ id, emoji: '⚔️', name: id, wantStatement: '', hue: 0, archived: false, createdAt: TS, ...over })
const star = (id: string, skillId: string, tier: StarComponent['tier'], lit = false): StarComponent =>
  ({ id, skillId, parentStarId: null, tier, title: id, ...(lit ? { litAt: TS } : {}), createdAt: TS })
const quest = (id: string, over: Partial<Quest> = {}): Quest =>
  ({ id, title: id, type: 'short', skillId: null, xpReward: 10, status: 'active', createdAt: TS, ...over })
const xp = (id: string, questId: string, day: string, amount: number, skillId: string | null = null): XpEvent =>
  ({ id, ts: `${day}T03:00:00.000Z`, day, questId, skillId, amount })
const led = (id: string, day: string, kind: LedgerEvent['kind'], amount: number, over: Partial<LedgerEvent> = {}): LedgerEvent =>
  ({ id, ts: `${day}T03:00:00.000Z`, day, kind, amount, ...over })

const world = (over: Partial<Store> = {}): Store => ({
  version: 4, character: { name: 'И', avatar: '🧭' }, skills: [], stars: [], quests: [], xpLog: [], ...over,
})

/** Ловит ViewError и отдаёт его поля — проверять kind и текст разом. */
const viewError = (fn: () => unknown): { kind: string; message: string; matches?: string[] } => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ViewError) return { kind: e.kind, message: e.message, matches: e.matches }
    throw e
  }
  throw new Error('ViewError не брошен')
}

describe('resolveIdPrefix', () => {
  const items = [{ id: 'q_abc' }, { id: 'q_abd' }, { id: 'c_2' }, { id: 'c_2x' }]
  it('уникальный префикс и точный id', () => {
    expect(resolveIdPrefix(items, 'q_abc', 'квест')).toBe('q_abc')
    expect(resolveIdPrefix(items, 'c_2x', 'звезда')).toBe('c_2x')
  })
  it('точный id выигрывает у потомков-префиксов', () => expect(resolveIdPrefix(items, 'c_2', 'звезда')).toBe('c_2'))
  it('нет совпадений — not-found с родом сущности в тексте', () =>
    expect(viewError(() => resolveIdPrefix(items, 'нет', 'навык'))).toEqual({
      kind: 'not-found', message: 'навык с id «нет» не найден', matches: undefined,
    }))
  it('неоднозначный префикс — ambiguous со всеми кандидатами', () =>
    expect(viewError(() => resolveIdPrefix(items, 'q_ab', 'квест'))).toEqual({
      kind: 'ambiguous', message: 'префикс «q_ab» неоднозначен: q_abc, q_abd', matches: ['q_abc', 'q_abd'],
    }))
})

describe('пустой мир', () => {
  // нет ledger и wishlist вовсе — поля опциональны в v4
  const s = world()
  it('statusView: уровень 1, нули, квота свободна', () =>
    expect(statusView(s, TODAY)).toEqual({
      character: { name: 'И', level: 1, into: 0, toNext: 300, totalXp: 0 },
      today: { due: 0, habitsDone: 0 },
      skills: [],
      sparks: { balance: 0, provision: 0, moves: { used: 0, free: 3 } },
    }))
  it('walletView: нули и пустой журнал', () =>
    expect(walletView(s, TODAY)).toEqual({
      balance: 0, ledgerTotal: 0, provisionTotal: 0, provisions: [],
      moves: { used: 0, free: 3 }, emission: { d7: 0, d30: 0 }, ledger: [],
    }))
  it('списки пусты, stats — недели с нулями', () => {
    for (const f of ['active', 'today', 'proposed', 'all'] as const) expect(questsView(s, TODAY, f)).toEqual([])
    expect(skillsView(s)).toEqual([])
    expect(starsView(s)).toEqual([])
    expect(wishlistView(s)).toEqual([])
    expect(statsView(s, TODAY, 2)).toEqual([
      { weekStart: '2026-10-19', total: 0, bySkill: {} },
      { weekStart: '2026-10-26', total: 0, bySkill: {} },
    ])
  })
  it('questView/ranksView в пустом мире — not-found', () => {
    expect(viewError(() => questView(s, 'q')).kind).toBe('not-found')
    expect(viewError(() => ranksView(s, 's')).kind).toBe('not-found')
  })
})

describe('statusView', () => {
  it('«на сегодня»: контракты с наступившим сроком и short без срока; привычки — по факту отметки', () => {
    const s = world({
      quests: [
        quest('q_late', { dueDate: '2026-10-20' }),
        quest('q_due', { type: 'mid', dueDate: TODAY }),
        quest('q_later', { dueDate: '2026-11-05' }),
        quest('q_short'), // short без срока — сегодня
        quest('q_mid', { type: 'mid' }), // mid без срока — нет
        quest('q_habit', { type: 'repeating' }),
        quest('q_habit2', { type: 'repeating' }),
        quest('q_prop', { status: 'proposed', proposalNote: 'n' }),
        quest('q_arch', { status: 'archived', dueDate: '2026-10-01' }),
        quest('q_done', { status: 'done', dueDate: '2026-10-01' }),
      ],
      xpLog: [
        xp('e1', 'q_habit', TODAY, 10),
        // отметка с откатом в тот же день — не «сделано»
        xp('e2', 'q_habit2', TODAY, 10), xp('e3', 'q_habit2', TODAY, -10),
      ],
    })
    expect(statusView(s, TODAY).today).toEqual({ due: 3, habitsDone: 1 })
  })
  it('архивный навык выпадает; уровень навыка и текущий ранг считаются', () => {
    const s = world({
      skills: [skill('s_live'), skill('s_old', { archived: true }), skill('s_bare')],
      stars: [star('c1', 's_live', 'D', true), star('c2', 's_live', 'C'), star('c3', 's_old', 'D')],
      xpLog: [xp('e1', 'q', '2026-10-01', 130, 's_live'), xp('e2', 'q', '2026-10-01', 50, 's_old')],
    })
    const v = statusView(s, TODAY)
    expect(v.skills).toEqual([
      { id: 's_live', name: 's_live', level: 2, into: 30, toNext: 150, ranksTotal: 2, ranksAchieved: 1, currentRank: 'C' },
      { id: 's_bare', name: 's_bare', level: 1, into: 0, toNext: 100, ranksTotal: 0, ranksAchieved: 0, currentRank: null },
    ])
    // XP архивного навыка остаётся персонажу
    expect(v.character).toMatchObject({ totalXp: 180 })
  })
  it('XP в минусе после откатов — totalXp 0, не отрицательный', () => {
    const s = world({ xpLog: [xp('e1', 'q', '2026-10-01', -40)] })
    expect(statusView(s, TODAY).character).toEqual({ name: 'И', level: 1, into: 0, toNext: 300, totalXp: 0 })
  })
  it('отрицательный баланс: провизия просрочки больше Σ ledger', () => {
    const s = world({
      quests: [quest('q_late', { xpReward: 100, dueDate: '2026-10-10' })],
      ledger: [led('l1', '2026-10-01', 'adjust', 30, { note: 'сид' })],
    })
    expect(statusView(s, TODAY).sparks).toEqual({ balance: -70, provision: 100, moves: { used: 0, free: 3 } })
  })
})

describe('walletView', () => {
  const base = (): Store => world({
    quests: [
      quest('q_late', { title: 'Просрочка', xpReward: 100, dueDate: '2026-10-10' }), // 20 дней — потолок
      quest('q_fresh', { title: 'Свежая', xpReward: 50, dueDate: '2026-10-27' }), // 3 дня — 30%
      quest('q_done', { status: 'done', xpReward: 70, dueDate: '2026-10-01' }),
      quest('q_arch', { status: 'archived', xpReward: 70, dueDate: '2026-10-01' }),
      quest('q_habit', { type: 'repeating', xpReward: 10 }),
    ],
    ledger: [
      led('l1', '2026-10-01', 'adjust', 50, { note: 'сид' }),
      led('l2', '2026-10-25', 'earn', 20, { questId: 'q_habit' }),
      led('l3', '2026-10-28', 'earn', 10, { questId: 'q_habit' }),
      led('l4', '2026-10-28', 'reversal', -10, { reversesId: 'l3', questId: 'q_habit' }),
      led('l5', '2026-10-29', 'spend', -15, { note: 'кофе', opId: 'op1' }),
    ],
  })

  it('провизии — только активные просроченные контракты; cap — награда', () => {
    expect(walletView(base(), TODAY).provisions).toEqual([
      { questId: 'q_late', title: 'Просрочка', provision: 100, cap: 100 },
      { questId: 'q_fresh', title: 'Свежая', provision: 15, cap: 50 },
    ])
  })
  it('баланс — Σ ledger минус провизии, может уйти в минус', () => {
    const v = walletView(base(), TODAY)
    expect({ balance: v.balance, ledgerTotal: v.ledgerTotal, provisionTotal: v.provisionTotal })
      .toEqual({ balance: -60, ledgerTotal: 55, provisionTotal: 115 })
  })
  it('эмиссия не считает развёрнутую выплату; окно 7 дней включает сегодня', () => {
    expect(walletView(base(), TODAY).emission).toEqual({ d7: 20, d30: 20 })
  })
  it('журнал свежим сверху, store не мутирован', () => {
    const s = base()
    const before = JSON.stringify(s)
    expect(walletView(s, TODAY).ledger.map((e) => e.id)).toEqual(['l5', 'l4', 'l3', 'l2', 'l1'])
    expect(JSON.stringify(s)).toBe(before)
  })
  it('квота переносов — rolling-окно 7 дней по всем квестам', () => {
    const move = (day: string) => ({ from: '2026-11-01', to: '2026-11-02', day, ts: `${day}T03:00:00.000Z` })
    const s = world({
      quests: [
        quest('q1', { dueDate: '2026-11-10', dueDateHistory: [move('2026-10-23'), move('2026-10-24')] }),
        quest('q2', { dueDate: '2026-11-10', dueDateHistory: [move('2026-10-30')] }),
      ],
    })
    expect(walletView(s, TODAY).moves).toEqual({ used: 2, free: 3 })
  })
})

describe('questsView', () => {
  const s = world({
    quests: [
      quest('q_act'),
      quest('q_habit', { type: 'repeating' }),
      quest('q_later', { type: 'mid', dueDate: '2026-11-20' }),
      quest('q_prop', { status: 'proposed', proposalNote: 'n', dueDate: '2026-10-01' }),
      quest('q_done', { status: 'done' }),
      quest('q_arch', { status: 'archived' }),
    ],
  })
  const ids = (list: Quest[]) => list.map((q) => q.id)
  it('active по умолчанию — все активные, привычки тоже', () =>
    expect(ids(questsView(s, TODAY, 'active'))).toEqual(['q_act', 'q_habit', 'q_later']))
  it('today — только активные контракты, положенные на сегодня (proposed с прошедшим сроком — нет)', () =>
    expect(ids(questsView(s, TODAY, 'today'))).toEqual(['q_act']))
  it('proposed', () => expect(ids(questsView(s, TODAY, 'proposed'))).toEqual(['q_prop']))
  it('all — всё, кроме архива, в порядке store', () =>
    expect(ids(questsView(s, TODAY, 'all'))).toEqual(['q_act', 'q_habit', 'q_later', 'q_prop', 'q_done']))
})

describe('questView', () => {
  const s = world({
    quests: [
      quest('q_epic', { type: 'mid' }),
      quest('q_c2', { parentQuestId: 'q_epic', createdAt: '2026-10-03T00:00:00.000Z' }),
      quest('q_c1', { parentQuestId: 'q_epic', status: 'done', result: { summary: 'и' }, createdAt: '2026-10-02T00:00:00.000Z' }),
      quest('q_c3', { parentQuestId: 'q_epic', status: 'proposed', proposalNote: 'n', createdAt: '2026-10-04T00:00:00.000Z' }),
      quest('q_c4', { parentQuestId: 'q_epic', status: 'archived', createdAt: '2026-10-05T00:00:00.000Z' }),
      quest('q_pend', { type: 'long' }),
      quest('q_pc', { parentQuestId: 'q_pend', status: 'proposed', proposalNote: 'n' }),
      quest('q_old', { status: 'archived' }),
    ],
  })
  it('эпик: дети по createdAt без архива, прогресс по active+done', () => {
    expect(questView(s, 'q_epic')).toEqual({
      ...s.quests[0], children: ['q_c1', 'q_c2', 'q_c3'], progress: { done: 1, total: 2 },
    })
  })
  it('эпик только с proposed-детьми: children есть, progress null', () =>
    expect(questView(s, 'q_pend')).toMatchObject({ children: ['q_pc'], progress: null }))
  it('обычный квест и подквест — как есть, без полей эпика', () => {
    expect(questView(s, 'q_c2')).toBe(s.quests[1])
    expect(questView(s, 'q_c2')).not.toHaveProperty('children')
  })
  it('архивный квест находится; префикс резолвится', () => {
    expect(questView(s, 'q_old').id).toBe('q_old')
    expect(questView(s, 'q_ep').id).toBe('q_epic')
  })
  it('неоднозначный префикс — ambiguous', () =>
    expect(viewError(() => questView(s, 'q_c'))).toMatchObject({ kind: 'ambiguous', matches: ['q_c2', 'q_c1', 'q_c3', 'q_c4'] }))
})

describe('skillsView / ranksView / starsView', () => {
  const s = world({
    skills: [skill('s_run', { emoji: '🏃', name: 'Бег' }), skill('s_old', { archived: true }), skill('s_row')],
    stars: [
      star('c_d1', 's_run', 'D', true), star('c_d2', 's_run', 'D', true), star('c_d3', 's_run', 'D'),
      star('c_b1', 's_run', 'B'),
      star('c_o1', 's_old', 'C', true),
    ],
  })
  it('skillsView: архив выпадает, имя с эмодзи, ранги сводкой', () =>
    expect(skillsView(s)).toEqual([
      { id: 's_run', name: '🏃 Бег', level: 1, into: 0, toNext: 100, ranks: { total: 2, achieved: 1 } },
      { id: 's_row', name: '⚔️ s_row', level: 1, into: 0, toNext: 100, ranks: { total: 0, achieved: 0 } },
    ]))
  it('ranksView: только ранги со звёздами, D→S; порог 60% (2 из 3 — взят)', () =>
    expect(ranksView(s, 's_ru')).toEqual([
      { tier: 'D', achieved: true, lit: 2, total: 3 },
      { tier: 'B', achieved: false, lit: 0, total: 1 },
    ]))
  it('ranksView: архивный навык доступен; навык без звёзд — пустая лестница', () => {
    expect(ranksView(s, 's_old')).toEqual([{ tier: 'C', achieved: true, lit: 1, total: 1 }])
    expect(ranksView(s, 's_row')).toEqual([])
  })
  it('ranksView: неоднозначный навык — ambiguous', () =>
    expect(viewError(() => ranksView(s, 's_r')).kind).toBe('ambiguous'))
  it('starsView: без фильтров — все звёзды, архивного навыка тоже; пустые значения — нет фильтра', () => {
    expect(starsView(s)).toBe(s.stars)
    expect(starsView(s, { skill: '', tier: '' })).toBe(s.stars)
  })
  it('starsView: фильтры по навыку и рангу складываются', () =>
    expect(starsView(s, { skill: 's_run', tier: 'D' }).map((c) => c.id)).toEqual(['c_d1', 'c_d2', 'c_d3']))
  it('starsView: ранг вне D|C|B|A|S — bad-param', () =>
    expect(viewError(() => starsView(s, { tier: 'Z' }))).toMatchObject({ kind: 'bad-param', message: '--tier: D|C|B|A|S' }))
  it('starsView: при двух ошибках отказ про навык', () =>
    expect(viewError(() => starsView(s, { skill: 'нет', tier: 'Z' })).kind).toBe('not-found'))
})

describe('parseWeeks / statsView', () => {
  it('parseWeeks: пусто — 4, границы 1 и 52 включены', () => {
    expect([parseWeeks(), parseWeeks(null), parseWeeks(''), parseWeeks('1'), parseWeeks('52')]).toEqual([4, 4, 4, 1, 52])
  })
  it('parseWeeks: 0, 53, дробь, мусор — bad-param', () => {
    for (const raw of ['0', '53', '1.5', 'abc', '-1'])
      expect(viewError(() => parseWeeks(raw)), raw).toMatchObject({ kind: 'bad-param', message: '--weeks: целое 1..52' })
  })
  it('statsView: Пн..Вс от старой к новой; XP без навыка — ключ "null"; ноль после отката остаётся', () => {
    const s = world({
      xpLog: [
        xp('e1', 'q1', '2026-10-30', 10, 's1'),
        xp('e2', 'q2', '2026-10-26', 5),
        xp('e3', 'q1', '2026-10-20', 7, 's1'),
        xp('e4', 'q1', '2026-10-20', -7, 's1'),
        xp('e5', 'q1', '2026-10-11', 100, 's1'), // до окна — не считается
      ],
    })
    const v = statsView(s, TODAY, 2)
    expect(v).toEqual([
      { weekStart: '2026-10-19', total: 0, bySkill: { s1: 0 } },
      { weekStart: '2026-10-26', total: 15, bySkill: { s1: 10, null: 5 } },
    ])
    expect(JSON.stringify(v[1].bySkill)).toBe('{"s1":10,"null":5}')
  })
})

describe('wishlistView', () => {
  it('архив выпадает, остальное — как есть в порядке store', () => {
    const s = world({
      wishlist: [
        { id: 'w1', title: 'Книга', kind: 'small', price: 30, createdAt: TS },
        { id: 'w2', title: 'Скрыто', kind: 'small', price: 1, archived: true, createdAt: TS },
        { id: 'w3', title: 'Часы', kind: 'big', starId: 'c1', claimedAt: TS, createdAt: TS },
      ],
    })
    expect(wishlistView(s).map((w) => w.id)).toEqual(['w1', 'w3'])
    expect(wishlistView(s)[1]).toBe(s.wishlist![2])
  })
})
