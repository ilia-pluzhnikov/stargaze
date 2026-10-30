import type { LedgerEvent, Quest, StarComponent, Store, Tier, WishlistItem } from '../types'
import { TIERS } from '../types'
import { charXpTotal, epicProgress, isDueToday, questChildren, questDoneOnDay, skillXpTotal } from './selectors'
import { charLevel, skillLevel } from './xp'
import { currentRank, galaxySummary, isRankAchieved, rankStars, skillTiers } from './stars'
import {
  FREE_MOVES_PER_7D, emissionInDays, ledgerTotal, movesUsedIn7d, provisionForQuest, provisionTotal, sparksBalance,
} from './sparks'
import { weeklyXp } from './stats'

// Машинные срезы store для голов: CLI печатает их в `--json`, HTTP API отдаёт
// GET-маршрутами — один и тот же JSON (контракт описан в API.md: имена и
// порядок полей не менять). Чистые функции от (store, today, параметры):
// «сегодня» приходит снаружи, здесь оно не вычисляется.

/** Отказ построения среза. Текст общий для голов, код выбирает голова:
 * CLI — exit 2 на bad-param, иначе 1; API — 400 / 404 / 409. */
export class ViewError extends Error {
  constructor(
    public kind: 'bad-param' | 'not-found' | 'ambiguous',
    message: string,
    public matches?: string[], // ambiguous: все id под префиксом
  ) {
    super(message)
  }
}

/** Id по точному совпадению или уникальному префиксу (как в git). */
export function resolveIdPrefix(items: { id: string }[], prefix: string, kind: string): string {
  const hits = items.filter((x) => x.id.startsWith(prefix))
  if (hits.length === 1) return hits[0].id
  if (hits.length === 0) throw new ViewError('not-found', `${kind} с id «${prefix}» не найден`)
  // точное совпадение выигрывает: полный id не должен глохнуть из-за потомков-префиксов
  const exact = hits.find((x) => x.id === prefix)
  if (exact) return exact.id
  const ids = hits.map((x) => x.id)
  throw new ViewError('ambiguous', `префикс «${prefix}» неоднозначен: ${ids.join(', ')}`, ids)
}

export interface StatusView {
  character: { name: string; level: number; into: number; toNext: number; totalXp: number }
  today: { due: number; habitsDone: number }
  skills: {
    id: string; name: string; level: number; into: number; toNext: number
    ranksTotal: number; ranksAchieved: number; currentRank: Tier | null
  }[]
  sparks: { balance: number; provision: number; moves: { used: number; free: number } }
}

/** Сводка дня — `status`: персонаж, «на сегодня», живые навыки, кошелёк. */
export function statusView(store: Store, today: string): StatusView {
  const totalXp = charXpTotal(store.xpLog)
  const char = charLevel(totalXp)
  const active = store.quests.filter((q) => q.status === 'active')
  return {
    character: { name: store.character.name, level: char.level, into: char.into, toNext: char.toNext, totalXp },
    // «на сегодня» — только контракты (привычкам isDueToday отвечает false);
    // привычки считаются по факту: сколько активных отмечено сегодня
    today: {
      due: active.filter((q) => isDueToday(q, today)).length,
      habitsDone: active.filter((q) => q.type === 'repeating' && questDoneOnDay(store.xpLog, q.id, today)).length,
    },
    skills: store.skills.filter((sk) => !sk.archived).map((sk) => {
      const info = skillLevel(skillXpTotal(store.xpLog, sk.id))
      const ladder = galaxySummary(store.stars, sk.id)
      return {
        id: sk.id, name: sk.name, level: info.level, into: info.into, toNext: info.toNext,
        ranksTotal: ladder.total, ranksAchieved: ladder.achieved, currentRank: currentRank(store.stars, sk.id),
      }
    }),
    sparks: {
      balance: sparksBalance(store, today),
      provision: provisionTotal(store, today),
      moves: { used: movesUsedIn7d(store, today), free: FREE_MOVES_PER_7D },
    },
  }
}

export interface WalletView {
  balance: number
  ledgerTotal: number
  provisionTotal: number
  provisions: { questId: string; title: string; provision: number; cap: number }[]
  moves: { used: number; free: number }
  emission: { d7: number; d30: number }
  ledger: LedgerEvent[]
}

/** Кошелёк — `wallet`: баланс и его слагаемые, капающие контракты (cap — потолок
 * капания, он же награда), квота переносов, эмиссия, журнал свежим сверху. */
export function walletView(store: Store, today: string): WalletView {
  return {
    balance: sparksBalance(store, today),
    ledgerTotal: ledgerTotal(store),
    provisionTotal: provisionTotal(store, today),
    provisions: store.quests
      .map((q) => ({ questId: q.id, title: q.title, provision: provisionForQuest(q, today), cap: q.xpReward }))
      .filter((p) => p.provision > 0),
    moves: { used: movesUsedIn7d(store, today), free: FREE_MOVES_PER_7D },
    emission: { d7: emissionInDays(store, today, 7), d30: emissionInDays(store, today, 30) },
    ledger: [...(store.ledger ?? [])].reverse(),
  }
}

