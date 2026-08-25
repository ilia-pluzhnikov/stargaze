import { useEffect, useState } from 'react'
import type { Quest, Skill, StarComponent, Store } from '../types'
import { completedDaysForQuest, lastCompletionDay, questDoneOnDay, skillXpTotal } from '../logic/selectors'
import { provisionForQuest } from '../logic/sparks'
import { currentRank, galaxySummary, rankTitle } from '../logic/stars'
import { computeStreak } from '../logic/streak'
import { skillLevel } from '../logic/xp'
import { QuestRow } from './QuestRow'

interface Props {
  skill: Skill
  store: Store
  today: string
  archiveBlock?: string | null // причина, по которой архив запрещён (активные контракты навыка)
  onClose: () => void
  onComplete: (q: Quest) => void
  onUncomplete: (q: Quest) => void
  onEditQuest: (q: Quest) => void
  onAddQuest: () => void
  onEditSkill: () => void
  onArchiveSkill: () => void
  onOpenGalaxy: () => void
  onTickDod: (q: Quest, index: number) => void
}

export function SkillPanel({
  skill,
  store,
  today,
  archiveBlock,
  onClose,
  onComplete,
  onUncomplete,
  onEditQuest,
  onAddQuest,
  onEditSkill,
  onArchiveSkill,
  onOpenGalaxy,
  onTickDod,
}: Props) {
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // взвод не переживает появления блока: иначе после снятия причины кнопка ждала бы
  // уже взведённой и сносила навык кликом, которого пользователь не делал
  useEffect(() => {
    if (archiveBlock) setConfirmArchive(false)
  }, [archiveBlock])
  const info = skillLevel(skillXpTotal(store.xpLog, skill.id))
  const quests = store.quests.filter((q) => q.skillId === skill.id && q.status !== 'archived')
  const active = quests.filter((q) => q.status === 'active')
  const doneOnes = quests.filter((q) => q.status === 'done')
  const starOf = (q: Quest): StarComponent | null =>
    q.starId ? (store.stars.find((c) => c.id === q.starId) ?? null) : null
  const summary = galaxySummary(store.stars, skill.id)
  const cur = currentRank(store.stars, skill.id)
  const curTitle = cur ? rankTitle(skill, cur) : undefined

  const isDoneNow = (q: Quest) =>
    q.type === 'repeating' ? questDoneOnDay(store.xpLog, q.id, today) : q.status === 'done'
  const streakOf = (q: Quest) =>
    q.type === 'repeating' ? computeStreak(q, completedDaysForQuest(store.xpLog, q.id), today) : 0

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer">
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <h3>
          {skill.emoji} {skill.name}
        </h3>
        <div className="sk-sub">
          Уровень {info.level} · {info.into} / {info.toNext} XP
        </div>
        <div className="bar" style={{ maxWidth: 260 }}>
          <i style={{ width: `${Math.round((info.into / info.toNext) * 100)}%` }} />
        </div>

        {skill.wantStatement && (
          <div className="statement">
            <div className="lbl">Что я хочу от навыка</div>
            <div className="txt">{skill.wantStatement}</div>
          </div>
        )}

        {summary.total > 0 && (
          <div className="statement">
            <div className="lbl">Ранги</div>
            <div className="ladder-row">
              Взято {summary.achieved}/{summary.total}
              {cur
                ? ` · текущий ранг: ${cur} · ${curTitle}`
                : ' · все ранги взяты'}
            </div>
          </div>
        )}

        <div className="quests">
          {active.map((q) => (
            <QuestRow
              key={q.id}
              quest={q}
              skill={null}
              done={isDoneNow(q)}
              streak={streakOf(q)}
              star={starOf(q)}
              provision={provisionForQuest(q, today)}
              expanded={expandedId === q.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
              onTickDod={(i) => onTickDod(q, i)}
              onToggle={() => (isDoneNow(q) ? onUncomplete(q) : onComplete(q))}
              onEdit={() => onEditQuest(q)}
            />
          ))}
          {doneOnes.map((q) => (
            <QuestRow
              key={q.id}
              quest={q}
              skill={null}
              done
              streak={0}
              doneDay={lastCompletionDay(store.xpLog, q.id)}
              star={starOf(q)}
              provision={provisionForQuest(q, today)}
              expanded={expandedId === q.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
              onToggle={() => onUncomplete(q)}
              onEdit={() => onEditQuest(q)}
            />
          ))}
        </div>

        <div className="drawer-actions">
          <button onClick={onOpenGalaxy}>Открыть галактику</button>
          <button onClick={onAddQuest}>+ Квест</button>
          <button onClick={onEditSkill}>Изменить</button>
          {archiveBlock ? (
            <button className="danger" disabled>
              Архивировать
            </button>
          ) : confirmArchive ? (
            <button className="danger" onClick={onArchiveSkill}>
              Точно архивировать?
            </button>
          ) : (
            <button className="danger" onClick={() => setConfirmArchive(true)}>
              Архивировать
            </button>
          )}
        </div>
        {archiveBlock && <div className="hint">{archiveBlock}</div>}
      </div>
    </>
  )
}
