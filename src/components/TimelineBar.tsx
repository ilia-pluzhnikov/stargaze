import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, diffDays, formatDayLong } from '../logic/dates'
import { timelineMonths, timelineTicks } from '../logic/timeline'
import type { TimelineMark } from '../logic/timeline'

interface Props {
  first: string // первый день истории — левая граница ползунка
  today: string // правая граница
  day: string // выбранный день, first ≤ day ≤ today
  marks: TimelineMark[]
  summary: { level: number; starsLit: number; starsTotal: number }
  onChange: (day: string) => void
  onClose: () => void
}

/** ▶ доигрывает от текущего положения до сегодня за это время — независимо от длины истории. */
const PLAY_MS = 12_000
/** Диаметр бегунка в px — тот же, что у .timeline-range в index.css: засечки встают под его центр. */
const THUMB = 16
/** Минимальный зазор между подписями месяцев, % ширины дорожки. */
const MONTH_GAP = 7

// Полоса истории неба: только представление и таймер ▶. Вся логика дат — в logic/dates и logic/timeline.
export function TimelineBar({ first, today, day, marks, summary, onChange, onClose }: Props) {
  const span = Math.max(0, diffDays(today, first))
  const value = Math.min(span, Math.max(0, diffDays(day, first)))
  const [playing, setPlaying] = useState(false)
  const playFrom = useRef(0)
  // rAF-цикл живёт дольше одного рендера — держим свежий onChange, не перезапуская проигрывание
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!playing) return
    const from = playFrom.current
    const startedAt = performance.now()
    let raf = 0
    let last = -1
    const tick = (now: number) => {
      // день — из прошедшего времени, а не «день за кадр»: длительность не зависит от FPS
      const t = Math.min(1, Math.max(0, (now - startedAt) / PLAY_MS))
      const offset = from + Math.floor(t * (span - from))
      if (offset !== last) {
        last = offset
        onChangeRef.current(addDays(first, offset))
      }
      if (t >= 1) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, first, span])

  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (span === 0) return
    playFrom.current = value >= span ? 0 : value // уже на сегодня — старт с первого дня
    setPlaying(true)
  }
  const pick = (next: string) => {
    setPlaying(false) // любое ручное движение ставит паузу
    onChange(next)
  }

  const at = (d: string) => {
    const f = span === 0 ? 0 : Math.min(1, Math.max(0, diffDays(d, first) / span))
    return `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f.toFixed(4)})`
  }

  // несколько событий одного дня — одна засечка; title перечисляет их
  const ticks = useMemo(
    () =>
      timelineTicks(marks, first, today).map((t) => ({
        day: t.day,
        rank: t.rank,
        title: [formatDayLong(t.day), ...t.marks.map((m) => `${m.kind === 'rank' ? '▲' : '✦'} ${m.label}`)].join('\n'),
      })),
    [marks, first, today],
  )

  const months = useMemo(() => {
    const shown: { day: string; label: string; pct: number }[] = []
    for (const m of timelineMonths(first, today)) {
      const pct = span === 0 ? 0 : (diffDays(m.day, first) / span) * 100
      if (shown.length && pct - shown[shown.length - 1].pct < MONTH_GAP) continue
      shown.push({ ...m, pct })
    }
    return shown
  }, [first, today, span])

  return (
    <div className="timeline">
      <div className="timeline-head">
        <div className="timeline-summary">
          ◷ <b>{formatDayLong(day)}</b>
          {day === today && ' · сегодня'}
          {' · '}<span className="lv">ур. {summary.level}</span>
          {' · '}горит {summary.starsLit} из {summary.starsTotal}
        </div>
        <button type="button" onClick={togglePlay} disabled={span === 0}
          title={playing ? 'Пауза' : 'Проиграть рост неба до сегодня'}
          aria-label={playing ? 'Пауза' : 'Проиграть рост неба до сегодня'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" onClick={onClose} title="Закрыть историю и вернуться в сегодня" aria-label="Закрыть историю">✕</button>
      </div>
      <div className="timeline-ticks">
        {ticks.map((t) => (
          <button key={t.day} type="button" tabIndex={-1}
            className={t.rank ? 'timeline-tick rank' : 'timeline-tick'}
            style={{ left: at(t.day) }} title={t.title} aria-label={t.title}
            onClick={() => pick(t.day)} />
        ))}
      </div>
      <input className="timeline-range" type="range" min={0} max={span} step={1} value={value}
        aria-label="Дата неба" aria-valuetext={formatDayLong(day)}
        onPointerDown={() => setPlaying(false)}
        onChange={(e) => pick(addDays(first, Number(e.target.value)))} />
      <div className="timeline-months">
        {months.map((m) => (
          <span key={m.day} style={{ left: at(m.day) }}>{m.label}</span>
        ))}
      </div>
    </div>
  )
}
