import { describe, expect, it } from 'vitest'
import type { Quest, Store } from '../types'
import { actionShapeError, completeQuestRefusal, storeChanged } from './gates'
import { ACTION_TYPES, reducer, type Action } from './store'

const TS = '2026-10-30T05:00:00.000Z' // игровой день 2026-10-30 (UTC+7)
const DAY = '2026-10-30'

const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({
  id, title: `Квест ${id}`, type: 'short', skillId: 's1', xpReward: 40, status: 'active', createdAt: TS, ...extra,
})
const base = (quests: Quest[] = []): Store => ({
  version: 4,
  character: { name: 'И', avatar: '🧙' },
  skills: [{ id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: TS }],
  stars: [{ id: 'c1', skillId: 's1', parentStarId: null, tier: 'D', title: 'Звезда', createdAt: TS }],
  quests,
  xpLog: [],
})

describe('actionShapeError: валидная форма', () => {
  // по образцу на каждый тип union: таблица форм не должна отвергать ни одно честное действие
  const valid: Action[] = [
    { type: 'completeQuest', questId: 'q1', day: DAY, ts: TS, result: { summary: 'итог' }, force: true },
    { type: 'uncompleteQuest', questId: 'q1', day: DAY, ts: TS },
    { type: 'addQuest', quest: quest('q1') },
    { type: 'updateQuest', quest: quest('q1') },
    { type: 'archiveQuest', questId: 'q1', day: DAY, ts: TS },
    { type: 'proposeQuest', quest: quest('q1', { status: 'proposed' }) },
    { type: 'acceptQuest', questId: 'q1', ts: TS },
    { type: 'rejectQuest', questId: 'q1' },
    { type: 'addSkill', skill: base().skills[0] },
    { type: 'updateSkill', skill: base().skills[0] },
    { type: 'archiveSkill', skillId: 's1' },
    { type: 'addStar', star: base().stars[0] },
    { type: 'updateStar', star: base().stars[0] },
    { type: 'removeStar', starId: 'c1' },
    { type: 'lightStar', starId: 'c1', ts: TS, evidence: 'сделал' },
    { type: 'unlightStar', starId: 'c1' },
    { type: 'setCharacter', character: { name: 'И', avatar: '🧙' } },
    { type: 'importStore', store: base() },
    { type: 'resetToSeed' },
    { type: 'moveDueDate', questId: 'q1', to: '2026-11-05', day: DAY, ts: TS },
    { type: 'addWishlistItem', item: { id: 'w1', title: 'Массаж', kind: 'small', price: 80, createdAt: TS } },
    { type: 'updateWishlistItem', item: { id: 'w1', title: 'Массаж', kind: 'small', price: 90, createdAt: TS } },
    { type: 'archiveWishlistItem', itemId: 'w1' },
    { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS, opId: 'op1' },
    { type: 'spendSparks', amount: 10, note: 'кофе', day: DAY, ts: TS, opId: 'op2' },
    { type: 'claimReward', itemId: 'w2', ts: TS },
    { type: 'adjustSparks', amount: -5, note: 'поправка', day: DAY, ts: TS },
    { type: 'setGameTz', offsetMin: 300 },
  ]

  it('образцы покрывают все типы действий', () => {
    expect(new Set(valid.map((a) => a.type))).toEqual(new Set(ACTION_TYPES))
  })

  it.each(valid.map((a) => [a.type, a] as const))('%s проходит', (_t, a) => {
    expect(actionShapeError(JSON.parse(JSON.stringify(a)))).toBeNull()
  })

  it('необязательные поля можно опустить', () => {
    expect(actionShapeError({ type: 'completeQuest', questId: 'q1', day: DAY, ts: TS })).toBeNull()
    expect(actionShapeError({ type: 'lightStar', starId: 'c1', ts: TS })).toBeNull()
    expect(actionShapeError({ type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS })).toBeNull()
  })

  // мусорный ts по форме — строка: отказ по нему — дело гейтов и validateStore (422)
  it('ts — любая строка, формат времени не проверяется', () => {
    expect(actionShapeError({ type: 'purchaseItem', itemId: 'w1', day: DAY, ts: '' })).toBeNull()
  })
})

