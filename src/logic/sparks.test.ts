import { describe, expect, it, vi } from 'vitest'
import type { LedgerEvent, Quest, QuestDueDateMove, Store } from '../types'
import { addDays, diffDays, isCalendarDay } from './dates'
import {
  SPARKS_EPOCH,
  cancelFeeFor,
  dayInGameTz,
  debtAnchor,
  drainStart,
  earnWindowOk,
  ledgerTotal,
  moveFeeFor,
  movesUsedIn7d,
  provisionForQuest,
  provisionTotal,
  settlementDay,
  sparksBalance,
  todayInGameTz,
  weeklyRate,
} from './sparks'

// все даты тестов — после SPARKS_EPOCH, полдень Бангкока = 05:00 UTC
const tsAt = (day: string) => `${day}T05:00:00.000Z`
const DUE = '2026-09-10'

function mkQuest(over: Partial<Quest> = {}): Quest {
  return {
    id: 'q1', title: 'Контракт', type: 'short', skillId: null, xpReward: 100,
    dueDate: DUE, status: 'active', createdAt: tsAt('2026-09-01'), ...over,
  }
}

describe('dates: diffDays / isCalendarDay', () => {
  it('diffDays считает полные дни', () => {
    expect(diffDays('2026-08-10', '2026-08-07')).toBe(3)
    expect(diffDays('2026-08-07', '2026-08-10')).toBe(-3)
    expect(diffDays('2027-01-02', '2026-12-28')).toBe(5)
  })
  it('isCalendarDay режет некалендарные даты', () => {
    expect(isCalendarDay('2026-08-05')).toBe(true)
    expect(isCalendarDay('2026-99-99')).toBe(false)
    expect(isCalendarDay('2026-02-30')).toBe(false)
    expect(isCalendarDay('2026-8-5')).toBe(false)
  })
})

