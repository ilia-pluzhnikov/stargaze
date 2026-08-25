import type { Quest, Store } from '../types'
import { addDays, diffDays } from './dates'

// Константы экономики. Формулы и лестница стимулов меняются только вместе со
// спекой 2026-08-05-stargaze-sparks-economy-design.md и тестами (§10).
export const GAME_TZ_OFFSET_H = 7        // игровой пояс UTC+7 (Бангкок)
export const SPARKS_EPOCH = '2026-08-07' // день активации: просрочки до него амнистированы (спека §11)
export const DRAIN_RATE = 0.10           // доля R за полный день просрочки
export const DRAIN_CAP = 1.0             // потолок капания = 1×R
export const FREE_MOVES_PER_7D = 3       // бесплатных переносов за rolling-окно
export const MOVE_FEE_RATE = 0.10
export const CANCEL_FEE_BASE = 0.5
export const XP_REWARD_MAX = 1000        // технический предел (валидация)

// Целочисленные знаменатели ставок: наивное умножение на 0.1 ловит float-шум
// (0.1×100 = 10.000000000000002 → ceil = 11). Менять ставки — только вместе
// с этими знаменателями.
const CAP_DAYS = Math.round(DRAIN_CAP / DRAIN_RATE) // 10
const MOVE_FEE_DEN = Math.round(1 / MOVE_FEE_RATE)  // 10

// Момент ISO: дата (10 симв.) + T + часы:минуты (секунды/доли не влияют на день,
// не захватываем) + опциональный офсет ('Z' или '+HH:MM'/'-HH:MM').
const ISO_MOMENT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

/** Смещение офсета в минутах: '+07:00' → 420, '-07:00' → −420. */
function offsetMinutes(designator: string | undefined): number {
  if (!designator || designator === 'Z') return 0
  const sign = designator[0] === '-' ? -1 : 1
  const [oh, om] = designator.slice(1).split(':').map(Number)
  return sign * (oh * 60 + om)
}

/** Финансовый день ISO-таймстампа в игровом поясе. Разбор регуляркой и
 * календарная арифметика через `addDays` — без единого `new Date(iso)`: он
 * парсит строку без designator как ЛОКАЛЬНОЕ время машины (не UTC), что и
 * есть тот самый недетерминизм, ради устранения которого функция написана —
 * ts приходит из payload агента через API, где designator не гарантирован. */
export function dayInGameTz(iso: string): string {
  const m = ISO_MOMENT_RE.exec(iso)
  if (!m) {
    // Нераспознанный формат: деградация до календарной части строки, если она
    // читается (00:00 UTC по умолчанию) — детерминированно, без NaN-мусора.
    const dateOnly = /^\d{4}-\d{2}-\d{2}/.exec(iso)
    return dateOnly ? dateOnly[0] : iso
  }
  const [, day, hh, mm, offset] = m
  // Отсутствие designator трактуем как UTC — детерминированный выбор вместо
  // локального пояса машины.
  const gameMinutes = Number(hh) * 60 + Number(mm) - offsetMinutes(offset) + GAME_TZ_OFFSET_H * 60
  const dayShift = Math.floor(gameMinutes / 1440) // floor, не усечение: переход через полночь в обе стороны (−1/0/+1)
  return addDays(day, dayShift)
}

/** Сегодня в игровом поясе — «сегодня» для всех голов. Локальный день машины
 * (todayKey) годится только там, где день не сравнивается с данными: у игрока
 * в поездке и у сервера в UTC он расходится с игровым и уводит день у ledger,
 * xpLog, стриков и расписания. */
export function todayInGameTz(): string {
  return dayInGameTz(new Date().toISOString())
}

/** Контрактный квест — short/mid/long (не привычка). */
export function isContract(q: Quest): boolean {
  return q.type !== 'repeating'
}

/** День, с которого капает просрочка: амнистия долгам до запуска экономики
 * и до принятия квеста. Осмыслен только у квестов с dueDate. */
export function drainStart(q: Quest): string {
  let start = q.dueDate ?? SPARKS_EPOCH
  const created = dayInGameTz(q.createdAt)
  if (created > start) start = created
  if (q.acceptedAt) {
    const accepted = dayInGameTz(q.acceptedAt)
    if (accepted > start) start = accepted
  }
  if (SPARKS_EPOCH > start) start = SPARKS_EPOCH
  return start
}

/** Вычисляемое капание активного контракта на день today; 0 для остального. */
export function provisionForQuest(q: Quest, today: string): number {
  if (q.status !== 'active' || !isContract(q) || !q.dueDate) return 0
  const d = Math.max(0, diffDays(today, drainStart(q)))
  // «целые перемножили — поделили в конце»: ceil(min(d,10)·R/10) ≡ ceil(min(d·0.1,1)·R) без float-шума
  return Math.ceil((Math.min(d, CAP_DAYS) * q.xpReward) / CAP_DAYS)
}

export function provisionTotal(store: Store, today: string): number {
  let total = 0
  for (const q of store.quests) total += provisionForQuest(q, today)
  return total
}

export function ledgerTotal(store: Store): number {
  let total = 0
  for (const e of store.ledger ?? []) total += e.amount
  return total
}

