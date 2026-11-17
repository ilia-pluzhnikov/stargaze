import { useEffect, useMemo, useState } from 'react'
import { TIERS } from '../types'
import type { Skill, SkyStore, StarComponent } from '../types'
import { SKY_H, SKY_W, constellationPlacements } from '../logic/layout'
import { usePanZoom } from '../hooks/usePanZoom'
import { Galaxy } from './Galaxy'
import { displaySkillName } from './GalaxyHud'
import { sky } from './skyColors'
import { CosmosBackdrop } from './CosmosBackdrop'
import { GlowDefs, GlowStops, RootGlowDefs } from './StarGlow'
import { glow, nebulaStops } from './skyGlow'

interface Props {
  store: SkyStore
  /** Сегодняшнее небо для раскладки; нет = то же, что store. В режиме истории store — проекция прошлого.
   * Предусловие: всё, что рисуется из store, есть в layoutFrom (навыки и звёзды store ⊆ layoutFrom) —
   * `skyAsOf` это гарантирует. */
  layoutFrom?: SkyStore
  onOpenGalaxy: (skillId: string) => void
  /** Открыть полосу истории; нет = кнопки нет (полоса уже открыта или прошлого ещё нет). */
  onOpenHistory?: () => void
  /** Войти в 3D-облёт неба; нет = кнопки нет. */
  onOpen3d?: () => void
}

interface StarHover {
  skill: Skill
  star: StarComponent
  x: number
  y: number
}

export function Sky({ store, layoutFrom, onOpenGalaxy, onOpenHistory, onOpen3d }: Props) {
  const pz = usePanZoom(SKY_W, SKY_H)
  const [hover, setHover] = useState<StarHover | null>(null)
  // Пан уводит звёзды из-под курсора — иначе после отпускания остаётся устаревший тултип.
  useEffect(() => {
    if (pz.isPanning) setHover(null)
  }, [pz.isPanning])
  const layout = layoutFrom ?? store
  const skills = useMemo(() => store.skills.filter((s) => !s.archived), [store.skills])
  // Раскладка и фон — по сегодняшнему набору: слоты зависят от числа навыков и их hue,
  // иначе при движении по времени галактики прыгают, а фон плывёт
  const layoutSkills = useMemo(() => layout.skills.filter((s) => !s.archived), [layout.skills])
  const placements = useMemo(
    () => constellationPlacements(layoutSkills.map(({ id, hue, name }) => ({ id, hue, name }))),
    [layoutSkills],
  )
  const backdropHue = layoutSkills.length
    ? Math.round(layoutSkills.reduce((sum, skill) => sum + skill.hue, 0) / layoutSkills.length)
    : 230

  return (
    <div className="sky-wrap">
      <CosmosBackdrop hue={backdropHue} seed="questlog-sky" />
      <svg
        ref={pz.svgRef}
        className={pz.isPanning ? 'sky-svg panning' : 'sky-svg'}
        viewBox={pz.viewBox}
        preserveAspectRatio="xMidYMid meet"
        {...pz.handlers}
      >
        <defs>
          {TIERS.map((t) => {
            const halo = sky.rarityHalo(t)
            return (
              <radialGradient key={t} id={`mini-halo-${t}`}>
                <stop offset="0%" stopColor={halo.inner} />
                <stop offset="34%" stopColor={halo.mid} />
                <stop offset="100%" stopColor={halo.outer} />
              </radialGradient>
            )
          })}
          <GlowDefs />
          {skills.map((s) => (
            <g key={s.id}>
              <radialGradient id={`neb-${s.id}`}><GlowStops stops={nebulaStops(s.hue, 'overview')} /></radialGradient>
              <RootGlowDefs id={s.id} hue={s.hue} />
            </g>
          ))}
        </defs>
        {skills.map((s) => {
          const a = placements.get(s.id)!
          const [rx, ry] = glow.nebula.radius.overview
          return <ellipse key={s.id} cx={a.x} cy={a.y - 10} rx={rx} ry={ry} fill={`url(#neb-${s.id})`} />
        })}
        {skills.map((skill) => (
          <Galaxy key={skill.id} anchor={placements.get(skill.id)!} skill={skill}
            stars={store.stars} layoutStars={layout.stars} xpLog={store.xpLog} onOpen={() => onOpenGalaxy(skill.id)}
            onStarHover={(h) => setHover(h ? { skill, star: h.star, x: h.x, y: h.y } : null)} />
        ))}
      </svg>
      {(onOpenHistory || onOpen3d || pz.isMoved) && (
        <div className="sky-corner">
          {onOpen3d && (
            <button className="sky-reset" onClick={onOpen3d} title="Облёт неба в 3D — камера сама летит от галактики к галактике">◈ 3D-облёт</button>
          )}
          {onOpenHistory && (
            <button className="sky-reset" onClick={onOpenHistory} title="Показать небо на любую прошлую дату">◷ История</button>
          )}
          {pz.isMoved && (
            <button className="sky-reset" onClick={pz.reset} title="Вернуть обзор всего неба">⌖ Обзор</button>
          )}
        </div>
      )}
      {hover && !pz.isPanning && (
        <div className="sky-tip" style={{ left: hover.x, top: hover.y }}>
          <div className={hover.star.litAt ? 'sky-tip-title lit' : 'sky-tip-title'}>{hover.star.title}</div>
          <div className="sky-tip-meta">
            <span className={`sky-tip-tier r-${hover.star.tier.toLowerCase()}`}>{hover.star.tier}</span>
            {' · '}{hover.star.litAt ? 'зажжена' : 'не зажжена'}
            {' · '}{displaySkillName(hover.skill.name)}
          </div>
          {hover.star.criteria && <div className="sky-tip-dod">{hover.star.criteria}</div>}
        </div>
      )}
    </div>
  )
}