/** Выборки `quests`: active — по умолчанию, остальные — флаги --today/--proposed/--all. */
export const QUEST_FILTERS = ['active', 'today', 'proposed', 'all'] as const
export type QuestFilter = (typeof QUEST_FILTERS)[number]

/** Квесты выборки как есть, в порядке store — `quests`. all — всё, кроме
 * архива; today — активные контракты, положенные на сегодня. */
export function questsView(store: Store, today: string, filter: QuestFilter): Quest[] {
  switch (filter) {
    case 'active':
      return store.quests.filter((q) => q.status === 'active')
    case 'today':
      return store.quests.filter((q) => q.status === 'active' && isDueToday(q, today))
    case 'proposed':
      return store.quests.filter((q) => q.status === 'proposed')
    case 'all':
      return store.quests.filter((q) => q.status !== 'archived')
  }
}

/** Эпик: квест плюс id детей (archived выпадают) и прогресс по active+done —
 * null, если дети только proposed. */
export type EpicView = Quest & { children: string[]; progress: { done: number; total: number } | null }

/** Карточка квеста — `quest <id>`: id точный или уникальный префикс, поиск по
 * всем статусам; у эпика — EpicView, у прочих — квест как есть. */
export function questView(store: Store, idOrPrefix: string): Quest | EpicView {
  const questId = resolveIdPrefix(store.quests, idOrPrefix, 'квест')
  const q = store.quests.find((x) => x.id === questId)!
  const children = questChildren(store.quests, q.id)
  if (children.length === 0) return q
  return { ...q, children: children.map((c) => c.id), progress: epicProgress(store.quests, q.id) }
}

export interface SkillRow {
  id: string
  name: string // с эмодзи: «💪 Здоровье»
  level: number
  into: number
  toNext: number
  ranks: { total: number; achieved: number }
}

/** Живые навыки — `skills`: уровень и ранги. */
export function skillsView(store: Store): SkillRow[] {
  return store.skills.filter((sk) => !sk.archived).map((sk) => {
    const info = skillLevel(skillXpTotal(store.xpLog, sk.id))
    return {
      id: sk.id, name: `${sk.emoji} ${sk.name}`, level: info.level, into: info.into, toNext: info.toNext,
      ranks: galaxySummary(store.stars, sk.id),
    }
  })
}

export interface RankRow {
  tier: Tier
  achieved: boolean
  lit: number // зажжено звёзд ранга
  total: number
}

/** Лестница рангов навыка — `ranks --skill <id>`: только ранги, в которых есть
 * звёзды; навык — по id или префиксу, архивный тоже. */
export function ranksView(store: Store, skill: string): RankRow[] {
  const skillId = resolveIdPrefix(store.skills, skill, 'навык')
  return skillTiers(store.stars, skillId).map((tier) => {
    const own = rankStars(store.stars, skillId, tier)
    return {
      tier,
      achieved: isRankAchieved(store.stars, skillId, tier),
      lit: own.filter((c) => !!c.litAt).length,
      total: own.length,
    }
  })
}

/** Звёзды как есть, в порядке store — `stars [--skill <id>] [--tier <D|C|B|A|S>]`.
 * Пустое значение фильтра = нет фильтра. Навык резолвится раньше проверки
 * ранга: при двух ошибках отказ — про навык, как в CLI. */
export function starsView(store: Store, filter: { skill?: string; tier?: string } = {}): StarComponent[] {
  let list = store.stars
  if (filter.skill) {
    const skillId = resolveIdPrefix(store.skills, filter.skill, 'навык')
    list = list.filter((c) => c.skillId === skillId)
  }
  if (filter.tier) {
    if (!TIERS.includes(filter.tier as Tier)) throw new ViewError('bad-param', '--tier: D|C|B|A|S')
    list = list.filter((c) => c.tier === filter.tier)
  }
  return list
}

/** Окно `stats` в неделях: нет значения (или пустое) — 4, иначе целое 1..52. */
export function parseWeeks(raw?: string | null): number {
  const weeks = raw ? Number(raw) : 4
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new ViewError('bad-param', '--weeks: целое 1..52')
  return weeks
}

export interface WeekRow {
  weekStart: string // понедельник
  total: number
  bySkill: Record<string, number> // ключ "null" — XP квестов без навыка
}

/** XP по неделям Пн..Вс, от старой к новой, включая текущую — `stats --weeks N`.
 * В bySkill — каждый навык, тронутый за неделю, даже с нулём после откатов. */
export function statsView(store: Store, today: string, weeks: number): WeekRow[] {
  return weeklyXp(store.xpLog, weeks, today).map((w) => ({ ...w, bySkill: Object.fromEntries(w.bySkill) }))
}

/** Витрина без архива, позиции как есть — `wishlist`. Куплена ли разовая
 * награда — факт ledger (spend с itemId), в позиции его нет. */
export function wishlistView(store: Store): WishlistItem[] {
  return (store.wishlist ?? []).filter((w) => !w.archived)
}
