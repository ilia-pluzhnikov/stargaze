import { describe, expect, it } from 'vitest'
import type { Quest, Skill, StarComponent, Store } from '../types'
import { validateStore } from './validate'

const T0 = '2026-07-01T00:00:00.000Z'

const skill = (id: string, overrides: Partial<Skill> = {}): Skill => ({
  id,
  emoji: '🎯',
  name: `Навык ${id}`,
  wantStatement: 'хочу',
  hue: 200,
  archived: false,
  createdAt: T0,
  ...overrides,
})

const star = (overrides: Partial<StarComponent> = {}): StarComponent => ({
  id: 'c1',
  skillId: 's1',
  parentStarId: null,
  tier: 'D',
  title: 'Звезда',
  createdAt: T0,
  ...overrides,
})

const quest = (overrides: Partial<Quest> = {}): Quest => ({
  id: 'q1',
  title: 'Квест',
  type: 'short',
  skillId: 's1',
  xpReward: 10,
  status: 'active',
  createdAt: T0,
  ...overrides,
})

const base = (overrides: Partial<Store> = {}): Store => ({
  version: 3,
  character: { name: 'Тест', avatar: '⚔️' },
  skills: [skill('s1')],
  stars: [star()],
  quests: [],
  xpLog: [],
  ...overrides,
})

