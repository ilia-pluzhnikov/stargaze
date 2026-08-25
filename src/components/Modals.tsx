import { useState } from 'react'
import type { Quest, QuestDodItem, QuestResource, QuestResult, QuestType, Skill, StarComponent, Store, Tier, WishlistItem } from '../types'
import { DOW_LABELS, QUEST_TYPE_LABEL, TIERS, WISHLIST_EMOJI_MAX } from '../types'
import { genId } from '../logic/store'
import { isCalendarDay, todayKey } from '../logic/dates'
import { FREE_MOVES_PER_7D, moveFeeFor, movesUsedIn7d, provisionForQuest } from '../logic/sparks'
import { validateStore } from '../logic/validate'
import { childrenOf, skillStars, TIER_CLASS } from '../logic/stars'
import { rarityVar, sky } from './skyColors'
import { SKY_GLYPHS } from './skyGlyphs'

/* ── Квест ─────────────────────────────────────── */

interface QuestModalProps {
  initial?: Quest
  defaultSkillId: string | null
  skills: Skill[]
  stars: StarComponent[]
  quests: Quest[] // для выбора эпика-родителя и определения «у квеста есть дети»
  today: string // игровой день: пол для дедлайна принятого контракта (см. dueFloor)
  archiveBlock?: string | null // причина, по которой архив запрещён (эпик с active-детьми)
  frozen?: boolean // принятый контракт (всё, кроме proposed): условия экономики заморожены
  cancelFee?: number | null // цена отмены; null/undefined = архив бесплатный
  onMoveDueDate?: () => void
  onSave: (q: Quest, isNew: boolean) => void
  onArchive: (id: string) => void
  onClose: () => void
}

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // Пн..Вс

