import { useMemo, useState } from 'react'
import type { Quest, QuestDodItem, QuestResult, Skill, StarComponent, WishlistItem } from './types'
import { useStore } from './hooks/useStore'
import { genId } from './logic/store'
import { cancelFeeFor, sparksBalance, todayInGameTz } from './logic/sparks'
import { recurringDashboard } from './logic/recurring'
import { charLevel, skillLevel } from './logic/xp'
import { charXpTotal, questDoneOnDay, skillXpTotal } from './logic/selectors'
import { Sky } from './components/Sky'
import { GalaxyView } from './components/GalaxyView'
import { Journal } from './components/Journal'
import { Chronicle } from './components/Chronicle'
import type { ChronicleRow } from './components/Chronicle'
import { SkillPanel } from './components/SkillPanel'
import { Wallet } from './components/Wallet'
import { CompleteQuestModal, DataModal, MoveDueDateModal, QuestModal, SkillModal, StarModal, WishlistModal } from './components/Modals'
import { LevelUpOverlay } from './components/LevelUpOverlay'

interface Toast {
  id: number
  text: string
}
interface LevelUp {
  kind: 'skill' | 'char'
  name: string
  level: number
}

let toastSeq = 1

export default function App() {
  const [store, dispatch, mode] = useStore()
  const [view, setView] = useState<'sky' | 'journal' | 'chronicle' | 'wallet'>('sky')
  const [skillPanelId, setSkillPanelId] = useState<string | null>(null)
  const [galaxyId, setGalaxyId] = useState<string | null>(null)
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null)
  const [questModal, setQuestModal] = useState<{ quest?: Quest; defaultSkillId?: string | null } | null>(null)
  const [skillModal, setSkillModal] = useState<{ skill?: Skill } | null>(null)
  const [starModal, setStarModal] = useState<{
    skillId: string
    star?: StarComponent
    defaultParentStarId?: string | null
  } | null>(null)
  const [completeModal, setCompleteModal] = useState<Quest | null>(null)
  const [moveModal, setMoveModal] = useState<Quest | null>(null)
  const [wishlistModal, setWishlistModal] = useState<{ item?: WishlistItem } | null>(null)
  const [dataOpen, setDataOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [levelUps, setLevelUps] = useState<LevelUp[]>([])

  // Игровой пояс, а не календарный день браузера: «сегодня» уходит и в ledger, и в
  // xpLog, и в расписание — в поездке локальный день разошёлся бы с CLI и сервером
  const today = todayInGameTz()
  const charInfo = charLevel(charXpTotal(store.xpLog))
  const balance = sparksBalance(store, today)
  const chronicleData = useMemo(() => {
    const activeSkillIds = new Set(store.skills.filter((skill) => !skill.archived).map((skill) => skill.id))
    const recurringQuests = store.quests.filter((quest) => quest.type === 'repeating' && quest.status !== 'proposed')
    const activeQuests = recurringQuests.filter(
      (quest) => quest.status === 'active' && (quest.skillId === null || activeSkillIds.has(quest.skillId)),
    )
    const sleepingQuests = recurringQuests.filter((quest) => !activeQuests.includes(quest))
    const dashboard = recurringDashboard(store.xpLog, activeQuests, today)
    const sleepingDashboard = recurringDashboard(store.xpLog, sleepingQuests, today)
    const questsById = new Map(recurringQuests.map((quest) => [quest.id, quest]))
    const skillsById = new Map(store.skills.map((skill) => [skill.id, skill]))
    const starsById = new Map(store.stars.map((star) => [star.id, star]))

    const decorate = (history: (typeof dashboard.quests)[number]): ChronicleRow => {
      const quest = questsById.get(history.questId)
      const skill = quest?.skillId ? skillsById.get(quest.skillId) : null
      const star = quest?.starId ? starsById.get(quest.starId) : null
      return {
        ...history,
        title: quest?.title ?? 'Неизвестный квест',
        skillLabel: skill ? `${skill.emoji} ${skill.name}` : null,
        starTitle: star?.title ?? null,
        starTier: star?.tier ?? null,
        hue: skill?.hue ?? 210,
      }
    }

    return {
      dashboard,
      rows: dashboard.quests.map(decorate),
      sleepingRows: sleepingDashboard.quests.map(decorate),
    }
  }, [store.quests, store.skills, store.stars, store.xpLog, today])

  const pushToast = (text: string) => {
    const id = toastSeq++
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2100)
  }

  const applyComplete = (quest: Quest, result?: QuestResult, force?: boolean) => {
    const ups: LevelUp[] = []
    if (quest.skillId) {
      const skill = store.skills.find((s) => s.id === quest.skillId)
      if (skill) {
        const before = skillLevel(skillXpTotal(store.xpLog, skill.id)).level
        const after = skillLevel(skillXpTotal(store.xpLog, skill.id) + quest.xpReward).level
        if (after > before) ups.push({ kind: 'skill', name: skill.name, level: after })
      }
    }
    const beforeChar = charLevel(charXpTotal(store.xpLog)).level
    const afterChar = charLevel(charXpTotal(store.xpLog) + quest.xpReward).level
    if (afterChar > beforeChar) ups.push({ kind: 'char', name: store.character.name, level: afterChar })
    dispatch({ type: 'completeQuest', questId: quest.id, day: today, ts: new Date().toISOString(), result, force })
    pushToast(`+${quest.xpReward} XP · ${quest.title}`)
    if (ups.length) setLevelUps((q) => [...q, ...ups])
  }

  const completeQuest = (quest: Quest) => {
    if (quest.type === 'repeating') {
      if (questDoneOnDay(store.xpLog, quest.id, today)) return
      applyComplete(quest)
      return
    }
    // short/mid/long: контракт карточки — завершение только с итогом, через диалог
    if (quest.status !== 'active') return
    setCompleteModal(quest)
  }

  const confirmComplete = (quest: Quest, result: QuestResult, dod: QuestDodItem[] | undefined, force: boolean) => {
    const next = dod ? { ...quest, definitionOfDone: dod } : quest
    if (dod) dispatch({ type: 'updateQuest', quest: next })
    applyComplete(next, result, force)
    setCompleteModal(null)
  }

  const uncompleteQuest = (quest: Quest) => {
    dispatch({ type: 'uncompleteQuest', questId: quest.id, day: today, ts: new Date().toISOString() })
    pushToast(`Откат · ${quest.title}`)
  }

  const acceptQuest = (quest: Quest) => {
    dispatch({ type: 'acceptQuest', questId: quest.id, ts: new Date().toISOString() })
    pushToast(`Принят · ${quest.title}`)
  }

  const rejectQuest = (quest: Quest) => {
    dispatch({ type: 'rejectQuest', questId: quest.id })
    pushToast(`Отклонён · ${quest.title}`)
  }

  const handleLight = (starId: string, evidence: string, alsoIds: string[]) => {
    const ts = new Date().toISOString()
    for (const id of [...alsoIds].reverse()) dispatch({ type: 'lightStar', starId: id, ts, evidence: evidence || undefined })
    dispatch({ type: 'lightStar', starId, ts, evidence: evidence || undefined })
  }

  const tickDod = (quest: Quest, index: number) => {
    if (!quest.definitionOfDone) return
    dispatch({
      type: 'updateQuest',
      quest: {
        ...quest,
        definitionOfDone: quest.definitionOfDone.map((d, j) => (j === index ? { ...d, done: !d.done } : d)),
      },
    })
  }

  const saveQuest = (quest: Quest, isNew: boolean) => {
    dispatch({ type: isNew ? 'addQuest' : 'updateQuest', quest })
    setQuestModal(null)
  }

  const saveSkill = (skill: Skill, isNew: boolean) => {
    dispatch({ type: isNew ? 'addSkill' : 'updateSkill', skill })
    setSkillModal(null)
  }

  const saveStar = (star: StarComponent, isNew: boolean) => {
    dispatch({ type: isNew ? 'addStar' : 'updateStar', star })
    setStarModal(null)
  }

  const starCanDelete = starModal?.star
    ? !starModal.star.litAt &&
      !store.quests.some((q) => q.starId === starModal.star!.id) &&
      !store.stars.some((c) => c.parentStarId === starModal.star!.id)
    : false

  // архив эпика запрещён, пока жив хоть один active-подквест — объясняем это прямо в модалке
  const questModalArchiveBlock =
    questModal?.quest && store.quests.some((c) => c.parentQuestId === questModal.quest!.id && c.status === 'active')
      ? 'У эпика есть активные подквесты — сначала заверши или заархивируй их'
      : null

  const questModalQuest = questModal?.quest ?? null
  // зеркало заморозки в редьюсере: условия контракта фиксирует принятие, свободен только proposed.
  // Без этого поля XP/типа у сданного жили бы, а правка молча не доезжала
  const questFrozen = Boolean(questModalQuest && questModalQuest.status !== 'proposed' && questModalQuest.type !== 'repeating')
  // неустойку платит только живой контракт: done и archived уходят в архив бесплатно
  const questContractActive = Boolean(questModalQuest && questModalQuest.status === 'active' && questModalQuest.type !== 'repeating')
  const questCancelFee = questContractActive && questModalQuest ? cancelFeeFor(questModalQuest, today) : null

  const panelSkill = (skillPanelId && store.skills.find((s) => s.id === skillPanelId && !s.archived)) || null
  // редьюсер молча не архивирует навык с активными контрактами — причину показываем, а не закрываем панель
  const skillArchiveBlock =
    panelSkill && store.quests.some((q) => q.skillId === panelSkill.id && q.status === 'active' && q.type !== 'repeating')
      ? 'У навыка есть активные контракты — сначала заверши или отмени их'
      : null
  const galaxy = store.skills.find((s) => s.id === galaxyId && !s.archived) ?? null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Stargaze</div>
        {mode === 'local' && (
          <span className="mode-badge" title="Канон-сервер недоступен — данные живут в localStorage этого браузера. Подключение проверяется в фоне.">
            локальный режим
          </span>
        )}
        <nav className="views">
          <button className={view === 'sky' ? 'on' : ''} onClick={() => setView('sky')}>
            Небо
          </button>
          <button className={view === 'journal' ? 'on' : ''} onClick={() => setView('journal')}>
            Журнал
          </button>
          <button className={view === 'chronicle' ? 'on' : ''} onClick={() => setView('chronicle')}>
            Хроника
          </button>
          <button className={view === 'wallet' ? 'on' : ''} onClick={() => setView('wallet')}>
            ✨ {balance}
          </button>
        </nav>
        <div className="char">
          <span className="char-avatar">{store.character.avatar}</span>
          <div className="char-meta">
            <div className="char-name">
              {store.character.name}
              <span className="char-lvl">ур. {charInfo.level}</span>
              <span className="char-xp">
                {charInfo.into} / {charInfo.toNext} XP
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round((charInfo.into / charInfo.toNext) * 100)}%` }} />
            </div>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => setQuestModal({ defaultSkillId: skillPanelId })}>+ Квест</button>
          <button onClick={() => setSkillModal({})}>+ Навык</button>
          <button onClick={() => setDataOpen(true)}>Данные</button>
        </div>
      </header>

      {view === 'sky' && !galaxy && (
        <Sky
          store={store}
          onOpenGalaxy={(id) => {
            setGalaxyId(id)
            setSelectedStarId(null)
          }}
        />
      )}
      {view === 'sky' && galaxy && (
        <GalaxyView
          store={store}
          skill={galaxy}
          skills={store.skills.filter((s) => !s.archived)}
          selectedStarId={selectedStarId}
          onSelectStar={setSelectedStarId}
          onSwitch={(id) => {
            setGalaxyId(id)
            setSelectedStarId(null)
          }}
          onBack={() => {
            setGalaxyId(null)
            setSelectedStarId(null)
          }}
          onAddStar={(parentStarId) => setStarModal({ skillId: galaxy.id, defaultParentStarId: parentStarId })}
          onEditRanks={() => setSkillModal({ skill: galaxy })}
          onLightStar={handleLight}
          onUnlightStar={(starId) => dispatch({ type: 'unlightStar', starId })}
          onEditStar={(star) => setStarModal({ skillId: star.skillId, star })}
        />
      )}
      {view === 'journal' && (
        <Journal
          store={store}
          today={today}
          onComplete={completeQuest}
          onUncomplete={uncompleteQuest}
          onEditQuest={(q) => setQuestModal({ quest: q })}
          onAddQuest={() => setQuestModal({})}
          onOpenSkill={(id) => setSkillPanelId(id)}
          onAccept={acceptQuest}
          onReject={rejectQuest}
          onTickDod={tickDod}
        />
      )}
      {view === 'chronicle' && (
        <Chronicle
          dashboard={chronicleData.dashboard}
          rows={chronicleData.rows}
          sleepingRows={chronicleData.sleepingRows}
          onToggleToday={(questId, completed) => {
            const quest = store.quests.find((candidate) => candidate.id === questId && candidate.status === 'active')
            if (!quest) return
            if (completed) uncompleteQuest(quest)
            else completeQuest(quest)
          }}
        />
      )}
      {view === 'wallet' && (
        <Wallet
          store={store}
          today={today}
          onPurchase={(item) => {
            // opId свежий на каждое нажатие: он гасит ретрай очереди, а не повторную покупку
            dispatch({ type: 'purchaseItem', itemId: item.id, day: today, ts: new Date().toISOString(), opId: genId('op') })
            pushToast(`−${item.price} ✨ · ${item.title}`)
          }}
          onSpend={(amount, note) => {
            dispatch({ type: 'spendSparks', amount, note, day: today, ts: new Date().toISOString(), opId: genId('op') })
            pushToast(`−${amount} ✨ · ${note}`)
          }}
          onClaim={(item) => {
            dispatch({ type: 'claimReward', itemId: item.id, ts: new Date().toISOString() })
            pushToast(`✦ Получено · ${item.title}`)
          }}
          onAddItem={() => setWishlistModal({})}
          onEditItem={(item) => setWishlistModal({ item })}
          onArchiveItem={(item) => dispatch({ type: 'archiveWishlistItem', itemId: item.id })}
          onOpenQuest={(q) => setQuestModal({ quest: q })}
        />
      )}

      {panelSkill && (
        <SkillPanel
          skill={panelSkill}
          store={store}
          today={today}
          archiveBlock={skillArchiveBlock}
          onClose={() => setSkillPanelId(null)}
          onComplete={completeQuest}
          onUncomplete={uncompleteQuest}
          onEditQuest={(q) => setQuestModal({ quest: q })}
          onAddQuest={() => setQuestModal({ defaultSkillId: panelSkill.id })}
          onEditSkill={() => setSkillModal({ skill: panelSkill })}
          onArchiveSkill={() => {
            // страховка на месте отправки: панель уже не даёт взвести кнопку при блоке,
            // но dispatch не должен уходить в редьюсер на молчаливый no-op ни при какой вёрстке
            if (skillArchiveBlock) {
              pushToast(skillArchiveBlock)
              return
            }
            dispatch({ type: 'archiveSkill', skillId: panelSkill.id })
            setSkillPanelId(null)
          }}
          onOpenGalaxy={() => {
            setSkillPanelId(null)
            setView('sky')
            setGalaxyId(panelSkill.id)
            setSelectedStarId(null)
          }}
          onTickDod={tickDod}
        />
      )}

      {questModal && (
        <QuestModal
          initial={questModal.quest}
          defaultSkillId={questModal.defaultSkillId ?? null}
          skills={store.skills.filter((s) => !s.archived)}
          stars={store.stars}
          quests={store.quests}
          today={today}
          archiveBlock={questModalArchiveBlock}
          frozen={questFrozen}
          cancelFee={questCancelFee}
          // перенос предлагаем только у живого контракта: у done редьюсер молча отказал бы
          onMoveDueDate={questContractActive && questModalQuest?.dueDate ? () => setMoveModal(questModalQuest) : undefined}
          onSave={saveQuest}
          onArchive={(id) => {
            dispatch({ type: 'archiveQuest', questId: id, day: today, ts: new Date().toISOString() })
            setQuestModal(null)
          }}
          onClose={() => setQuestModal(null)}
        />
      )}

      {completeModal && (
        <CompleteQuestModal
          quest={completeModal}
          activeChildren={store.quests.filter((c) => c.parentQuestId === completeModal.id && c.status === 'active')}
          onConfirm={(result, dod, force) => confirmComplete(completeModal, result, dod, force)}
          onClose={() => setCompleteModal(null)}
        />
      )}

      {moveModal && (
        <MoveDueDateModal
          quest={moveModal}
          store={store}
          today={today}
          onConfirm={(to) => {
            dispatch({ type: 'moveDueDate', questId: moveModal.id, to, day: today, ts: new Date().toISOString() })
            pushToast(`Дедлайн → ${to} · ${moveModal.title}`)
            setMoveModal(null)
            setQuestModal(null)
          }}
          onClose={() => setMoveModal(null)}
        />
      )}

      {wishlistModal && (
        <WishlistModal
          initial={wishlistModal.item}
          skills={store.skills.filter((s) => !s.archived)}
          stars={store.stars}
          items={(store.wishlist ?? []).filter((w) => !w.archived)}
          onSave={(item, isNew) => {
            dispatch({ type: isNew ? 'addWishlistItem' : 'updateWishlistItem', item })
            setWishlistModal(null)
          }}
          onArchive={(id) => {
            dispatch({ type: 'archiveWishlistItem', itemId: id })
            setWishlistModal(null)
          }}
          onClose={() => setWishlistModal(null)}
        />
      )}

      {skillModal && <SkillModal initial={skillModal.skill} onSave={saveSkill} onClose={() => setSkillModal(null)} />}

      {starModal && (
        <StarModal
          skillId={starModal.skillId}
          stars={store.stars}
          initial={starModal.star}
          defaultParentStarId={starModal.defaultParentStarId}
          canDelete={starCanDelete}
          onSave={saveStar}
          onDelete={(starId) => {
            dispatch({ type: 'removeStar', starId })
            setStarModal(null)
          }}
          onClose={() => setStarModal(null)}
        />
      )}

      {dataOpen && (
        <DataModal
          store={store}
          onImport={(s) => {
            dispatch({ type: 'importStore', store: s })
            setDataOpen(false)
            pushToast('Импорт завершён')
          }}
          onReset={() => {
            dispatch({ type: 'resetToSeed' })
            setDataOpen(false)
            pushToast('Сброшено к сиду лета')
          }}
          onClose={() => setDataOpen(false)}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>

      {levelUps.length > 0 && (
        <LevelUpOverlay
          kind={levelUps[0].kind}
          name={levelUps[0].name}
          level={levelUps[0].level}
          onDone={() => setLevelUps((q) => q.slice(1))}
        />
      )}
    </div>
  )
}
