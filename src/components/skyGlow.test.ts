import { describe, expect, it } from 'vitest'
import { TIERS } from '../types'
import { rarity, sky } from './skyColors'
import {
  bloomFalloff, bloomStops, coronaFalloff, coronaStops, glow, glowWeight, nebulaStops,
  rootBloomStops, rootCoronaStops, spikePath, spikeStops,
} from './skyGlow'
import type { GlowStop } from './skyGlow'

/** Стоп рецепта → числа; заодно страж формата: любой цвет рецепта — валидная hsla-строка. */
const parse = (stop: GlowStop) => {
  const m = /^hsla\((\d+), (\d+)%, (\d+)%, ([\d.]+)\)$/.exec(stop.color)
  if (!m) throw new Error(`не hsla: ${stop.color}`)
  return { offset: stop.offset, h: Number(m[1]), s: Number(m[2]), l: Number(m[3]), a: Number(m[4]) }
}
const colored = TIERS.filter((t) => rarity[t].s > 0)

/** Градиент рецепта: стопы от центра (0) до края (1) по возрастанию, на краю — ноль света. */
const expectGradient = (stops: GlowStop[], label: string) => {
  const p = stops.map(parse)
  expect(p[0].offset, label).toBe(0)
  expect(p[p.length - 1].offset, label).toBe(1)
  for (let i = 1; i < p.length; i++) expect(p[i].offset, label).toBeGreaterThan(p[i - 1].offset)
  expect(p[p.length - 1].a, label).toBe(0)
  return p
}

describe('спад света', () => {
  it('корона: 1 в центре, 0 на краю, строго убывает', () => {
    expect(coronaFalloff(0)).toBe(1)
    expect(coronaFalloff(1)).toBe(0)
    const samples = Array.from({ length: 21 }, (_, i) => coronaFalloff(i / 20))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1])
  })

  it('корона спадает круто: на половине радиуса остаётся меньше трети света', () => {
    expect(coronaFalloff(0.5)).toBeLessThan(1 / 3)
  })

  it('блум: сплошное ядро до плато, дальше убывает в ноль без подъёмов', () => {
    expect(bloomFalloff(0)).toBe(1)
    expect(bloomFalloff(glow.bloom.plateau)).toBe(1)
    expect(bloomFalloff(1)).toBe(0)
    const samples = Array.from({ length: 21 }, (_, i) => bloomFalloff(i / 20))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1])
  })
})

describe('корона звезды', () => {
  it('у каждого ранга — градиент цвета своей редкости, свет строго убывает к краю', () => {
    for (const t of TIERS) {
      const p = expectGradient(coronaStops(t), `ранг ${t}`)
      for (const stop of p) expect(stop.h, `ранг ${t}`).toBe(rarity[t].h)
      for (let i = 1; i < p.length; i++) expect(p[i].a, `ранг ${t}`).toBeLessThan(p[i - 1].a)
      expect(p[0].a, `ранг ${t}`).toBeLessThanOrEqual(glow.corona.maxAlpha)
    }
  })

  it('цвет насыщеннее редкости и не светлее её: корона красит небо, а не белит', () => {
    for (const t of colored) {
      for (const stop of coronaStops(t).map(parse)) {
        expect(stop.s, `ранг ${t}`).toBeGreaterThan(rarity[t].s)
        expect(stop.l, `ранг ${t}`).toBeLessThanOrEqual(rarity[t].l)
      }
    }
  })

  it('к краю корона темнее, чем в центре', () => {
    for (const t of TIERS) {
      const p = coronaStops(t).map(parse)
      expect(p[p.length - 1].l, `ранг ${t}`).toBeLessThan(p[0].l)
    }
  })

  it('серая D остаётся серой и светит слабее любого цветного ранга', () => {
    const d = coronaStops('D').map(parse)
    for (const stop of d) expect(stop.s).toBe(0)
    for (const t of colored) expect(d[0].a, `против ${t}`).toBeLessThan(parse(coronaStops(t)[0]).a)
  })

  it('вес свечения не убывает с рангом', () => {
    const weights = TIERS.map(glowWeight)
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(weights[i - 1])
    const peaks = TIERS.map((t) => parse(coronaStops(t)[0]).a)
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThanOrEqual(peaks[i - 1])
  })
})

