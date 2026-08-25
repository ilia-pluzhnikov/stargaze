import { describe, expect, it } from 'vitest'
import { SKY_H, SKY_W } from '../logic/layout'
import { skyField } from './skyField'

const TINTS = ['#ffffff', '#ffdfc0', '#ffcf9e']

describe('skyField', () => {
  it('детерминизм: одинаковый сид — идентичный массив', () => {
    expect(skyField(80, 'test-seed', 40)).toEqual(skyField(80, 'test-seed', 40))
  })

  it('разные сиды — разные поля', () => {
    expect(skyField(30, 'a')).not.toEqual(skyField(30, 'b'))
  })

  it('count + ring штук; кольцо — вне основного прямоугольника', () => {
    const stars = skyField(50, 's', 30)
    expect(stars).toHaveLength(80)
    const ringStars = stars.slice(50)
    for (const s of ringStars) {
      const inside = s.x >= 0 && s.x <= SKY_W && s.y >= 0 && s.y <= SKY_H
      expect(inside).toBe(false)
    }
  })

  it('значения в диапазонах спеки', () => {
    const stars = skyField(400, 'ranges', 100)
    for (const s of stars) {
      expect(s.r).toBeGreaterThanOrEqual(0.4)
      expect(s.r).toBeLessThanOrEqual(2.4)
      expect(s.o).toBeGreaterThan(0)
      // фон тише контента: даже яркие не выходят за 0.65 (калибровка 21.07)
      expect(s.o).toBeLessThanOrEqual(0.65)
      expect(TINTS).toContain(s.fill)
      if (s.tw) {
        expect(s.twDur).toBeGreaterThanOrEqual(2.6)
        expect(s.twDur).toBeLessThanOrEqual(4.6)
        expect(s.twDelay).toBeGreaterThanOrEqual(0)
        expect(s.twDelay).toBeLessThanOrEqual(4)
      }
      if (s.bright) expect(s.r).toBeGreaterThanOrEqual(1.8)
    }
  })

  it('есть и яркие звёзды, и тёплые тинты, и мерцающие (на большом поле)', () => {
    const stars = skyField(800, 'variety')
    expect(stars.some((s) => s.bright)).toBe(true)
    expect(stars.some((s) => s.fill === '#ffdfc0')).toBe(true)
    expect(stars.some((s) => s.fill === '#ffcf9e')).toBe(true)
    expect(stars.filter((s) => s.tw).length).toBeGreaterThan(800 * 0.2)
  })
})