describe('validateStore', () => {
  it('валидный store v3', () => expect(validateStore(base())).toEqual([]))
  it('не-объект', () => expect(validateStore('мусор')).toEqual(['store: не объект']))
  it('чужая версия', () => expect(validateStore({ ...base(), version: 2 }).join()).toMatch(/version/))
  it('битый character', () =>
    expect(validateStore({ ...base(), character: { name: 5 } }).join()).toMatch(/character/))

  it('дубликат id квеста', () => {
    const s = base({ quests: [quest({ id: 'q1' }), quest({ id: 'q1' })] })
    expect(validateStore(s).join()).toMatch(/дубликат id/)
  })

  it('glyphId: отсутствие и строка валидны, не-строка — ошибка', () => {
    expect(validateStore(base())).toEqual([])
    const withGlyph = base({ skills: [skill('s1', { glyphId: 'delta' })] })
    expect(validateStore(withGlyph)).toEqual([])
    const broken = base({ skills: [skill('s1', { glyphId: 7 as unknown as string })] })
    expect(validateStore(broken).some((e) => e.includes('glyphId'))).toBe(true)
  })

  it('rankTitles: отсутствие и валидный объект валидны', () => {
    expect(validateStore(base())).toEqual([])
    const withTitles = base({ skills: [skill('s1', { rankTitles: { D: 'Разминка', S: 'Мастер' } })] })
    expect(validateStore(withTitles)).toEqual([])
  })
  it('rankTitles: не объект — ошибка', () => {
    const s = base({ skills: [skill('s1', { rankTitles: 'нет' as unknown as Skill['rankTitles'] })] })
    expect(validateStore(s).join()).toMatch(/rankTitles/)
  })
  it('rankTitles: ключ вне TIERS — ошибка', () => {
    const s = base({ skills: [skill('s1', { rankTitles: { X: 'что-то' } as unknown as Skill['rankTitles'] })] })
    expect(validateStore(s).join()).toMatch(/rankTitles/)
  })
  it('rankTitles: значение не строка — ошибка', () => {
    const s = base({ skills: [skill('s1', { rankTitles: { D: 5 as unknown as string } })] })
    expect(validateStore(s).join()).toMatch(/rankTitles/)
  })

  it('star: parentStarId должен существовать', () => {
    const s = base({ stars: [star({ id: 'c1', parentStarId: 'нет' })] })
    expect(validateStore(s).join('\n')).toMatch(/parentStarId/)
  })
  it('star: родитель из другого навыка — ошибка', () => {
    const s = base({
      skills: [skill('s1'), skill('s2')],
      stars: [star({ id: 'c1', skillId: 's1' }), star({ id: 'c2', skillId: 's2', parentStarId: 'c1' })],
    })
    expect(validateStore(s).join('\n')).toMatch(/другого навыка/)
  })
  it('star: цикл parentStarId — ошибка', () => {
    const s = base({ stars: [star({ id: 'a', parentStarId: 'b' }), star({ id: 'b', parentStarId: 'a' })] })
    expect(validateStore(s).join('\n')).toMatch(/цикл/)
  })
  it('star: самоссылающийся parentStarId — тоже цикл, без зависания', () => {
    const s = base({ stars: [star({ id: 'a', parentStarId: 'a' })] })
    expect(validateStore(s).join('\n')).toMatch(/цикл/)
  })
  it('star: неизвестный tier — ошибка', () => {
    const s = base({ stars: [star({ id: 'c1', tier: 'X' as never })] })
    expect(validateStore(s).join('\n')).toMatch(/tier/)
  })
  it('star: xpTarget не положительное число — ошибка', () => {
    const s = base({ stars: [star({ xpTarget: -1 })] })
    expect(validateStore(s).join()).toMatch(/xpTarget/)
  })
  it('star: evidence без litAt', () => {
    const s = base({ stars: [star({ evidence: 'сдал' })] })
    expect(validateStore(s).join()).toMatch(/evidence/)
  })

  it('quest.starId чужого навыка — ошибка', () => {
    const s = base({
      skills: [skill('s1'), skill('s2')],
      stars: [star({ id: 'c1', skillId: 's2' })],
      quests: [quest({ id: 'q1', skillId: 's1', starId: 'c1' })],
    })
    expect(validateStore(s).join('\n')).toMatch(/принадлежит навыку s2/)
  })
  it('quest.starId — не найден', () => {
    const s = base({ quests: [quest({ id: 'q1', starId: 'нет' })] })
    expect(validateStore(s).join()).toMatch(/starId/)
  })
  it('proposalNote у не-proposed', () => {
    const s = base({ quests: [quest({ proposalNote: 'зачем' })] })
    expect(validateStore(s).join()).toMatch(/proposalNote/)
  })

  it('событие с несуществующим questId', () => {
    const s = base({ xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'нет', skillId: null, amount: 10 }] })
    expect(validateStore(s).join()).toMatch(/questId/)
  })
  it('skillId события отличается от skillId квеста (разные реальные навыки — снимок легален)', () => {
    const s = base({
      skills: [skill('s1'), skill('s2')],
      quests: [quest({ id: 'q1', skillId: 's1' })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's2', amount: 10 }],
    })
    expect(validateStore(s)).toEqual([])
  })
  it('skillId события ссылается на несуществующий навык', () => {
    const s = base({
      quests: [quest({ id: 'q1' })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 'несуществующий', amount: 1 }],
    })
    expect(validateStore(s).join()).toMatch(/skillId.*не найден/)
  })
  it('битый формат day', () => {
    const s = base({
      quests: [quest({ id: 'q1' })],
      xpLog: [{ id: 'e1', ts: 't', day: '07.07.2026', questId: 'q1', skillId: 's1', amount: 1 }],
    })
    expect(validateStore(s).join()).toMatch(/day/)
  })
  it('отрицательный net за день', () => {
    const s = base({
      quests: [quest({ id: 'q1' })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: -5 }],
    })
    expect(validateStore(s).join()).toMatch(/net/)
  })
  it('события у proposed-квеста', () => {
    const s = base({
      quests: [quest({ id: 'q1', status: 'proposed', proposalNote: 'x' })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 5 }],
    })
    expect(validateStore(s).join()).toMatch(/proposed/)
  })
  it('повторная отметка repeating в один день без компенсации', () => {
    const s = base({
      quests: [quest({ id: 'q1', type: 'repeating' })],
      xpLog: [
        { id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 },
        { id: 'e2', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 },
      ],
    })
    expect(validateStore(s).join()).toMatch(/повторная отметка/)
  })
  it('невалидная версия и дубликат id квеста оба обнаруживаются', () => {
    const s = base({ quests: [quest({ id: 'q1' }), quest({ id: 'q1' })] })
    const errors = validateStore({ ...s, version: 2 })
    expect(errors.join()).toMatch(/version/)
    expect(errors.join()).toMatch(/дубликат id/)
  })
})

