import { describe, expect, it } from 'vitest'
import type { LedgerEvent, Store, WishlistItem } from '../types'
import { addDays } from './dates'
import { SPARKS_EPOCH } from './sparks'
import { DEBT_ZONE, trackModel } from './track'

// полдень Бангкока = 05:00 UTC; экономике 14 дней → окно weeklyRate = 14
const TODAY = addDays(SPARKS_EPOCH, 13)
const tsAt = (day: string) => `${day}T05:00:00.000Z`

function mkStore(over: Partial<Store> = {}): Store {
  return {
    version: 3, character: { name: 'Тест', avatar: '🧙' },
    skills: [], stars: [], quests: [], xpLog: [], ...over,
  }
}
const adj = (amount: number, day = TODAY): LedgerEvent =>
  ({ id: `adj_${day}_${amount}`, ts: tsAt(day), day, kind: 'adjust', amount, note: 'сид теста' })
const earn = (amount: number, day = TODAY): LedgerEvent =>
  ({ id: `e_${day}_${amount}`, ts: tsAt(day), day, kind: 'earn', amount, questId: 'q1' })

let seq = 0
function mkItem(price: number | undefined, over: Partial<WishlistItem> = {}): WishlistItem {
  seq += 1
  return {
    id: `w${seq}`, title: `Позиция ${seq}`, kind: 'small', price,
    createdAt: tsAt(addDays(SPARKS_EPOCH, seq % 7)), ...over,
  }
}

describe('trackModel: когда трека нет', () => {
  it('пустая витрина и баланс ≥ 0 → null', () => {
    expect(trackModel(mkStore(), TODAY)).toBeNull()
    expect(trackModel(mkStore({ ledger: [adj(500)] }), TODAY)).toBeNull()
  })
  it('вехи без цены, big и архив на треке не живут', () => {
    const store = mkStore({
      ledger: [adj(500)],
      wishlist: [
        mkItem(undefined),                              // «хочу» без цены
        mkItem(100, { kind: 'big', starId: 's1' }),     // big — якорь звезда
        mkItem(50, { archived: true }),                 // архив
      ],
    })
    expect(trackModel(store, TODAY)).toBeNull()
  })
  it('купленная разовая уходит с трека, повторяющаяся остаётся; reversal возвращает веху', () => {
    const one = mkItem(50)
    const rep = mkItem(80, { repeatable: true })
    const spend = (id: string, itemId: string): LedgerEvent =>
      ({ id, ts: tsAt(TODAY), day: TODAY, kind: 'spend', amount: -50, itemId })
    const store = mkStore({
      ledger: [adj(500), spend('sp1', one.id), spend('sp2', rep.id)],
      wishlist: [one, rep],
    })
    expect(trackModel(store, TODAY)!.milestones.map((x) => x.item.id)).toEqual([rep.id])
    const undone = mkStore({
      ledger: [adj(500), spend('sp1', one.id),
        { id: 'rv1', ts: tsAt(TODAY), day: TODAY, kind: 'reversal', amount: 50, reversesId: 'sp1' }],
      wishlist: [one, rep],
    })
    expect(trackModel(undone, TODAY)!.milestones.map((x) => x.item.id)).toEqual([one.id, rep.id])
  })
})

describe('trackModel: геометрия и вехи', () => {
  it('вехи равномерны, отсортированы по цене, последняя на правом краю', () => {
    const store = mkStore({
      ledger: [adj(10)],
      wishlist: [mkItem(120), mkItem(40), mkItem(360), mkItem(1080)],
    })
    const m = trackModel(store, TODAY)!
    expect(m.zeroPos).toBe(0)
    expect(m.milestones.map((x) => x.item.price)).toEqual([40, 120, 360, 1080])
    expect(m.milestones.map((x) => x.pos)).toEqual([0.25, 0.5, 0.75, 1])
  })
  it('равные цены: стабильный порядок по createdAt, затем id', () => {
    const a = mkItem(45, { id: 'wa', createdAt: tsAt('2026-08-10') })
    const b = mkItem(45, { id: 'wb', createdAt: tsAt('2026-08-08') })
    const m = trackModel(mkStore({ ledger: [adj(10)], wishlist: [a, b] }), TODAY)!
    expect(m.milestones.map((x) => x.item.id)).toEqual(['wb', 'wa'])
  })
  it('reached — по price ≤ balance (условие кнопки «Купить»)', () => {
    const store = mkStore({ ledger: [adj(45)], wishlist: [mkItem(45), mkItem(46)] })
    const m = trackModel(store, TODAY)!
    expect(m.milestones.map((x) => x.reached)).toEqual([true, false])
  })
})