describe('actionShapeError: отказы', () => {
  it('не объект', () => {
    for (const x of [null, 'completeQuest', 42, [], undefined])
      expect(actionShapeError(x), JSON.stringify(x)).toMatch(/ожидается объект действия/)
  })

  it('нет type / неизвестный type', () => {
    expect(actionShapeError({ questId: 'q1' })).toBe('нет поля type')
    expect(actionShapeError({ type: 'взлом' })).toBe('неизвестное действие «взлом»')
    expect(actionShapeError({ type: 7 })).toBe('неизвестное действие «7»')
    // имя из прототипа — не тип действия
    expect(actionShapeError({ type: 'toString' })).toBe('неизвестное действие «toString»')
  })

  it('нет обязательного поля', () => {
    expect(actionShapeError({ type: 'completeQuest', questId: 'q1', day: DAY })).toBe('completeQuest: нет поля ts')
    expect(actionShapeError({ type: 'spendSparks', amount: 5, day: DAY, ts: TS })).toBe('spendSparks: нет поля note')
    expect(actionShapeError({ type: 'addQuest' })).toBe('addQuest: нет поля quest')
  })

  it('id вместо questId/skillId/starId/itemId — подсказка с верным именем', () => {
    expect(actionShapeError({ type: 'completeQuest', id: 'q1', day: DAY, ts: TS, result: { summary: 'итог' } }))
      .toBe('completeQuest: поле называется questId, не id')
    expect(actionShapeError({ type: 'archiveSkill', id: 's1' })).toBe('archiveSkill: поле называется skillId, не id')
    expect(actionShapeError({ type: 'lightStar', id: 'c1', ts: TS })).toBe('lightStar: поле называется starId, не id')
    expect(actionShapeError({ type: 'purchaseItem', id: 'w1', day: DAY, ts: TS })).toBe('purchaseItem: поле называется itemId, не id')
  })

  it('id рядом с верным полем — не ошибка формы', () => {
    expect(actionShapeError({ type: 'rejectQuest', questId: 'q1', id: 'q1' })).toBeNull()
  })

  it('строковые поля', () => {
    expect(actionShapeError({ type: 'rejectQuest', questId: 5 })).toBe('rejectQuest: questId — ожидается строка-id')
    expect(actionShapeError({ type: 'acceptQuest', questId: 'q1', ts: 1730000000 })).toBe('acceptQuest: ts — ожидается строка ISO-времени')
    expect(actionShapeError({ type: 'spendSparks', amount: 5, note: 5, day: DAY, ts: TS })).toBe('spendSparks: note — ожидается строка')
  })

  it('day и to — календарный день YYYY-MM-DD', () => {
    for (const day of ['2026-7-1', '2026-02-30', '30.10.2026', `${DAY}T00:00`, 20261030])
      expect(actionShapeError({ type: 'completeQuest', questId: 'q1', day, ts: TS }), String(day))
        .toBe('completeQuest: day — ожидается день YYYY-MM-DD')
    expect(actionShapeError({ type: 'moveDueDate', questId: 'q1', to: 'завтра', day: DAY, ts: TS }))
      .toBe('moveDueDate: to — ожидается день YYYY-MM-DD')
  })

  it('объекты: null и массив — не объект', () => {
    expect(actionShapeError({ type: 'addQuest', quest: null })).toBe('addQuest: quest — ожидается объект')
    expect(actionShapeError({ type: 'importStore', store: [] })).toBe('importStore: store — ожидается объект')
    expect(actionShapeError({ type: 'setCharacter', character: 'И' })).toBe('setCharacter: character — ожидается объект')
  })

  it('число', () => {
    expect(actionShapeError({ type: 'adjustSparks', amount: '5', note: 'н', day: DAY, ts: TS })).toBe('adjustSparks: amount — ожидается число')
  })

  it('необязательное поле, если есть, — своего типа (null не «нет поля»)', () => {
    const c = { type: 'completeQuest', questId: 'q1', day: DAY, ts: TS }
    expect(actionShapeError({ ...c, result: 'готово' })).toBe('completeQuest: result — ожидается объект')
    expect(actionShapeError({ ...c, force: 'yes' })).toBe('completeQuest: force — ожидается true или false')
    expect(actionShapeError({ type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS, opId: 7 })).toBe('purchaseItem: opId — ожидается строка')
    expect(actionShapeError({ type: 'lightStar', starId: 'c1', ts: TS, evidence: null })).toBe('lightStar: evidence — ожидается строка')
  })
})