describe('sparks: игровой пояс UTC+7', () => {
  it('граница игрового дня — 17:00 UTC', () => {
    expect(dayInGameTz('2026-09-04T16:59:59.000Z')).toBe('2026-09-04')
    expect(dayInGameTz('2026-09-04T17:00:00.000Z')).toBe('2026-09-05')
  })
  it('офсеты в ISO приводятся к одному игровому дню (детерминизм пояса)', () => {
    // один и тот же момент времени в трёх записях
    expect(dayInGameTz('2026-09-05T09:30:00+07:00')).toBe('2026-09-05')
    expect(dayInGameTz('2026-09-05T02:30:00.000Z')).toBe('2026-09-05')
    expect(dayInGameTz('2026-09-04T19:30:00-07:00')).toBe('2026-09-05')
  })
  it('без designator — трактуем как UTC, не как локальный пояс машины', () => {
    expect(dayInGameTz('2026-08-05T17:00:00')).toBe('2026-08-06')
  })
  it('положительный офсет, переход через полночь назад (UTC 2026-08-04T17:30)', () => {
    expect(dayInGameTz('2026-08-05T00:30:00+07:00')).toBe('2026-08-05')
  })
  it('todayInGameTz берёт игровой день, а не календарный день машины', () => {
    vi.useFakeTimers()
    try {
      // 18:00 UTC — в игровом поясе уже следующие сутки, в UTC-машине ещё нет
      vi.setSystemTime(new Date('2026-09-04T18:00:00.000Z'))
      expect(todayInGameTz()).toBe('2026-09-05')
      vi.setSystemTime(new Date('2026-09-04T16:00:00.000Z'))
      expect(todayInGameTz()).toBe('2026-09-04')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sparks: drainStart', () => {
  it('дедлайн позже всех — отсчёт от дедлайна', () => {
    expect(drainStart(mkQuest())).toBe(DUE)
  })
  it('квест создан после дедлайна — амнистия до дня создания', () => {
    const q = mkQuest({ dueDate: '2026-09-01', createdAt: tsAt('2026-09-05') })
    expect(drainStart(q)).toBe('2026-09-05')
  })
  it('принят после создания и дедлайна — амнистия до дня принятия', () => {
    const q = mkQuest({ dueDate: '2026-09-01', acceptedAt: tsAt('2026-09-07') })
    expect(drainStart(q)).toBe('2026-09-07')
  })
  it('всё раньше эпохи — отсчёт от SPARKS_EPOCH', () => {
    const before = addDays(SPARKS_EPOCH, -10)
    const q = mkQuest({ dueDate: before, createdAt: `${before}T00:00:00.000Z` })
    expect(drainStart(q)).toBe(SPARKS_EPOCH)
  })
})

describe('sparks: провизия', () => {
  const p = (d: number, r = 100) => provisionForQuest(mkQuest({ xpReward: r }), addDays(DUE, d))
  it('матрица дней при R=100', () => {
    expect([p(0), p(1), p(4), p(5), p(9), p(10), p(11)]).toEqual([0, 10, 40, 50, 90, 100, 100])
  })
  it('ceil от итоговой суммы: R=1/9/10/11/500', () => {
    expect(provisionForQuest(mkQuest({ xpReward: 1 }), addDays(DUE, 1))).toBe(1)
    expect(provisionForQuest(mkQuest({ xpReward: 9 }), addDays(DUE, 1))).toBe(1)
    expect(provisionForQuest(mkQuest({ xpReward: 10 }), addDays(DUE, 1))).toBe(1)
    expect(provisionForQuest(mkQuest({ xpReward: 11 }), addDays(DUE, 1))).toBe(2)
    expect(provisionForQuest(mkQuest({ xpReward: 500 }), addDays(DUE, 3))).toBe(150)
  })
  it('float-регрессия: d=3, R=100 → ровно 30, не 31', () => {
    // наивный ceil(min(3×0.1,1)×100) даёт 31 из-за 0.30000000000000004
    expect(p(3)).toBe(30)
  })
  it('свойства: 0 ≤ p ≤ R, монотонность по дням', () => {
    let prev = 0
    for (let d = -3; d <= 15; d++) {
      const val = p(d)
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(100)
      expect(val).toBeGreaterThanOrEqual(prev)
      prev = val
    }
  })
  it('не капает: repeating, done, proposed, без dueDate', () => {
    expect(provisionForQuest(mkQuest({ type: 'repeating' }), addDays(DUE, 5))).toBe(0)
    expect(provisionForQuest(mkQuest({ status: 'done' }), addDays(DUE, 5))).toBe(0)
    expect(provisionForQuest(mkQuest({ status: 'proposed' }), addDays(DUE, 5))).toBe(0)
    expect(provisionForQuest(mkQuest({ dueDate: undefined }), addDays(DUE, 5))).toBe(0)
  })
})

describe('sparks: цены операций', () => {
  it('moveFee = ceil(10% R); float-регрессия R=100 → 10, не 11', () => {
    expect(moveFeeFor(mkQuest())).toBe(10)
    expect(moveFeeFor(mkQuest({ xpReward: 95 }))).toBe(10)
    expect(moveFeeFor(mkQuest({ xpReward: 1 }))).toBe(1)
  })
  it('cancelFee растёт с просрочкой и упирается в R', () => {
    expect(cancelFeeFor(mkQuest(), addDays(DUE, -1))).toBe(50) // до дедлайна — ровно 50%
    expect(cancelFeeFor(mkQuest(), addDays(DUE, 4))).toBe(70)  // 50 + 0.5×40
    expect(cancelFeeFor(mkQuest(), addDays(DUE, 10))).toBe(100) // потолок R
    expect(cancelFeeFor(mkQuest({ xpReward: 9 }), addDays(DUE, -1))).toBe(5) // ceil(4.5)
    expect(cancelFeeFor(mkQuest({ dueDate: undefined }), DUE)).toBe(50) // контракт без даты
  })
})

describe('sparks: анти-бэкфилл-окно', () => {
  const ts = tsAt('2026-09-10')
  it('сегодня и вчера — ок; позавчера и завтра — нет', () => {
    expect(earnWindowOk('2026-09-10', ts)).toBe(true)
    expect(earnWindowOk('2026-09-09', ts)).toBe(true)
    expect(earnWindowOk('2026-09-08', ts)).toBe(false)
    expect(earnWindowOk('2026-09-11', ts)).toBe(false)
  })
  it('нестроковый ts не роняет арифметику дней: окна нет, день расчёта = day', () => {
    // ts приходит из payload (API проверяет только type). Раньше такой запрос
    // доезжал до validateStore и получал внятный 422 — 500 из недр diffDays хуже
    const broken = undefined as unknown as string
    expect(earnWindowOk('2026-09-10', broken)).toBe(false)
    expect(settlementDay('2026-09-10', broken)).toBe('2026-09-10')
  })
  it('settlementDay: внутри окна берёт day, снаружи — игровой день ts', () => {
    expect(settlementDay('2026-09-10', ts)).toBe('2026-09-10')
    expect(settlementDay('2026-09-09', ts)).toBe('2026-09-09') // вчера ещё своё
    expect(settlementDay('2026-09-01', ts)).toBe('2026-09-10') // устаревший day не удешевляет провизию
    expect(settlementDay('2026-09-11', ts)).toBe('2026-09-10') // будущий day тоже нормализуется
  })
})

function mkStore(over: Partial<Store> = {}): Store {
  return {
    version: 3, character: { name: 'Тест', avatar: '🧙' },
    skills: [], stars: [], quests: [], xpLog: [], ...over,
  }
}

const adj = (amount: number, day = DUE): LedgerEvent =>
  ({ id: `adj_${day}_${amount}`, ts: tsAt(day), day, kind: 'adjust', amount, note: 'сид теста' })

describe('sparks: баланс и провизии', () => {
  it('store без ledger: ledgerTotal 0, баланс 0', () => {
    expect(ledgerTotal(mkStore())).toBe(0)
    expect(sparksBalance(mkStore(), DUE)).toBe(0)
  })
  it('баланс = Σledger − Σпровизий и может быть отрицательным', () => {
    const s = mkStore({ quests: [mkQuest()], ledger: [adj(30)] })
    expect(sparksBalance(s, addDays(DUE, 5))).toBe(30 - 50)
  })
  it('provisionTotal суммирует только активные контракты', () => {
    const s = mkStore({
      quests: [
        mkQuest(),
        mkQuest({ id: 'q2', status: 'done' }),
        mkQuest({ id: 'q3', type: 'repeating', dueDate: undefined }),
      ],
    })
    expect(provisionTotal(s, addDays(DUE, 2))).toBe(20)
  })
})

describe('sparks: квота переносов (rolling 7 дней)', () => {
  const move = (day: string): QuestDueDateMove => ({ from: DUE, to: addDays(DUE, 1), day, ts: tsAt(day) })
  it('считает записи всех квестов в окне [day−6, day] включительно', () => {
    const day = '2026-09-20'
    const s = mkStore({
      quests: [
        mkQuest({ id: 'q1', dueDateHistory: [move(addDays(day, -7)), move(addDays(day, -6))] }),
        mkQuest({ id: 'q2', dueDateHistory: [move(addDays(day, -3)), move(day)] }),
      ],
    })
    expect(movesUsedIn7d(s, day)).toBe(3) // запись −7 дней выпала из окна
  })
  it('окно работает через границу года', () => {
    const day = '2027-01-02'
    const s = mkStore({
      quests: [mkQuest({ dueDateHistory: [move('2026-12-28'), move('2026-12-31'), move('2027-01-01')] })],
    })
    expect(movesUsedIn7d(s, day)).toBe(3)
  })
})

const earn = (amount: number, day: string, id = `e_${day}_${amount}`): LedgerEvent =>
  ({ id, ts: tsAt(day), day, kind: 'earn', amount, questId: 'q1' })
const reversal = (reversesId: string, amount: number, day: string): LedgerEvent =>
  ({ id: `r_${reversesId}`, ts: tsAt(day), day, kind: 'reversal', amount, reversesId })

describe('sparks: debtAnchor', () => {
  it('пустой ledger и история без минусов — якоря нет (0)', () => {
    expect(debtAnchor(mkStore(), DUE)).toBe(0)
    expect(debtAnchor(mkStore({ ledger: [adj(100, '2026-09-01'), adj(50, '2026-09-02')] }), DUE)).toBe(0)
  })
  it('пик долга в истории глубже текущего — берётся пик (события разных ts)', () => {
    const store = mkStore({
      ledger: [adj(100, '2026-09-01'), adj(-300, '2026-09-02'), adj(150, '2026-09-03')],
    })
    // префиксы на границах: 100, −200, −50 → дно −200
    expect(debtAnchor(store, DUE)).toBe(-200)
  })
  it('чисто провизионный долг: якорь = −провизии и не скользит за балансом при earn', () => {
    const quests = [mkQuest({ xpReward: 1000 })]
    const today = addDays(DUE, 10) // капание на потолке: провизия 1000
    expect(debtAnchor(mkStore({ quests }), today)).toBe(-1000)
    // погашение сдачами других контрактов: earn не двигает якорь —
    // ratio в треке растёт, ради этого формула и переписана
    const paying = mkStore({
      quests,
      ledger: [{ id: 'e1', ts: tsAt(today), day: today, kind: 'earn', amount: 200 }],
    })
    expect(debtAnchor(paying, today)).toBe(-1000)
  })
  it('яма в середине ts-группы — фантом атомарного отката, не считается', () => {
    const ts = tsAt('2026-09-05')
    const tsRev = tsAt('2026-09-06')
    const store = mkStore({
      ledger: [
        { id: 'e1', ts, day: '2026-09-05', kind: 'earn', amount: 100 },
        { id: 'd1', ts, day: '2026-09-05', kind: 'drain', amount: -50 },
        { id: 'r1', ts: tsRev, day: '2026-09-06', kind: 'reversal', amount: -100, reversesId: 'e1' },
        { id: 'r2', ts: tsRev, day: '2026-09-06', kind: 'reversal', amount: 50, reversesId: 'd1' },
      ],
    })
    // границы ts-групп: 50, 0 — ямы −50 в середине отката нет
    expect(debtAnchor(store, DUE)).toBe(0)
  })
})

describe('sparks: weeklyRate', () => {
  it('экономика моложе окна — нормировка на фактические дни с эпохи', () => {
    const today = addDays(SPARKS_EPOCH, 13) // окно 14 дней
    const store = mkStore({ ledger: [earn(200, today)] })
    expect(weeklyRate(store, today)).toBe(100) // 200·7/14
  })
  it('первый день эпохи — окно не меньше 1 дня', () => {
    const store = mkStore({ ledger: [earn(50, SPARKS_EPOCH)] })
    expect(weeklyRate(store, SPARKS_EPOCH)).toBe(350) // 50·7/1
  })
  it('после 28 дней окно фиксируется: старые earn выпадают', () => {
    const today = addDays(SPARKS_EPOCH, 55)
    const store = mkStore({
      ledger: [earn(999, addDays(today, -28)), earn(280, today)], // первый — за окном
    })
    expect(weeklyRate(store, today)).toBe(70) // 280·7/28
  })
  it('reversal вычёркивает earn из темпа; пустая эмиссия → 0', () => {
    const today = addDays(SPARKS_EPOCH, 13)
    const e = earn(100, today)
    const store = mkStore({ ledger: [e, reversal(e.id, -100, today)] })
    expect(weeklyRate(store, today)).toBe(0)
    expect(weeklyRate(mkStore(), today)).toBe(0)
  })
})
