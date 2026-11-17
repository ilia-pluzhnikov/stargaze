import type { Tier } from '../types'
import { rarity, tierStyle } from './skyColors'

/**
 * Рецепт свечения зажжённой звезды — единственное место, где живут его числа.
 * 2D-небо (SVG) строит по ним градиенты; 3D (canvas) кода не разделяет, но берёт те же
 * числа: радиусы слоёв, стопы, альфы и смешение.
 *
 * Контраст даёт не количество света, а его форма: тёмное небо, маленькое раскалённое
 * ядро, тугой светлый блум и широкая насыщенная корона с крутым спадом. Цвет света —
 * насыщенный и к краю темнее: светлые ненасыщенные ореолы, наложенные друг на друга,
 * дают серую пелену. Размытия (feGaussianBlur) в рецепте нет: мягкость дают стопы
 * градиента — фильтр пересчитывался на каждый кадр пана и зума.
 */
export const glow = {
  /** Смешение слоёв света при перекрытии. svg — 2D-небо: обычное; слой смешения на каждую
   * звезду (mix-blend-mode: screen) стоил +30–50% кадра, а на тёмном разреженном небе его
   * не видно. canvas — спрайты, которые перекрываются плотно (3D): свет складывать
   * (globalCompositeOperation), иначе полупрозрачные ореолы белят друг друга. */
  blend: { svg: 'normal', canvas: 'lighter' },
  /** Раскалённая середина — тёплый крем зажжённой звезды (sky.litCore, #FFF3D9). */
  hot: { h: 41, s: 100, l: 93 },
  /** Корона — широкий мягкий свет цвета редкости, к краю темнее. Спад — лоренциан
   * 1 / (1 + (t / r0)²), сведённый в ноль на краю: острый пик и длинный слабый хвост,
   * так светит точечный источник, а не «заливка». peak — альфа в центре до веса ранга. */
  corona: {
    r0: 0.35, offsets: [0, 0.12, 0.26, 0.42, 0.6, 0.8, 1],
    peak: 0.68, maxAlpha: 0.9, saturate: 20, lightInner: 0, lightOuter: -18,
  },
  /** Блум — тугой яркий свет вокруг ядра. До plateau — сплошное раскалённое ядро, дальше
   * альфа падает как (1 − u)^power: без видимой кромки, с нулевым наклоном на краю.
   * Цвет: крем → светлый оттенок ранга (tintLight) → цвет ранга. */
  bloom: {
    plateau: 0.16, power: 2.2, offsets: [0, 0.16, 0.28, 0.44, 0.62, 0.82, 1],
    tintLight: 88, bodyLift: 12,
  },
  /** Лучи: ромб, сходящийся в остриё; свет гаснет к концам. */
  spike: { tintAt: 0.3, tintLight: 86, tintAlpha: 0.62, shortOpacity: 0.55 },
  /** «Обычная» D почти не сияет цветом: серые предметы не светятся (лут-язык). */
  commonDim: 0.4,
  /** Размеры слоёв в единицах звезды; множатся на tierStyle[tier].scale.
   * galaxy — открытая галактика, overview — мини-созвездие обзорного неба (до scale 0.25). */
  sizes: {
    galaxy: { corona: 36, bloom: 15, spikeLong: 32, spikeLongWidth: 1.5, spikeShort: 13, spikeShortWidth: 1 },
    overview: { corona: 46, bloom: 22, spikeLong: 34, spikeLongWidth: 1.8, spikeShort: 0, spikeShortWidth: 0 },
  },
  /** Ядро галактики (корень созвездия) — семейный hue навыка. */
  root: { peak: 0.55, saturation: 85, light: 62, corona: 46, bloom: 18 },
  /** Небула за созвездием — семейный hue: насыщенная и тёмная, чтобы красить небо, а не
   * белить его. profile — [доля радиуса, доля пика]; peak — альфа в центре по видам.
   * radius — полуоси эллипса [rx, ry] в единицах мира: ровно до видимого края. Небула —
   * самая большая заливка кадра, невидимый хвост градиента стоил бы как видимая часть. */
  nebula: {
    saturation: 72, light: 48, lightOuter: 38,
    profile: [[0, 1], [0.45, 0.42], [0.8, 0.14], [1, 0]],
    peak: { galaxy: 0.16, overview: 0.22 },
    radius: { galaxy: [365, 247], overview: [145, 108] },
  },
} as const

export type GlowSize = keyof typeof glow.sizes

/** Стоп градиента: offset — доля радиуса 0..1. */
export interface GlowStop {
  offset: number
  color: string
}