describe('completeQuestRefusal', () => {
  const complete = (extra: Partial<Extract<Action, { type: 'completeQuest' }>> = {}): Extract<Action, { type: 'completeQuest' }> =>
    ({ type: 'completeQuest', questId: 'q1', day: DAY, ts: TS, result: { summary: 'итог' }, ...extra })

  /** Отказ обязан совпадать с no-op редьюсера: иначе 422 соврал бы о действии, которое прошло бы. */
  const refused = (s: Store, a: Extract<Action, { type: 'completeQuest' }>) => {
    const r = completeQuestRefusal(s, a)
    expect(r).not.toBeNull()
    expect(reducer(s, a)).toBe(s)
    return r!
  }

  it('контракт без итога → «нужен итог: result.summary»', () => {
    const s = base([quest('q1')])
    expect(refused(s, complete({ result: undefined })).error).toBe('нужен итог: result.summary')
    expect(refused(s, complete({ result: { summary: '   ' } })).error).toBe('нужен итог: result.summary')
    // force итог не заменяет
    expect(refused(s, complete({ result: undefined, force: true })).error).toBe('нужен итог: result.summary')
  })

  // result без строкового summary редьюсер не переваривает (.trim() на не-строке) —
  // поэтому отказ обязан случиться раньше, на границе
  it('result без строкового summary → тот же отказ', () => {
    const s = base([quest('q1')])
    for (const result of [{}, { summary: 5 }, { text: 'итог' }])
      expect(completeQuestRefusal(s, complete({ result: result as never }))?.error).toBe('нужен итог: result.summary')
  })

  it('открытый DoD без force → перечень незакрытых пунктов', () => {
    const s = base([quest('q1', { definitionOfDone: [{ text: 'А', done: true }, { text: 'Б' }, { text: 'В', done: false }] })])
    const r = refused(s, complete())
    expect(r.error).toMatch(/DoD/)
    expect(r.dod).toEqual(['Б', 'В'])
    expect(completeQuestRefusal(s, complete({ force: true }))).toBeNull()
  })

  it('эпик с активными подквестами без force → перечень детей', () => {
    const s = base([quest('q1'), quest('q2', { parentQuestId: 'q1' }), quest('q3', { parentQuestId: 'q1', status: 'done' })])
    const r = refused(s, complete())
    expect(r.error).toBe('эпик «Квест q1» не завершён: активные подквесты')
    expect(r.children).toEqual([{ id: 'q2', title: 'Квест q2' }])
    expect(completeQuestRefusal(s, complete({ force: true }))).toBeNull()
  })

  it('порядок — как в редьюсере: итог → DoD → подквесты', () => {
    const s = base([quest('q1', { definitionOfDone: [{ text: 'Б' }] }), quest('q2', { parentQuestId: 'q1' })])
    expect(completeQuestRefusal(s, complete({ result: undefined }))?.error).toBe('нужен итог: result.summary')
    expect(completeQuestRefusal(s, complete())?.dod).toEqual(['Б'])
  })

  it('привычка с day позже игрового дня ts → «отметка наперёд»', () => {
    const s = base([quest('h1', { type: 'repeating' })])
    const r = refused(s, complete({ questId: 'h1', day: '2026-10-31', result: undefined }))
    expect(r.error).toMatch(/^отметка наперёд/)
    expect(r.error).toContain('2026-10-31')
  })

  it('отметка наперёд считается по игровому поясу, а не по UTC-дате ts', () => {
    const s = base([quest('h1', { type: 'repeating' })])
    // 20:00 UTC 30-го — уже 31-е в UTC+7: 31-е не наперёд, 1-е — наперёд
    const late = '2026-10-30T20:00:00.000Z'
    expect(completeQuestRefusal(s, complete({ questId: 'h1', day: '2026-10-31', ts: late }))).toBeNull()
    expect(completeQuestRefusal(s, complete({ questId: 'h1', day: '2026-11-01', ts: late }))?.error).toMatch(/наперёд/)
  })

  it('привычка за сегодня и за прошлое, ts без дня — не отказ (как в редьюсере)', () => {
    const s = base([quest('h1', { type: 'repeating' })])
    expect(completeQuestRefusal(s, complete({ questId: 'h1' }))).toBeNull()
    expect(completeQuestRefusal(s, complete({ questId: 'h1', day: '2026-10-01' }))).toBeNull()
    expect(completeQuestRefusal(s, complete({ questId: 'h1', day: '2026-10-31', ts: 'T1' }))).toBeNull()
  })

  it('идемпотентные и тихие no-op — не отказ', () => {
    const s = base([
      quest('done', { status: 'done', result: { summary: 'было' } }),
      quest('arch', { status: 'archived' }),
      quest('prop', { status: 'proposed' }),
    ])
    for (const questId of ['done', 'arch', 'prop', 'нет-такого']) {
      const a = complete({ questId, result: undefined })
      expect(completeQuestRefusal(s, a), questId).toBeNull()
      expect(reducer(s, a), questId).toBe(s)
    }
    // вторая отметка привычки за тот же день
    const marked = reducer(base([quest('h1', { type: 'repeating' })]), complete({ questId: 'h1' }))
    expect(completeQuestRefusal(marked, complete({ questId: 'h1' }))).toBeNull()
    expect(reducer(marked, complete({ questId: 'h1' }))).toBe(marked)
  })

  it('годная сдача — не отказ, редьюсер её применяет', () => {
    const s = base([quest('q1', { definitionOfDone: [{ text: 'А', done: true }] })])
    expect(completeQuestRefusal(s, complete())).toBeNull()
    expect(reducer(s, complete()).quests[0].status).toBe('done')
  })
})

