import { useState } from 'react'
import type { Quest, Store } from '../types'
import { QUEST_TYPE_LABEL } from '../types'
import {
  charXpTotal,
  compareDueUrgency,
  completedDaysForQuest,
  epicProgress,
  isDueToday,
  isDueWithin,
  lastCompletionDay,
  questChildren,
  questDoneOnDay,
  skillXpTotal,
  weekActivity,
} from '../logic/selectors'
import { provisionForQuest } from '../logic/sparks'
import { computeStreak } from '../logic/streak'
import { charLevel, skillLevel } from '../logic/xp'
import { QuestRow } from './QuestRow'

type Filter = 'today' | 'due7' | 'all' | 'repeating'

// Табы говорят языком сроков, а не внутренних типов (short/mid/long наружу ничего не значат)
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'due7', label: '7 дней' },
  { key: 'all', label: 'Все' },
  { key: 'repeating', label: 'Повторяющиеся' },
]

interface Props {
  store: Store
  today: string
  onComplete: (q: Quest) => void
  onUncomplete: (q: Quest) => void
  onEditQuest: (q: Quest) => void
  onAddQuest: () => void
  onOpenSkill: (id: string) => void
  onAccept: (q: Quest) => void
  onReject: (q: Quest) => void
  onTickDod: (q: Quest, index: number) => void
}

