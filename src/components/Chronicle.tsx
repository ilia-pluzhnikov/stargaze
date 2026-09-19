import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { RecurringDashboard, RecurringQuestHistory, RecurringWeekCount } from '../logic/recurring'
import type { Tier } from '../types'
import { addDays, dowOf, DOW_SHORT, formatDayShort, formatDayWithDow } from '../logic/dates'
import { rarityVar } from './skyColors'

export interface ChronicleRow extends RecurringQuestHistory {
  title: string
  skillLabel: string | null
  starTitle: string | null
  starTier: Tier | null
  hue: number
}

interface Props {
  dashboard: RecurringDashboard
  rows: ChronicleRow[]
  sleepingRows: ChronicleRow[]
  onToggleDay: (questId: string, day: string, completed: boolean) => void
  onEditQuest: (questId: string) => void
}

/** Взведённая клетка — `${questId}|${day}`: снятие отметки старше вчера идёт в два клика. */
type Armed = string | null

interface GridActions {
  armed: Armed
  setArmed: (key: Armed) => void
  onToggleDay: Props['onToggleDay']
  onEditQuest: Props['onEditQuest']
}

interface GridProps {
  today: string
  days: string[]
  rows: ChronicleRow[]
  weeks?: RecurringWeekCount[]
  /** Нет действий = спящая сетка: только история, без кликов. */
  actions?: GridActions
}