describe('storeChanged', () => {
  it('тот же объект — не изменён', () => {
    const s = base()
    expect(storeChanged(s, s)).toBe(false)
  })

  it('применённое действие — изменён', () => {
    const s = base([quest('q1')])
    expect(storeChanged(s, reducer(s, { type: 'completeQuest', questId: 'q1', day: DAY, ts: TS, result: { summary: 'итог' } }))).toBe(true)
    expect(storeChanged(s, reducer(s, { type: 'archiveSkill', skillId: 's1' }))).toBe(false) // активный контракт держит архив
    const free = base()
    expect(storeChanged(free, reducer(free, { type: 'archiveSkill', skillId: 's1' }))).toBe(true)
  })

  // ветки, которые пересобирают store и на no-op: новая ссылка, то же содержимое
  it('пересобранный, но тот же store — не изменён', () => {
    const s = base()
    const cases: Action[] = [
      { type: 'updateSkill', skill: { ...s.skills[0], id: 'нет-такого' } },
      { type: 'unlightStar', starId: 'c1' }, // не зажжена: litAt/evidence = undefined
      { type: 'archiveSkill', skillId: 'нет-такого' },
      { type: 'setCharacter', character: { name: 'И', avatar: '🧙' } },
    ]
    for (const a of cases) {
      const next = reducer(s, a)
      expect(next, a.type).not.toBe(s)
      expect(storeChanged(s, next), a.type).toBe(false)
    }
  })
})