export function Journal({ store, today, onComplete, onUncomplete, onEditQuest, onAddQuest, onOpenSkill, onAccept, onReject, onTickDod }: Props) {
  const [filter, setFilter] = useState<Filter>('today')
  const [showDone, setShowDone] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const matches = (q: Quest): boolean => {
    if (filter === 'all') return true
    if (filter === 'today') return isDueToday(q, today)
    if (filter === 'due7') return isDueWithin(q, today, 7)
    return q.type === filter
  }

  const skillOf = (q: Quest) => (q.skillId ? (store.skills.find((s) => s.id === q.skillId) ?? null) : null)
  const starOf = (q: Quest) => (q.starId ? (store.stars.find((c) => c.id === q.starId) ?? null) : null)
  const byCreated = (a: Quest, b: Quest) => a.createdAt.localeCompare(b.createdAt)
  const parentRefOf = (q: Quest) => {
    if (!q.parentQuestId) return null
    const p = store.quests.find((x) => x.id === q.parentQuestId)
    return p ? { id: p.id, title: p.title } : null
  }
  const isDoneNow = (q: Quest) =>
    q.type === 'repeating' ? questDoneOnDay(store.xpLog, q.id, today) : q.status === 'done'
  const streakOf = (q: Quest) =>
    q.type === 'repeating' ? computeStreak(q, completedDaysForQuest(store.xpLog, q.id), today) : 0

  const proposed = store.quests.filter((q) => q.status === 'proposed')
  const active = store.quests
    .filter((q) => q.status === 'active' && matches(q))
    .sort((a, b) => Number(isDoneNow(a)) - Number(isDoneNow(b)) || compareDueUrgency(a, b))
  // порядок active-списка: дети идут сразу под своим родителем (по createdAt), с отступом.
  // Семантика фильтров не меняется — тот же набор квестов; ребёнок с родителем вне
  // выборки рендерится верхним уровнем с пометкой «⤴ эпик».
  const activeIds = new Set(active.map((q) => q.id))
  const activeRows: { q: Quest; child: boolean }[] = []
  for (const q of active) {
    if (q.parentQuestId && activeIds.has(q.parentQuestId)) continue
    activeRows.push({ q, child: false })
    for (const c of active.filter((x) => x.parentQuestId === q.id).sort(byCreated)) activeRows.push({ q: c, child: true })
  }

  const done = store.quests
    .filter((q) => q.status === 'done' && matches(q))
    .sort((a, b) => (lastCompletionDay(store.xpLog, b.id) ?? '').localeCompare(lastCompletionDay(store.xpLog, a.id) ?? ''))

  const charInfo = charLevel(charXpTotal(store.xpLog))
  const activeSkills = store.skills.filter((s) => !s.archived)

  return (
    <div className="journal">
      <div className="journal-grid">
        <div className="pane">
          <h2>Квесты</h2>
          {proposed.length > 0 && (
            <div className="proposals">
              <div className="proposals-title">Предложения гейм-мастера</div>
              {proposed.map((q) => (
                <div key={q.id} className="proposal-card">
                  <div className="p-title">
                    {q.title} <span className="p-xp">+{q.xpReward} XP</span>
                  </div>
                  <div className="p-meta">
                    {QUEST_TYPE_LABEL[q.type]}
                    {skillOf(q) ? ` · ${skillOf(q)!.emoji} ${skillOf(q)!.name}` : ''}
                    {starOf(q) ? ` · ✦ ${starOf(q)!.title}` : ''}
                  </div>
                  {q.parentQuestId && (
                    <div className="p-card-line">
                      ⤴ Часть эпика: {store.quests.find((x) => x.id === q.parentQuestId)?.title ?? q.parentQuestId}
                    </div>
                  )}
                  {q.proposalNote && <div className="p-note">Почему сейчас: {q.proposalNote}</div>}
                  {q.why && <div className="p-card-line">Зачем: {q.why}</div>}
                  {q.description && <div className="p-card-line">{q.description}</div>}
                  {q.definitionOfDone && q.definitionOfDone.length > 0 && (
                    <ul className="p-dod">
                      {q.definitionOfDone.map((d, i) => (
                        <li key={i}>{d.text}</li>
                      ))}
                    </ul>
                  )}
                  <div className="p-actions">
                    <button className="p-accept" onClick={() => onAccept(q)}>Принять</button>
                    <button className="p-reject" onClick={() => onReject(q)}>Отклонить</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          {active.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 13 }}>Пусто. Добавь квест ниже.</div>}
          {activeRows.map(({ q, child }) => (
            <QuestRow
              key={q.id}
              quest={q}
              skill={skillOf(q)}
              done={isDoneNow(q)}
              streak={streakOf(q)}
              star={starOf(q)}
              child={child}
              parentRef={parentRefOf(q)}
              progress={epicProgress(store.quests, q.id)}
              childQuests={questChildren(store.quests, q.id)}
              provision={provisionForQuest(q, today)}
              onOpenQuest={(id) => setExpandedId(id)}
              expanded={expandedId === q.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
              onTickDod={(i) => onTickDod(q, i)}
              onToggle={() => (isDoneNow(q) ? onUncomplete(q) : onComplete(q))}
              onEdit={() => onEditQuest(q)}
            />
          ))}

          {done.length > 0 && (
            <>
              <button className="done-toggle" onClick={() => setShowDone((v) => !v)}>
                {showDone ? '▾' : '▸'} Выполненные ({done.length})
              </button>
              {showDone &&
                done.map((q) => (
                  <QuestRow
                    key={q.id}
                    quest={q}
                    skill={skillOf(q)}
                    done
                    streak={0}
                    doneDay={lastCompletionDay(store.xpLog, q.id)}
                    star={starOf(q)}
                    parentRef={parentRefOf(q)}
                    progress={epicProgress(store.quests, q.id)}
                    childQuests={questChildren(store.quests, q.id)}
                    provision={provisionForQuest(q, today)}
                    onOpenQuest={(id) => setExpandedId(id)}
                    expanded={expandedId === q.id}
                    onToggleExpand={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
                    onToggle={() => onUncomplete(q)}
                    onEdit={() => onEditQuest(q)}
                  />
                ))}
            </>
          )}

          <button className="add-btn" onClick={onAddQuest}>
            + Квест
          </button>
        </div>

        <div className="pane right">
          <div className="char-card">
            <div className="big-avatar">{store.character.avatar}</div>
            <div className="nm">{store.character.name}</div>
            <div className="lv">
              Уровень {charInfo.level} · {charInfo.into} / {charInfo.toNext} XP
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round((charInfo.into / charInfo.toNext) * 100)}%` }} />
            </div>
            <div className="total">всего {charXpTotal(store.xpLog)} XP</div>
          </div>

          <div className="week-grid">
            {weekActivity(store.xpLog, today).map(({ day, active, isToday }, i) => (
              <div key={day} className={`week-cell${active ? ' on' : ''}${isToday ? ' today' : ''}`} title={day}>
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i]}
              </div>
            ))}
          </div>

          <h2>Навыки</h2>
          <table className="skills-table">
            <tbody>
              {activeSkills.map((s) => {
                const info = skillLevel(skillXpTotal(store.xpLog, s.id))
                const pulse = info.into >= 0.75 * info.toNext
                return (
                  <tr key={s.id} onClick={() => onOpenSkill(s.id)}>
                    <td>
                      {s.emoji} {s.name}
                    </td>
                    <td className="lvl">{info.level}</td>
                    <td className="bar-cell">
                      <div className={pulse ? 'bar pulse' : 'bar'}>
                        <i style={{ width: `${Math.round((info.into / info.toNext) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
