import { describe, expect, it } from 'vitest'
import type { LedgerEvent, Quest, QuestDueDateMove, Store, WishlistItem } from '../types'
import { addDays } from './dates'
import { emissionInDays, provisionForQuest, purchasedDays, sparksBalance } from './sparks'
import { reducer, type Action } from './store'
import { validateStore } from './validate'

/** ts, чей игровой день (UTC+7) совпадает с day: полдень Бангкока. */
export const tsAt = (day: string) => `${day}T05:00:00.000Z`
export const DUE = '2026-09-10' // все даты — после SPARKS_EPOCH

export function mkQuest(over: Partial<Quest> = {}): Quest {
  return {
    id: 'q1', title: 'Контракт', type: 'short', skillId: null, xpReward: 100,
    dueDate: DUE, status: 'active', createdAt: tsAt('2026-09-01'), ...over,
  }
}

export function mkStore(over: Partial<Store> = {}): Store {
  return {
    version: 3, character: { name: 'Тест', avatar: '🧙' },
    skills: [], stars: [], quests: [mkQuest()], xpLog: [], ...over,
  }
}

export const seedSparks = (amount: number, day = DUE): LedgerEvent =>
  ({ id: `seed_${day}_${amount}`, ts: tsAt(day), day, kind: 'adjust', amount, note: 'сид теста' })

export function complete(
  store: Store, day: string,
  extra: Partial<Extract<Action, { type: 'completeQuest' }>> = {},
): Store {
  return reducer(store, {
    type: 'completeQuest', questId: 'q1', day, ts: tsAt(day),
    result: { summary: 'сделано' }, ...extra,
  })
}

