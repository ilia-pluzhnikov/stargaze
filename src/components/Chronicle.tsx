import { Fragment, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { RecurringDashboard, RecurringQuestHistory, RecurringWeekCount } from '../logic/recurring'
import type { Tier } from '../types'
import { dowOf, formatDayShort } from '../logic/dates'
import { rarityVar } from './skyColors'

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

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
  onToggleToday: (questId: string, completed: boolean) => void
}

interface GridProps {
  today: string
  days: string[]
  rows: ChronicleRow[]
  weeks?: RecurringWeekCount[]
  sleeping?: boolean
  onToggleToday: (questId: string, completed: boolean) => void
}

function ChronicleGrid({ today, days, rows, weeks, sleeping = false, onToggleToday }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [days.length])

  const statsColumn = days.length + 2
  const footerRow = rows.length + 2
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `clamp(210px, 26vw, 260px) repeat(${days.length}, 18px) 126px`,
  }

  return (
    <div className="chronicle-scroll" ref={scrollRef}>
      <div className={`chronicle-grid${sleeping ? ' sleeping' : ''}`} style={gridStyle}>
        <div className="chronicle-corner chronicle-sticky-left" style={{ gridColumn: 1, gridRow: 1 }}>
          {sleeping ? 'Архив' : 'Рекуррентные квесты'}
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
          Серии
        </div>

        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2
          const currentWeek = row.weeks[row.weeks.length - 1]
          const hueStyle = { '--chronicle-hue': row.hue } as CSSProperties
          return (
            <Fragment key={row.questId}>
              <div
                className="chronicle-quest chronicle-sticky-left"
                style={{ ...hueStyle, gridColumn: 1, gridRow }}
              >
                <div className="chronicle-quest-title">{row.title}</div>
                <div className="chronicle-quest-meta">
                  {row.skillLabel && <span>{row.skillLabel}</span>}
                  {currentWeek && currentWeek.scheduled > 0 && (
                    <span>
                      неделя {currentWeek.scheduledCompleted}/{currentWeek.scheduled}
                    </span>
                  )}
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
                const state = entry.completed ? 'отмечено' : entry.scheduled ? 'не закрыто' : 'не запланировано'
                const interactive = !sleeping && isToday && (entry.scheduled || entry.completed)
                return (
                  <button
                    key={entry.day}
                    className={`chronicle-cell${entry.completed ? ' completed' : ''}${entry.scheduled ? ' scheduled' : ''}${isToday ? ' today' : ''}${dowOf(entry.day) === 1 ? ' week-start' : ''}`}
                    style={{ ...hueStyle, gridColumn: dayIndex + 2, gridRow }}
                    disabled={!interactive}
                    title={`${formatDayShort(entry.day)} · ${state}${interactive ? ' · нажми, чтобы изменить' : ''}`}
                    aria-label={`${row.title}, ${formatDayShort(entry.day)}: ${state}`}
                    onClick={() => onToggleToday(row.questId, entry.completed)}
                  >
                    <span aria-hidden="true" />
                  </button>
                )
              })}

              <div
                className="chronicle-streaks chronicle-sticky-right"
                style={{ gridColumn: statsColumn, gridRow }}
              >
                <span>
                  сейчас <b>{row.currentStreak}</b>
                </span>
                <span>
                  лучший <b>{row.bestStreak}</b>
                </span>
                {row.currentStreak === 0 && row.bestStreak > 0 && <em>новый цикл</em>}
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
              <small>закрыто / положено</small>
            </div>
            {weeks.map((week) => {
              const startIndex = days.indexOf(week.weekStart)
              const span = Math.max(1, days.indexOf(week.weekEnd) - startIndex + 1)
              const complete = week.scheduled > 0 && week.scheduledCompleted === week.scheduled
              return (
                <div
                  key={week.weekStart}
                  className={`chronicle-week-total${complete ? ' complete' : ''}${week.scheduled === 0 ? ' empty' : ''}`}
                  style={{ gridColumn: `${startIndex + 2} / span ${span}`, gridRow: footerRow }}
                  title={`${formatDayShort(week.weekStart)}–${formatDayShort(week.weekEnd)} · ${week.completed} отметок всего`}
                >
                  {week.scheduledCompleted}/{week.scheduled}
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

export function Chronicle({ dashboard, rows, sleepingRows, onToggleToday }: Props) {
  const openTitles = new Set(dashboard.todayOpenQuestIds)
  const remaining = rows.filter((row) => openTitles.has(row.questId)).map((row) => row.title)

  return (
    <main className="chronicle">
      <div className="chronicle-shell">
        <header className="chronicle-heading">
          <div>
            <div className="chronicle-kicker">История ритма</div>
            <h1>Хроника</h1>
            <p>Повторяющиеся квесты за последние 12 ISO-недель — напрямую из xpLog.</p>
          </div>
          <div className="chronicle-today-summary">
            <span>Сегодня</span>
            {dashboard.todayScheduled === 0 ? (
              <strong>нет обязательных отметок</strong>
            ) : (
              <>
                <strong>
                  {dashboard.todayCompleted}/{dashboard.todayScheduled} закрыто
                </strong>
                <small>{remaining.length > 0 ? `Осталось: ${remaining.join(' · ')}` : 'Контур дня закрыт'}</small>
              </>
            )}
          </div>
        </header>

        <div className="chronicle-legend" aria-label="Легенда">
          <span><i className="done" /> отмечено</span>
          <span><i className="missed" /> положено, не закрыто</span>
          <span><i /> не положено</span>
          <small>Сегодняшнюю ячейку можно нажать</small>
        </div>

        {rows.length > 0 ? (
          <ChronicleGrid
            today={dashboard.today}
            days={dashboard.days}
            rows={rows}
            weeks={dashboard.weeks}
            onToggleToday={onToggleToday}
          />
        ) : (
          <div className="chronicle-empty">Нет активных повторяющихся квестов.</div>
        )}

        {sleepingRows.length > 0 && (
          <details className="chronicle-sleeping">
            <summary>Спящие привычки <span>{sleepingRows.length}</span></summary>
            <p>История сохранена, но пропуски не участвуют в ритме активных направлений.</p>
            <ChronicleGrid
              today={dashboard.today}
              days={dashboard.days}
              rows={sleepingRows}
              sleeping
              onToggleToday={onToggleToday}
            />
          </details>
        )}
      </div>
    </main>
  )
}
