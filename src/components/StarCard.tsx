import { useState } from 'react'
import type { Quest, Skill, StarComponent, XpEvent } from '../types'
import { questDoneOnDay } from '../logic/selectors'
import { rankTitle } from '../logic/stars'
import { todayInGameTz } from '../logic/sparks'
import { rarityVar } from './skyColors'

interface Props {
  star: StarComponent
  skill: Skill
  parent: StarComponent | null
  childrenCount: number
  unlitAncestors: StarComponent[]
  quests: Quest[] // квесты, привязанные к звезде
  xpLog: XpEvent[]
  xp: number
  onLight: (evidence: string, alsoIds: string[]) => void
  onUnlight: () => void
  onEdit: () => void
  onAddChild: () => void
  onClose: () => void
}

export function StarCard({ star, skill, parent, childrenCount, unlitAncestors, quests, xpLog, xp, onLight, onUnlight, onEdit, onAddChild, onClose }: Props) {
  const [evidence, setEvidence] = useState('')
  const [cascade, setCascade] = useState(true)
  const [confirmUnlight, setConfirmUnlight] = useState(false)
  const lit = !!star.litAt
  const today = todayInGameTz() // тот же игровой день, что в App: галочка «сделано» не должна расходиться с журналом

  return (
    <div className="hud">
      <div className="hud-main">
        <div className="hud-title">{lit ? '✦ ' : '☆ '}{star.title}</div>
        <div className="hud-meta">
          {parent && <span>после: {parent.title}</span>}
          {childrenCount > 0 && <span>ветвей дальше: {childrenCount}</span>}
          <span style={{ color: rarityVar(star.tier) }}>ранг: {star.tier} · {rankTitle(skill, star.tier)}</span>
          {star.criteria && <span>критерий: {star.criteria}</span>}
          <span className="xp">{xp} XP вложено{star.xpTarget ? ` / ${star.xpTarget}` : ''}</span>
          {lit && star.evidence && <span>подтверждено: {star.evidence}</span>}
        </div>
        {quests.length > 0 && (
          <div className="hud-meta">
            {quests.map((q) => (
              <span key={q.id}>{(q.type === 'repeating' ? questDoneOnDay(xpLog, q.id, today) : q.status === 'done') ? '✓' : '·'} {q.title}</span>
            ))}
          </div>
        )}
      </div>
      <div className="hud-actions">
        {!lit && (
          <>
            <input className="evidence-input" placeholder="Чем подтверждено?" value={evidence}
              onChange={(e) => setEvidence(e.target.value)} />
            {unlitAncestors.length > 0 && (
              <label className="cascade-opt">
                <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
                зажечь и путь к ней: {[...unlitAncestors].reverse().map((a) => a.title).join(' → ')}
              </label>
            )}
            <button className="primary"
              onClick={() => onLight(evidence.trim(), cascade ? unlitAncestors.map((a) => a.id) : [])}>
              Зажечь
            </button>
          </>
        )}
        {lit && (confirmUnlight
          ? <button className="danger" onClick={onUnlight}>Точно погасить?</button>
          : <button onClick={() => setConfirmUnlight(true)}>Погасить</button>)}
        <button onClick={onAddChild}>+ ветка отсюда</button>
        <button onClick={onEdit}>Изменить</button>
      </div>
      <button className="hud-close" onClick={onClose}>✕</button>
    </div>
  )
}
