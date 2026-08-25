import type { Store, WishlistItem } from '../types'
import { debtAnchor, purchasedDays, sparksBalance, weeklyRate } from './sparks'

// Доля трека под зону погашения долга; занята, только когда баланс < 0.
// Значение — вместе со спекой 2026-08-18-stargaze-savings-track-design.md §3.2.
export const DEBT_ZONE = 0.22

export interface TrackMilestone {
  item: WishlistItem
  pos: number      // 0..1 позиция на треке
  reached: boolean // цена ≤ баланс — то же условие, что у кнопки «Купить»
}

export interface TrackEta {
  kind: 'toZero' | 'toItem'
  title?: string // toItem: название цели
  weeks: number  // ceil(остаток / rate)
}

export interface TrackModel {
  balance: number
  zeroPos: number // 0 или DEBT_ZONE
  debt: { anchor: number; ratio: number } | null // только при balance < 0
  milestones: TrackMilestone[]
  fill: number    // 0..1
  rate: number    // ✨/нед, до округления
  eta: TrackEta | null
}

/** Модель трека накоплений: вычисляется, не хранится. null — показывать
 * нечего (вех нет и баланс ≥ 0); вех нет, но долг есть → трек «долг → 0»
 * без вех: прогресс погашения ценен сам по себе. */
export function trackModel(store: Store, today: string): TrackModel | null {
  const balance = sparksBalance(store, today)
  // купленная разовая — не цель: на треке она выглядела бы серой «недостижимой» (враньё)
  const bought = purchasedDays(store)
  const priced = (store.wishlist ?? [])
    .filter((w) => !w.archived && w.kind === 'small' && w.price !== undefined
      && (w.repeatable || !bought.has(w.id)))
    .sort((a, b) =>
      a.price! - b.price! || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  if (priced.length === 0 && balance >= 0) return null

  const zeroPos = balance < 0 ? DEBT_ZONE : 0
  const n = priced.length
  const milestones: TrackMilestone[] = priced.map((item, i) => ({
    item,
    pos: zeroPos + ((i + 1) * (1 - zeroPos)) / n,
    reached: item.price! <= balance,
  }))

  let debt: TrackModel['debt'] = null
  let fill: number
  if (balance < 0) {
    const anchor = debtAnchor(store, today) // ≤ balance < 0 — деления на ноль нет
    const ratio = 1 - balance / anchor
    debt = { anchor, ratio }
    fill = ratio * zeroPos
  } else {
    // кусочно-линейно по опорным ценам: 0 → P₁ → … → P_n (спека §3.3)
    fill = zeroPos
    let prevPrice = 0
    let prevPos = zeroPos
    for (const m of milestones) {
      const price = m.item.price!
      if (balance >= price) {
        fill = m.pos
      } else {
        // сегмент нулевой ценовой длины (равные цены) не интерполируется
        fill = price > prevPrice
          ? prevPos + ((balance - prevPrice) / (price - prevPrice)) * (m.pos - prevPos)
          : prevPos
        break
      }
      prevPrice = price
      prevPos = m.pos
    }
  }

  const rate = weeklyRate(store, today)
  let eta: TrackEta | null = null
  if (rate > 0) {
    if (balance < 0) {
      eta = { kind: 'toZero', weeks: Math.ceil(-balance / rate) }
    } else {
      const next = milestones.find((m) => !m.reached)
      if (next) {
        eta = { kind: 'toItem', title: next.item.title, weeks: Math.ceil((next.item.price! - balance) / rate) }
      }
    }
  }

  return { balance, zeroPos, debt, milestones, fill, rate, eta }
}
