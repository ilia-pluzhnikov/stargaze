import type { Tier } from '../types'

/** Масштаб и вес свечения по рангу; светлоту и цвет звезды задаёт палитра редкости.
 * База масштаба ×1.25 (21.07): звёзды укрупнены пропорционально, C = 1.25. */
export const tierStyle: Record<Tier, { scale: number; glow: number }> = {
  D: { scale: 1.06, glow: 0.8 },
  C: { scale: 1.25, glow: 1.0 },
  B: { scale: 1.4, glow: 1.15 },
  A: { scale: 1.6, glow: 1.35 },
  S: { scale: 1.88, glow: 1.6 },
}

/** Палитра редкости лута (лестница WoW/Diablo): точный ранг звезды = цвет.
 * Сознательные решения спеки 2026-07-18: C зелёный ниже B синего
 * (лут-конвенция), S — золото hue 43, вне запрещённой бренд-зоны 15–35
 * (акцент #FF7715). name — внутреннее имя палитры, в UI не выводится. */
export const rarity: Record<Tier, { h: number; s: number; l: number; name: string }> = {
  D: { h: 0, s: 0, l: 72, name: 'Common' },
  C: { h: 110, s: 55, l: 55, name: 'Uncommon' },
  B: { h: 210, s: 85, l: 62, name: 'Rare' },
  A: { h: 272, s: 75, l: 66, name: 'Epic' },
  S: { h: 43, s: 95, l: 60, name: 'Legendary' },
}

/** CSS-токен редкости для HTML-поверхностей (значения зеркалит :root в index.css). */
export const rarityVar = (tier: Tier) => `var(--rarity-${tier.toLowerCase()})`

const clamp01 = (x: number) => Math.min(0.85, x)
/** hsla от цвета редкости ранга; dl — сдвиг светлоты (кламп 95%). */
const rar = (tier: Tier, a: number, dl = 0) => {
  const c = rarity[tier]
  return `hsla(${c.h}, ${c.s}%, ${Math.min(95, c.l + dl)}%, ${a})`
}

/** Цвета SVG-неба — единственная точка калибровки палитры неба.
 * Презентация, не ядро. Семейный hue навыка живёт на небуле, рёбрах, глифе
 * и корне; сами звёзды красятся редкостью ранга (спека 2026-07-18).
 * HTML-часть берёт цвета из CSS-токенов --rarity-* (index.css). */
export const sky = {
  galaxyCoreInner: (hue: number) => `hsla(${hue}, 75%, 68%, 0.12)`,
  galaxyCoreOuter: (hue: number) => `hsla(${hue}, 70%, 70%, 0.24)`,
  galaxyStroke: (hue: number) => `hsla(${hue}, 55%, 75%, 0.8)`,
  edge: (hue: number, achieved: boolean) => `hsla(${hue}, 40%, 70%, ${achieved ? 0.55 : 0.25})`,
  /** Незажжённая — цвет редкости ранга (альфа в цвете); зажжённая — тёплый крем «Неба-3».
   * Без высветления и плотнее (21.07): полупрозрачная заливка и светлая
   * обводка серили цвет — синий B читался выцветшим. */
  starFill: (lit: boolean, tier: Tier) => (lit ? '#FFF3D9' : rar(tier, 0.8)),
  starStroke: (lit: boolean, tier: Tier) => (lit ? '#FFE9BE' : rar(tier, 0.95)),
  /** Glow-подложка рёбер на обзоре — семейный hue, вес по рангу целевой звезды. */
  edgeGlow: (hue: number, lit: boolean, tier: Tier) =>
    `hsla(${hue}, 80%, 68%, ${clamp01((lit ? 0.5 : 0.25) * tierStyle[tier].glow)})`,
  xpBar: (hue: number) => `hsl(${hue}, 55%, 68%)`,
  track: 'rgba(255, 255, 255, 0.08)',
  label: '#ffffff',
  labelDim: '#a0a0a0',
  /** тёплое ядро зажжённой звезды и кремовые кресты-флеры (лаборатория неба) */
  litCore: '#FFF3D9',
  flare: '#FFEFC9',
  /** стопы radialGradient ореола звезды — цвет редкости ранга.
   * Светлоту почти не поднимаем (было +14): выбеливание съедало hue, и
   * зажжённые D и C сливались (поймано глазами 21.07). D — «обычная»:
   * аура едва заметна, цветом редкости светятся C и выше (лут-язык:
   * серые предметы не сияют). */
  rarityHalo: (tier: Tier) => {
    const common = tier === 'D'
    return {
      inner: rar(tier, common ? 0.4 : 0.95, 0),
      mid: rar(tier, common ? 0.14 : 0.5, -8),
      outer: rar(tier, 0, 0),
    }
  },
  /** более спокойный ореол корня созвездия — семейный hue */
  rootHalo: (hue: number) => ({
    inner: `hsla(${hue}, 80%, 80%, 0.5)`,
    outer: `hsla(${hue}, 80%, 65%, 0)`,
  }),
  /** стопы radialGradient небулы за созвездием — семейный hue */
  nebula: (hue: number) => ({
    core: `hsla(${hue}, 58%, 52%, 0.08)`,
    edge: `hsla(${hue}, 58%, 52%, 0)`,
  }),
  glyphStroke: (hue: number) => `hsla(${hue}, 62%, 76%, 1)`,
  /** легенда рангов — цвет редкости, пониженная альфа, чтобы не кричала */
  rankLabel: (tier: Tier) => rar(tier, 0.55, 14),
} as const