describe('экономика: completeQuest', () => {
  it('сдача в срок: earn +R', () => {
    const s = complete(mkStore(), DUE)
    expect(s.ledger).toHaveLength(1)
    expect(s.ledger![0]).toMatchObject({ kind: 'earn', amount: 100, questId: 'q1', day: DUE })
  })
  it('сдача с просрочкой d=2: earn +R и drain −20 с общим opId', () => {
    const day = addDays(DUE, 2)
    const s = complete(mkStore(), day)
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['earn', 100], ['drain', -20]])
    expect(s.ledger![0].opId).toBeDefined()
    expect(s.ledger![0].opId).toBe(s.ledger![1].opId)
  })
  it('сдача улучшает баланс ровно на R в любой день', () => {
    for (const d of [0, 1, 5, 10, 12]) {
      const day = addDays(DUE, d)
      const before = mkStore()
      const after = complete(before, day)
      expect(sparksBalance(after, day) - sparksBalance(before, day)).toBe(100)
    }
  })
  it('force-сдача: XP полный, earn нет, drain есть → баланс улучшается на 0', () => {
    const day = addDays(DUE, 3)
    const before = mkStore({ quests: [mkQuest({ definitionOfDone: [{ text: 'пункт' }] })] })
    const after = complete(before, day, { force: true })
    expect(after.xpLog).toHaveLength(1)
    expect(after.xpLog[0].amount).toBe(100)
    expect(after.ledger!.map((e) => e.kind)).toEqual(['drain'])
    expect(sparksBalance(after, day) - sparksBalance(before, day)).toBe(0)
  })
  it('анти-бэкфилл repeating: сегодня/вчера платят, позавчера/завтра — только XP', () => {
    const q = mkQuest({ type: 'repeating', dueDate: undefined })
    const today = '2026-09-10'
    const cases: [string, boolean][] = [
      [today, true], [addDays(today, -1), true],
      [addDays(today, -2), false], [addDays(today, 1), false],
    ]
    for (const [day, paid] of cases) {
      const s = reducer(mkStore({ quests: [q] }), { type: 'completeQuest', questId: 'q1', day, ts: tsAt(today) })
      expect(s.xpLog, day).toHaveLength(1)
      expect(s.ledger ?? [], day).toHaveLength(paid ? 1 : 0)
    }
  })
  it('контрактный бэкфилл не уменьшает долг: провизия по игровому дню ts', () => {
    // сдаём «за D+1», хотя на часах D+6 → окно не пройдено → drain по D+6
    const s = complete(mkStore(), addDays(DUE, 1), { ts: tsAt(addDays(DUE, 6)) })
    expect(s.ledger!.find((e) => e.kind === 'drain')!.amount).toBe(-60)
  })
  it('мусорный ts не прощает долг: сдача просроченного — no-op, а не earn без drain', () => {
    // тот же вход, что у покупки: провизия NaN, `NaN > 0` ложно → drain не пишется,
    // и просроченный на потолок контракт заплатил бы полный R. Долг невычислим — сдачи нет
    const s0 = mkStore()
    const s = reducer(s0, { type: 'completeQuest', questId: 'q1', day: addDays(DUE, 10), ts: '', result: { summary: 'итог' } })
    expect(s).toBe(s0)
    // с честным ts тот же день сдаётся и платит R за вычетом потолка капания
    const ok = complete(s0, addDays(DUE, 10))
    expect(ok.ledger!.map((e) => [e.kind, e.amount])).toEqual([['earn', 100], ['drain', -100]])
  })
  it('существующие гейты дают побитовый no-op', () => {
    const s0 = mkStore()
    expect(reducer(s0, { type: 'completeQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })).toBe(s0) // без result
  })
})

describe('экономика: uncompleteQuest', () => {
  it('цикл сдал D+2 → откат D+5 → пересдал D+5 = прямой сдаче в D+5', () => {
    const d2 = addDays(DUE, 2)
    const d5 = addDays(DUE, 5)
    let s = complete(mkStore(), d2) // +100, −20
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: d5, ts: tsAt(d5) })
    expect(s.ledger!.map((e) => e.kind)).toEqual(['earn', 'drain', 'reversal', 'reversal'])
    expect(s.quests[0].status).toBe('active')
    expect(sparksBalance(s, d5)).toBe(-50) // провизия d=5 возобновилась
    s = complete(s, d5) // +100, −50
    const direct = complete(mkStore(), d5)
    expect(sparksBalance(s, d5)).toBe(50)
    expect(sparksBalance(s, d5)).toBe(sparksBalance(direct, d5))
  })
  it('reversal разворачивает только связку последней сдачи; чужой drain не трогается', () => {
    const d3 = addDays(DUE, 3)
    const d4 = addDays(DUE, 4)
    // drain без opId — фиксация переноса (moveDueDate из задачи 6 пишет такие)
    const moveDrain: LedgerEvent = { id: 'l_move', ts: tsAt(d3), day: d3, kind: 'drain', amount: -30, questId: 'q1' }
    let s = complete(mkStore({ ledger: [moveDrain] }), d4) // + earn/drain сдачи
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: d4, ts: tsAt(d4) })
    const reversals = s.ledger!.filter((e) => e.kind === 'reversal')
    expect(reversals).toHaveLength(2)
    expect(reversals.some((e) => e.reversesId === 'l_move')).toBe(false)
  })
  it('повторный uncomplete не плодит reversal (XP-гейт уже отработал)', () => {
    let s = complete(mkStore(), DUE)
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
    const twice = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
    expect(twice).toBe(s)
  })
  it('откат repeating: разворачивает earn этого дня; бэкфилл-отметка — только XP', () => {
    const q = mkQuest({ type: 'repeating', dueDate: undefined })
    const today = '2026-09-10'
    let s = reducer(mkStore({ quests: [q] }), { type: 'completeQuest', questId: 'q1', day: today, ts: tsAt(today) })
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: today, ts: tsAt(today) })
    expect(s.ledger!.map((e) => e.kind)).toEqual(['earn', 'reversal'])
    expect(s.ledger![1]).toMatchObject({ amount: -100, reversesId: s.ledger![0].id })

    const backDay = addDays(today, -2)
    let s2 = reducer(mkStore({ quests: [q] }), { type: 'completeQuest', questId: 'q1', day: backDay, ts: tsAt(today) })
    s2 = reducer(s2, { type: 'uncompleteQuest', questId: 'q1', day: backDay, ts: tsAt(today) })
    expect(s2.ledger ?? []).toHaveLength(0)
    expect(s2.xpLog).toHaveLength(2) // +100 / −100
  })
  it('доэкономический done-квест откатывается без reversal', () => {
    // сдача была до экономики: XP есть, ledger пуст
    const done = mkQuest({ status: 'done', result: { summary: 'сделан до экономики' } })
    const s0 = mkStore({
      quests: [done],
      xpLog: [{ id: 'e1', ts: tsAt('2026-09-05'), day: '2026-09-05', questId: 'q1', skillId: null, amount: 100 }],
    })
    const s = reducer(s0, { type: 'uncompleteQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
    expect(s.quests[0].status).toBe('active')
    expect(s.ledger ?? []).toHaveLength(0)
  })
})

