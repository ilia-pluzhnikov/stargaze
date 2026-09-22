import { useEffect, useMemo, useState } from 'react'
import { TIERS } from '../types'
import type { Skill, SkyStore, StarComponent, Tier } from '../types'
import { GALAXY_H, GALAXY_W, hashStr, layoutConstellation, mulberry32 } from '../logic/layout'
import {
  ancestorsOf,
  childrenOf,
  currentRank,
  galaxyStats,
  isRankAchieved,
  rankStars,
  skillStars,
  skillTiers,
  starProgress,
  starXp,
} from '../logic/stars'
import { skillLevel } from '../logic/xp'
import { skillXpTotal } from '../logic/selectors'
import { constellationAsOf } from '../logic/timeline'
import { usePanZoom } from '../hooks/usePanZoom'
import { sky, tierStyle } from './skyColors'
import { glyphById } from './skyGlyphs'
import { GalaxyHud, displaySkillName } from './GalaxyHud'
import { CosmosBackdrop } from './CosmosBackdrop'
import { StarCard } from './StarCard'

export interface GalaxyActions {
  onAddStar: (parentStarId: string | null) => void
  onLightStar: (starId: string, evidence: string, alsoIds: string[]) => void
  onUnlightStar: (starId: string) => void
  onEditStar: (star: StarComponent) => void
}

interface GalaxyViewProps {
  store: SkyStore
  /** Сегодняшнее небо для раскладки; нет = то же, что store. Предусловие: всё, что рисуется из
   * store, есть в layoutFrom (навыки и звёзды store ⊆ layoutFrom) — `skyAsOf` это гарантирует. */
  layoutFrom?: SkyStore
  skill: Skill
  skills: Skill[] // неархивные, канонический порядок store.skills — лента и листание
  selectedStarId: string | null
  onSelectStar: (id: string | null) => void
  onSwitch: (id: string) => void
  onBack: () => void
  /** Действия правки; нет = только просмотр (небо в режиме истории). */
  actions?: GalaxyActions
  /** День проекции в режиме истории; нет = сегодня. */
  asOfDay?: string
  /** Открыть полосу истории; нет = кнопки нет (полоса уже открыта или прошлого ещё нет). */
  onOpenHistory?: () => void
}