export function QuestModal({
  initial,
  defaultSkillId,
  skills,
  stars,
  quests,
  today,
  archiveBlock,
  frozen,
  cancelFee,
  onMoveDueDate,
  onSave,
  onArchive,
  onClose,
}: QuestModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<QuestType>(initial?.type ?? 'repeating')
  const [skillId, setSkillId] = useState<string>(initial?.skillId ?? defaultSkillId ?? '')
  const [starId, setStarId] = useState(initial?.starId ?? '')
  const [xp, setXp] = useState(String(initial?.xpReward ?? 25))
  const [days, setDays] = useState<number[]>(initial?.daysOfWeek ?? [])
  const [due, setDue] = useState(initial?.dueDate ?? '')
  const [why, setWhy] = useState(initial?.why ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [dodText, setDodText] = useState((initial?.definitionOfDone ?? []).map((d) => d.text).join('\n'))
  const [resources, setResources] = useState<QuestResource[]>(initial?.resources ?? [])
  const [parentQuestId, setParentQuestId] = useState(initial?.parentQuestId ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // дедлайн активного контракта заперт ровно тогда, когда его морозит редьюсер
  const dueLocked = Boolean(frozen && initial?.dueDate)
  // Пол даты — только у принятого контракта, которому срок ставят впервые: у него
  // drainStart уже в прошлом (createdAt/acceptedAt), и дата назад мгновенно
  // материализует провизию, снять которую нечем (дальше срок заморожен, а перенос
  // вперёд накапавшее фиксирует). У нового и proposed drainStart клампится в
  // сегодня — капания нет вовсе, и запрет только отнимал бы легальный ввод
  // (зафиксировать уже просроченное обязательство); CLI на --due тоже не запрещает
  const dueFloor = frozen && !initial?.dueDate ? today : undefined

  // квест с детьми — сам родитель: второй уровень запрещён валидацией, селект скрыт.
  // Проверка initial обязательна: у нового квеста детей нет, а `c.parentQuestId === undefined`
  // совпало бы с любым top-level квестом и молча спрятало селект
  const hasChildren = initial != null && quests.some((c) => c.parentQuestId === initial.id)
  // eligible: не-repeating, top-level, не archived и не done (модель терпит done-родителя,
  // но точки входа новых связей его не предлагают)
  const parentOptions = quests.filter(
    (p) => p.id !== initial?.id && p.type !== 'repeating' && !p.parentQuestId && p.status !== 'archived' && p.status !== 'done',
  )

  const starOptions = skillStars(stars, skillId)
    .slice()
    .sort((a, b) => Number(!!a.litAt) - Number(!!b.litAt))

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))

  const setResource = (i: number, patch: Partial<QuestResource>) =>
    setResources((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const save = () => {
    const t = title.trim()
    const xpN = Math.floor(Number(xp))
    // эпик не может стать повторяющимся: дети сохранят parentQuestId и стор станет невалидным
    if (hasChildren && type === 'repeating') return setErr('У квеста есть подквесты — тип «Повторяющийся» недоступен')
    if (!t) return setErr('Нужно название')
    if (!Number.isFinite(xpN) || xpN < 1) return setErr('XP — целое число ≥ 1')
    // min на инпуте закрывает календарь, эта проверка — ввод текстом (на webOS-фолбэке
    // поле текстовое, и min там косметика; рядом у MoveDueDateModal ровно поэтому есть
    // и min, и гейт кнопки). Условие — то же, что у dueFloor: см. комментарий выше
    if (dueFloor && due && due < dueFloor)
      return setErr('Дедлайн не раньше сегодня')
    // DoD: строка = пункт; старые done-флаги сохраняем по индексу при равном числе строк
    const dodLines = dodText.split('\n').map((x) => x.trim()).filter(Boolean)
    const oldDod = initial?.definitionOfDone ?? []
    const definitionOfDone: QuestDodItem[] = dodLines.map((text, i) =>
      dodLines.length === oldDod.length && oldDod[i]?.done ? { text, done: true } : { text },
    )
    const cleanResources = resources
      .map((r) => ({ title: r.title.trim(), url: r.url?.trim() }))
      .filter((r) => r.title !== '')
      .map((r) => (r.url ? { title: r.title, url: r.url } : { title: r.title }))
    const quest: Quest = {
      id: initial?.id ?? genId('q'),
      title: t,
      type,
      skillId: skillId || null,
      starId: starId || null,
      // repeating не может быть подквестом: при смене типа связь снимается — это отражено скрытием селекта
      parentQuestId: type !== 'repeating' && parentQuestId ? parentQuestId : undefined,
      xpReward: xpN,
      daysOfWeek: type === 'repeating' && days.length > 0 && days.length < 7 ? [...days].sort() : undefined,
      dueDate: type !== 'repeating' && due ? due : undefined,
      status: initial?.status ?? 'active',
      // невидимые в форме поля правки не теряют: итог живёт на done-квесте
      proposalNote: initial?.proposalNote,
      result: type !== 'repeating' ? initial?.result : undefined,
      why: why.trim() || undefined,
      description: description.trim() || undefined,
      definitionOfDone: definitionOfDone.length > 0 ? definitionOfDone : undefined,
      resources: cleanResources.length > 0 ? cleanResources : undefined,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    onSave(quest, !initial)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>{initial ? 'Квест' : 'Новый квест'}</h3>
        <div className="field">
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Что нужно сделать" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Тип</label>
            <select value={type} disabled={frozen} onChange={(e) => setType(e.target.value as QuestType)}>
              {(Object.keys(QUEST_TYPE_LABEL) as QuestType[]).map((k) => (
                <option key={k} value={k}>
                  {QUEST_TYPE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>XP</label>
            <input type="number" min={1} value={xp} disabled={frozen} onChange={(e) => setXp(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Навык</label>
          <select
            value={skillId}
            onChange={(e) => {
              setSkillId(e.target.value)
              setStarId('')
            }}
          >
            <option value="">— без навыка (Главный квест) —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.name}
              </option>
            ))}
          </select>
        </div>
        {skillId && starOptions.length > 0 && (
          <div className="field">
            <label>Звезда (какую наливает XP; опционально)</label>
            <select value={starId} onChange={(e) => setStarId(e.target.value)}>
              <option value="">— навык в целом —</option>
              {starOptions.map((star) => (
                <option key={star.id} value={star.id}>
                  {star.litAt ? '✦' : '☆'} {star.tier} · {star.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {type !== 'repeating' && !hasChildren && parentOptions.length > 0 && (
          <div className="field">
            <label>Часть эпика</label>
            <select value={parentQuestId} onChange={(e) => setParentQuestId(e.target.value)}>
              <option value="">— самостоятельный квест —</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}
        {type === 'repeating' ? (
          <div className="field">
            <label>Дни недели (пусто = каждый день)</label>
            <div className="dow">
              {DOW_ORDER.map((d) => (
                <button key={d} className={days.includes(d) ? 'on' : ''} onClick={() => toggleDay(d)}>
                  {DOW_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Дедлайн</label>
            {/* заморожен только уже поставленный срок — пустой ставится один раз
                отсюда (иначе контракт без даты не переносится ничем и заперт).
                Признак берём из сохранённого квеста, а не из `due`: живое состояние
                поля успевает стать непустым на полудобитой дате (нативный date отдаёт
                год «0002» после дня и месяца) и подменяло бы инпут прямо под руками */}
            {dueLocked ? (
              <div className="field-row" style={{ alignItems: 'center' }}>
                <span>{initial?.dueDate}</span>
                {onMoveDueDate && (
                  <button type="button" className="add-btn" onClick={onMoveDueDate}>Перенести…</button>
                )}
              </div>
            ) : (
              <input type="date" value={due} min={dueFloor} onChange={(e) => setDue(e.target.value)} />
            )}
          </div>
        )}
        {frozen && (
          <div className="hint">
            {dueLocked
              ? 'Условия контракта (тип, XP, дедлайн) заморожены: их фиксирует принятие'
              : 'Тип и XP заморожены. Срока нет — контракт не капает; дату можно задать здесь, дальше её двигает только перенос'}
          </div>
        )}
        <details className="quest-card-section" open={Boolean(why || description || dodText || resources.length)}>
          <summary>Карточка (зачем · описание · DoD · материалы)</summary>
          <div className="field">
            <label>Зачем</label>
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Мотивация: ради чего этот квест" />
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Что именно сделать" />
          </div>
          <div className="field">
            <label>Definition of Done (строка = пункт)</label>
            <textarea rows={3} value={dodText} onChange={(e) => setDodText(e.target.value)} placeholder={'Выписаны точки касания\nВыбран сегмент'} />
          </div>
          <div className="field">
            <label>Материалы</label>
            {resources.map((r, i) => (
              <div className="field-row" key={i} style={{ marginBottom: 6 }}>
                <input
                  value={r.title}
                  onChange={(e) => setResource(i, { title: e.target.value })}
                  placeholder="Название"
                />
                <input
                  value={r.url ?? ''}
                  onChange={(e) => setResource(i, { url: e.target.value })}
                  placeholder="URL (опционально)"
                />
                <button
                  type="button"
                  className="q-res-del"
                  aria-label="Убрать материал"
                  onClick={() => setResources((cur) => cur.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="add-btn" onClick={() => setResources((cur) => [...cur, { title: '' }])}>
              + материал
            </button>
          </div>
        </details>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          {initial && (
            cancelFee != null && !archiveBlock ? (
              confirmCancel ? (
                <button className="danger" onClick={() => onArchive(initial.id)}>
                  Точно отменить? −{cancelFee} ✨
                </button>
              ) : (
                <button className="danger" onClick={() => setConfirmCancel(true)}>
                  Отменить контракт (−{cancelFee} ✨)
                </button>
              )
            ) : (
              <button className="danger" onClick={() => (archiveBlock ? setErr(archiveBlock) : onArchive(initial.id))}>
                В архив
              </button>
            )
          )}
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </>
  )
}

/* ── Завершение квеста с итогом ────────────────── */

interface CompleteQuestModalProps {
  quest: Quest
  activeChildren: Quest[] // active-подквесты эпика; пустой массив = не эпик
  onConfirm: (result: QuestResult, dod: QuestDodItem[] | undefined, force: boolean) => void
  onClose: () => void
}

export function CompleteQuestModal({ quest, activeChildren, onConfirm, onClose }: CompleteQuestModalProps) {
  const [summary, setSummary] = useState('')
  const [artifactUrl, setArtifactUrl] = useState('')
  const [evidence, setEvidence] = useState('')
  const [dod, setDod] = useState<QuestDodItem[]>(quest.definitionOfDone ?? [])
  const [forceOpen, setForceOpen] = useState(false)
  const [forceChildren, setForceChildren] = useState(false)

  const dodChanged = dod.some((d, i) => Boolean(d.done) !== Boolean(quest.definitionOfDone?.[i]?.done))
  const openCount = dod.filter((d) => !d.done).length
  // DoD-гейт и гейт по детям: и то и другое блокирует завершение, пока не взведён явный force
  const canConfirm =
    summary.trim() !== '' && (openCount === 0 || forceOpen) && (activeChildren.length === 0 || forceChildren)

  const confirm = () => {
    if (!canConfirm) return
    const result: QuestResult = { summary: summary.trim() }
    const a = artifactUrl.trim()
    const e = evidence.trim()
    if (a) result.artifactUrl = a
    if (e) result.evidence = e
    // skippedQuestIds пишет ядро — клиент лишь сообщает, что force взведён
    onConfirm(result, dodChanged ? dod : undefined, openCount > 0 || activeChildren.length > 0)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>Завершить квест</h3>
        <div className="complete-quest-title">
          {quest.title} <span className="p-xp">+{quest.xpReward} XP</span>
        </div>
        {dod.length > 0 && (
          <div className="field">
            <label>Definition of Done</label>
            {dod.map((d, i) => (
              <label key={i} className={d.done ? 'q-dod' : 'q-dod dod-open'}>
                <input
                  type="checkbox"
                  checked={Boolean(d.done)}
                  onChange={() => setDod((cur) => cur.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                />
                <span className={d.done ? 'dod-on' : ''}>{d.text}</span>
              </label>
            ))}
            {openCount > 0 && (
              <label className="q-dod force-row">
                <input type="checkbox" checked={forceOpen} onChange={() => setForceOpen((v) => !v)} />
                <span>
                  Завершить с незакрытыми пунктами ({openCount}) — они будут помечены в итоге как пропущенные
                </span>
              </label>
            )}
          </div>
        )}
        {activeChildren.length > 0 && (
          <div className="field">
            <label>Активные подквесты</label>
            {activeChildren.map((c) => (
              <div key={c.id} className="q-dod dod-open">
                <span>{c.title}</span>
              </div>
            ))}
            <label className="q-dod force-row">
              <input type="checkbox" checked={forceChildren} onChange={() => setForceChildren((v) => !v)} />
              <span>
                Завершить эпик, не закрывая подквесты ({activeChildren.length}) — они останутся активными
                и лягут в итог как пропущенные
              </span>
            </label>
          </div>
        )}
        <div className="field">
          <label>Итог (обязательно) — что получилось</label>
          <textarea
            rows={2}
            autoFocus
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Выбран сегмент heads/операторов, сформулирован оффер"
          />
        </div>
        <div className="field">
          <label>Ссылка на артефакт</label>
          <input value={artifactUrl} onChange={(e) => setArtifactUrl(e.target.value)} placeholder="https://… (опционально)" />
        </div>
        <div className="field">
          <label>Evidence — измеримый сигнал</label>
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="«7 ответов, 2 заявки» (опционально)" />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!canConfirm} onClick={confirm}>
            Завершить
          </button>
        </div>
      </div>
    </>
  )
}

/* ── Навык ─────────────────────────────────────── */

interface SkillModalProps {
  initial?: Skill
  onSave: (s: Skill, isNew: boolean) => void
  onClose: () => void
}

export function SkillModal({ initial, onSave, onClose }: SkillModalProps) {
  const [emoji, setEmoji] = useState(initial?.emoji ?? '✨')
  const [name, setName] = useState(initial?.name ?? '')
  const [want, setWant] = useState(initial?.wantStatement ?? '')
  const [hue, setHue] = useState<number>(initial?.hue ?? Math.floor(Math.random() * 360))
  const [glyphId, setGlyphId] = useState<string | undefined>(initial?.glyphId)
  const [rankTitles, setRankTitles] = useState<Partial<Record<Tier, string>>>(initial?.rankTitles ?? {})
  const [err, setErr] = useState<string | null>(null)

  const save = () => {
    const n = name.trim()
    if (!n) return setErr('Нужно название')
    const cleanRankTitles: Partial<Record<Tier, string>> = {}
    for (const t of TIERS) {
      const v = rankTitles[t]?.trim()
      if (v) cleanRankTitles[t] = v
    }
    const skill: Skill = {
      id: initial?.id ?? genId('s'),
      emoji: emoji.trim() || '✨',
      name: n,
      wantStatement: want.trim(),
      lore: initial?.lore,
      hue,
      glyphId,
      rankTitles: Object.keys(cleanRankTitles).length > 0 ? cleanRankTitles : undefined,
      archived: initial?.archived ?? false,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    onSave(skill, !initial)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>{initial ? 'Навык' : 'Новый навык'}</h3>
        <div className="field-row">
          <div className="field" style={{ flex: '0 0 80px' }}>
            <label>Эмодзи</label>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </div>
          <div className="field">
            <label>Название</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Например: Контент" />
          </div>
        </div>
        <div className="field">
          <label>Что я хочу от навыка</label>
          <textarea rows={2} value={want} onChange={(e) => setWant(e.target.value)} />
        </div>
        <div className="field">
          <label>Оттенок созвездия</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="range" min={0} max={360} value={hue} onChange={(e) => setHue(Number(e.target.value))} />
            <span
              style={{
                flex: '0 0 22px',
                height: 22,
                borderRadius: '50%',
                background: sky.xpBar(hue),
                boxShadow: `0 0 10px ${sky.edgeGlow(hue, true, 'C')}`,
              }}
            />
          </div>
        </div>
        <div className="field">
          <label>Глиф созвездия</label>
          <div className="glyph-grid">
            <button type="button" className={glyphId === undefined ? 'glyph-cell on' : 'glyph-cell'}
              onClick={() => setGlyphId(undefined)} title="Без глифа">—</button>
            {SKY_GLYPHS.map((g) => (
              <button type="button" key={g.id} className={glyphId === g.id ? 'glyph-cell on' : 'glyph-cell'}
                onClick={() => setGlyphId(g.id)} title={g.name}>
                <svg viewBox="230 150 560 660" aria-hidden>
                  <g fill="none" stroke="currentColor" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round">
                    {g.paths.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                </svg>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Ранги</label>
          <div className="rank-titles">
            {TIERS.map((t) => (
              <div key={t} className="field-row" style={{ alignItems: 'center', gap: 8 }}>
                <span style={{ flex: '0 0 20px', color: rarityVar(t) }}>{t}</span>
                <input
                  value={rankTitles[t] ?? ''}
                  onChange={(e) => setRankTitles((cur) => ({ ...cur, [t]: e.target.value }))}
                  placeholder={TIER_CLASS[t]}
                />
              </div>
            ))}
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </>
  )
}

/* ── Звезда ────────────────────────────────────── */

interface StarModalProps {
  skillId: string
  stars: StarComponent[] // все звёзды навыка — для select родителя
  initial?: StarComponent
  defaultParentStarId?: string | null // предзаполнение при «+ ветка отсюда»
  canDelete: boolean // не зажжена, без квестов и без детей
  onSave: (c: StarComponent, isNew: boolean) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** Все потомки звезды (обход childrenOf) — не предлагать их в select родителя при редактировании. */
function descendantsOf(stars: StarComponent[], rootId: string): Set<string> {
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const child of childrenOf(stars, id)) {
      if (!result.has(child.id)) {
        result.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return result
}

export function StarModal({ skillId, stars, initial, defaultParentStarId, canDelete, onSave, onDelete, onClose }: StarModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [criteria, setCriteria] = useState(initial?.criteria ?? '')
  const [xp, setXp] = useState(initial?.xpTarget != null ? String(initial.xpTarget) : '')
  const [parentStarId, setParentStarId] = useState<string | null>(
    initial?.parentStarId ?? defaultParentStarId ?? null,
  )
  const [tier, setTier] = useState<Tier>(initial?.tier ?? 'D')
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const excluded = initial ? descendantsOf(stars, initial.id) : new Set<string>()
  const parentOptions = skillStars(stars, skillId).filter((s) => s.id !== initial?.id && !excluded.has(s.id))

  const save = () => {
    const t = title.trim()
    if (!t) return setErr('Нужно название')
    const xpN = Math.floor(Number(xp))
    const star: StarComponent = {
      id: initial?.id ?? genId('c'),
      skillId,
      parentStarId,
      tier,
      title: t,
      criteria: criteria.trim() || undefined,
      xpTarget: xpN > 0 ? xpN : undefined,
      litAt: initial?.litAt,
      evidence: initial?.evidence,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    onSave(star, !initial)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>{initial ? 'Звезда' : 'Новая звезда'}</h3>
        <div className="field">
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Например: Алфавит" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Родитель</label>
            <select value={parentStarId ?? ''} onChange={(e) => setParentStarId(e.target.value || null)}>
              <option value="">— из ядра —</option>
              {parentOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.litAt ? '✦' : '☆'} {s.tier} · {s.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ранг</label>
            <select value={tier} style={{ color: rarityVar(tier) }} onChange={(e) => setTier(e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t} value={t} style={{ color: rarityVar(t) }}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Критерий зажигания</label>
          <textarea
            rows={2}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="Чем будет подтверждено (необязательно)"
          />
        </div>
        <div className="field">
          <label>XP-цель для заливки</label>
          <input type="number" min={0} value={xp} onChange={(e) => setXp(e.target.value)} placeholder="Пусто = нет" />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          {initial &&
            canDelete &&
            (confirmDelete ? (
              <button className="danger" onClick={() => onDelete(initial.id)}>
                Точно удалить?
              </button>
            ) : (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            ))}
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </>
  )
}

/* ── Данные ────────────────────────────────────── */

interface DataModalProps {
  store: Store
  onImport: (s: Store) => void
  onReset: () => void
  onClose: () => void
}

export function DataModal({ store, onImport, onReset, onClose }: DataModalProps) {
  const [err, setErr] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const doExport = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stargaze-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (validateStore(parsed).length > 0) {
        setErr('Файл не похож на валидный экспорт Stargaze (v3). Автомиграции старых версий нет.')
        return
      }
      onImport(parsed as Store)
    } catch {
      setErr('Не удалось прочитать JSON.')
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>Данные</h3>
        <div className="field">
          <button className="add-btn" onClick={doExport}>
            ⬇ Экспорт в JSON
          </button>
        </div>
        <div className="field">
          <label>Импорт из JSON (заменит текущее состояние)</label>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
            }}
          />
        </div>
        <div className="field">
          {confirmReset ? (
            <button className="add-btn" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onReset}>
              Точно сбросить всё к сиду лета?
            </button>
          ) : (
            <button className="add-btn" onClick={() => setConfirmReset(true)}>
              ↺ Сброс к сиду лета
            </button>
          )}
        </div>
        <div className="hint">Данные живут в localStorage этого браузера. Экспортируй перед чисткой браузера.</div>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </>
  )
}

/* ── Позиция витрины ───────────────────────────── */

interface WishlistModalProps {
  initial?: WishlistItem
  skills: Skill[]
  stars: StarComponent[]
  items: WishlistItem[] // живая витрина — для проверки уникальности якоря big
  onSave: (item: WishlistItem, isNew: boolean) => void
  onArchive: (id: string) => void
  onClose: () => void
}

export function WishlistModal({ initial, skills, stars, items, onSave, onArchive, onClose }: WishlistModalProps) {
  const initialStar = initial?.starId ? stars.find((c) => c.id === initial.starId) : undefined
  const [kind, setKind] = useState<'small' | 'big'>(initial?.kind ?? 'small')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '')
  // навык здесь — только фильтр списка звёзд: в позиции хранится звезда, навык выводится из неё
  const [skillId, setSkillId] = useState(initialStar?.skillId ?? '')
  const [starId, setStarId] = useState(initial?.starId ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '')
  const [originalPrice, setOriginalPrice] = useState(initial?.originalPrice ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '')
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '')
  const [repeatable, setRepeatable] = useState(Boolean(initial?.repeatable))
  const [err, setErr] = useState<string | null>(null)
  const ownStars = skillId ? skillStars(stars, skillId) : []

  // полученное ядро не переписывает (тихий no-op) — говорим об этом до нажатия
  const claimed = Boolean(initial?.claimedAt)

  const save = () => {
    if (claimed) return
    const t = title.trim()
    if (!t) return setErr('Нужно название')
    // ядро отвергло бы длинный эмодзи молча (no-op) — говорим до нажатия
    if (emoji.trim().length > WISHLIST_EMOJI_MAX) return setErr('Эмодзи — один символ (до 16 юнитов)')
    const base = {
      id: initial?.id ?? genId('w'),
      title: t,
      note: note.trim() || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      originalPrice: originalPrice.trim() || undefined,
      emoji: emoji.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      claimedAt: initial?.claimedAt,
      archived: initial?.archived,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    if (kind === 'small') {
      const rep = repeatable ? { repeatable: true as const } : {}
      const raw = price.trim()
      if (raw === '') return onSave({ ...base, kind: 'small', ...rep }, !initial) // без цены — легальное «хочу»
      const p = Math.floor(Number(raw))
      if (!Number.isFinite(p) || p < 1) return setErr('Цена — целое число ≥ 1 (или пусто — «без цены»)')
      onSave({ ...base, kind: 'small', price: p, ...rep }, !initial)
    } else {
      if (!starId) return setErr('Big-награда требует звезду-якорь')
      // звезда-якорь уникальна среди живых big — иначе непонятно, что разблокирует зажигание
      const taken = items.some(
        (w) => w.id !== initial?.id && w.kind === 'big' && !w.archived && w.starId === starId,
      )
      if (taken) return setErr('К этой звезде уже привязана награда')
      onSave({ ...base, kind: 'big', starId }, !initial)
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>{initial ? 'Позиция витрины' : 'Новая позиция'}</h3>
        <div className="field">
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Массаж / iPhone" />
        </div>
        <div className="field">
          <label>Вид {initial && <em>(не меняется после создания)</em>}</label>
          <select value={kind} disabled={Boolean(initial)} onChange={(e) => setKind(e.target.value as 'small' | 'big')}>
            <option value="small">Мелкая радость — за искры</option>
            <option value="big">Big-награда — за звезду</option>
          </select>
        </div>
        {kind === 'small' ? (
          <>
            <div className="field">
              <label>Цена в искрах <em>(пусто — «без цены», назначишь на калибровке)</em></label>
              <input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={repeatable} onChange={(e) => setRepeatable(e.target.checked)} />
                {' '}Повторяющаяся — можно покупать много раз
              </label>
            </div>
          </>
        ) : (
          <div className="field-row">
            <div className="field">
              <label>Навык</label>
              <select
                value={skillId}
                onChange={(e) => { setSkillId(e.target.value); setStarId('') }}
              >
                <option value="">— выбери —</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Звезда-якорь</label>
              <select value={starId} disabled={!skillId} onChange={(e) => setStarId(e.target.value)}>
                <option value="">{skillId ? '— выбери —' : '— сначала навык —'}</option>
                {ownStars.map((c) => (
                  <option key={c.id} value={c.id}>{c.litAt ? '✦' : '○'} {c.tier} · {c.title}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="field">
          <label>Ссылка</label>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label>Исходная цена</label>
          <input value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} placeholder="2800 ฿ / ~$120, не подтверждена" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Эмодзи</label>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🛋️" />
          </div>
          <div className="field">
            <label>Картинка (URL)</label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…jpg" />
          </div>
        </div>
        <div className="field">
          <label>Заметка</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Опционально" />
        </div>
        {claimed && <div className="hint">Награда уже получена — позиция больше не редактируется.</div>}
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          {initial && !initial.archived && (
            <button className="danger" onClick={() => onArchive(initial.id)}>Спрятать из витрины</button>
          )}
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={claimed} onClick={save}>Сохранить</button>
        </div>
      </div>
    </>
  )
}

/* ── Перенос дедлайна ──────────────────────────── */

interface MoveDueDateModalProps {
  quest: Quest
  store: Store
  today: string
  onConfirm: (to: string) => void
  onClose: () => void
}

export function MoveDueDateModal({ quest, store, today, onConfirm, onClose }: MoveDueDateModalProps) {
  const [to, setTo] = useState(quest.dueDate ?? '')
  const used = movesUsedIn7d(store, today)
  const freeLeft = Math.max(0, FREE_MOVES_PER_7D - used)
  const fee = freeLeft > 0 ? 0 : moveFeeFor(quest)
  const provision = provisionForQuest(quest, today)
  // isCalendarDay, а не регулярка: те же три условия, что у редьюсера. На нативном
  // input type="date" 2026-02-31 недостижим, но на webOS-фолбэке в текст кнопка
  // включилась бы, а тост соврал бы об успехе поверх no-op'а ядра
  const valid = isCalendarDay(to) && to >= today && to !== quest.dueDate

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <h3>Перенести дедлайн</h3>
        <div className="complete-quest-title">
          {quest.title} <span className="p-xp">сейчас до {quest.dueDate}</span>
        </div>
        <div className="field">
          <label>Новая дата (не раньше сегодня)</label>
          <input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="hint">
          {freeLeft > 0
            ? `Бесплатных переносов осталось ${freeLeft} из ${FREE_MOVES_PER_7D} за 7 дней`
            : `Бесплатные переносы за 7 дней исчерпаны — этот будет стоить −${fee} ✨`}
          {provision > 0 && ` · накапавший долг −${provision} ✨ зафиксируется`}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!valid} onClick={() => onConfirm(to)}>
            Перенести
          </button>
        </div>
      </div>
    </>
  )
}