describe('экономика: moveDueDate', () => {
  const move = (s: Store, to: string, day: string): Store =>
    reducer(s, { type: 'moveDueDate', questId: 'q1', to, day, ts: tsAt(day) })

  it('перенос просроченного фиксирует долг и переписывает dueDate', () => {
    const day = addDays(DUE, 2)
    const s = move(mkStore(), addDays(DUE, 10), day)
    expect(s.quests[0].dueDate).toBe(addDays(DUE, 10))
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['drain', -20]])
    expect(s.quests[0].dueDateHistory).toEqual([
      { from: DUE, to: addDays(DUE, 10), day, ts: tsAt(day) },
    ])
    expect(provisionForQuest(s.quests[0], day)).toBe(0) // отсчёт с новой даты заново
  })
  it('3 переноса бесплатны, 4-й платный −ceil(R/10) и попадает в history.fee', () => {
    const day = addDays(DUE, -1) // без просрочки, чтобы не мешал drain
    let s = mkStore()
    for (const n of [1, 2, 3]) s = move(s, addDays(DUE, n), day)
    expect(s.ledger ?? []).toHaveLength(0)
    s = move(s, addDays(DUE, 4), day)
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['moveFee', -10]])
    expect(s.quests[0].dueDateHistory![3].fee).toBe(10)
  })
  it('квота общая на все квесты', () => {
    const day = addDays(DUE, -1)
    const hist = (d: string): QuestDueDateMove => ({ from: DUE, to: addDays(DUE, 1), day: d, ts: tsAt(d) })
    const other = mkQuest({ id: 'q2', dueDate: addDays(DUE, 1), dueDateHistory: [hist(day), hist(day), hist(day)] })
    const s = move(mkStore({ quests: [mkQuest(), other] }), addDays(DUE, 5), day)
    expect(s.ledger!.filter((e) => e.kind === 'moveFee')).toHaveLength(1)
  })
  it('гейты: прошлое, та же дата, repeating, без dueDate, некалендарная — побитовый no-op', () => {
    const s0 = mkStore()
    expect(move(s0, addDays(DUE, -3), addDays(DUE, -1))).toBe(s0) // to < day
    expect(move(s0, DUE, DUE)).toBe(s0)                            // та же дата — слот не тратится
    expect(move(s0, '2026-99-99', DUE)).toBe(s0)
    const rep = mkStore({ quests: [mkQuest({ type: 'repeating' })] })
    expect(move(rep, addDays(DUE, 1), DUE)).toBe(rep)
    const noDue = mkStore({ quests: [mkQuest({ dueDate: undefined })] })
    expect(move(noDue, addDays(DUE, 1), DUE)).toBe(noDue)
  })
  it('устаревший day не обнуляет квоту: и окно, и запись — по дню из ts', () => {
    const day = addDays(DUE, -1) // без просрочки, чтобы drain не мешал
    let s = mkStore()
    for (const n of [1, 2, 3]) s = move(s, addDays(DUE, n), day)
    expect(s.ledger ?? []).toHaveLength(0)
    // четвёртый приходит с законсервированным day, но живым ts: окно [day−6, day]
    // не должно уехать в пустоту, а запись — лечь мимо окна следующего переноса
    const s4 = reducer(s, { type: 'moveDueDate', questId: 'q1', to: addDays(DUE, 4), day: addDays(DUE, -30), ts: tsAt(day) })
    expect(s4.ledger!.map((e) => [e.kind, e.amount])).toEqual([['moveFee', -10]])
    expect(s4.quests[0].dueDateHistory!.at(-1)).toMatchObject({ day, fee: 10 })
  })
  it('ужесточение назад (to < dueDate, но ≥ day) легально и тратит слот', () => {
    const day = addDays(DUE, -5)
    const s = move(mkStore(), addDays(DUE, -2), day)
    expect(s.quests[0].dueDate).toBe(addDays(DUE, -2))
    expect(s.quests[0].dueDateHistory).toHaveLength(1)
  })
})