describe('validateStore: карточка квеста', () => {
  it('полная валидная карточка у done-квеста', () => {
    const s = base({
      quests: [quest({
        status: 'done',
        description: 'Разобрать путь клиента',
        why: 'Чтобы выбрать канал на своих данных',
        definitionOfDone: [{ text: 'Выписаны точки касания', done: true }, { text: 'Выбран сегмент' }],
        resources: [{ title: 'Pipeline лидов', url: 'https://x' }, { title: 'База (без ссылки)' }],
        result: { summary: 'Выбран сегмент', artifactUrl: 'https://y', evidence: '7 ответов' },
      })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 }],
    })
    expect(validateStore(s)).toEqual([])
  })
  it('done-квест без result — валиден (легаси)', () => {
    const s = base({
      quests: [quest({ status: 'done' })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 }],
    })
    expect(validateStore(s)).toEqual([])
  })
  it('definitionOfDone: пустой text — ошибка', () => {
    const s = base({ quests: [quest({ definitionOfDone: [{ text: '  ' }] })] })
    expect(validateStore(s).join()).toMatch(/definitionOfDone/)
  })
  it('definitionOfDone: done не boolean — ошибка', () => {
    const s = base({ quests: [quest({ definitionOfDone: [{ text: 'x', done: 1 as unknown as boolean }] })] })
    expect(validateStore(s).join()).toMatch(/done/)
  })
  it('resources: без title — ошибка', () => {
    const s = base({ quests: [quest({ resources: [{ title: '' }] })] })
    expect(validateStore(s).join()).toMatch(/resources/)
  })
  it('resources: url не строка — ошибка', () => {
    const s = base({ quests: [quest({ resources: [{ title: 'x', url: 5 as unknown as string }] })] })
    expect(validateStore(s).join()).toMatch(/url/)
  })
  it('result без summary — ошибка', () => {
    const s = base({
      quests: [quest({ status: 'done', result: { summary: '  ' } })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 }],
    })
    expect(validateStore(s).join()).toMatch(/summary/)
  })
  it('result у active — ошибка', () => {
    const s = base({ quests: [quest({ result: { summary: 'x' } })] })
    expect(validateStore(s).join()).toMatch(/result/)
  })
  it('result у proposed — ошибка', () => {
    const s = base({ quests: [quest({ status: 'proposed', proposalNote: 'n', result: { summary: 'x' } })] })
    expect(validateStore(s).join()).toMatch(/result/)
  })
  it('result у repeating-done — ошибка', () => {
    const s = base({
      quests: [quest({ type: 'repeating', status: 'done', result: { summary: 'x' } })],
      xpLog: [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 }],
    })
    expect(validateStore(s).join()).toMatch(/repeating/)
  })
  it('description/why не строки — ошибка', () => {
    const s = base({ quests: [quest({ description: 5 as unknown as string, why: [] as unknown as string })] })
    const j = validateStore(s).join()
    expect(j).toMatch(/description/)
    expect(j).toMatch(/why/)
  })
})

describe('validateStore: DoD-гейт и история итогов', () => {
  const doneXp = () => [{ id: 'e1', ts: 't', day: '2026-07-07', questId: 'q1', skillId: 's1', amount: 10 }]

  it('result.skippedDod из строк — валиден', () => {
    const s = base({
      quests: [quest({ status: 'done', result: { summary: 'x', skippedDod: ['Пункт Б'] } })],
      xpLog: doneXp(),
    })
    expect(validateStore(s)).toEqual([])
  })
  it('result.skippedDod не массив строк — ошибка', () => {
    const s = base({
      quests: [quest({ status: 'done', result: { summary: 'x', skippedDod: [5] as unknown as string[] } })],
      xpLog: doneXp(),
    })
    expect(validateStore(s).join()).toMatch(/skippedDod/)
  })
  it('resultHistory с валидными записями — валиден при любом статусе не-repeating', () => {
    const s = base({
      quests: [quest({ resultHistory: [{ summary: 'Первая', cancelledAt: 'T2' }] })],
    })
    expect(validateStore(s)).toEqual([])
  })
  it('resultHistory: запись без cancelledAt — ошибка', () => {
    const s = base({
      quests: [quest({ resultHistory: [{ summary: 'x' } as unknown as { summary: string; cancelledAt: string }] })],
    })
    expect(validateStore(s).join()).toMatch(/cancelledAt/)
  })
  it('resultHistory: запись с пустым summary — ошибка', () => {
    const s = base({
      quests: [quest({ resultHistory: [{ summary: ' ', cancelledAt: 'T2' }] })],
    })
    expect(validateStore(s).join()).toMatch(/resultHistory/)
  })
  it('resultHistory у repeating — ошибка', () => {
    const s = base({
      quests: [quest({ type: 'repeating', resultHistory: [{ summary: 'x', cancelledAt: 'T2' }] })],
    })
    expect(validateStore(s).join()).toMatch(/repeating/)
  })
})