const clampPct = (x: number) => Math.round(Math.min(100, Math.max(0, x)))
const hsla = (h: number, s: number, l: number, a: number) =>
  `hsla(${h}, ${clampPct(s)}%, ${clampPct(l)}%, ${Number(Math.min(1, Math.max(0, a)).toFixed(3))})`

const lorentz = (t: number) => 1 / (1 + (t / glow.corona.r0) ** 2)

/** Доля света короны на расстоянии t (0 — центр, 1 — край): 1 в центре, строго убывает, 0 на краю. */
export function coronaFalloff(t: number): number {
  const edge = lorentz(1)
  return (lorentz(t) - edge) / (1 - edge)
}

/** Доля света блума: 1 на плато ядра, дальше плавно в ноль. */
export function bloomFalloff(t: number): number {
  const { plateau, power } = glow.bloom
  if (t <= plateau) return 1
  return (1 - (t - plateau) / (1 - plateau)) ** power
}

/** Вес свечения ранга: «вес» из tierStyle, у D — приглушён. */
export const glowWeight = (tier: Tier) => tierStyle[tier].glow * (tier === 'D' ? glow.commonDim : 1)

/** Насыщенность цвета редкости для света; серый D остаётся серым. */
const lightSat = (tier: Tier) => (rarity[tier].s === 0 ? 0 : rarity[tier].s + glow.corona.saturate)

const coronaFrom = (h: number, s: number, l: number, peak: number): GlowStop[] =>
  glow.corona.offsets.map((t) => ({
    offset: t,
    color: hsla(
      h,
      s,
      l + glow.corona.lightInner + (glow.corona.lightOuter - glow.corona.lightInner) * t,
      Math.min(glow.corona.maxAlpha, peak) * coronaFalloff(t),
    ),
  }))

const bloomFrom = (h: number, s: number, l: number): GlowStop[] => {
  const { plateau, offsets, tintLight, bodyLift } = glow.bloom
  const tintAt = offsets.find((t) => t > plateau) ?? 1
  return offsets.map((t) => {
    if (t <= plateau) return { offset: t, color: hsla(glow.hot.h, glow.hot.s, glow.hot.l, 1) }
    // сразу за ядром — светлый оттенок, дальше светлота сходит к цвету ранга
    const u = (t - tintAt) / (1 - tintAt)
    const light = t === tintAt ? tintLight : l + bodyLift * (1 - u)
    return { offset: t, color: hsla(h, s, light, bloomFalloff(t)) }
  })
}

const spikeFrom = (h: number, s: number, l: number): GlowStop[] => [
  { offset: 0, color: hsla(glow.hot.h, glow.hot.s, glow.hot.l, 0.95) },
  { offset: glow.spike.tintAt, color: hsla(h, s, glow.spike.tintLight, glow.spike.tintAlpha) },
  { offset: 1, color: hsla(h, s, l, 0) },
]

/** Широкая корона звезды — насыщенный цвет редкости её ранга. */
export function coronaStops(tier: Tier): GlowStop[] {
  const c = rarity[tier]
  return coronaFrom(c.h, lightSat(tier), c.l, glow.corona.peak * glowWeight(tier))
}

/** Тугой блум: раскалённое кремовое ядро, светлый оттенок, цвет ранга, прозрачный край. */
export function bloomStops(tier: Tier): GlowStop[] {
  const c = rarity[tier]
  return bloomFrom(c.h, lightSat(tier), c.l)
}

/** Луч: кремовый у ядра, к острию — цвет ранга и ноль. Градиент ложится на рамку ромба. */
export function spikeStops(tier: Tier): GlowStop[] {
  const c = rarity[tier]
  return spikeFrom(c.h, lightSat(tier), c.l)
}

/** Корона ядра галактики — семейный hue навыка. */
export const rootCoronaStops = (hue: number): GlowStop[] =>
  coronaFrom(hue, glow.root.saturation, glow.root.light, glow.root.peak)

/** Блум ядра галактики — тот же ход «крем → оттенок → цвет», от hue навыка. */
export const rootBloomStops = (hue: number): GlowStop[] => bloomFrom(hue, glow.root.saturation, glow.root.light)

/** Небула за созвездием: цвет навыка, к краю темнее и в ноль. */
export const nebulaStops = (hue: number, size: GlowSize): GlowStop[] =>
  glow.nebula.profile.map(([t, share]) => ({
    offset: t,
    color: hsla(
      hue,
      glow.nebula.saturation,
      glow.nebula.light + (glow.nebula.lightOuter - glow.nebula.light) * t,
      glow.nebula.peak[size] * share,
    ),
  }))

/** Контур луча: ромб длиной 2·length и толщиной 2·width с центром в (0, 0). */
export const spikePath = (length: number, width: number) =>
  `M${-length} 0 L0 ${-width} L${length} 0 L0 ${width} Z`