/** Баланс кошелька: Σ ledger − провизии. Может быть отрицательным; нигде не хранится. */
export function sparksBalance(store: Store, today: string): number {
  return ledgerTotal(store) - provisionTotal(store, today)
}

/** Сколько слотов rolling-окна [day−6, day] уже потрачено (по всем квестам). */
export function movesUsedIn7d(store: Store, day: string): number {
  const from = addDays(day, -6)
  let used = 0
  for (const q of store.quests)
    for (const m of q.dueDateHistory ?? []) if (m.day >= from && m.day <= day) used++
  return used
}

/** Цена платного переноса: 10% награды. */
export function moveFeeFor(q: Quest): number {
  return Math.ceil(q.xpReward / MOVE_FEE_DEN)
}

/** Неустойка отмены: min(R, 0.5·R + 0.5·провизия) — растёт с просрочкой, потолок R. */
export function cancelFeeFor(q: Quest, day: string): number {
  const r = q.xpReward
  return Math.ceil(Math.min(r, CANCEL_FEE_BASE * r + 0.5 * provisionForQuest(q, day)))
}

/** Анти-бэкфилл-окно выплат: day = сегодня или вчера в игровом поясе относительно ts. */
export function earnWindowOk(day: string, ts: string): boolean {
  // ts приходит из payload и не обязан быть строкой (API проверяет только type):
  // без момента окно не выполнено, а арифметика дней не запускается вовсе — иначе
  // diffDays падает на .split и запрос получает 500 вместо внятного отказа валидации
  if (typeof ts !== 'string') return false
  const d = diffDays(dayInGameTz(ts), day)
  return d === 0 || d === 1
}

/** День, по которому считаются деньги: то же окно, что у выплаты, — вне
 * «сегодня/вчера» относительно ts берётся игровой день ts. Провизия растёт со
 * временем, поэтому day из прошлого завышал бы баланс, удешевлял отмену и
 * пропускал перенос в фактическое прошлое; day приходит из payload (агент через
 * API) или консервируется офлайн-очередью веба. */
export function settlementDay(day: string, ts: string): string {
  // на нестроковом ts (см. earnWindowOk) остаёмся на day: запрос дойдёт до
  // validateStore и получит 422 со списком, а не 500 из недр арифметики дней.
  // Записать что-либо это не даст — событие без строкового ts валидация отвергает
  if (typeof ts !== 'string') return day
  return earnWindowOk(day, ts) ? day : dayInGameTz(ts)
}

/** Σ незареверсённых earn за окно последних N игровых дней (включая today) — опора калибровки цен. */
export function emissionInDays(store: Store, today: string, days: number): number {
  const from = addDays(today, -(days - 1))
  const reversed = new Set(
    (store.ledger ?? []).filter((e) => e.kind === 'reversal' && e.reversesId).map((e) => e.reversesId),
  )
  return (store.ledger ?? [])
    .filter((e) => e.kind === 'earn' && !reversed.has(e.id) && e.day >= from && e.day <= today)
    .reduce((sum, e) => sum + e.amount, 0)
}

/** Дни живых покупок по позициям: itemId → day последнего не развёрнутого spend.
 * «Куплена» у разовой награды не хранится — вычисляется отсюда (цикл 16). */
export function purchasedDays(store: Store): Map<string, string> {
  const ledger = store.ledger ?? []
  const reversed = new Set<string>()
  for (const e of ledger) if (e.kind === 'reversal' && e.reversesId !== undefined) reversed.add(e.reversesId)
  const days = new Map<string, string>()
  for (const e of ledger)
    if (e.kind === 'spend' && e.itemId !== undefined && !reversed.has(e.id)) days.set(e.itemId, e.day)
  return days
}

/** Худший зафиксированный долг с поправкой на текущее капание: дно
 * префиксных сумм ledger минус сегодняшние провизии; всегда ≤ 0 и ≤ баланса
 * (последний элемент — всегда граница, поэтому min ≤ Σledger). Префиксы
 * берутся только на границах ts-групп: события одного dispatch (связка
 * earn+drain сдачи, пара reversal отката) делят один ts, и префикс в
 * середине группы — фантомное дно, которого баланс не касался. Вычитание
 * провизий держит якорь на месте при погашении (earn растит ratio трека),
 * а новое капание углубляет его честно. */
export function debtAnchor(store: Store, today: string): number {
  const ledger = store.ledger ?? []
  let run = 0
  let min = 0
  for (let i = 0; i < ledger.length; i++) {
    run += ledger[i].amount
    const midGroup = i + 1 < ledger.length && ledger[i + 1].ts === ledger[i].ts
    if (!midGroup && run < min) min = run
  }
  return min - provisionTotal(store, today)
}

// Окно темпа эмиссии растёт вместе с историей экономики до потолка 4 недель:
// 7-дневное дёргается от одной сдачи, а фиксированные 28 занижали бы темп,
// пока экономика моложе окна.
export const RATE_WINDOW_MAX_DAYS = 28

/** Темп эмиссии ✨/нед: незареверсённые earn за окно, приведённые к неделе. */
export function weeklyRate(store: Store, today: string): number {
  const windowDays = Math.max(1, Math.min(RATE_WINDOW_MAX_DAYS, diffDays(today, SPARKS_EPOCH) + 1))
  return (emissionInDays(store, today, windowDays) * 7) / windowDays
}