describe('подквесты (parentQuestId)', () => {
  const subqStore = (quests: Quest[]): Store => ({
    version: 3,
    character: { name: 'И', avatar: 'X' },
    skills: [{ id: 's1', emoji: '✨', name: 'Н', wantStatement: '', hue: 200, archived: false, createdAt: 'T0' }],
    stars: [],
    quests,
    xpLog: [],
  })
  const mq = (id: string, over: Partial<Quest> = {}): Quest => ({
    id, title: 'К', type: 'mid', skillId: 's1', xpReward: 10, status: 'active', createdAt: 'T0', ...over,
  })

  it('эпик + ребёнок — валидно', () => {
    expect(validateStore(subqStore([mq('p'), mq('c', { parentQuestId: 'p' })]))).toEqual([])
  })
  it('parentQuestId: null — валидно (эквивалент отсутствия)', () => {
    expect(validateStore(subqStore([mq('a', { parentQuestId: null })]))).toEqual([])
  })
  it('битый parentQuestId (родителя нет) — ошибка', () => {
    expect(validateStore(subqStore([mq('c', { parentQuestId: 'нет' })]))).toEqual([
      expect.stringContaining('parentQuestId'),
    ])
  })
  it('parentQuestId не строка — ошибка', () => {
    expect(
      validateStore(subqStore([mq('c', { parentQuestId: 7 as unknown as string })])),
    ).toEqual([expect.stringContaining('parentQuestId')])
  })
  it('сам себе родитель — ошибка', () => {
    expect(validateStore(subqStore([mq('a', { parentQuestId: 'a' })]))).toEqual([
      expect.stringContaining('сам на себя'),
    ])
  })
  it('внук (два уровня) — ошибка', () => {
    const s = subqStore([mq('a'), mq('b', { parentQuestId: 'a' }), mq('c', { parentQuestId: 'b' })])
    expect(validateStore(s)).toEqual([expect.stringContaining('второй уровень')])
  })
  it('repeating-родитель — ошибка; repeating-ребёнок — ошибка', () => {
    expect(validateStore(subqStore([mq('p', { type: 'repeating' }), mq('c', { parentQuestId: 'p' })])))
      .toEqual([expect.stringContaining('repeating')])
    expect(validateStore(subqStore([mq('p'), mq('c', { type: 'repeating', parentQuestId: 'p' })])))
      .toEqual([expect.stringContaining('repeating')])
  })
  it('родитель done + ребёнок active — валидно (легаси после uncomplete)', () => {
    const s = subqStore([mq('p', { status: 'done', result: { summary: 'итог' } }), mq('c', { parentQuestId: 'p' })])
    expect(validateStore(s)).toEqual([])
  })
  it('ребёнок archived-родителя — валидно', () => {
    expect(validateStore(subqStore([mq('p', { status: 'archived' }), mq('c', { parentQuestId: 'p' })]))).toEqual([])
  })
  it('result.skippedQuestIds — массив строк; иначе ошибка', () => {
    const ok = subqStore([
      mq('p', { status: 'done', result: { summary: 'итог', skippedQuestIds: ['c'] } }),
      mq('c', { parentQuestId: 'p' }),
    ])
    expect(validateStore(ok)).toEqual([])
    const bad = subqStore([
      mq('p', { status: 'done', result: { summary: 'итог', skippedQuestIds: [1] as unknown as string[] } }),
    ])
    expect(validateStore(bad)).toEqual([expect.stringContaining('skippedQuestIds')])
  })
})

