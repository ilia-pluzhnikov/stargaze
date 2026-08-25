import { useEffect, useMemo, useState } from 'react'
import { TIERS } from '../types'
import type { Skill, StarComponent, Store } from '../types'
import { SKY_H, SKY_W, constellationPlacements, hashStr, mulberry32 } from '../logic/layout'
import { rankTitle } from '../logic/stars'
import { usePanZoom } from '../hooks/usePanZoom'
import { Galaxy } from './Galaxy'
import { displaySkillName } from './GalaxyHud'
import { sky } from './skyColors'
import { CosmosBackdrop } from './CosmosBackdrop'

interface Props {
  store: Store
  onOpenGalaxy: (skillId: string) => void
}

interface StarHover {
  skill: Skill
  star: StarComponent
  x: number
  y: number
}

export function Sky({ store, onOpenGalaxy }: Props) {
  const pz = usePanZoom(SKY_W, SKY_H)
  const [hover, setHover] = useState<StarHover | null>(null)
  // Пан уводит звёзды из-под курсора — иначе после отпускания остаётся устаревший тултип.
  useEffect(() => {
    if (pz.isPanning) setHover(null)
  }, [pz.isPanning])
  const skills = useMemo(() => store.skills.filter((s) => !s.archived), [store.skills])
  const placements = useMemo(() => constellationPlacements(skills.map(({ id, hue, name }) => ({ id, hue, name }))), [skills])
  const backdropHue = skills.length
    ? Math.round(skills.reduce((sum, skill) => sum + skill.hue, 0) / skills.length)
    : 230
  const milky = useMemo(() => {
    const rng = mulberry32(hashStr('questlog-milky'))
    return Array.from({ length: 7 }, (_, i) => {
      const t = i / 6
      return {
        x: 200 + t * 1400,
        y: 820 - t * 620 + Math.sin(t * 9) * 60,
        rx: 170 + rng() * 120,
        o: 0.35 + rng() * 0.35,
        rot: -20 + rng() * 8,
      }
    })
  }, [])

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
          <radialGradient id="milkg">
            <stop offset="0%" stopColor="hsla(226, 45%, 62%, 0.05)" />
            <stop offset="100%" stopColor="hsla(226, 45%, 62%, 0)" />
          </radialGradient>
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
          {skills.map((s) => {
            const rootHalo = sky.rootHalo(s.hue)
            return (
              <g key={s.id}>
                <radialGradient id={`neb-${s.id}`}>
                  <stop offset="0%" stopColor={sky.nebula(s.hue).core} />
                  <stop offset="100%" stopColor={sky.nebula(s.hue).edge} />
                </radialGradient>
                <radialGradient id={`mini-root-halo-${s.id}`}>
                  <stop offset="0%" stopColor={rootHalo.inner} />
                  <stop offset="100%" stopColor={rootHalo.outer} />
                </radialGradient>
              </g>
            )
          })}
        </defs>
        {milky.map((m, i) => (
          <ellipse key={i} cx={m.x} cy={m.y} rx={m.rx} ry={m.rx * 0.4} fill="url(#milkg)"
            opacity={m.o} transform={`rotate(${m.rot} ${m.x} ${m.y})`} />
        ))}
        {skills.map((s) => {
          const a = placements.get(s.id)!
          return <ellipse key={s.id} cx={a.x} cy={a.y - 10} rx={220} ry={165} fill={`url(#neb-${s.id})`} />
        })}
        {skills.map((skill) => (
          <Galaxy key={skill.id} anchor={placements.get(skill.id)!} skill={skill}
            stars={store.stars} xpLog={store.xpLog} onOpen={() => onOpenGalaxy(skill.id)}
            onStarHover={(h) => setHover(h ? { skill, star: h.star, x: h.x, y: h.y } : null)} />
        ))}
      </svg>
      {pz.isMoved && (
        <button className="sky-reset" onClick={pz.reset} title="Вернуть обзор всего неба">⌖ Обзор</button>
      )}
      {hover && !pz.isPanning && (
        <div className="sky-tip" style={{ left: hover.x, top: hover.y }}>
          <div className={hover.star.litAt ? 'sky-tip-title lit' : 'sky-tip-title'}>{hover.star.title}</div>
          <div className="sky-tip-meta">
            <span className={`sky-tip-tier r-${hover.star.tier.toLowerCase()}`}>{hover.star.tier}</span>
            {' · '}{rankTitle(hover.skill, hover.star.tier)}
            {' · '}{hover.star.litAt ? 'зажжена' : 'не зажжена'}
            {' · '}{displaySkillName(hover.skill.name)}
          </div>
          {hover.star.criteria && <div className="sky-tip-dod">{hover.star.criteria}</div>}
        </div>
      )}
    </div>
  )
}