describe('trackModel: заливка в плюсе', () => {
  it('на вехе, внутри сегмента (линейно по цене), выше всех цен → 1', () => {
    const wishlist = [mkItem(40), mkItem(120)]
    const at = (balance: number) =>
      trackModel(mkStore({ ledger: [adj(balance)], wishlist }), TODAY)!.fill
    expect(at(40)).toBe(0.5)      // ровно на первой вехе
    expect(at(80)).toBe(0.75)     // t = (80−40)/80 = 0.5 сегмента [0.5..1]
    expect(at(120)).toBe(1)
    expect(at(9999)).toBe(1)
  })
  it('баланс 0: заливка на нулевой отметке', () => {
    const m = trackModel(mkStore({ ledger: [adj(40), adj(-40)], wishlist: [mkItem(40)] }), TODAY)!
    expect(m.fill).toBe(0)
  })
  it('сегмент нулевой ценовой длины (равные цены) пройден целиком при balance ≥ цены', () => {
    const m = trackModel(mkStore({ ledger: [adj(45)], wishlist: [mkItem(45), mkItem(45)] }), TODAY)!
    expect(m.fill).toBe(1) // обе вехи по 45 достигнуты
  })
})

describe('trackModel: зона долга', () => {
  it('долг: zeroPos = DEBT_ZONE, вехи правее, заливка внутри зоны', () => {
    // пик −200 (три дня назад), погашено до −100 → ratio 0.5
    const store = mkStore({
      ledger: [adj(-200, addDays(TODAY, -3)), adj(100, addDays(TODAY, -1))],
      wishlist: [mkItem(40)],
    })
    const m = trackModel(store, TODAY)!
    expect(m.zeroPos).toBe(DEBT_ZONE)
    expect(m.debt).toEqual({ anchor: -200, ratio: 0.5 })
    expect(m.fill).toBeCloseTo(0.5 * DEBT_ZONE, 10)
    // toBeCloseTo: 0.22 + (1 − 0.22) не обязан быть бинарно ровно 1
    expect(m.milestones[0].pos).toBeCloseTo(1, 10) // одна веха — на правом краю остатка
    expect(m.milestones[0].reached).toBe(false)
  })
  it('баланс на дне якоря → заливка 0; вех нет, но долг есть → трек без вех', () => {
    const m = trackModel(mkStore({ ledger: [adj(-300)] }), TODAY)!
    expect(m.debt).toEqual({ anchor: -300, ratio: 0 })
    expect(m.fill).toBe(0)
    expect(m.milestones).toEqual([])
  })
})

describe('trackModel: темп и ETA', () => {
  it('долг → toZero: weeks = ceil(|balance| / rate)', () => {
    // earn 200 за окно 14 дней → rate 100; баланс −100
    const store = mkStore({ ledger: [adj(-300), earn(200)] })
    const m = trackModel(store, TODAY)!
    expect(m.rate).toBe(100)
    expect(m.eta).toEqual({ kind: 'toZero', weeks: 1 })
  })
  it('плюс → первая недостижимая веха', () => {
    const store = mkStore({
      ledger: [adj(-120), earn(200)], // баланс 80, rate 100
      wishlist: [mkItem(40, { title: 'Книга' }), mkItem(280, { title: 'Кресло' })],
    })
    expect(trackModel(store, TODAY)!.eta).toEqual({ kind: 'toItem', title: 'Кресло', weeks: 2 })
  })
  it('все вехи достигнуты или темп 0 → ETA нет', () => {
    const all = mkStore({ ledger: [earn(200)], wishlist: [mkItem(40)] })
    expect(trackModel(all, TODAY)!.eta).toBeNull()
    const silent = mkStore({ ledger: [adj(-100)] }) // adjust — не earn, rate 0
    expect(trackModel(silent, TODAY)!.eta).toBeNull()
  })
})
