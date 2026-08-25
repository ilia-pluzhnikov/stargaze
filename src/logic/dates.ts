/** 'YYYY-MM-DD' в локальном часовом поясе. */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function todayKey(): string {
  return dayKey(new Date())
}

/** day-key ± n дней (в полдень, чтобы не зацепить DST-края). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  dt.setDate(dt.getDate() + n)
  return dayKey(dt)
}

/** День недели day-key: 0=вс..6=сб. */
export function dowOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getDay()
}

export function formatDayShort(key: string): string {
  const [, m, d] = key.split('-')
  return `${d}.${m}`
}

/** Полных дней между day-ключами: diffDays('2026-08-10','2026-08-07') = 3. UTC-арифметика, DST не влияет. */
export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86_400_000)
}

/** Строгая календарная валидность 'YYYY-MM-DD' («2026-99-99» не пройдёт). */
export function isCalendarDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