describe('валидация экономики искр', () => {
  const mk = (): Store => ({
    version: 3, character: { name: 'И', avatar: '🧙' },
    skills: [{ id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: '2026-09-01T00:00:00.000Z' }],
    stars: [{ id: 'st1', skillId: 's1', parentStarId: null, tier: 'S', title: 'Звезда', createdAt: '2026-09-01T00:00:00.000Z' }],
    xpLog: [],
    quests: [{ id: 'q1', title: 'К', type: 'short', skillId: 's1', xpReward: 100, dueDate: '2026-09-20', status: 'active', createdAt: '2026-09-01T00:00:00.000Z' }],
    ledger: [], wishlist: [],
  })
  const errsOf = (patch: (s: Store) => void): string[] => {
    const s = mk()
    patch(s)
    return validateStore(s)
  }
  const E = (day: string, over: object) => ({ id: `l_${Math.random().toString(36).slice(2)}`, ts: `${day}T05:00:00.000Z`, day, ...over })

  it('легаси: store без ledger/wishlist валиден', () => {
    const s = mk()
    delete (s as Partial<Store>).ledger
    delete (s as Partial<Store>).wishlist
    expect(validateStore(s)).toEqual([])
  })
  it('валидный экономический store проходит', () => {
    const s = mk()
    s.wishlist = [
      { id: 'w1', title: 'Массаж', kind: 'small', price: 80, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'w2', title: 'iPhone', kind: 'big', starId: 'st1', createdAt: '2026-09-01T00:00:00.000Z' },
    ]
    s.ledger = [
      { id: 'l1', ts: '2026-09-10T05:00:00.000Z', day: '2026-09-10', kind: 'earn', amount: 100, questId: 'q1', opId: 'op1' },
      { id: 'l2', ts: '2026-09-10T05:00:00.000Z', day: '2026-09-10', kind: 'drain', amount: -20, questId: 'q1', opId: 'op1' },
      { id: 'l3', ts: '2026-09-11T05:00:00.000Z', day: '2026-09-11', kind: 'reversal', amount: -100, questId: 'q1', reversesId: 'l1' },
      { id: 'l4', ts: '2026-09-11T05:00:00.000Z', day: '2026-09-11', kind: 'spend', amount: -80, itemId: 'w1', note: 'Массаж' },
      { id: 'l5', ts: '2026-09-11T05:00:00.000Z', day: '2026-09-11', kind: 'adjust', amount: 5, note: 'причина' },
    ]
    s.quests[0].dueDateHistory = [
      { from: '2026-09-15', to: '2026-09-18', day: '2026-09-14', ts: '2026-09-14T05:00:00.000Z' },
      { from: '2026-09-18', to: '2026-09-20', day: '2026-09-15', ts: '2026-09-15T05:00:00.000Z', fee: 10 },
    ]
    s.quests[0].acceptedAt = '2026-09-01T00:00:00.000Z'
    expect(validateStore(s)).toEqual([])
  })
  it('ledger: неизвестный kind, нулевой amount, знак не по kind', () => {
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'magic', amount: 5 }) as never] }).join(' ')).toContain('kind')
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'adjust', amount: 0, note: 'x' }) as never] }).join(' ')).toContain('amount')
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'earn', amount: -5, questId: 'q1' }) as never] }).join(' ')).toContain('earn')
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'spend', amount: 5, note: 'x' }) as never] }).join(' ')).toContain('spend')
  })
  it('ledger: битые ссылки questId/itemId', () => {
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'earn', amount: 5, questId: 'нет' }) as never] }).join(' ')).toContain('questId')
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'spend', amount: -5, itemId: 'нет' }) as never] }).join(' ')).toContain('itemId')
  })
  it('ledger: adjust и spend-без-itemId требуют note', () => {
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'adjust', amount: 5 }) as never] }).join(' ')).toContain('note')
    expect(errsOf((s) => { s.ledger = [E('2026-09-10', { kind: 'spend', amount: -5 }) as never] }).join(' ')).toContain('note')
  })
  it('ledger: правила reversal', () => {
    const earn = { id: 'l1', ts: '2026-09-10T05:00:00.000Z', day: '2026-09-10', kind: 'earn' as const, amount: 100, questId: 'q1' }
    // amount ≠ −цели
    expect(errsOf((s) => {
      s.ledger = [earn, E('2026-09-11', { kind: 'reversal', amount: -50, reversesId: 'l1' }) as never]
    }).join(' ')).toContain('reversal')
    // ссылка вперёд
    expect(errsOf((s) => {
      s.ledger = [E('2026-09-09', { kind: 'reversal', amount: -100, reversesId: 'l1' }) as never, earn]
    }).join(' ')).toContain('reversal')
    // второй reversal на ту же цель
    expect(errsOf((s) => {
      s.ledger = [earn,
        E('2026-09-11', { kind: 'reversal', amount: -100, reversesId: 'l1' }) as never,
        E('2026-09-12', { kind: 'reversal', amount: -100, reversesId: 'l1' }) as never]
    }).join(' ')).toContain('второй reversal')
  })
  it('wishlist: цена small — safe integer, граница та же, что у сумм ledger', () => {
    const w = (price: number) => ({ id: 'w1', title: 'Т', kind: 'small' as const, price, createdAt: 'x' })
    expect(errsOf((s) => { s.wishlist = [w(2 ** 53) as never] }).join(' ')).toContain('цена')
    expect(errsOf((s) => { s.wishlist = [w(2 ** 53 - 1) as never] })).toEqual([])
  })

  it('wishlist: дисциплина small/big и уникальность звезды-якоря', () => {
    const w = (over: object) => ({ id: `w_${Math.random().toString(36).slice(2)}`, title: 'Т', createdAt: 'x', ...over })
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', price: 0 }) as never] }).join(' ')).toContain('цена')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', price: 5, starId: 'st1' }) as never] }).join(' ')).toContain('small')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big', starId: 'st1', price: 5 }) as never] }).join(' ')).toContain('big')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big', starId: 'нет' }) as never] }).join(' ')).toContain('starId')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big' }) as never] }).join(' ')).toContain('starId')
    expect(errsOf((s) => {
      s.wishlist = [w({ kind: 'big', starId: 'st1' }) as never, w({ kind: 'big', starId: 'st1' }) as never]
    }).join(' ')).toContain('дубль')
    // archived big выпадает из проверки уникальности
    expect(errsOf((s) => {
      s.wishlist = [w({ kind: 'big', starId: 'st1', archived: true }) as never, w({ kind: 'big', starId: 'st1' }) as never]
    })).toEqual([])
  })
  it('wishlist: small без цены валиден; справочные поля — непустые строки', () => {
    const w = (over: object) => ({ id: `w_${Math.random().toString(36).slice(2)}`, title: 'Т', createdAt: 'x', ...over })
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small' }) as never] })).toEqual([])
    expect(errsOf((s) => {
      s.wishlist = [w({ kind: 'small', sourceUrl: 'https://x.example', originalPrice: '2800 ฿' }) as never]
    })).toEqual([])
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', sourceUrl: ' ' }) as never] }).join(' ')).toContain('sourceUrl')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', originalPrice: 7 }) as never] }).join(' ')).toContain('originalPrice')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big', starId: 'st1', originalPrice: '' }) as never] }).join(' ')).toContain('originalPrice')
  })
  it('wishlist: emoji и imageUrl — непустые строки, emoji ≤ 16 юнитов', () => {
    const w = (over: object) => ({ id: `w_${Math.random().toString(36).slice(2)}`, title: 'Т', createdAt: 'x', ...over })
    expect(errsOf((s) => {
      s.wishlist = [w({ kind: 'small', emoji: '🛋️', imageUrl: 'https://x.example/sofa.jpg' }) as never]
    })).toEqual([])
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', emoji: ' ' }) as never] }).join(' ')).toContain('emoji')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', emoji: '🛋️'.repeat(6) }) as never] }).join(' ')).toContain('emoji')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', emoji: 7 }) as never] }).join(' ')).toContain('emoji')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big', starId: 'st1', imageUrl: '' }) as never] }).join(' ')).toContain('imageUrl')
  })
  it('wishlist: repeatable — boolean и только у small', () => {
    const w = (over: object) => ({ id: `w_${Math.random().toString(36).slice(2)}`, title: 'Т', createdAt: 'x', ...over })
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', repeatable: true }) as never] })).toEqual([])
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'small', repeatable: 1 }) as never] }).join(' ')).toContain('repeatable')
    expect(errsOf((s) => { s.wishlist = [w({ kind: 'big', starId: 'st1', repeatable: true }) as never] }).join(' ')).toContain('repeatable')
  })
  it('dueDateHistory: рваная цепочка и расхождение с dueDate', () => {
    expect(errsOf((s) => {
      s.quests[0].dueDateHistory = [
        { from: '2026-09-15', to: '2026-09-18', day: '2026-09-14', ts: 'x' },
        { from: '2026-09-17', to: '2026-09-20', day: '2026-09-15', ts: 'x' },
      ]
    }).join(' ')).toContain('разорвана')
    expect(errsOf((s) => {
      s.quests[0].dueDateHistory = [{ from: '2026-09-15', to: '2026-09-19', day: '2026-09-14', ts: 'x' }]
    }).join(' ')).toContain('dueDate')
  })
  it('календарность дат и потолок xpReward', () => {
    expect(errsOf((s) => { s.quests[0].dueDate = '2026-99-99' }).length).toBeGreaterThan(0)
    expect(errsOf((s) => { s.quests[0].xpReward = 1001 }).join(' ')).toContain('xpReward')
  })
  it('фикс: result у archived-квеста валиден, у active — по-прежнему нет', () => {
    expect(errsOf((s) => {
      s.quests[0].status = 'archived'
      s.quests[0].result = { summary: 'сделано' }
    })).toEqual([])
    expect(errsOf((s) => { s.quests[0].result = { summary: 'сделано' } }).join(' ')).toContain('result')
  })
})
