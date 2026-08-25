import { useLayoutEffect, useRef } from 'react'
import type { TrackModel } from '../logic/track'
import { WishVisual, hasVisual } from './WishVisual'

interface Props {
  model: TrackModel
  onMilestoneClick: (itemId: string) => void
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`

// Минимальный шаг между вехами: карточка награды 84px + зазор (подписи st-name
// до 84px влезают тем более). Вехи делят (1 − zeroPos) холста, поэтому ширина
// холста — шаг · n / (1 − zeroPos); узкий экран получает горизонтальный скролл.
const MILESTONE_STEP = 104

export function SavingsTrack({ model, onMilestoneClick }: Props) {
  const { balance, zeroPos, debt, milestones, fill, rate, eta } = model
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // при переполнении открываемся на кромке заливки, а не на левом краю
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = Math.max(0, el.scrollWidth * fill - el.clientWidth / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const minWidth = milestones.length
    ? Math.round((MILESTONE_STEP * milestones.length) / (1 - zeroPos))
    : undefined
  // место под карточки над рейлом нужно, только если хоть одной есть что показать
  const anyCard = milestones.some((m) => hasVisual(m.item))
  return (
    <div className={anyCard ? 'savings-track has-cards' : 'savings-track'}>
      <div className="st-scroll" ref={scrollRef}>
        <div className="st-canvas" style={minWidth ? { minWidth } : undefined}>
          <div className={debt ? 'st-rail in-debt' : 'st-rail'}>
            {debt && <div className="st-debt-zone" style={{ width: pct(zeroPos) }} />}
            <div className="st-fill" style={{ width: pct(fill) }} />
            {debt && (
              <>
                <div className="st-zero" style={{ left: pct(zeroPos) }} />
                <span className="st-zero-label" style={{ left: pct(zeroPos) }}>0</span>
                <span className="st-debt-label">{balance} ✨</span>
              </>
            )}
            {milestones.map((m, i) => {
              // битая картинка без эмодзи оставит пустую тёмную карточку — принятая деградация
              const card = hasVisual(m.item)
              const cls =
                'st-ms' +
                (m.reached ? ' reached' : '') +
                (i === milestones.length - 1 ? ' edge-r' : '')
              return (
                <div key={m.item.id} className={cls} style={{ left: pct(m.pos) }}>
                  <button
                    className="st-star"
                    title={`${m.item.title} · ${m.item.price} ✨`}
                    onClick={() => onMilestoneClick(m.item.id)}
                  >
                    {card && (
                      // карточка внутри кнопки: клик по картинке — клик по вехе
                      <span className="st-card">
                        <WishVisual item={m.item} />
                      </span>
                    )}
                  </button>
                  <span className="st-price">{m.item.price} ✨</span>
                  <span className="st-name">{m.item.title}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {eta && (
        <div className="st-eta">
          {eta.kind === 'toZero' ? 'до нуля' : `до «${eta.title}»`} ≈ {eta.weeks} нед
          {' '}при темпе {Math.max(1, Math.round(rate))} ✨/нед
        </div>
      )}
    </div>
  )
}