describe('экономика: archiveQuest = отмена контракта', () => {
  const cancel = (s: Store, day: string): Store =>
    reducer(s, { type: 'archiveQuest', questId: 'q1', day, ts: tsAt(day) })

  it('отмена до дедлайна: неустойка ровно 50%, archivedAt проставлен', () => {
    const day = addDays(DUE, -1)
    const s = cancel(mkStore(), day)
    expect(s.quests[0].status).toBe('archived')
    expect(s.quests[0].archivedAt).toBe(tsAt(day))
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['cancelFee', -50]])
  })
  it('неустойка растёт с просрочкой: d=4 → −70, d=10 → потолок −100', () => {
    expect(cancel(mkStore(), addDays(DUE, 4)).ledger![0].amount).toBe(-70)
    expect(cancel(mkStore(), addDays(DUE, 10)).ledger![0].amount).toBe(-100)
  })
  it('контракт без dueDate: неустойка 50% (лазейка закрыта наполовину)', () => {
    const s = reducer(mkStore({ quests: [mkQuest({ dueDate: undefined })] }),
      { type: 'archiveQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
    expect(s.ledger![0].amount).toBe(-50)
  })
  it('repeating, done и proposed архивируются бесплатно, с archivedAt', () => {
    for (const quests of [
      [mkQuest({ type: 'repeating', dueDate: undefined })],
      [mkQuest({ status: 'done', result: { summary: 'сделано' } })],
      [mkQuest({ status: 'proposed', proposalNote: 'надо' })],
    ]) {
      const s = reducer(mkStore({ quests }), { type: 'archiveQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
      expect(s.quests[0].status).toBe('archived')
      expect(s.quests[0].archivedAt).toBe(tsAt(DUE))
      expect(s.ledger ?? []).toHaveLength(0)
    }
  })
  it('отмена active-контракта без day/ts (старый клиент) — no-op, не бесплатная отмена', () => {
    const s0 = mkStore()
    expect(reducer(s0, { type: 'archiveQuest', questId: 'q1' } as unknown as Action)).toBe(s0)
  })
  it('архив архивного — no-op', () => {
    const s0 = mkStore({ quests: [mkQuest({ status: 'archived' })] })
    expect(reducer(s0, { type: 'archiveQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })).toBe(s0)
  })
})

describe('экономика: acceptQuest и archiveSkill', () => {
  it('accept пишет acceptedAt и амнистирует старую просрочку', () => {
    const q = mkQuest({ status: 'proposed', proposalNote: 'надо', dueDate: '2026-09-01' })
    const day = '2026-09-15'
    const s = reducer(mkStore({ quests: [q] }), { type: 'acceptQuest', questId: 'q1', ts: tsAt(day) })
    expect(s.quests[0].status).toBe('active')
    expect(s.quests[0].acceptedAt).toBe(tsAt(day))
    expect(provisionForQuest(s.quests[0], day)).toBe(0) // drainStart = день принятия
  })
  it('archiveSkill с активным контрактом навыка — побитовый no-op', () => {
    const skill = { id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: tsAt('2026-09-01') }
    const s0 = mkStore({ skills: [skill], quests: [mkQuest({ skillId: 's1' })] })
    expect(reducer(s0, { type: 'archiveSkill', skillId: 's1' })).toBe(s0)
  })
  it('archiveSkill без контрактов каскадно архивирует привычки как раньше', () => {
    const skill = { id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: tsAt('2026-09-01') }
    const s0 = mkStore({ skills: [skill], quests: [mkQuest({ skillId: 's1', type: 'repeating', dueDate: undefined })] })
    const s = reducer(s0, { type: 'archiveSkill', skillId: 's1' })
    expect(s.skills[0].archived).toBe(true)
    expect(s.quests[0].status).toBe('archived')
    expect(s.ledger ?? []).toHaveLength(0)
  })
})

describe('экономика: витрина и траты', () => {
  const massage: WishlistItem = { id: 'w1', title: 'Массаж', kind: 'small', price: 80, createdAt: tsAt('2026-09-01') }
  const skill = { id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: tsAt('2026-09-01') }
  const iphone: WishlistItem = { id: 'w2', title: 'iPhone', kind: 'big', starId: 'st1', createdAt: tsAt('2026-09-01') }
  const darkStar = { id: 'st1', skillId: 's1', parentStarId: null, tier: 'D' as const, title: 'Звезда', createdAt: tsAt('2026-09-01') }
  const litStar = { ...darkStar, litAt: tsAt('2026-09-05') }
  const buy = (s: Store, day = DUE, opId = 'op_buy1'): Store =>
    reducer(s, { type: 'purchaseItem', itemId: 'w1', day, ts: tsAt(day), opId })

  it('покупка при точном балансе проходит и пишет снапшот title в note', () => {
    const s = buy(mkStore({ quests: [], wishlist: [massage], ledger: [seedSparks(80)] }))
    expect(s.ledger!.at(-1)).toMatchObject({ kind: 'spend', amount: -80, itemId: 'w1', note: 'Массаж', opId: 'op_buy1' })
  })
  it('на единицу меньше — no-op', () => {
    const s0 = mkStore({ quests: [], wishlist: [massage], ledger: [seedSparks(79)] })
    expect(buy(s0)).toBe(s0)
  })
  it('провизия делает баланс недостаточным', () => {
    // чистыми 80, но контракт просрочен d=2 → баланс 60 < 80
    const s0 = mkStore({ wishlist: [massage], ledger: [seedSparks(80)] })
    expect(buy(s0, addDays(DUE, 2))).toBe(s0)
  })
  it('мусорный ts не открывает балансовый гейт: баланс невычислим → no-op', () => {
    // ts:'' проходит typeof-проверку, но дня из него нет → провизия и баланс NaN,
    // а `NaN < price` ложно. Позиция за 1 искру при пустом кошельке: гейт обязан
    // отказать по существу (баланс 0 < 1), а не «пройти» из-за несравнимого NaN
    // живой контракт в сторе обязателен: NaN родится в provisionForQuest, а без
    // квестов провизия — честный ноль, и гейт отработал бы по совпадению
    const penny: WishlistItem = { ...massage, price: 1 }
    const s0 = mkStore({ wishlist: [penny] })
    expect(reducer(s0, { type: 'purchaseItem', itemId: 'w1', day: DUE, ts: '', opId: 'op_junk' })).toBe(s0)
    expect(s0.ledger).toBeUndefined()
    // тот же вход с честным ts отказывает по существу (баланс 0 < 1) — значит
    // тест ловит fail-open, а не совпадение
    expect(reducer(s0, { type: 'purchaseItem', itemId: 'w1', day: DUE, ts: tsAt(DUE), opId: 'op_ok' })).toBe(s0)
  })
  it('мусорный ts не открывает гейт произвольной траты', () => {
    const s0 = mkStore()
    expect(reducer(s0, { type: 'spendSparks', amount: 1, note: 'кофе', day: DUE, ts: '' })).toBe(s0)
    expect(s0.ledger).toBeUndefined()
  })
  it('повтор opId — no-op (ретрай не покупает дважды)', () => {
    const s1 = buy(mkStore({ quests: [], wishlist: [massage], ledger: [seedSparks(200)] }))
    expect(buy(s1)).toBe(s1)
  })
  it('spendSparks: гейт баланса, обязательный note', () => {
    const s0 = mkStore({ quests: [], ledger: [seedSparks(50)] })
    const spend = (amount: number, note: string) =>
      reducer(s0, { type: 'spendSparks', amount, note, day: DUE, ts: tsAt(DUE), opId: 'op_s1' })
    expect(spend(50, 'кофе с другом').ledger!.at(-1)).toMatchObject({ kind: 'spend', amount: -50, note: 'кофе с другом' })
    expect(spend(51, 'кофе')).toBe(s0)
    expect(spend(50, '  ')).toBe(s0)
  })
  it('adjustSparks: любой знак, note обязателен', () => {
    const s0 = mkStore({ quests: [] })
    expect(reducer(s0, { type: 'adjustSparks', amount: -30, note: 'реструктуризация', day: DUE, ts: tsAt(DUE) }).ledger!.at(-1))
      .toMatchObject({ kind: 'adjust', amount: -30 })
    expect(reducer(s0, { type: 'adjustSparks', amount: 30, note: '', day: DUE, ts: tsAt(DUE) })).toBe(s0)
    expect(reducer(s0, { type: 'adjustSparks', amount: 0, note: 'x', day: DUE, ts: tsAt(DUE) })).toBe(s0)
    // 1e30 — целое по isInteger, но небезопасное: такой ledger validateStore не пропустит,
    // и редьюсер не должен производить стор, который потом некому записать
    expect(reducer(s0, { type: 'adjustSparks', amount: 1e30, note: 'много', day: DUE, ts: tsAt(DUE) })).toBe(s0)
  })
  it('claim: до зажигания звезды no-op, после — ставит claimedAt', () => {
    const dark = mkStore({ quests: [], skills: [skill], stars: [darkStar], wishlist: [iphone] })
    expect(reducer(dark, { type: 'claimReward', itemId: 'w2', ts: tsAt(DUE) })).toBe(dark)
    const lit = mkStore({ quests: [], skills: [skill], stars: [litStar], wishlist: [iphone] })
    const s = reducer(lit, { type: 'claimReward', itemId: 'w2', ts: tsAt(DUE) })
    expect(s.wishlist![0].claimedAt).toBe(tsAt(DUE))
    // повторный claim — no-op (получено необратимо)
    expect(reducer(s, { type: 'claimReward', itemId: 'w2', ts: tsAt(addDays(DUE, 1)) })).toBe(s)
  })
  it('claim: якорь-звезда не уезжает от дописанных в тот же ранг звёзд', () => {
    // ради этого якорь и сменили: при пороге ранга (ceil(0.6·n)) 1/1 = ранг взят,
    // а после добавления второй незажжённой звезды того же ранга 1/2 < 2 — право
    // на уже разблокированную награду отобрал бы рост дерева
    const grown = { id: 'st2', skillId: 's1', parentStarId: null, tier: 'D' as const, title: 'Новая', createdAt: tsAt('2026-09-02') }
    const s0 = mkStore({ quests: [], skills: [skill], stars: [litStar, grown], wishlist: [iphone] })
    const s = reducer(s0, { type: 'claimReward', itemId: 'w2', ts: tsAt(DUE) })
    expect(s.wishlist![0].claimedAt).toBe(tsAt(DUE))
  })
  it('wishlist CRUD: дубль big-звезды, заморозка kind, claimed не редактируется', () => {
    const base = mkStore({ quests: [], skills: [skill], stars: [litStar], wishlist: [iphone] })
    const dup: WishlistItem = { ...iphone, id: 'w3', title: 'MacBook' }
    expect(reducer(base, { type: 'addWishlistItem', item: dup })).toBe(base)
    const renamed = reducer(base, { type: 'updateWishlistItem', item: { ...iphone, title: 'iPhone 18' } })
    expect(renamed.wishlist![0]).toMatchObject({ title: 'iPhone 18', kind: 'big', starId: 'st1' })
    // попытка перекрасить kind: редьюсер восстановит kind='big', а big с price невалиден → no-op целиком
    expect(reducer(base, {
      type: 'updateWishlistItem',
      item: { ...iphone, kind: 'small', price: 5, starId: undefined } as WishlistItem,
    })).toBe(base)
    const claimed = mkStore({ quests: [], skills: [skill], stars: [litStar], wishlist: [{ ...iphone, claimedAt: tsAt(DUE) }] })
    expect(reducer(claimed, { type: 'updateWishlistItem', item: { ...iphone, title: 'Другое' } })).toBe(claimed)
    const archived = reducer(claimed, { type: 'archiveWishlistItem', itemId: 'w2' })
    expect(archived.wishlist![0].archived).toBe(true) // архив claimed — уборка витрины, легален
  })
  it('addWishlistItem: битые формы — no-op', () => {
    const s0 = mkStore({ quests: [], skills: [skill], stars: [litStar] })
    const bad: WishlistItem[] = [
      { id: 'b1', title: 'Т', kind: 'small', price: 0, createdAt: 'x' },
      { id: 'b2', title: 'Т', kind: 'small', price: 5, starId: 'st1', createdAt: 'x' },
      { id: 'b3', title: 'Т', kind: 'big', starId: 'нет', createdAt: 'x' },
      { id: 'b4', title: '  ', kind: 'small', price: 5, createdAt: 'x' },
      { id: 'b5', title: 'Т', kind: 'big', createdAt: 'x' }, // big без якоря
      { id: 'b6', title: 'Т', kind: 'small', price: 2 ** 53, createdAt: 'x' }, // не safe integer — как у сумм ledger
    ]
    for (const item of bad) expect(reducer(s0, { type: 'addWishlistItem', item }), item.id).toBe(s0)
  })
  it('addWishlistItem: small с claimedAt — no-op (иначе store невалиден)', () => {
    const s0 = mkStore({ quests: [], skills: [skill] })
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...massage, claimedAt: tsAt(DUE) } })).toBe(s0)
  })
  it('addWishlistItem: big с claimedAt — no-op (гейт звезды не обходится подделкой)', () => {
    const s0 = mkStore({ quests: [], skills: [skill], stars: [darkStar] })
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...iphone, claimedAt: tsAt(DUE) } })).toBe(s0)
  })
  it('addWishlistItem: archived — no-op (позиция не рождается в архиве)', () => {
    const s0 = mkStore({ quests: [], skills: [skill] })
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...massage, archived: true } })).toBe(s0)
  })
  it('update архивной позиции легален: title меняется, archived восстановлен из prev', () => {
    const s0 = mkStore({ quests: [], skills: [skill], wishlist: [{ ...massage, archived: true }] })
    const s = reducer(s0, { type: 'updateWishlistItem', item: { ...massage, title: 'Массаж 90' } })
    expect(s.wishlist![0]).toMatchObject({ title: 'Массаж 90', archived: true })
  })
})

