import type { Character, LedgerEvent, Quest, QuestDueDateMove, QuestResult, Skill, StarComponent, Store, WishlistItem, XpEvent } from '../types'
import { WISHLIST_EMOJI_MAX } from '../types'
import { isCalendarDay } from './dates'
import { netForQuest, netForQuestOnDay } from './selectors'
import { cancelFeeFor, earnWindowOk, FREE_MOVES_PER_7D, moveFeeFor, movesUsedIn7d, provisionForQuest, purchasedDays, settlementDay, sparksBalance } from './sparks'
import { ancestorsOf } from './stars'
import { seedStore } from '../data/seed'

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export type Action =
  | { type: 'completeQuest'; questId: string; day: string; ts: string; result?: QuestResult; force?: boolean }
  | { type: 'uncompleteQuest'; questId: string; day: string; ts: string }
  | { type: 'addQuest'; quest: Quest }
  | { type: 'updateQuest'; quest: Quest }
  | { type: 'archiveQuest'; questId: string; day: string; ts: string }
  | { type: 'proposeQuest'; quest: Quest } // quest.status обязан быть 'proposed'
  | { type: 'acceptQuest'; questId: string; ts: string }
  | { type: 'rejectQuest'; questId: string }
  | { type: 'addSkill'; skill: Skill }
  | { type: 'updateSkill'; skill: Skill }
  | { type: 'archiveSkill'; skillId: string }
  | { type: 'addStar'; star: StarComponent }
  | { type: 'updateStar'; star: StarComponent }
  | { type: 'removeStar'; starId: string }
  | { type: 'lightStar'; starId: string; ts: string; evidence?: string }
  | { type: 'unlightStar'; starId: string }
  | { type: 'setCharacter'; character: Character }
  | { type: 'importStore'; store: Store }
  | { type: 'resetToSeed' }
  | { type: 'moveDueDate'; questId: string; to: string; day: string; ts: string }
  | { type: 'addWishlistItem'; item: WishlistItem }
  | { type: 'updateWishlistItem'; item: WishlistItem }
  | { type: 'archiveWishlistItem'; itemId: string }
  | { type: 'purchaseItem'; itemId: string; day: string; ts: string; opId?: string }
  | { type: 'spendSparks'; amount: number; note: string; day: string; ts: string; opId?: string }
  | { type: 'claimReward'; itemId: string; ts: string }
  | { type: 'adjustSparks'; amount: number; note: string; day: string; ts: string }

/** Все типы действий — для валидации на границе API. Полнота гарантируется компайл-проверкой ниже. */
export const ACTION_TYPES = [
  'completeQuest', 'uncompleteQuest', 'addQuest', 'updateQuest', 'archiveQuest',
  'addSkill', 'updateSkill', 'archiveSkill',
  'addStar', 'updateStar', 'removeStar', 'lightStar', 'unlightStar',
  'proposeQuest', 'acceptQuest', 'rejectQuest',
  'setCharacter', 'importStore', 'resetToSeed',
  'moveDueDate',
  'addWishlistItem', 'updateWishlistItem', 'archiveWishlistItem',
  'purchaseItem', 'spendSparks', 'claimReward', 'adjustSparks',
] as const satisfies readonly Action['type'][]

// Если union Action пополнится, а список выше забыт — эта строка перестанет компилироваться.
const _actionTypesExhaustive: Exclude<Action['type'], (typeof ACTION_TYPES)[number]> extends never ? true : never = true
void _actionTypesExhaustive

function event(quest: Quest, day: string, ts: string, amount: number): XpEvent {
  return { id: genId('e'), ts, day, questId: quest.id, skillId: quest.skillId, amount }
}

function ledgerEvent(e: Omit<LedgerEvent, 'id'>): LedgerEvent {
  return { id: genId('l'), ...e }
}

function withLedger(store: Store, events: LedgerEvent[]): Partial<Pick<Store, 'ledger'>> {
  return events.length > 0 ? { ledger: [...(store.ledger ?? []), ...events] } : {}
}

