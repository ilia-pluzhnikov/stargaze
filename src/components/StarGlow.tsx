import { TIERS } from '../types'
import type { Tier } from '../types'
import { tierStyle } from './skyColors'
import { bloomStops, coronaStops, glow, rootBloomStops, rootCoronaStops, spikePath, spikeStops } from './skyGlow'
import type { GlowSize, GlowStop } from './skyGlow'

/** Стопы градиента из рецепта света. */
export function GlowStops({ stops }: { stops: GlowStop[] }) {
  return stops.map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />)
}

/** Градиенты света всех рангов — один раз в `<defs>` неба; id общие для обоих видов. */
export function GlowDefs() {
  return TIERS.map((t) => (
    <g key={t}>
      <radialGradient id={`glow-corona-${t}`}><GlowStops stops={coronaStops(t)} /></radialGradient>
      <radialGradient id={`glow-bloom-${t}`}><GlowStops stops={bloomStops(t)} /></radialGradient>
      <radialGradient id={`glow-spike-${t}`}><GlowStops stops={spikeStops(t)} /></radialGradient>
    </g>
  ))
}

/** Градиенты света ядра галактики — от hue навыка; id — по ключу (навык или вид). */
export function RootGlowDefs({ id, hue }: { id: string; hue: number }) {
  return (
    <>
      <radialGradient id={`glow-root-corona-${id}`}><GlowStops stops={rootCoronaStops(hue)} /></radialGradient>
      <radialGradient id={`glow-root-bloom-${id}`}><GlowStops stops={rootBloomStops(hue)} /></radialGradient>
    </>
  )
}

interface LitStarProps {
  tier: Tier
  size: GlowSize
  /** Мерцание короны: длительность и задержка от seeded PRNG звезды; нет — свет ровный. */
  twinkle?: { duration: string; delay: string }
}

/** Свет зажжённой звезды с центром в (0, 0): корона, лучи, блум с раскалённым ядром.
 * Указатель свет не ловит — мишень клика и наведения рисует владелец, иначе корона
 * перекрыла бы соседние звёзды. */
export function LitStar({ tier, size, twinkle }: LitStarProps) {
  const k = tierStyle[tier].scale
  const s = glow.sizes[size]
  const long = spikePath(s.spikeLong * k, s.spikeLongWidth)
  const short = s.spikeShort > 0 ? spikePath(s.spikeShort * k, s.spikeShortWidth) : null
  const spike = `url(#glow-spike-${tier})`
  return (
    <g pointerEvents="none">
      <circle
        className={twinkle ? 'halo-tw' : undefined}
        r={s.corona * k} fill={`url(#glow-corona-${tier})`}
        style={twinkle ? { animationDuration: twinkle.duration, animationDelay: twinkle.delay } : undefined}
      />
      <path d={long} fill={spike} />
      <path d={long} fill={spike} transform="rotate(90)" />
      {/* прозрачность — на каждом луче, не на группе: групповая требует отдельного слоя на звезду */}
      {short && <path d={short} fill={spike} fillOpacity={glow.spike.shortOpacity} transform="rotate(45)" />}
      {short && <path d={short} fill={spike} fillOpacity={glow.spike.shortOpacity} transform="rotate(-45)" />}
      <circle r={s.bloom * k} fill={`url(#glow-bloom-${tier})`} />
    </g>
  )
}

/** Свет ядра галактики с центром в (0, 0): корона и блум с раскалённой серединой, от hue навыка. */
export function RootLight({ id, scale = 1 }: { id: string; scale?: number }) {
  return (
    <g pointerEvents="none">
      <circle r={glow.root.corona * scale} fill={`url(#glow-root-corona-${id})`} />
      <circle r={glow.root.bloom * scale} fill={`url(#glow-root-bloom-${id})`} />
    </g>
  )
}
