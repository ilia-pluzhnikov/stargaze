import { describe, expect, it } from 'vitest'
import { formatDayLong, formatDayWithDow } from './dates'

describe('formatDayWithDow', () => {
  it('день недели, число без ведущего нуля, месяц в родительном падеже', () => {
    expect(formatDayWithDow('2026-09-18')).toBe('пт 18 сен')
    expect(formatDayWithDow('2026-05-03')).toBe('вс 3 мая')
    expect(formatDayWithDow('2027-01-04')).toBe('пн 4 янв')
  })
})

describe('formatDayLong', () => {
  it('число без ведущего нуля, полный месяц в родительном падеже, год', () => {
    expect(formatDayLong('2026-06-14')).toBe('14 июня 2026')
    expect(formatDayLong('2026-03-02')).toBe('2 марта 2026')
  })
  it('граница года', () => {
    expect(formatDayLong('2026-12-31')).toBe('31 декабря 2026')
    expect(formatDayLong('2027-01-01')).toBe('1 января 2027')
  })
})