/** Валидная форма позиции витрины в контексте store (excludeId — при update). */
function wishlistShapeOk(store: Store, item: WishlistItem, excludeId?: string): boolean {
  if (!item.title.trim()) return false
  // claimedAt пишет только редьюсер: в payload это подделка «уже получено» в обход гейта звезды
  if (item.claimedAt !== undefined) return false
  // справочные поля свободной формы, но не пустышки
  if (item.sourceUrl !== undefined && (typeof item.sourceUrl !== 'string' || item.sourceUrl.trim() === '')) return false
  if (item.originalPrice !== undefined && (typeof item.originalPrice !== 'string' || item.originalPrice.trim() === '')) return false
  if (item.emoji !== undefined && (typeof item.emoji !== 'string' || item.emoji.trim() === '' || item.emoji.length > WISHLIST_EMOJI_MAX)) return false
  if (item.imageUrl !== undefined && (typeof item.imageUrl !== 'string' || item.imageUrl.trim() === '')) return false
  if (item.repeatable !== undefined && typeof item.repeatable !== 'boolean') return false
  if (item.kind === 'small')
    // цена опциональна: без неё позиция — «хочу», покупку гейтит purchaseItem
    return (item.price === undefined || (Number.isSafeInteger(item.price) && item.price > 0)) && item.starId === undefined
  if (item.kind !== 'big') return false
  if (item.price !== undefined) return false
  if (item.repeatable !== undefined) return false // big разовая по механике claimedAt
  if (!item.starId || !store.stars.some((s) => s.id === item.starId)) return false
  // среди живых big звезда-якорь уникальна — иначе непонятно, что разблокирует зажигание
  return !(store.wishlist ?? []).some(
    (w) => w.id !== excludeId && w.kind === 'big' && !w.archived && w.starId === item.starId,
  )
}

