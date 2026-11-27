import { describe, expect, it } from 'vitest'
import { SKY_GLYPH_GROUPS, SKY_GLYPHS, glyphById } from './skyGlyphs'

describe('skyGlyphs', () => {
  it('id глифов — публичный контракт: первые двенадцать на месте', () => {
    const ids = new Set(SKY_GLYPHS.map((g) => g.id))
    for (const id of ['delta', 'lantern', 'tower', 'quill', 'caduceus', 'crescent',
      'lotus', 'scales', 'lighthouse', 'helm', 'sword', 'tree']) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('id уникальны', () => {
    expect(new Set(SKY_GLYPHS.map((g) => g.id)).size).toBe(SKY_GLYPHS.length)
  })

  it('у каждого глифа — известная тема, имя, смысл и контур', () => {
    const groups = new Set(SKY_GLYPH_GROUPS.map((g) => g.id))
    for (const g of SKY_GLYPHS) {
      expect(groups.has(g.group), g.id).toBe(true)
      expect(g.name.trim(), g.id).not.toBe('')
      expect(g.meaning.trim(), g.id).not.toBe('')
      expect(g.paths.length, g.id).toBeGreaterThan(0)
      for (const d of g.paths) expect(d, g.id).toMatch(/^M/)
    }
  })

  it('пустых тем нет, и в теме до 5 глифов — ряд формы навыка', () => {
    for (const grp of SKY_GLYPH_GROUPS) {
      const count = SKY_GLYPHS.filter((g) => g.group === grp.id).length
      expect(count, grp.id).toBeGreaterThan(0)
      expect(count, grp.id).toBeLessThanOrEqual(5)
    }
  })

  it('глифы идут по темам подряд — в порядке тем формы', () => {
    const order = SKY_GLYPH_GROUPS.map((g) => g.id)
    const seen = SKY_GLYPHS.map((g) => order.indexOf(g.group))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('glyphById: неизвестный id и пустое значение — без глифа', () => {
    expect(glyphById('owl')?.name).toBe('Сова')
    expect(glyphById('no-such-glyph')).toBeNull()
    expect(glyphById(undefined)).toBeNull()
    expect(glyphById(null)).toBeNull()
    expect(glyphById('')).toBeNull()
  })
})