describe('экономика: заморозка условий в updateQuest', () => {
  it('у активного контракта не меняются R/type/status/createdAt/dueDate', () => {
    const s = reducer(mkStore(), {
      type: 'updateQuest',
      quest: { ...mkQuest(), title: 'Новое имя', xpReward: 10, type: 'long', status: 'done', dueDate: '2027-01-01', createdAt: tsAt('2026-09-09') },
    })
    const q = s.quests[0]
    expect(q.title).toBe('Новое имя') // тексты патчатся
    expect([q.xpReward, q.type, q.status, q.dueDate, q.createdAt])
      .toEqual([100, 'short', 'active', DUE, tsAt('2026-09-01')])
  })
  it('у активного контракта без дедлайна срок ставится из payload — иначе квест заперт навсегда', () => {
    // moveDueDate на квесте без dueDate — no-op, и других способов задать срок нет
    const noDue = mkQuest({ dueDate: undefined })
    const s = reducer(mkStore({ quests: [noDue] }), {
      type: 'updateQuest',
      quest: { ...noDue, dueDate: DUE, xpReward: 500 },
    })
    expect(s.quests[0].dueDate).toBe(DUE)
    expect(s.quests[0].xpReward).toBe(100) // остальные условия заморожены по-прежнему
  })
  it('поставленный однажды дедлайн замерзает: второй раз payload его не двигает', () => {
    const noDue = mkQuest({ dueDate: undefined })
    const s0 = reducer(mkStore({ quests: [noDue] }), { type: 'updateQuest', quest: { ...noDue, dueDate: DUE } })
    const s1 = reducer(s0, { type: 'updateQuest', quest: { ...s0.quests[0], dueDate: addDays(DUE, 30) } })
    expect(s1.quests[0].dueDate).toBe(DUE)
  })
  it('dueDateHistory/acceptedAt/archivedAt из payload игнорируются у любого квеста', () => {
    const rep = mkQuest({ type: 'repeating', dueDate: undefined })
    const s = reducer(mkStore({ quests: [rep] }), {
      type: 'updateQuest',
      quest: { ...rep, acceptedAt: tsAt(DUE), archivedAt: tsAt(DUE), dueDateHistory: [{ from: DUE, to: DUE, day: DUE, ts: tsAt(DUE) }] },
    })
    expect(s.quests[0].acceptedAt).toBeUndefined()
    expect(s.quests[0].archivedAt).toBeUndefined()
    expect(s.quests[0].dueDateHistory).toBeUndefined()
  })
  it('у proposed и у привычки xpReward редактируем (условия замораживаются принятием)', () => {
    const prop = mkQuest({ status: 'proposed', proposalNote: 'надо' })
    expect(reducer(mkStore({ quests: [prop] }), { type: 'updateQuest', quest: { ...prop, xpReward: 500 } }).quests[0].xpReward).toBe(500)
    const rep = mkQuest({ type: 'repeating', dueDate: undefined })
    expect(reducer(mkStore({ quests: [rep] }), { type: 'updateQuest', quest: { ...rep, xpReward: 500 } }).quests[0].xpReward).toBe(500)
  })
  it('status из payload игнорируется: done не воскресает и второго earn нет', () => {
    const s0 = complete(mkStore(), DUE)
    const s = reducer(s0, { type: 'updateQuest', quest: { ...s0.quests[0], status: 'active', xpReward: 500 } })
    expect(s.quests[0].status).toBe('done')
    expect(complete(s, DUE)).toBe(s) // воскрешение редактором обходило бы гейт повторной сдачи
    expect(s.ledger!.filter((e) => e.kind === 'earn')).toHaveLength(1)
  })
  it('resultHistory восстанавливается из prev: правка формой не стирает отменённые итоги', () => {
    const history = [{ summary: 'первый заход', cancelledAt: tsAt(DUE) }]
    const q = mkQuest({ status: 'done', result: { summary: 'итог' }, resultHistory: history })
    const { resultHistory, ...payload } = q // веб-форма это поле в payload не кладёт
    const s = reducer(mkStore({ quests: [q] }), { type: 'updateQuest', quest: payload })
    expect(s.quests[0].resultHistory).toEqual(history)
  })
  it('xpReward сданного контракта не меняется payload: чеканка искр закрыта', () => {
    const s0 = complete(mkStore(), DUE)
    const edited = reducer(s0, { type: 'updateQuest', quest: { ...s0.quests[0], xpReward: 1000 } })
    expect(edited.quests[0].xpReward).toBe(100)
    // сценарий чеканки целиком: правка R у done → откат (reversal по историческим −100) → пересдача
    const back = reducer(edited, { type: 'uncompleteQuest', questId: 'q1', day: DUE, ts: tsAt(DUE) })
    const again = complete(back, DUE)
    expect(sparksBalance(again, DUE)).toBe(100) // ровно один R, а не 1000
  })
  it('правка сданного контракта не рвёт dueDateHistory: dueDate тоже из prev', () => {
    const moveDay = addDays(DUE, -1)
    const moved = reducer(mkStore(), {
      type: 'moveDueDate', questId: 'q1', to: addDays(DUE, 5), day: moveDay, ts: tsAt(moveDay),
    })
    const s0 = complete(moved, addDays(DUE, 5))
    // попытка стереть срок у сданного: dueDate ≠ последнего to развалил бы валидацию стора
    const cleared = reducer(s0, { type: 'updateQuest', quest: { ...s0.quests[0], dueDate: undefined } })
    expect(cleared.quests[0].dueDate).toBe(addDays(DUE, 5))
    expect(validateStore(cleared)).toEqual([])
    // и смена на другую дату — тоже мимо
    const swapped = reducer(s0, { type: 'updateQuest', quest: { ...s0.quests[0], dueDate: addDays(DUE, 40) } })
    expect(swapped.quests[0].dueDate).toBe(addDays(DUE, 5))
    expect(validateStore(swapped)).toEqual([])
  })
})

