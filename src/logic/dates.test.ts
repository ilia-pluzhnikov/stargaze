import { describe, expect, it } from 'vitest'
import { formatDayWithDow } from './dates'

describe('formatDayWithDow', () => {
  it('день недели, число без ведущего нуля, месяц в родительном падеже', () => {
    expect(formatDayWithDow('2026-09-18')).toBe('пт 18 сен')
    expect(formatDayWithDow('2026-05-03')).toBe('вс 3 мая')
    expect(formatDayWithDow('2027-01-04')).toBe('пн 4 янв')
  })
})
