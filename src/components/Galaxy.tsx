import { useMemo } from 'react'
import type { Skill, StarComponent, XpEvent } from '../types'
import { skillLevel } from '../logic/xp'
import { skillXpTotal } from '../logic/selectors'
import { currentRank, isRankAchieved, skillStars, skillTiers } from '../logic/stars'
import { CONST_H, CONST_W, layoutConstellation } from '../logic/layout'
import type { SkyPlacement } from '../logic/layout'
import { glyphById } from './skyGlyphs'
import { sky, tierStyle } from './skyColors'

interface Props {
  anchor: SkyPlacement
  skill: Skill
  stars: StarComponent[]
  xpLog: XpEvent[]
  onOpen: () => void
  onStarHover: (hover: { star: StarComponent; x: number; y: number } | null) => void
}

// В лабораторном all-sky созвездие занимает ~14% ширины мира.
// 0.25 здесь даёт ту же пропорцию при SKY_W=1800 (раньше было всего ~9%).
const MINI_SCALE = 0.25

/** Узел неба: мини-созвездие навыка (скелет без фильтров) + имя + сводка. */
export function Galaxy({ anchor, skill, stars, xpLog, onOpen, onStarHover }: Props) {
  const hue = skill.hue
  const level = skillLevel(skillXpTotal(xpLog, skill.id))
  const own = useMemo(() => skillStars(stars, skill.id), [stars, skill.id])
  const tiers = useMemo(() => skillTiers(stars, skill.id), [stars, skill.id])
  const cur = currentRank(stars, skill.id)
  const marks = tiers.map((t) => (isRankAchieved(stars, skill.id, t) ? '✓' : t === cur ? '●' : '○'))
  const constellation = useMemo(() => layoutConstellation(own, skill.id), [own, skill.id])
  const glyph = glyphById(skill.glyphId)
  const half = (CONST_H * MINI_SCALE) / 2
  const rootHaloId = `mini-root-halo-${skill.id}`

  return (
    <g className="galaxy-g" transform={`translate(${anchor.x}, ${anchor.y})`} onClick={onOpen}>
      <g transform={`rotate(${anchor.rotation})`}>
      <g transform={`translate(${(-CONST_W * MINI_SCALE) / 2}, ${-half - 12}) scale(${MINI_SCALE})`}>
        {glyph && (
          <g className="glyph glyph-mini">
            {glyph.paths.map((d, i) => (
              <path key={`soft-${i}`} className="glyph-soft" d={d} fill="none" stroke={sky.glyphStroke(hue)} strokeWidth={15}
                strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {glyph.paths.map((d, i) => (
              <path key={`crisp-${i}`} className="glyph-crisp" d={d} fill="none" stroke={sky.glyphStroke(hue)} strokeWidth={4.2}
                strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
        )}
        {constellation.edges.map(([a, b], i) => {
          const A = a < 0 ? constellation.root : constellation.nodes[a]
          const B = constellation.nodes[b]
          const lit = (a < 0 || !!constellation.nodes[a].star.litAt) && !!B.star.litAt
          return (
            <g key={i}>
              <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={sky.edgeGlow(hue, lit, B.star.tier)}
                strokeWidth={lit ? 12 : 8} opacity={lit ? 0.18 : 0.08} />
              <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={sky.edge(hue, lit)}
                strokeWidth={lit ? 3.2 : 2.4} />
            </g>
          )
        })}
        {constellation.nodes.map(({ star, x, y }) => {
          const lit = !!star.litAt
          const scale = tierStyle[star.tier].scale
          return (
            <g key={star.id} transform={`translate(${x}, ${y})`}>
              <circle r={(lit ? 28 : 15) * scale} fill={`url(#mini-halo-${star.tier})`} opacity={lit ? 0.9 : 0.45} />
              {lit && (
                <g opacity={0.9}>
                  <rect x={-18 * scale} y={-0.7} width={36 * scale} height={1.4} rx={0.7} fill={sky.flare} opacity={0.8} />
                  <rect x={-0.7} y={-18 * scale} width={1.4} height={36 * scale} rx={0.7} fill={sky.flare} opacity={0.8} />
                  <rect x={-9 * scale} y={-0.4} width={18 * scale} height={0.8} fill={sky.flare} opacity={0.42} transform="rotate(45)" />
                  <rect x={-9 * scale} y={-0.4} width={18 * scale} height={0.8} fill={sky.flare} opacity={0.42} transform="rotate(-45)" />
                </g>
              )}
              <circle r={(lit ? 7 : 5) * scale} fill={sky.starFill(lit, star.tier)}
                stroke={sky.starStroke(lit, star.tier)} strokeWidth={lit ? 0.8 : 1.2} />
              {/* Мини-звезда ~1–2 px на экране — курсором не попасть без увеличенной невидимой мишени. */}
              <circle r={22} fill="transparent"
                onMouseEnter={(e) => onStarHover({ star, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => onStarHover(null)} />
            </g>
          )
        })}
        <g transform={`translate(${constellation.root.x}, ${constellation.root.y})`}>
          <circle r={38} fill={`url(#${rootHaloId})`} />
          <circle r={42} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.12} strokeWidth={1.2} />
          <circle r={29} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.24} strokeWidth={1.2} />
          <circle r={18} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.48} strokeWidth={1.4} />
          <rect x={-18} y={-0.6} width={36} height={1.2} fill={sky.flare} opacity={0.58} />
          <rect x={-0.6} y={-18} width={1.2} height={36} fill={sky.flare} opacity={0.58} />
          <circle r={7} fill={sky.litCore} stroke={sky.flare} strokeWidth={1} />
        </g>
      </g>
      </g>
      <text className="const-name sky-name" textAnchor="middle" y={half + 16} fontSize={14} fill={sky.label}>{skill.name}</text>
      <text textAnchor="middle" y={half + 36} fontSize={10.5} letterSpacing={2.2} fill={sky.labelDim}>
        {tiers.length > 0 ? `УР. ${level.level} · ${marks.join(' ')}` : `УР. ${level.level} · без звёзд`}
      </text>
      <rect x={-65} y={half + 45} width={130} height={4} rx={2} fill={sky.track} />
      <rect x={-65} y={half + 45} width={Math.max(2, Math.round(130 * (level.into / level.toNext)))} height={4} rx={2} fill={sky.xpBar(hue)} />
    </g>
  )
}
