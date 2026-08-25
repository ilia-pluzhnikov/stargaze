import type { Quest, StarComponent } from '../types'
import { formatDayShort } from '../logic/dates'
import { rarityVar } from './skyColors'

/** Есть ли у квеста что раскрывать (карточка-контракт). */
export function questHasCard(q: Quest): boolean {
  return Boolean(
    q.description || q.why || q.definitionOfDone?.length || q.resources?.length || q.result,
  )
}

interface Props {
  quest: Quest
  skill: { emoji: string; name: string } | null
  star?: StarComponent | null
  done: boolean
  streak: number
  doneDay?: string | null // для секции «Выполненные»
  child?: boolean // рендер с отступом под родителем
  parentRef?: { id: string; title: string } | null // «⤴ часть эпика» (пометка в meta и крошка в карточке)
  progress?: { done: number; total: number } | null // бейдж эпика 2/5
  childQuests?: Quest[] // секция «Подквесты» в раскрытой карточке
  provision?: number // капание просроченного контракта (0/undefined = не показывать)
  onOpenQuest?: (id: string) => void
  expanded?: boolean
  onToggleExpand?: () => void
  onTickDod?: (index: number) => void
  onToggle: () => void
  onEdit: () => void
}

export function QuestRow({
  quest,
  skill,
  star,
  done,
  streak,
  doneDay,
  child,
  parentRef,
  progress,
  childQuests,
  provision,
  onOpenQuest,
  expanded,
  onToggleExpand,
  onTickDod,
  onToggle,
  onEdit,
}: Props) {
  const dod = quest.definitionOfDone
  const dodDone = dod?.filter((d) => d.done).length ?? 0
  // эпик без description/DoD всё равно раскрывается — ради списка детей, крошки и журнала переносов
  const hasCard =
    questHasCard(quest) ||
    (childQuests?.length ?? 0) > 0 ||
    Boolean(parentRef) ||
    (quest.dueDateHistory?.length ?? 0) > 0
  return (
    <div className={`quest-row${done ? ' done' : ''}${child ? ' child' : ''}`}>
      <button className={done ? 'chk on' : 'chk'} onClick={onToggle} aria-label={done ? 'Отменить' : 'Выполнить'}>
        ✓
      </button>
      <div
        className={hasCard ? 'q-body q-expandable' : 'q-body'}
        onClick={hasCard ? onToggleExpand : undefined}
        role={hasCard ? 'button' : undefined}
      >
        <div className="q-title">{quest.title}</div>
        <div className="q-meta">
          {skill && (
            <span className="skill-tag">
              {skill.emoji} {skill.name}
            </span>
          )}
          {star && (
            <span className="star-tag" style={{ color: rarityVar(star.tier) }}>
              {star.litAt ? '✦' : '☆'} {star.title}
            </span>
          )}
          {progress && (
            <span className="epic-tag">{progress.done}/{progress.total}</span>
          )}
          {!child && parentRef && <span>⤴ {parentRef.title}</span>}
          {quest.dueDate ? (
            <span>до {formatDayShort(quest.dueDate)}</span>
          ) : (
            // молчание про срок у активного контракта читалось бы как «сегодня»,
            // хотя без даты он не капает вовсе
            quest.status === 'active' && quest.type !== 'repeating' && <span>без срока</span>
          )}
          {provision !== undefined && provision > 0 && (
            <span className="q-drip">капает −{provision} ✨</span>
          )}
          {streak > 0 && <span className="fire">🔥×{streak}</span>}
          {doneDay && <span>выполнено {formatDayShort(doneDay)}</span>}
          {hasCard && (
            <span className="card-tag">
              {expanded ? '▾' : '▸'} {dod?.length ? `${dodDone}/${dod.length}` : 'карточка'}
            </span>
          )}
        </div>
        {expanded && hasCard && (
          <div className="q-card" onClick={(e) => e.stopPropagation()}>
            {parentRef && (
              <div className="q-card-block">
                <div className="q-crumb" onClick={() => onOpenQuest?.(parentRef.id)}>
                  ⤴ часть эпика: {parentRef.title}
                </div>
              </div>
            )}
            {quest.why && (
              <div className="q-card-block">
                <div className="lbl">Зачем</div>
                <div className="txt">{quest.why}</div>
              </div>
            )}
            {quest.description && (
              <div className="q-card-block">
                <div className="lbl">Описание</div>
                <div className="txt">{quest.description}</div>
              </div>
            )}
            {dod && dod.length > 0 && (
              <div className="q-card-block">
                <div className="lbl">Definition of Done</div>
                {dod.map((d, i) => (
                  <label key={i} className="q-dod">
                    <input
                      type="checkbox"
                      checked={Boolean(d.done)}
                      disabled={!onTickDod}
                      onChange={() => onTickDod?.(i)}
                    />
                    <span className={d.done ? 'dod-on' : ''}>{d.text}</span>
                  </label>
                ))}
              </div>
            )}
            {quest.resources && quest.resources.length > 0 && (
              <div className="q-card-block">
                <div className="lbl">Материалы</div>
                {quest.resources.map((r, i) => (
                  <div key={i} className="q-res">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title}
                      </a>
                    ) : (
                      <span>
                        {r.title} <em>(без ссылки)</em>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {quest.dueDateHistory && quest.dueDateHistory.length > 0 && (
              <div className="q-card-block">
                <div className="lbl">Переносы дедлайна</div>
                {quest.dueDateHistory.map((m, i) => (
                  <div key={i} className="q-res">
                    {formatDayShort(m.from)} → {formatDayShort(m.to)} · {formatDayShort(m.day)}
                    {m.fee ? ` · −${m.fee} ✨` : ''}
                  </div>
                ))}
              </div>
            )}
            {quest.result && (
              <div className="q-card-block q-result">
                <div className="lbl">Итог</div>
                <div className="txt">{quest.result.summary}</div>
                {quest.result.artifactUrl && (
                  <div className="q-res">
                    <a href={quest.result.artifactUrl} target="_blank" rel="noreferrer">
                      артефакт
                    </a>
                  </div>
                )}
                {quest.result.evidence && <div className="q-evidence">{quest.result.evidence}</div>}
                {quest.result.skippedDod && quest.result.skippedDod.length > 0 && (
                  <div className="q-skipped">пропущено: {quest.result.skippedDod.join(' · ')}</div>
                )}
              </div>
            )}
            {childQuests && childQuests.length > 0 && (
              <div className="q-card-block q-children">
                <div className="lbl">Подквесты{progress ? ` · ${progress.done}/${progress.total}` : ''}</div>
                {childQuests.map((c) => (
                  <div key={c.id} className="q-child-row" onClick={() => onOpenQuest?.(c.id)}>
                    <span className="q-child-status">{c.status === 'done' ? '✓' : c.status === 'proposed' ? '?' : '·'}</span>
                    <span className={c.status === 'done' ? 'dod-on' : ''}>{c.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <span className="q-xp">+{quest.xpReward}</span>
      <button className="q-edit" onClick={onEdit} aria-label="Изменить">
        ✎
      </button>
    </div>
  )
}