export function GalaxyView({
  store,
  layoutFrom,
  skill,
  skills,
  selectedStarId,
  onSelectStar,
  onSwitch,
  onBack,
  actions,
  asOfDay,
  onOpenHistory,
}: GalaxyViewProps) {
  const pz = usePanZoom(GALAXY_W, GALAXY_H)
  const hue = skill.hue
  const glyph = glyphById(skill.glyphId)
  const cur = currentRank(store.stars, skill.id)

  const layoutStars = (layoutFrom ?? store).stars
  const full = useMemo(() => layoutConstellation(skillStars(layoutStars, skill.id), skill.id), [layoutStars, skill.id])
  const constellation = useMemo(
    () => constellationAsOf(full, skillStars(store.stars, skill.id)),
    [full, store.stars, skill.id],
  )
  // Изгиб ребра привязан к дочерней звезде и считается по полной раскладке в её порядке:
  // сегодняшний рисунок не меняется, а в прошлом ребро не «пляшет», когда соседние исчезают
  const bows = useMemo(() => {
    const rng = mulberry32(hashStr(skill.id + ':bows'))
    return new Map(full.edges.map(([, b]): [string, number] => [full.nodes[b].star.id, rng()]))
  }, [full, skill.id])
  const edgePaths = useMemo(
    () =>
      constellation.edges.map(([a, b]) => {
        const A = a < 0 ? constellation.root : constellation.nodes[a]
        const B = constellation.nodes[b]
        const mx = (A.x + B.x) / 2
        const my = (A.y + B.y) / 2
        const dx = B.x - A.x
        const dy = B.y - A.y
        const len = Math.hypot(dx, dy) || 1
        // ?? 0.5 — страховка: constellation.nodes — подмножество full.nodes, ветка недостижима по построению
        const bow = ((bows.get(B.star.id) ?? 0.5) - 0.5) * Math.min(16, len * 0.12)
        return {
          d: `M${A.x.toFixed(1)} ${A.y.toFixed(1)} Q${(mx - (dy / len) * bow).toFixed(1)} ${(my + (dx / len) * bow).toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}`,
          lit: (a < 0 || !!constellation.nodes[a].star.litAt) && !!B.star.litAt,
        }
      }),
    [constellation, bows],
  )

  const legend = useMemo(() => skillTiers(store.stars, skill.id).map((t, k) => ({
    tier: t,
    lit: rankStars(store.stars, skill.id, t).filter((s) => !!s.litAt).length,
    total: rankStars(store.stars, skill.id, t).length,
    achieved: isRankAchieved(store.stars, skill.id, t),
    y: 760 - k * 60,
  })), [store.stars, skill.id])

  // ── подсветка ранга по клику в легенде ──
  const [highlightTier, setHighlightTier] = useState<Tier | null>(null)
  useEffect(() => setHighlightTier(null), [skill.id])
  // Подсветка действует, только пока ранг есть в легенде: в прошлом, где его звёзд ещё не было,
  // снять её было бы нечем. Само состояние не сбрасываем — с возвратом ранга вернётся и подсветка
  const activeTier = highlightTier && legend.some((l) => l.tier === highlightTier) ? highlightTier : null

  // ── данные нижнего HUD ──
  const [hoverStarId, setHoverStarId] = useState<string | null>(null)
  useEffect(() => setHoverStarId(null), [skill.id])

  const stats = useMemo(() => galaxyStats(store.stars, skill.id), [store.stars, skill.id])
  const level = useMemo(() => skillLevel(skillXpTotal(store.xpLog, skill.id)).level, [store.xpLog, skill.id])
  const ribbon = useMemo(
    () =>
      skills.map((s) => ({
        id: s.id,
        name: displaySkillName(s.name),
        level: skillLevel(skillXpTotal(store.xpLog, s.id)).level,
        current: s.id === skill.id,
      })),
    [skills, store.xpLog, skill.id],
  )
  const hover = useMemo(() => {
    if (!hoverStarId) return null
    const node = constellation.nodes.find((n) => n.star.id === hoverStarId)
    if (!node) return null
    const tierList = rankStars(store.stars, skill.id, node.star.tier)
    return {
      star: node.star,
      tierLit: tierList.filter((s) => !!s.litAt).length,
      tierTotal: tierList.length,
    }
  }, [hoverStarId, constellation, store.stars, skill.id])

  // ── StarCard: владелец вычисляет дерево вокруг выбранной звезды ──
  const selectedStar = selectedStarId ? store.stars.find((s) => s.id === selectedStarId) ?? null : null
  const ancestors = useMemo(
    () => (selectedStar ? ancestorsOf(store.stars, selectedStar.id) : []),
    [store.stars, selectedStar],
  )
  const parent = ancestors[0] ?? null
  const unlitAncestors = useMemo(() => ancestors.filter((a) => !a.litAt), [ancestors])
  const childrenCount = useMemo(
    () => (selectedStar ? childrenOf(store.stars, selectedStar.id).length : 0),
    [store.stars, selectedStar],
  )

  const go = (d: number) => {
    if (skills.length < 2) return
    const i = skills.findIndex((s) => s.id === skill.id)
    onSwitch(skills[(i + d + skills.length) % skills.length].id)
  }
  // клавиши ←/→: без deps-массива — go замыкает свежие skills/skill.id,
  // подписка пересоздаётся на каждый рендер (дёшево, зато без stale-замыканий)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body) return // не листать из инпутов/модалок
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="sky-wrap galaxy-view">
      <CosmosBackdrop hue={hue} seed={`galaxy-${skill.id}`} />
      <svg
        ref={pz.svgRef}
        className={pz.isPanning ? 'sky-svg panning' : 'sky-svg'}
        viewBox={pz.viewBox}
        preserveAspectRatio="xMidYMid meet"
        {...pz.handlers}
      >
        <defs>
          <filter id="starGlow2" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          {TIERS.map((t) => {
            const halo = sky.rarityHalo(t)
            return (
              <radialGradient key={t} id={`halo-${t}`}>
                <stop offset="0%" stopColor={halo.inner} />
                <stop offset="35%" stopColor={halo.mid} />
                <stop offset="100%" stopColor={halo.outer} />
              </radialGradient>
            )
          })}
          <radialGradient id="neb-view">
            <stop offset="0%" stopColor={sky.nebula(hue).core} />
            <stop offset="100%" stopColor={sky.nebula(hue).edge} />
          </radialGradient>
        </defs>
        <ellipse cx={GALAXY_W / 2} cy={430} rx={560} ry={380} fill="url(#neb-view)" />

        <g transform="translate(400, 40)">
          {glyph && (
            <g className="glyph">
              {glyph.paths.map((d, i) => (
                <path key={`soft-${i}`} className="glyph-soft" d={d} fill="none" stroke={sky.glyphStroke(hue)} strokeWidth={8}
                  strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
              ))}
              {glyph.paths.map((d, i) => (
                <path key={`crisp-${i}`} className="glyph-crisp" d={d} fill="none" stroke={sky.glyphStroke(hue)} strokeWidth={1.8}
                  strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
              ))}
            </g>
          )}
          <g className="rootRings">
            <circle cx={constellation.root.x} cy={constellation.root.y} r={20} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.35} strokeWidth={1} />
            <circle cx={constellation.root.x} cy={constellation.root.y} r={30} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.18} strokeWidth={1} />
            <circle cx={constellation.root.x} cy={constellation.root.y} r={42} fill="none" stroke={sky.galaxyStroke(hue)} strokeOpacity={0.09} strokeWidth={1} />
            <circle cx={constellation.root.x} cy={constellation.root.y} r={8} fill={sky.litCore} filter="url(#starGlow2)" />
          </g>
          <g className="edges">
            {edgePaths.map((e, i) => (
              <path key={i} d={e.d} fill="none" stroke={sky.edge(hue, e.lit)} strokeWidth={e.lit ? 1.9 : 1.4} />
            ))}
          </g>
          {constellation.nodes.map(({ star, x, y }) => {
            const lit = !!star.litAt
            const scale = tierStyle[star.tier].scale
            const prog = starProgress(star, store.xpLog, store.quests)
            const isTarget = star.tier === cur && !lit
            const twRng = mulberry32(hashStr(star.id + ':tw'))
            const twDur = (2.6 + twRng() * 2.6).toFixed(2)
            const twDelay = (twRng() * 4).toFixed(2)
            const haloR = (lit ? 22 : isTarget ? 11 + (prog ?? 0.15) * 8 : 9) * scale
            const dimmed = activeTier !== null && star.tier !== activeTier
            return (
              <g key={star.id} className="star-g" opacity={dimmed ? 0.35 : 1} transform={`translate(${x}, ${y})`}
                onClick={() => onSelectStar(star.id)}
                onMouseEnter={() => setHoverStarId(star.id)}
                onMouseLeave={() => setHoverStarId((c) => (c === star.id ? null : c))}>
                <circle
                  className={isTarget ? 'star-fill' : lit ? 'halo-tw' : undefined}
                  r={haloR} fill={`url(#halo-${star.tier})`} opacity={lit ? 0.9 : 0.5}
                  style={lit ? { animationDuration: `${twDur}s`, animationDelay: `${twDelay}s` } : undefined}
                />
                {lit && (
                  <g className="flare" opacity={0.85}>
                    <rect x={-16 * scale} y={-0.6} width={32 * scale} height={1.2} fill={sky.flare} opacity={0.75} />
                    <rect x={-0.6} y={-16 * scale} width={1.2} height={32 * scale} fill={sky.flare} opacity={0.75} />
                    <rect x={-8 * scale} y={-0.4} width={16 * scale} height={0.8} fill={sky.flare} opacity={0.4} transform="rotate(45)" />
                    <rect x={-8 * scale} y={-0.4} width={16 * scale} height={0.8} fill={sky.flare} opacity={0.4} transform="rotate(-45)" />
                  </g>
                )}
                <circle className="star-core" r={(lit ? 6 : 4.6) * scale}
                  fill={sky.starFill(lit, star.tier)}
                  stroke={lit ? undefined : sky.starStroke(false, star.tier)}
                  strokeWidth={lit ? 0 : 1}
                  filter={lit ? 'url(#starGlow2)' : undefined} />
                {star.id === selectedStarId && <circle className="sel-ring" r={13 * scale} strokeWidth={1.2} />}
              </g>
            )
          })}
          <g className="rank-legend">
            {legend.map((item) => (
              <text key={item.tier} className="const-name" x={-230} y={item.y} fontSize={13.5} fill={sky.rankLabel(item.tier)}
                onClick={() => setHighlightTier((c) => (c === item.tier ? null : item.tier))} style={{ cursor: 'pointer' }}>
                {item.tier} · {item.lit}/{item.total}{item.achieved ? ' ✓' : ''}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {(onOpenHistory || pz.isMoved) && (
        <div className="sky-corner">
          {onOpenHistory && (
            <button className="sky-reset" onClick={onOpenHistory} title="Показать галактику на любую прошлую дату">◷ История</button>
          )}
          {pz.isMoved && (
            <button className="sky-reset" onClick={pz.reset} title="Вернуть обзор всей галактики">⌖ Обзор</button>
          )}
        </div>
      )}
      <div className="galaxy-toolbar">
        <button onClick={onBack}>← Небо</button>
      </div>
      {!selectedStar && (
        <GalaxyHud skill={skill} level={level} stats={stats} hover={hover} ribbon={ribbon} onSwitch={onSwitch} />
      )}
      {selectedStar && (
        <StarCard
          // режим в ключе: смена правка↔просмотр пересоздаёт карточку, иначе взведённое
          // «Точно погасить?» пережило бы уход в прошлое и возврат
          key={`${selectedStar.id}:${actions ? 'edit' : 'view'}`}
          star={selectedStar}
          parent={parent}
          childrenCount={childrenCount}
          unlitAncestors={unlitAncestors}
          quests={store.quests.filter((q) => q.starId === selectedStar.id && q.status !== 'archived' && q.status !== 'proposed')}
          xpLog={store.xpLog}
          xp={starXp(store.xpLog, store.quests, selectedStar.id)}
          asOfDay={asOfDay}
          actions={actions && {
            onLight: (evidence, alsoIds) => actions.onLightStar(selectedStar.id, evidence, alsoIds),
            onUnlight: () => actions.onUnlightStar(selectedStar.id),
            onEdit: () => actions.onEditStar(selectedStar),
            onAddChild: () => actions.onAddStar(selectedStar.id),
          }}
          onClose={() => onSelectStar(null)}
        />
      )}
      {skills.length > 1 && (
        <>
          <button className="chev chev-l" onClick={(e) => { e.currentTarget.blur(); go(-1) }} title="Предыдущая галактика (←)">‹</button>
          <button className="chev chev-r" onClick={(e) => { e.currentTarget.blur(); go(1) }} title="Следующая галактика (→)">›</button>
        </>
      )}
      {constellation.nodes.length === 0 && (
        <div className="galaxy-empty">
          {actions ? (
            <>
              Звёзд пока нет. Добавь первую — например, «А1» для языка или «5 км» для бега.
              <br />
              <button onClick={() => actions.onAddStar(null)}>+ звезда</button>
            </>
          ) : (
            'На эту дату звёзд ещё не было.'
          )}
        </div>
      )}
    </div>
  )
}