function ChronicleGrid({ today, days, rows, weeks, actions }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [days.length])

  const sleeping = !actions
  const yesterday = addDays(today, -1)
  const statsColumn = days.length + 2
  const footerRow = rows.length + 2
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `clamp(210px, 26vw, 260px) repeat(${days.length}, 18px) 86px`,
  }

  return (
    <div className="chronicle-scroll" ref={scrollRef}>
      <div className={`chronicle-grid${sleeping ? ' sleeping' : ''}`} style={gridStyle}>
        <div className="chronicle-corner chronicle-sticky-left" style={{ gridColumn: 1, gridRow: 1 }}>
          {sleeping ? 'Архив' : 'Привычки'}
        </div>
        {days.map((day, index) => (
          <div
            key={day}
            className={`chronicle-day-head${day === today ? ' today' : ''}${dowOf(day) === 1 ? ' week-start' : ''}`}
            style={{ gridColumn: index + 2, gridRow: 1 }}
            title={day}
          >
            <span>{DOW_SHORT[dowOf(day)]}</span>
            <b>{day.slice(8)}</b>
          </div>
        ))}
        <div className="chronicle-stats-head chronicle-sticky-right" style={{ gridColumn: statsColumn, gridRow: 1 }}>
          Отметок
        </div>

        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2
          const hueStyle = { '--chronicle-hue': row.hue } as CSSProperties
          return (
            <Fragment key={row.questId}>
              <div
                className="chronicle-quest chronicle-sticky-left"
                style={{ ...hueStyle, gridColumn: 1, gridRow }}
              >
                {actions ? (
                  // из Журнала привычки ушли — название здесь единственный вход в правку и архив
                  <button
                    type="button"
                    className="chronicle-quest-title"
                    title="Открыть привычку: правка и архив"
                    onClick={() => actions.onEditQuest(row.questId)}
                  >
                    {row.title}
                  </button>
                ) : (
                  <div className="chronicle-quest-title">{row.title}</div>
                )}
                <div className="chronicle-quest-meta">
                  {row.skillLabel && <span>{row.skillLabel}</span>}
                  {row.starTitle && (
                    <span className="chronicle-star-link">
                      {row.starTier && <i className="rarity-mark" style={{ background: rarityVar(row.starTier) }} aria-hidden="true" />}
                      питает звезду «{row.starTitle}»
                    </span>
                  )}
                </div>
              </div>

              {row.days.map((entry, dayIndex) => {
                const isToday = entry.day === today
                const label = formatDayWithDow(entry.day)
                const state = entry.completed ? 'отмечено' : 'пусто'
                // старше вчера окно искр закрыто: отметка даст только XP, а снятую оплаченную
                // повторная постановка уже не оплатит — поэтому снятие здесь в два клика
                const stale = entry.day < yesterday
                const key = `${row.questId}|${entry.day}`
                const isArmed = actions?.armed === key
                const hint = !actions
                  ? ''
                  : isArmed
                    ? ' · снять? повторная отметка искр не даст · нажми ещё раз'
                    : entry.completed
                      ? ' · нажми, чтобы снять'
                      : ` · нажми, чтобы отметить${stale ? ' (XP без искр)' : ''}`
                return (
                  <button
                    key={entry.day}
                    className={`chronicle-cell${entry.completed ? ' completed' : ''}${isArmed ? ' armed' : ''}${isToday ? ' today' : ''}${dowOf(entry.day) === 1 ? ' week-start' : ''}`}
                    style={{ ...hueStyle, gridColumn: dayIndex + 2, gridRow }}
                    disabled={!actions}
                    title={`${label} · ${state}${hint}`}
                    aria-label={`${row.title}, ${label}: ${state}`}
                    onClick={() => {
                      if (!actions) return
                      if (entry.completed && stale && !isArmed) {
                        actions.setArmed(key)
                        return
                      }
                      actions.setArmed(null)
                      actions.onToggleDay(row.questId, entry.day, entry.completed)
                    }}
                    onMouseLeave={() => {
                      if (isArmed) actions?.setArmed(null)
                    }}
                    onBlur={() => {
                      if (isArmed) actions?.setArmed(null)
                    }}
                  >
                    <span aria-hidden="true" />
                  </button>
                )
              })}

              <div
                className="chronicle-total chronicle-sticky-right"
                style={{ gridColumn: statsColumn, gridRow }}
              >
                <b>{row.total}</b>
              </div>
            </Fragment>
          )
        })}

        {weeks && (
          <>
            <div
              className="chronicle-week-label chronicle-sticky-left"
              style={{ gridColumn: 1, gridRow: footerRow }}
            >
              Ритм по неделям
              <small>отметок за неделю</small>
            </div>
            {weeks.map((week) => {
              const startIndex = days.indexOf(week.weekStart)
              const span = Math.max(1, days.indexOf(week.weekEnd) - startIndex + 1)
              return (
                <div
                  key={week.weekStart}
                  className={`chronicle-week-total${week.completed === 0 ? ' empty' : ''}`}
                  style={{ gridColumn: `${startIndex + 2} / span ${span}`, gridRow: footerRow }}
                  title={`${formatDayShort(week.weekStart)}–${formatDayShort(week.weekEnd)} · отметок: ${week.completed}`}
                >
                  {week.completed}
                </div>
              )
            })}
            <div
              className="chronicle-week-tail chronicle-sticky-right"
              style={{ gridColumn: statsColumn, gridRow: footerRow }}
            >
              12 недель
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function Chronicle({ dashboard, rows, sleepingRows, onToggleDay, onEditQuest }: Props) {
  const [armed, setArmed] = useState<Armed>(null)

  // взвод не живёт вечно: на тач-экранах нет ни mouseleave, ни надёжного blur — без
  // таймера забытая взведённая клетка снималась бы одним случайным касанием позже
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(null), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <main className="chronicle">
      <div className="chronicle-shell">
        <header className="chronicle-heading">
          <div>
            <div className="chronicle-kicker">История ритма</div>
            <h1>Хроника</h1>
            <p>Привычки за последние 12 ISO-недель — напрямую из xpLog.</p>
          </div>
          <div className="chronicle-today-summary">
            <span>Сегодня</span>
            <strong>{dashboard.todayCompleted > 0 ? `отмечено: ${dashboard.todayCompleted}` : 'пока пусто'}</strong>
          </div>
        </header>

        <div className="chronicle-legend" aria-label="Легенда">
          <span><i className="done" /> отмечено</span>
          <span><i /> пусто</span>
          <small className={armed ? 'warn' : undefined}>
            {armed
              ? 'Нажми ещё раз, чтобы снять отметку: повторная отметка искр уже не даст'
              : 'Нажми на любую клетку. Искры — только за сегодня и вчера'}
          </small>
        </div>

        {rows.length > 0 ? (
          <ChronicleGrid
            today={dashboard.today}
            days={dashboard.days}
            rows={rows}
            weeks={dashboard.weeks}
            actions={{ armed, setArmed, onToggleDay, onEditQuest }}
          />
        ) : (
          <div className="chronicle-empty">Нет активных привычек.</div>
        )}

        {sleepingRows.length > 0 && (
          <details className="chronicle-sleeping">
            <summary>Спящие привычки <span>{sleepingRows.length}</span></summary>
            <p>История сохранена; спящие привычки не отмечаются.</p>
            <ChronicleGrid today={dashboard.today} days={dashboard.days} rows={sleepingRows} />
          </details>
        )}
      </div>
    </main>
  )
}