describe('экономика: день расчёта берётся из ts, а не из payload', () => {
  // Провизия растёт со временем, поэтому устаревший day завышал бы баланс
  // и удешевлял отмену. Окно то же, что у выплаты: сегодня/вчера по ts.
  const LATE = addDays(DUE, 10) // контракт на потолке капания: провизия = R = 100
  const cheap: WishlistItem = { id: 'w1', title: 'Массаж', kind: 'small', price: 100, createdAt: tsAt('2026-09-01') }

  it('покупка: устаревший day не открывает витрину под съеденный провизией баланс', () => {
    const s0 = mkStore({ wishlist: [cheap], ledger: [seedSparks(100)] })
    expect(sparksBalance(s0, LATE)).toBe(0) // чистыми 100, провизия −100
    expect(reducer(s0, { type: 'purchaseItem', itemId: 'w1', day: DUE, ts: tsAt(LATE), opId: 'op_stale' })).toBe(s0)
  })
  it('spendSparks: тот же гейт по дню из ts', () => {
    const s0 = mkStore({ ledger: [seedSparks(100)] })
    expect(reducer(s0, { type: 'spendSparks', amount: 100, note: 'кофе', day: DUE, ts: tsAt(LATE) })).toBe(s0)
  })
  it('перенос: устаревший day не разрешает перенос в фактическое прошлое', () => {
    const s0 = mkStore()
    expect(reducer(s0, { type: 'moveDueDate', questId: 'q1', to: addDays(DUE, 2), day: DUE, ts: tsAt(LATE) })).toBe(s0)
  })
  it('перенос вперёд: накапавший долг фиксируется по дню из ts', () => {
    const s = reducer(mkStore(), { type: 'moveDueDate', questId: 'q1', to: addDays(DUE, 20), day: DUE, ts: tsAt(LATE) })
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['drain', -100]])
  })
  it('отмена: неустойка считается по дню из ts (устаревший day её удешевлял)', () => {
    const s = reducer(mkStore(), { type: 'archiveQuest', questId: 'q1', day: DUE, ts: tsAt(LATE) })
    expect(s.ledger!.map((e) => [e.kind, e.amount])).toEqual([['cancelFee', -100]])
  })
})

