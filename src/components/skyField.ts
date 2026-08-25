import { SKY_H, SKY_W, hashStr, mulberry32 } from '../logic/layout'

/** Фоновая звезда «живого неба». Всё детерминировано от сида. */
export interface FieldStar {
  x: number
  y: number
  r: number
  o: number
  /** белый / кремовый / персиковый — тёплые тинты сертификата */
  fill: string
  /** «звезда первой величины»: крупнее + ореол */
  bright: boolean
  tw: boolean
  /** сек — индивидуальная длительность мерцания */
  twDur: number
  /** сек — индивидуальная задержка мерцания */
  twDelay: number
}

const TINTS: [number, string][] = [
  [0.6, '#ffffff'],
  [0.9, '#ffdfc0'],
  [1.01, '#ffcf9e'],
]

function makeStar(rng: () => number, x: number, y: number, dimmer: boolean): FieldStar {
  const bright = rng() < 0.025
  const t = rng()
  const fill = TINTS.find(([p]) => t < p)![1]
  return {
    x,
    y,
    r: bright ? 1.8 + rng() * 0.6 : 0.4 + rng() ** 2 * 1.4,
    // потише (21.07): фон не конкурирует с контентными звёздами редкости
    o: bright ? 0.5 + rng() * 0.15 : dimmer ? 0.16 + rng() * 0.34 : 0.2 + rng() * 0.45,
    fill,
    bright,
    tw: rng() < (dimmer ? 0.15 : 0.35),
    twDur: 2.6 + rng() * 2,
    twDelay: rng() * 4,
  }
}

/** Фоновые звёзды неба — детерминированные (замена layout.backgroundStars).
 * `ring` — звёзды в поясе шириной в мир вокруг основного прямоугольника:
 * зону видно при пане/зуме, пустой она ломает иллюзию бесконечного неба.
 * Пояс чуть тусклее и реже мерцает. */
export function skyField(count: number, seed: string, ring = 0): FieldStar[] {
  const rng = mulberry32(hashStr(seed))
  const stars = Array.from({ length: count }, () => makeStar(rng, rng() * SKY_W, rng() * SKY_H, false))
  while (ring > 0) {
    const x = (rng() * 3 - 1) * SKY_W
    const y = (rng() * 3 - 1) * SKY_H
    if (x >= 0 && x <= SKY_W && y >= 0 && y <= SKY_H) continue
    stars.push(makeStar(rng, x, y, true))
    ring--
  }
  return stars
}
