import { useEffect, useState } from 'react'
import type { Quest, Store, WishlistItem } from '../types'
import { LEDGER_KIND_LABEL } from '../types'
import { formatDayShort } from '../logic/dates'
import { ledgerTotal, provisionForQuest, provisionTotal, purchasedDays, sparksBalance } from '../logic/sparks'
import { rankTitle } from '../logic/stars'
import { SavingsTrack } from './SavingsTrack'
import { WishVisual } from './WishVisual'
import { trackModel } from '../logic/track'

interface Props {
  store: Store
  today: string
  onPurchase: (item: WishlistItem) => void
  onSpend: (amount: number, note: string) => void
  onClaim: (item: WishlistItem) => void
  onAddItem: () => void
  onEditItem: (item: WishlistItem) => void
  onArchiveItem: (item: WishlistItem) => void
  onOpenQuest: (quest: Quest) => void
}

export function Wallet({ store, today, onPurchase, onSpend, onClaim, onAddItem, onEditItem, onArchiveItem, onOpenQuest }: Props) {
  // Один слот на весь экран: взвод второй позиции сам снимает предыдущий,
  // двух занесённых кнопок одновременно не бывает
  const [confirm, setConfirm] = useState<{ kind: 'buy' | 'claim'; id: string } | null>(null)
  const [spendAmount, setSpendAmount] = useState('')
  const [spendNote, setSpendNote] = useState('')
  const armed = (kind: 'buy' | 'claim', id: string) => confirm?.kind === kind && confirm.id === id
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const track = trackModel(store, today)
  const flashItem = (id: string) => {
    setHighlightId(id)
    document.getElementById(`wi-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  useEffect(() => {
    if (highlightId === null) return
    const t = setTimeout(() => setHighlightId(null), 2000)
    return () => clearTimeout(t)
  }, [highlightId])

  const balance = sparksBalance(store, today)
  const provisions = store.quests
    .map((quest) => ({ quest, p: provisionForQuest(quest, today) }))
    .filter((x) => x.p > 0)
  const items = (store.wishlist ?? []).filter((w) => !w.archived)
  // повторяющиеся радости сверху, разовые под ними (внутри групп — порядок store)
  const small = items.filter((w) => w.kind === 'small')
    .sort((a, b) => Number(Boolean(b.repeatable)) - Number(Boolean(a.repeatable)))
  const big = items.filter((w) => w.kind === 'big')
  const ledger = [...(store.ledger ?? [])].reverse() // свежее сверху, как в CLI
  const bought = purchasedDays(store) // «куплена» у разовой — факт в ledger, не хранится

  // взвод не переживает потери права на действие: провизия съела баланс (или погасили
  // звезду, или позиция уехала в архив) — кнопка не должна дождаться возврата уже
  // взведённой и потратить искры кликом, которого не делали. Приём тот же, что в SkillPanel
  const canBuy = (w: WishlistItem) =>
    w.price !== undefined && w.price <= balance && (Boolean(w.repeatable) || !bought.has(w.id))
  const canClaim = (w: WishlistItem) =>
    !w.claimedAt && Boolean(store.stars.find((s) => s.id === w.starId)?.litAt)
  const armedItem = confirm ? items.find((w) => w.id === confirm.id) : undefined
  const armedOk = confirm === null ||
    (armedItem !== undefined && (confirm.kind === 'buy' ? canBuy(armedItem) : canClaim(armedItem)))
  useEffect(() => {
    if (!armedOk) setConfirm(null)
  }, [armedOk])
  const questTitle = (id?: string) => (id ? (store.quests.find((q) => q.id === id)?.title ?? id) : null)
  const itemTitle = (id?: string) => (id ? ((store.wishlist ?? []).find((w) => w.id === id)?.title ?? id) : null)

  const spendN = Math.floor(Number(spendAmount))
  const spendOk = Number.isFinite(spendN) && spendN >= 1
  const canSpend = spendOk && spendN <= balance && spendNote.trim() !== ''
  // почему кнопка не жмётся — говорим до нажатия, а не молчим
  const spendBlock = !spendOk
    ? null
    : spendN > balance
      ? `не хватает ${spendN - balance} ✨`
      : spendNote.trim() === ''
        ? 'нужна пометка «на что»'
        : null

  return (
    <div className="wallet">
      <div className="wallet-shell">
        <div className="wallet-head">
          <div className={balance < 0 ? 'wallet-balance negative' : 'wallet-balance'}>✨ {balance}</div>
          {provisions.length > 0 && (
            <div className="wallet-net">
              чистыми {ledgerTotal(store)} · провизия −{provisionTotal(store, today)}
            </div>
          )}
        </div>

        {provisions.length > 0 && (
          <div className="wallet-section">
            <h2>Капает</h2>
            {provisions.map(({ quest, p }) => (
              <div key={quest.id} className="wallet-drip-row" onClick={() => onOpenQuest(quest)}>
                <span className="wd-title">{quest.title}</span>
                <span className="wd-amount">−{p} ✨</span>
                <span className="wd-cap">{p >= quest.xpReward ? 'потолок' : `до потолка ещё ${quest.xpReward - p}`}</span>
              </div>
            ))}
          </div>
        )}

        <div className="wallet-section">
          <h2>
            Награды для себя
            <button className="add-btn wallet-add" onClick={onAddItem}>+ позиция</button>
          </h2>
          {track && <SavingsTrack model={track} onMilestoneClick={flashItem} />}
          {items.length === 0 && <div className="hint">Пусто. Заведи награды для себя: мелкие радости за искры и big-награды к звёздам.</div>}
          {small.map((w) => {
            const price = w.price ?? 0
            const short = price - balance
            const boughtDay = !w.repeatable ? bought.get(w.id) : undefined
            return (
              <div key={w.id} id={`wi-${w.id}`} className={highlightId === w.id ? 'wallet-item flash' : 'wallet-item'}>
                <WishVisual item={w} className="wi-thumb" placeholder />
                <span className="wi-title" onClick={() => onEditItem(w)}>{w.title}</span>
                {w.originalPrice && <span className="wi-orig">{w.originalPrice}</span>}
                {w.sourceUrl && <a className="wi-link" href={w.sourceUrl} target="_blank" rel="noreferrer">↗</a>}
                {w.note && <span className="wi-note">{w.note}</span>}
                {boughtDay ? (
                  // разовая уже куплена — трофей вместо кнопки, симметрия с «✦ получено» у big
                  <>
                    <span className="wi-claimed">✔ куплено {formatDayShort(boughtDay)}</span>
                    <button className="wi-hide" onClick={() => onArchiveItem(w)}>Спрятать из списка наград</button>
                  </>
                ) : w.price === undefined ? (
                  <span className="wi-locked">без цены</span>
                ) : (
                  <>
                    <span className="wi-price">{price} ✨</span>
                    {short > 0 ? (
                      <>
                        <span className="wi-locked">не хватает {short} ✨</span>
                        <button disabled>Купить</button>
                      </>
                    ) : armed('buy', w.id) ? (
                      <>
                        <button className="primary" onClick={() => { onPurchase(w); setConfirm(null) }}>
                          Точно купить за {price} ✨?
                        </button>
                        <button onClick={() => setConfirm(null)}>Отмена</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirm({ kind: 'buy', id: w.id })}>Купить</button>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {big.map((w) => {
            const star = store.stars.find((s) => s.id === w.starId)
            const skill = star ? store.skills.find((s) => s.id === star.skillId) : undefined
            return (
              <div key={w.id} className="wallet-item big">
                <WishVisual item={w} className="wi-thumb" placeholder />
                <span className="wi-title" onClick={() => onEditItem(w)}>{w.title}</span>
                {w.originalPrice && <span className="wi-orig">{w.originalPrice}</span>}
                {w.sourceUrl && <a className="wi-link" href={w.sourceUrl} target="_blank" rel="noreferrer">↗</a>}
                <span className="wi-anchor">
                  {skill ? `${skill.emoji} ${skill.name}` : '?'} · {star ? star.title : `звезда ${w.starId} не найдена`}
                  {skill && star ? ` · ${star.tier} «${rankTitle(skill, star.tier)}»` : ''}
                </span>
                {w.claimedAt ? (
                  <span className="wi-claimed">✦ получено {formatDayShort(w.claimedAt.slice(0, 10))}</span>
                ) : !star?.litAt ? (
                  <span className="wi-locked">звезда не зажжена</span>
                ) : armed('claim', w.id) ? (
                  // «получено» необратимо: второй шаг такой же, как у покупки
                  <>
                    <button className="primary" onClick={() => { onClaim(w); setConfirm(null) }}>Точно забрать?</button>
                    <button onClick={() => setConfirm(null)}>Отмена</button>
                  </>
                ) : (
                  <button onClick={() => setConfirm({ kind: 'claim', id: w.id })}>Забрать</button>
                )}
              </div>
            )
          })}
        </div>

        <div className="wallet-section">
          <h2>Произвольная трата</h2>
          <div className="wallet-spend">
            <input type="number" min={1} value={spendAmount} placeholder="✨" onChange={(e) => setSpendAmount(e.target.value)} />
            <input value={spendNote} placeholder="На что (обязательно)" onChange={(e) => setSpendNote(e.target.value)} />
            <button
              disabled={!canSpend}
              onClick={() => {
                onSpend(spendN, spendNote.trim())
                setSpendAmount('')
                setSpendNote('')
              }}
            >
              Потратить
            </button>
          </div>
          {spendBlock && <div className="hint">{spendBlock}</div>}
        </div>

        <div className="wallet-section">
          <h2>Выписка</h2>
          {ledger.length === 0 && <div className="hint">Событий пока нет — сдай первый контракт.</div>}
          {ledger.map((e) => (
            <div key={e.id} className="ledger-row">
              <span className="lr-day">{formatDayShort(e.day)}</span>
              <span className="lr-kind">{LEDGER_KIND_LABEL[e.kind]}</span>
              <span className={e.amount > 0 ? 'lr-amount plus' : 'lr-amount minus'}>
                {e.amount > 0 ? `+${e.amount}` : e.amount} ✨
              </span>
              <span className="lr-what">{e.note ?? itemTitle(e.itemId) ?? questTitle(e.questId) ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