describe('блум и лучи', () => {
  const hot = `hsla(${glow.hot.h}, ${glow.hot.s}%, ${glow.hot.l}%, 1)`

  it('раскалённая середина — тот же тёплый крем, что sky.litCore', () => {
    // hsl → rgb: рецепт хранит крем числами, палитра — hex; расходиться им нельзя
    const { h, s, l } = glow.hot
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100)
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l / 100 - c / 2
    const rgb = [c, x, 0].map((v) => Math.round((v + m) * 255)) // h в секторе 0..60°
    const hex = [1, 3, 5].map((i) => parseInt(sky.litCore.slice(i, i + 2), 16))
    rgb.forEach((v, i) => expect(Math.abs(v - hex[i])).toBeLessThanOrEqual(3))
  })

  it('блум: сплошное кремовое ядро до плато, дальше — цвет ранга, на краю ноль', () => {
    for (const t of TIERS) {
      const stops = bloomStops(t)
      const p = expectGradient(stops, `ранг ${t}`)
      stops.filter((s) => s.offset <= glow.bloom.plateau).forEach((s) => expect(s.color).toBe(hot))
      expect(stops.filter((s) => s.offset <= glow.bloom.plateau).length).toBeGreaterThanOrEqual(2)
      const tail = p.filter((s) => s.offset > glow.bloom.plateau)
      for (const stop of tail) expect(stop.h, `ранг ${t}`).toBe(rarity[t].h)
      // сразу за ядром — светлый оттенок, дальше светлота сходит к цвету ранга
      expect(tail[0].l).toBe(glow.bloom.tintLight)
      for (let i = 1; i < tail.length; i++) expect(tail[i].l).toBeLessThanOrEqual(tail[i - 1].l)
      for (let i = 1; i < p.length; i++) expect(p[i].a).toBeLessThanOrEqual(p[i - 1].a)
    }
  })

  it('луч: кремовый у ядра, к острию — цвет ранга и ноль', () => {
    for (const t of TIERS) {
      const p = expectGradient(spikeStops(t), `ранг ${t}`)
      expect(p[0].h).toBe(glow.hot.h)
      expect(p[0].a).toBeGreaterThan(0.9)
      expect(p[p.length - 1].h).toBe(rarity[t].h)
    }
  })

  it('контур луча — симметричный ромб с остриями на оси', () => {
    expect(spikePath(30, 1.5)).toBe('M-30 0 L0 -1.5 L30 0 L0 1.5 Z')
  })
})

describe('ядро галактики и небула — семейный hue навыка', () => {
  it('корона и блум ядра построены от hue', () => {
    const corona = expectGradient(rootCoronaStops(150), 'корона')
    for (const stop of corona) expect(stop.h).toBe(150)
    for (let i = 1; i < corona.length; i++) expect(corona[i].a).toBeLessThan(corona[i - 1].a)
    const bloom = expectGradient(rootBloomStops(150), 'блум')
    expect(bloom[0].h).toBe(glow.hot.h)
    expect(bloom[bloom.length - 1].h).toBe(150)
  })

  it('небула: в центре пик своего вида, цвет насыщенный и тёмный', () => {
    for (const size of ['galaxy', 'overview'] as const) {
      const p = expectGradient(nebulaStops(150, size), size)
      expect(p[0].a).toBeCloseTo(glow.nebula.peak[size], 3)
      for (let i = 1; i < p.length; i++) expect(p[i].a).toBeLessThan(p[i - 1].a)
      for (const stop of p) {
        expect(stop.h).toBe(150)
        expect(stop.s).toBeGreaterThanOrEqual(60)
        expect(stop.l).toBeLessThanOrEqual(50) // светлая небула — это и есть «белая пелена»
      }
    }
  })
})

describe('размеры слоёв', () => {
  it('корона шире блума, лучи длиннее блума; на обзоре коротких лучей нет', () => {
    for (const s of Object.values(glow.sizes)) {
      expect(s.corona).toBeGreaterThan(s.bloom)
      expect(s.spikeLong).toBeGreaterThan(s.bloom)
      expect(s.spikeLongWidth).toBeGreaterThan(0)
    }
    expect(glow.sizes.overview.spikeShort).toBe(0)
    expect(glow.sizes.galaxy.spikeShort).toBeGreaterThan(0)
  })

  it('детерминизм: одинаковый вход — одинаковый выход', () => {
    expect(coronaStops('A')).toEqual(coronaStops('A'))
    expect(nebulaStops(200, 'overview')).toEqual(nebulaStops(200, 'overview'))
  })
})