describe('витрина: позиция без цены (цикл 13)', () => {
  const wish: WishlistItem = { id: 'w3', title: 'Лампа', kind: 'small', createdAt: tsAt('2026-09-01') }

  it('addWishlistItem: small без цены — легальное «хочу»', () => {
    const s = reducer(mkStore({ quests: [] }), { type: 'addWishlistItem', item: wish })
    expect(s.wishlist).toEqual([wish])
  })
  it('покупка позиции без цены — no-op даже при богатом балансе', () => {
    const s0 = mkStore({ quests: [], wishlist: [wish], ledger: [seedSparks(500)] })
    expect(reducer(s0, { type: 'purchaseItem', itemId: 'w3', day: DUE, ts: tsAt(DUE), opId: 'op_np' })).toBe(s0)
  })
  it('updateWishlistItem назначает цену → покупка проходит', () => {
    let s = mkStore({ quests: [], wishlist: [wish], ledger: [seedSparks(500)] })
    s = reducer(s, { type: 'updateWishlistItem', item: { ...wish, price: 120 } })
    expect(s.wishlist![0].price).toBe(120)
    s = reducer(s, { type: 'purchaseItem', itemId: 'w3', day: DUE, ts: tsAt(DUE), opId: 'op_pr' })
    expect(s.ledger!.at(-1)).toMatchObject({ kind: 'spend', amount: -120, itemId: 'w3' })
  })
  it('снятие цены (item без поля price) — легально', () => {
    const priced: WishlistItem = { ...wish, price: 120 }
    const s = reducer(mkStore({ quests: [], wishlist: [priced] }), { type: 'updateWishlistItem', item: wish })
    expect(s.wishlist![0].price).toBeUndefined()
  })
  it('разовая покупается один раз; repeatable — многократно; reversal возвращает покупаемость', () => {
    const priced: WishlistItem = { ...wish, price: 50 }
    let s = reducer(mkStore({ quests: [], wishlist: [priced], ledger: [seedSparks(500)] }),
      { type: 'purchaseItem', itemId: 'w3', day: DUE, ts: tsAt(DUE), opId: 'op_a' })
    expect(s.ledger!.filter((e) => e.itemId === 'w3')).toHaveLength(1)
    expect(purchasedDays(s).get('w3')).toBe(DUE)
    expect(reducer(s, { type: 'purchaseItem', itemId: 'w3', day: DUE, ts: tsAt(DUE), opId: 'op_b' })).toBe(s) // уже куплена
    // разворот покупки руками (break-glass) — позиция снова покупаема
    const spend = s.ledger!.find((e) => e.itemId === 'w3')!
    const undone: Store = { ...s, ledger: [...s.ledger!, { id: 'l_rev1', ts: tsAt(DUE), day: DUE, kind: 'reversal', amount: -spend.amount, reversesId: spend.id }] }
    expect(purchasedDays(undone).has('w3')).toBe(false)
    const rebought = reducer(undone, { type: 'purchaseItem', itemId: 'w3', day: DUE, ts: tsAt(DUE), opId: 'op_c' })
    expect(rebought.ledger!.filter((e) => e.kind === 'spend' && e.itemId === 'w3')).toHaveLength(2)
    // повторяющаяся — прежнее поведение
    const rep: WishlistItem = { ...wish, id: 'w9', price: 50, repeatable: true }
    let r = mkStore({ quests: [], wishlist: [rep], ledger: [seedSparks(500)] })
    r = reducer(r, { type: 'purchaseItem', itemId: 'w9', day: DUE, ts: tsAt(DUE), opId: 'op_r1' })
    r = reducer(r, { type: 'purchaseItem', itemId: 'w9', day: DUE, ts: tsAt(DUE), opId: 'op_r2' })
    expect(r.ledger!.filter((e) => e.itemId === 'w9')).toHaveLength(2)
  })
  it('лицо награды: updateWishlistItem ставит и стирает emoji/imageUrl; пустышки — no-op', () => {
    const faced: WishlistItem = { ...wish, emoji: '🛋️', imageUrl: 'https://x.example/sofa.jpg' }
    let s = reducer(mkStore({ quests: [], wishlist: [wish] }), { type: 'updateWishlistItem', item: faced })
    expect(s.wishlist![0]).toEqual(faced)
    s = reducer(s, { type: 'updateWishlistItem', item: wish }) // поля сняты — легально
    expect(s.wishlist![0].emoji).toBeUndefined()
    expect(s.wishlist![0].imageUrl).toBeUndefined()
    const s0 = mkStore({ quests: [] })
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...wish, emoji: '  ' } })).toBe(s0)
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...wish, emoji: '🛋️'.repeat(6) } })).toBe(s0)
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...wish, imageUrl: '' } })).toBe(s0)
  })
  it('справочные поля: непустые строки валидны, пустышки — no-op', () => {
    const full: WishlistItem = { ...wish, sourceUrl: 'https://x.example', originalPrice: '2800 ฿' }
    const s = reducer(mkStore({ quests: [] }), { type: 'addWishlistItem', item: full })
    expect(s.wishlist).toEqual([full])
    const s0 = mkStore({ quests: [] })
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...wish, sourceUrl: ' ' } })).toBe(s0)
    expect(reducer(s0, { type: 'addWishlistItem', item: { ...wish, originalPrice: '' } })).toBe(s0)
  })
})

describe('эмиссия для калибровки: emissionInDays', () => {
  const earnAt = (id: string, day: string, amount: number): LedgerEvent =>
    ({ id, ts: tsAt(day), day, kind: 'earn', amount, questId: 'q1' })
  it('окно 7/30 дней включая сегодня; reversal вычёркивает earn', () => {
    const s = mkStore({ ledger: [
      earnAt('e1', DUE, 50),
      earnAt('e2', addDays(DUE, -6), 30),   // край окна 7 — входит
      earnAt('e3', addDays(DUE, -7), 20),   // только в окно 30
      earnAt('e4', addDays(DUE, -40), 500), // вне обоих окон
      earnAt('e5', addDays(DUE, -2), 40),   // будет развёрнут
      { id: 'r1', ts: tsAt(DUE), day: DUE, kind: 'reversal', amount: -40, questId: 'q1', reversesId: 'e5' },
    ] })
    expect(emissionInDays(s, DUE, 7)).toBe(80)
    expect(emissionInDays(s, DUE, 30)).toBe(100)
  })
  it('пустой ledger — ноль', () => {
    expect(emissionInDays(mkStore(), DUE, 7)).toBe(0)
  })
})

