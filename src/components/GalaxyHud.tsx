import type { Skill, StarComponent } from '../types'
import { rankTitle } from '../logic/stars'
import type { GalaxyStats } from '../logic/stars'

/** Имя навыка для неба: без уточнения в скобках («Гитара (акустика)» → «Гитара»). */
export function displaySkillName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '')
}

interface GalaxyHudProps {
  skill: Skill
  level: number
  stats: GalaxyStats
  hover: { star: StarComponent; tierLit: number; tierTotal: number } | null
  ribbon: { id: string; name: string; level: number; current: boolean }[]
  onSwitch: (id: string) => void
}

// Нижний HUD галактики: статы → имя → инфо (или hover-инфо звезды) → лента навыков.
// Чистый оверлей: всё приходит готовым, кликабельна только лента.
export function GalaxyHud({ skill, level, stats, hover, ribbon, onSwitch }: GalaxyHudProps) {
  return (
    <div className="ghud">
      <div className="ghud-stats">
        Уровень {level} · ранги {stats.ranksDone}/{stats.ranksTotal} · звёзд {stats.starsLit}/{stats.starsTotal}
      </div>
      <div className="ghud-name">{displaySkillName(skill.name)}</div>
      <div className="ghud-info">
        {hover ? (
          <>
            <span className={hover.star.litAt ? 'ghud-star lit' : 'ghud-star'}>{hover.star.title}</span>
            <br />
            <span className="ghud-star-meta">
              {hover.star.tier} · {rankTitle(skill, hover.star.tier)} · {hover.tierLit}/{hover.tierTotal} · {hover.star.litAt ? 'зажжена' : 'не зажжена'}
            </span>
            {hover.star.criteria && (
              <>
                <br />
                {hover.star.criteria}
              </>
            )}
          </>
        ) : (
          skill.lore || skill.wantStatement
        )}
      </div>
      <div className="ghud-ribbon">
        {ribbon.map((r) => (
          <button
            key={r.id}
            className={r.current ? 'ghud-rib on' : 'ghud-rib'}
            onClick={(e) => {
              e.currentTarget.blur() // вернуть фокус небу — иначе ←/→ перестают листать
              onSwitch(r.id)
            }}
          >
            {r.name}
            <span className="lv">{r.level}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
