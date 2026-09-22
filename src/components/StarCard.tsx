import { useState } from 'react'
import type { Quest, StarComponent, XpEvent } from '../types'
import { netForQuest, questDoneOnDay } from '../logic/selectors'
import { todayInGameTz } from '../logic/sparks'
import { rarityVar } from './skyColors'

export interface StarCardActions {
  onLight: (evidence: string, alsoIds: string[]) => void
  onUnlight: () => void
  onEdit: () => void
  onAddChild: () => void
}

interface Props {
  star: StarComponent
  parent: StarComponent | null
  childrenCount: number
  unlitAncestors: StarComponent[]
  quests: Quest[] // квесты, привязанные к звезде
  xpLog: XpEvent[]
  xp: number
  /** Действия правки; нет = только просмотр (небо в режиме истории). */
  actions?: StarCardActions
  /** День проекции в режиме истории; нет = сегодня. */
  asOfDay?: string
  onClose: () => void
}

export function StarCard({ star, parent, childrenCount, unlitAncestors, quests, xpLog, xp, actions, asOfDay, onClose }: Props) {
  const [evidence, setEvidence] = useState('')
  const [cascade, setCascade] = useState(true)
  const [confirmUnlight, setConfirmUnlight] = useState(false)
  const lit = !!star.litAt
  const day = asOfDay ?? todayInGameTz() // тот же игровой день, что в App: галочка «сделано» не должна расходиться с журналом
  // В прошлом истории статусов нет: «контракт сдан на дату» выводится из xpLog проекции
  const questDone = (q: Quest) =>
    q.type === 'repeating' ? questDoneOnDay(xpLog, q.id, day) : asOfDay ? netForQuest(xpLog, q.id) > 0 : q.status === 'done'

  return (
    <div className="hud">
      <div className="hud-main">
        <div className="hud-title">{lit ? '✦ ' : '☆ '}{star.title}</div>
        <div className="hud-meta">
          {parent && <span>после: {parent.title}</span>}
          {childrenCount > 0 && <span>ветвей дальше: {childrenCount}</span>}
          <span style={{ color: rarityVar(star.tier) }}>ранг: {star.tier}</span>
          {star.criteria && <span>критерий: {star.criteria}</span>}
          <span className="xp">{xp} XP вложено{star.xpTarget ? ` / ${star.xpTarget}` : ''}</span>
          {lit && star.evidence && <span>подтверждено: {star.evidence}</span>}
        </div>
        {quests.length > 0 && (
          <div className="hud-meta">
            {quests.map((q) => (
              <span key={q.id}>{questDone(q) ? '✓' : '·'} {q.title}</span>
            ))}
          </div>
        )}
      </div>
      {actions && (
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
                onClick={() => actions.onLight(evidence.trim(), cascade ? unlitAncestors.map((a) => a.id) : [])}>
                Зажечь
              </button>
            </>
          )}
          {lit && (confirmUnlight
            ? <button className="danger" onClick={actions.onUnlight}>Точно погасить?</button>
            : <button onClick={() => setConfirmUnlight(true)}>Погасить</button>)}
          <button onClick={actions.onAddChild}>+ ветка отсюда</button>
          <button onClick={actions.onEdit}>Изменить</button>
        </div>
      )}
      <button className="hud-close" onClick={onClose}>✕</button>
    </div>
  )
}