export function reducer(store: Store, action: Action): Store {
  switch (action.type) {
    case 'completeQuest': {
      const quest = store.quests.find((q) => q.id === action.questId)
      if (!quest || quest.status === 'archived' || quest.status === 'proposed') return store
      if (quest.type === 'repeating') {
        // максимум одна отметка в день
        if (netForQuestOnDay(store.xpLog, quest.id, action.day) > 0) return store
        const pay = earnWindowOk(action.day, action.ts)
          ? [ledgerEvent({ ts: action.ts, day: action.day, kind: 'earn', amount: quest.xpReward, questId: quest.id })]
          : [] // бэкфилл роста легален, бэкфилл денег — нет
        return {
          ...store,
          xpLog: [...store.xpLog, event(quest, action.day, action.ts, quest.xpReward)],
          ...withLedger(store, pay),
        }
      }
      if (quest.status === 'done') return store
      // контракт карточки: short/mid/long обязаны оставить итог
      const summary = action.result?.summary.trim()
      if (!summary) return store
      // DoD-гейт: незакрытые пункты блокируют завершение; force — явное исключение
      const skipped = (quest.definitionOfDone ?? []).filter((d) => !d.done).map((d) => d.text)
      if (skipped.length > 0 && !action.force) return store
      // гейт по детям: active-подквесты блокируют завершение эпика (как DoD-гейт)
      const openChildren = store.quests.filter((c) => c.parentQuestId === quest.id && c.status === 'active')
      if (openChildren.length > 0 && !action.force) return store
      const result: QuestResult = { summary }
      if (action.result?.artifactUrl) result.artifactUrl = action.result.artifactUrl
      if (action.result?.evidence) result.evidence = action.result.evidence
      // skippedDod пишет только редьюсер — из фактического состояния чеклиста, не из payload
      if (skipped.length > 0) result.skippedDod = skipped
      // skippedQuestIds пишет только редьюсер — из фактического состояния, не из payload
      if (openChildren.length > 0) result.skippedQuestIds = openChildren.map((c) => c.id)
      const opId = genId('op')
      // сдача задним числом не уменьшает долг: вне окна «сегодня/вчера» капание считается по игровому дню ts
      const provision = provisionForQuest(quest, settlementDay(action.day, action.ts))
      // невычислимый долг — отказ, как недостоверный баланс у покупки: на мусорном ts
      // провизия уходит в NaN, `NaN > 0` ложно, и drain просто не пишется — просроченный
      // на потолок контракт заплатил бы полный R (то же fail-open, только на выплате)
      if (!Number.isFinite(provision)) return store
      const forced = skipped.length > 0 || openChildren.length > 0
      const pay: LedgerEvent[] = []
      // force-сдача не платит: иначе force-эпик — фарм (+R сейчас, дети капают потом)
      if (!forced) pay.push(ledgerEvent({ ts: action.ts, day: action.day, kind: 'earn', amount: quest.xpReward, questId: quest.id, opId }))
      if (provision > 0) pay.push(ledgerEvent({ ts: action.ts, day: action.day, kind: 'drain', amount: -provision, questId: quest.id, opId }))
      return {
        ...store,
        quests: store.quests.map((q) => (q.id === quest.id ? { ...q, status: 'done' as const, result } : q)),
        xpLog: [...store.xpLog, event(quest, action.day, action.ts, quest.xpReward)],
        ...withLedger(store, pay),
      }
    }
    case 'uncompleteQuest': {
      const quest = store.quests.find((q) => q.id === action.questId)
      if (!quest) return store
      const ledger = store.ledger ?? []
      const reversedIds = new Set(ledger.filter((e) => e.kind === 'reversal').map((e) => e.reversesId))
      if (quest.type === 'repeating') {
        // откат только сегодняшней отметки
        const net = netForQuestOnDay(store.xpLog, quest.id, action.day)
        if (net <= 0) return store
        // разворачивается earn этого дня, если был (бэкфилл-отметка earn не писала)
        const earn = [...ledger].reverse().find(
          (e) => e.questId === quest.id && e.kind === 'earn' && e.day === action.day && !reversedIds.has(e.id),
        )
        const undo = earn
          ? [ledgerEvent({ ts: action.ts, day: action.day, kind: 'reversal', amount: -earn.amount, questId: quest.id, reversesId: earn.id })]
          : []
        return {
          ...store,
          xpLog: [...store.xpLog, event(quest, action.day, action.ts, -net)],
          ...withLedger(store, undo),
        }
      }
      const total = netForQuest(store.xpLog, quest.id)
      if (quest.status !== 'done' || total <= 0) return store
      // разворачиваем ТОЛЬКО связку последней сдачи: drain переносов (без opId сдачи) не трогаем
      const lastOpId = [...ledger].reverse().find(
        (e) => e.questId === quest.id && (e.kind === 'earn' || e.kind === 'drain') && e.opId !== undefined && !reversedIds.has(e.id),
      )?.opId
      const targets = lastOpId === undefined
        ? []
        : ledger.filter((e) => e.opId === lastOpId && (e.kind === 'earn' || e.kind === 'drain') && !reversedIds.has(e.id))
      const undo = targets.map((t) =>
        ledgerEvent({ ts: action.ts, day: action.day, kind: 'reversal', amount: -t.amount, questId: quest.id, reversesId: t.id }),
      )
      return {
        ...store,
        quests: store.quests.map((q) => {
          if (q.id !== quest.id) return q
          // откат снимает итог, но не стирает след: result уезжает в историю
          const { result, ...rest } = q
          return {
            ...rest,
            status: 'active' as const,
            ...(result ? { resultHistory: [...(q.resultHistory ?? []), { ...result, cancelledAt: action.ts }] } : {}),
          }
        }),
        xpLog: [...store.xpLog, event(quest, action.day, action.ts, -total)],
        ...withLedger(store, undo),
      }
    }
    case 'addQuest':
      return { ...store, quests: [...store.quests, action.quest] }
    case 'updateQuest': {
      const prev = store.quests.find((q) => q.id === action.quest.id)
      if (!prev) return store
      // условия контракта заморожены принятием (спека §13), а не активностью:
      // иначе экономика обходится редактором (R=10 перед отменой, «превратить»
      // long в repeating, сдвинуть createdAt), а у сданного — чеканка искр
      // (поднять R у done → откат вернёт исторические −R → пересдача платит новый R)
      // и разрыв цепочки dueDateHistory (dueDate из payload ≠ последнего to).
      // Свободен только proposed: предложение ещё обсуждается.
      // Исключение — контракт без дедлайна: заморозить пустоту значило бы запереть
      // квест навсегда (moveDueDate — no-op на !dueDate, ставить срок больше нечем),
      // а поставить его можно только в минус себе: без срока капания нет вовсе.
      // Дальше действует обычная заморозка — двигают уже только переносом.
      const frozen = prev.status !== 'proposed' && prev.type !== 'repeating'
        ? {
            xpReward: prev.xpReward, type: prev.type, createdAt: prev.createdAt,
            ...(prev.dueDate ? { dueDate: prev.dueDate } : {}),
          }
        : {}
      // status двигают только доменные действия (accept/complete/uncomplete/archive):
      // иначе done воскрешается редактором и платит второй earn мимо компенсации
      // resultHistory/dueDateHistory/acceptedAt/archivedAt тоже пишет только редьюсер (как skippedDod)
      const next: Quest = {
        ...action.quest,
        status: prev.status, resultHistory: prev.resultHistory,
        dueDateHistory: prev.dueDateHistory, acceptedAt: prev.acceptedAt, archivedAt: prev.archivedAt,
        ...frozen,
      }
      return { ...store, quests: store.quests.map((q) => (q.id === next.id ? next : q)) }
    }
    case 'archiveQuest': {
      const quest = store.quests.find((q) => q.id === action.questId)
      if (!quest || quest.status === 'archived') return store
      // эпик с активными детьми не архивируется: явность вместо каскадной магии
      if (store.quests.some((c) => c.parentQuestId === action.questId && c.status === 'active')) return store
      const events: LedgerEvent[] = []
      if (quest.status === 'active' && quest.type !== 'repeating') {
        // отмена контракта — платная; экшен без day/ts (старый клиент из очереди)
        // не может стать бесплатной лазейкой → no-op
        if (!action.day || !action.ts) return store
        events.push(ledgerEvent({
          ts: action.ts, day: action.day, kind: 'cancelFee',
          amount: -cancelFeeFor(quest, settlementDay(action.day, action.ts)), questId: quest.id,
        }))
      }
      return {
        ...store,
        quests: store.quests.map((q) => {
          if (q.id !== action.questId) return q
          const { proposalNote, ...rest } = q
          return { ...rest, status: 'archived' as const, ...(action.ts ? { archivedAt: action.ts } : {}) }
        }),
        ...withLedger(store, events),
      }
    }
    case 'addSkill':
      return { ...store, skills: [...store.skills, action.skill] }
    case 'updateSkill':
      return { ...store, skills: store.skills.map((s) => (s.id === action.skill.id ? action.skill : s)) }
    case 'archiveSkill':
      // активные контракты навыка блокируют архив: нельзя ни молча оштрафовать каждый, ни отпустить бесплатно
      if (store.quests.some((q) => q.skillId === action.skillId && q.status === 'active' && q.type !== 'repeating'))
        return store
      // архив навыка прячет созвездие вместе с квестами; xpLog не трогаем
      return {
        ...store,
        skills: store.skills.map((s) => (s.id === action.skillId ? { ...s, archived: true } : s)),
        quests: store.quests.map((q) => {
          if (q.skillId !== action.skillId || q.status === 'archived') return q
          const { proposalNote, ...rest } = q
          return { ...rest, status: 'archived' as const }
        }),
      }
    case 'addStar': {
      const star = action.star
      if (!store.skills.some((s) => s.id === star.skillId)) return store
      if (star.parentStarId !== null) {
        const p = store.stars.find((c) => c.id === star.parentStarId)
        if (!p || p.skillId !== star.skillId) return store
      }
      return { ...store, stars: [...store.stars, star] }
    }
    case 'updateStar': {
      const prev = store.stars.find((c) => c.id === action.star.id)
      if (!prev) return store
      const next = { ...action.star, skillId: prev.skillId, litAt: prev.litAt, evidence: prev.evidence }
      if (next.parentStarId !== null) {
        const p = store.stars.find((c) => c.id === next.parentStarId)
        if (!p || p.skillId !== next.skillId) return store
        // перенос под себя или под собственного потомка создал бы цикл
        if (next.parentStarId === next.id) return store
        const candidate = store.stars.map((c) => (c.id === next.id ? next : c))
        if (ancestorsOf(candidate, next.parentStarId).some((a) => a.id === next.id)) return store
      }
      return { ...store, stars: store.stars.map((c) => (c.id === next.id ? next : c)) }
    }
    case 'removeStar': {
      const target = store.stars.find((c) => c.id === action.starId)
      if (!target || target.litAt) return store
      if (store.quests.some((q) => q.starId === action.starId)) return store
      if (store.stars.some((c) => c.parentStarId === action.starId)) return store
      return { ...store, stars: store.stars.filter((c) => c.id !== action.starId) }
    }
    case 'lightStar': {
      const target = store.stars.find((c) => c.id === action.starId)
      if (!target || target.litAt) return store
      return {
        ...store,
        stars: store.stars.map((c) =>
          c.id === action.starId ? { ...c, litAt: action.ts, evidence: action.evidence } : c,
        ),
      }
    }
    case 'unlightStar':
      return {
        ...store,
        stars: store.stars.map((c) =>
          c.id === action.starId ? { ...c, litAt: undefined, evidence: undefined } : c,
        ),
      }
    case 'proposeQuest': {
      const q = action.quest
      if (q.status !== 'proposed') return store
      if (q.skillId && !store.skills.some((s) => s.id === q.skillId)) return store
      if (q.starId && !store.stars.some((c) => c.id === q.starId)) return store
      return { ...store, quests: [...store.quests, q] }
    }
    case 'acceptQuest': {
      const q = store.quests.find((x) => x.id === action.questId)
      if (!q || q.status !== 'proposed') return store
      return {
        ...store,
        quests: store.quests.map((x) => {
          if (x.id !== q.id) return x
          const { proposalNote, ...rest } = x
          return { ...rest, status: 'active' as const, ...(action.ts ? { acceptedAt: action.ts } : {}) }
        }),
      }
    }
    case 'rejectQuest': {
      const q = store.quests.find((x) => x.id === action.questId)
      if (!q || q.status !== 'proposed') return store
      // у proposed не может быть событий (completeQuest их не пускает); ремень безопасности:
      if (store.xpLog.some((e) => e.questId === q.id)) return store
      // reject физически удаляет квест, а у proposed-эпика легально есть дети:
      // удалив родителя, мы оставили бы висячий parentQuestId и невалидный стор
      if (store.quests.some((c) => c.parentQuestId === q.id)) return store
      return { ...store, quests: store.quests.filter((x) => x.id !== q.id) }
    }
    case 'setCharacter':
      return { ...store, character: action.character }
    case 'importStore':
      return action.store
    case 'resetToSeed':
      return seedStore()
    case 'moveDueDate': {
      const quest = store.quests.find((q) => q.id === action.questId)
      if (!quest || quest.status !== 'active' || quest.type === 'repeating' || !quest.dueDate) return store
      if (!isCalendarDay(action.to)) return store
      const settled = settlementDay(action.day, action.ts)
      if (action.to < settled) return store // перенос в прошлое двойно считал бы просрочку
      if (action.to === quest.dueDate) return store // та же дата — no-op без траты слота
      const provision = provisionForQuest(quest, settled)
      // окно квоты и день записи в нём — обязательно один день: на сыром day окно
      // [day−6, day] уезжает в пустоту, а запись ложится мимо окна следующего
      // переноса, и платный перенос становится бесплатным сколько угодно раз
      const paid = movesUsedIn7d(store, settled) >= FREE_MOVES_PER_7D
      const fee = paid ? moveFeeFor(quest) : undefined
      const events: LedgerEvent[] = []
      // перенос не стирает долг: накапавшее фиксируется, отсчёт с новой даты заново
      if (provision > 0)
        events.push(ledgerEvent({ ts: action.ts, day: action.day, kind: 'drain', amount: -provision, questId: quest.id }))
      if (fee !== undefined)
        events.push(ledgerEvent({ ts: action.ts, day: action.day, kind: 'moveFee', amount: -fee, questId: quest.id }))
      // day записи — тот же settled: это вход финансового гейта (окно квоты), а не
      // аудит-штамп. Ledger-события выше остаются на action.day — там day говорит,
      // каким днём событие заявил клиент (прецедент completeQuest: капание от дня
      // расчёта, а day заявленный), и ни в один гейт он не входит
      const entry: QuestDueDateMove = {
        from: quest.dueDate, to: action.to, day: settled, ts: action.ts,
        ...(fee !== undefined ? { fee } : {}),
      }
      return {
        ...store,
        quests: store.quests.map((q) =>
          q.id === quest.id
            ? { ...q, dueDate: action.to, dueDateHistory: [...(q.dueDateHistory ?? []), entry] }
            : q,
        ),
        ...withLedger(store, events),
      }
    }
    case 'addWishlistItem': {
      if ((store.wishlist ?? []).some((w) => w.id === action.item.id)) return store
      // archived ставит только archiveWishlistItem: позиция не рождается в архиве.
      // Проверка здесь, а не в форме, — иначе она съела бы легальную правку архивной позиции
      if (action.item.archived) return store
      if (!wishlistShapeOk(store, action.item)) return store
      return { ...store, wishlist: [...(store.wishlist ?? []), action.item] }
    }
    case 'updateWishlistItem': {
      const prev = (store.wishlist ?? []).find((w) => w.id === action.item.id)
      if (!prev || prev.claimedAt) return store // полученное не переписывается
      // kind/createdAt/claimedAt/archived пишет только редьюсер — payload их не меняет
      const next: WishlistItem = {
        ...action.item, kind: prev.kind, createdAt: prev.createdAt,
        claimedAt: prev.claimedAt, archived: prev.archived,
      }
      if (!wishlistShapeOk(store, next, next.id)) return store
      return { ...store, wishlist: (store.wishlist ?? []).map((w) => (w.id === next.id ? next : w)) }
    }
    case 'archiveWishlistItem': {
      const prev = (store.wishlist ?? []).find((w) => w.id === action.itemId)
      if (!prev || prev.archived) return store
      return { ...store, wishlist: (store.wishlist ?? []).map((w) => (w.id === action.itemId ? { ...w, archived: true } : w)) }
    }
    case 'purchaseItem': {
      const item = (store.wishlist ?? []).find((w) => w.id === action.itemId)
      if (!item || item.kind !== 'small' || item.archived || item.price === undefined) return store
      // разовая (не repeatable) покупается один раз: «куплена» — факт в ledger
      if (!item.repeatable && purchasedDays(store).has(item.id)) return store
      if (action.opId && (store.ledger ?? []).some((e) => e.opId === action.opId)) return store // ретрай
      // единственный несгибаемый гейт: force нет. Недостоверный баланс — тоже отказ:
      // на мусорном ts день расчёта не вычисляется, провизия уходит в NaN, и
      // сравнение `NaN < price` ложно — гейт открылся бы сам собой (fail-open)
      const balance = sparksBalance(store, settlementDay(action.day, action.ts))
      if (!Number.isFinite(balance) || balance < item.price) return store
      return {
        ...store,
        ...withLedger(store, [ledgerEvent({
          ts: action.ts, day: action.day, kind: 'spend', amount: -item.price,
          itemId: item.id, note: item.title, // снапшот названия на момент покупки
          ...(action.opId ? { opId: action.opId } : {}),
        })]),
      }
    }
    case 'spendSparks': {
      if (!Number.isInteger(action.amount) || action.amount <= 0) return store
      const note = action.note.trim()
      if (!note) return store
      if (action.opId && (store.ledger ?? []).some((e) => e.opId === action.opId)) return store
      const balance = sparksBalance(store, settlementDay(action.day, action.ts)) // недостоверный — отказ, как у покупки
      if (!Number.isFinite(balance) || balance < action.amount) return store
      return {
        ...store,
        ...withLedger(store, [ledgerEvent({
          ts: action.ts, day: action.day, kind: 'spend', amount: -action.amount, note,
          ...(action.opId ? { opId: action.opId } : {}),
        })]),
      }
    }
    case 'claimReward': {
      const item = (store.wishlist ?? []).find((w) => w.id === action.itemId)
      if (!item || item.kind !== 'big' || item.claimedAt || !item.starId) return store
      // якорь — сама звезда: `litAt` не гаснет, в отличие от порога ранга,
      // который «отъезжал» от дописанной в тот же ранг незажжённой звезды
      if (!store.stars.find((s) => s.id === item.starId)?.litAt) return store
      return {
        ...store,
        wishlist: (store.wishlist ?? []).map((w) => (w.id === item.id ? { ...w, claimedAt: action.ts } : w)),
      }
    }
    case 'adjustSparks': {
      // isSafeInteger, как в validateStore: 1e30 — целое по isInteger, но store с ним не пишется
      if (!Number.isSafeInteger(action.amount) || action.amount === 0) return store
      const note = action.note.trim()
      if (!note) return store
      return {
        ...store,
        ...withLedger(store, [ledgerEvent({ ts: action.ts, day: action.day, kind: 'adjust', amount: action.amount, note })]),
      }
    }
  }
}
