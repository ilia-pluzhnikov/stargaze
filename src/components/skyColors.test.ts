import { describe, expect, it } from 'vitest'
import { TIERS } from '../types'
import { rarity, rarityVar, sky, tierStyle } from './skyColors'

describe('skyColors', () => {
  it('формулы от hue возвращают валидные hsl/hsla-строки', () => {
    expect(sky.galaxyCoreInner(200)).toMatch(/^hsla\(200, \d+%, \d+%, 0\.\d+\)$/)
    expect(sky.galaxyCoreOuter(0)).toMatch(/^hsla\(0, /)
    expect(sky.galaxyStroke(360)).toMatch(/^hsla\(360, /)
    expect(sky.xpBar(55)).toMatch(/^hsl\(55, \d+%, \d+%\)$/)
  })

  it('edge: achieved ярче, чем не-achieved', () => {
    const on = sky.edge(150, true)
    const off = sky.edge(150, false)
    expect(on).not.toEqual(off)
    const alpha = (s: string) => Number(s.match(/, ([\d.]+)\)$/)![1])
    expect(alpha(on)).toBeGreaterThan(alpha(off))
  })

  it('палитра редкости: у всех пяти рангов определён цвет и внутреннее имя', () => {
    for (const t of TIERS) {
      const c = rarity[t]
      expect(c.name.length, `ранг ${t}`).toBeGreaterThan(0)
      expect(c.h).toBeGreaterThanOrEqual(0)
      expect(c.h).toBeLessThanOrEqual(360)
      expect(c.l).toBeGreaterThan(0)
    }
  })

  it('ни один цвет редкости не попадает в запрещённую бренд-зону hue 15–35', () => {
    for (const t of TIERS) {
      const c = rarity[t]
      if (c.s === 0) continue // серый D: hue без насыщенности не имеет значения
      expect(c.h < 15 || c.h > 35, `ранг ${t}: hue ${c.h}`).toBe(true)
    }
  })

  it('звезда: зажжённая — тёплое кремовое ядро, незажжённая — цвет редкости ранга', () => {
    for (const t of TIERS) {
      expect(sky.starFill(true, t)).toBe(sky.litCore)
      expect(sky.starStroke(true, t)).toBe('#FFE9BE')
      expect(sky.starFill(false, t)).toMatch(new RegExp(`^hsla\\(${rarity[t].h}, ${rarity[t].s}%, `))
      expect(sky.starStroke(false, t)).toMatch(new RegExp(`^hsla\\(${rarity[t].h}, ${rarity[t].s}%, `))
    }
  })

  it('ореол редкости построен от цвета своего ранга, внешний стоп прозрачный', () => {
    for (const t of TIERS) {
      const h = sky.rarityHalo(t)
      expect(h.inner).toMatch(new RegExp(`^hsla\\(${rarity[t].h}, ${rarity[t].s}%, `))
      expect(h.mid).toMatch(new RegExp(`^hsla\\(${rarity[t].h}, `))
      expect(h.outer).toMatch(/, 0\)$/)
    }
  })

  it('ореол: у D («обычной») аура тусклее любого цветного ранга', () => {
    const alpha = (s: string) => Number(/([\d.]+)\)$/.exec(s)![1])
    for (const t of TIERS) {
      if (t === 'D') continue
      expect(alpha(sky.rarityHalo('D').inner), `inner vs ${t}`).toBeLessThan(alpha(sky.rarityHalo(t).inner))
      expect(alpha(sky.rarityHalo('D').mid), `mid vs ${t}`).toBeLessThan(alpha(sky.rarityHalo(t).mid))
    }
  })

  it('легенда рангов — цвет редкости с пониженной альфой', () => {
    for (const t of TIERS) {
      expect(sky.rankLabel(t)).toMatch(new RegExp(`^hsla\\(${rarity[t].h}, `))
      const alpha = Number(/([\d.]+)\)$/.exec(sky.rankLabel(t))![1])
      expect(alpha).toBeLessThanOrEqual(0.6)
    }
  })

  it('семейный hue живёт: корень, небула, глиф — формулы от hue навыка', () => {
    const root = sky.rootHalo(150)
    expect(root.inner).toMatch(/^hsla\(150, /)
    expect(root.outer).toMatch(/, 0\)$/)
    const n = sky.nebula(150)
    expect(n.core).toMatch(/^hsla\(150, /)
    expect(n.edge).toMatch(/, 0\)$/)
    expect(sky.glyphStroke(150)).toMatch(/^hsla\(150, /)
    expect(sky.litCore).toBe('#FFF3D9')
    expect(sky.flare).toBe('#FFEFC9')
  })

  it('edgeGlow: семейный hue, зажжённое ребро ярче, альфа ≤ 0.85 даже у S', () => {
    const alpha = (s: string) => Number(/([\d.]+)\)$/.exec(s)![1])
    expect(sky.edgeGlow(150, true, 'C')).toMatch(/^hsla\(150, /)
    expect(alpha(sky.edgeGlow(150, true, 'C'))).toBeGreaterThan(alpha(sky.edgeGlow(150, false, 'C')))
    expect(alpha(sky.edgeGlow(200, true, 'S'))).toBeLessThanOrEqual(0.85)
  })

  it('детерминизм: одинаковый вход — одинаковый выход', () => {
    expect(sky.starFill(false, 'A')).toEqual(sky.starFill(false, 'A'))
  })

  it('константы: подписи — белый/серый, трек — полупрозрачный белый', () => {
    expect(sky.label).toBe('#ffffff')
    expect(sky.labelDim).toBe('#a0a0a0')
    expect(sky.track).toBe('rgba(255, 255, 255, 0.08)')
  })

  it('масштаб монотонно растёт от D к S', () => {
    const scales = TIERS.map((t) => tierStyle[t].scale)
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1])
  })

  it('rarityVar: CSS-токен редкости по рангу для HTML-поверхностей', () => {
    expect(rarityVar('D')).toBe('var(--rarity-d)')
    expect(rarityVar('S')).toBe('var(--rarity-s)')
  })
})
