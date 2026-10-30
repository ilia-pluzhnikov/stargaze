import type { Quest, Skill, StarComponent, WishlistItem } from '../types'

// Белые списки ключей сущностей: в store редьюсер кладёт только их. Агент вправе прислать
// объект из `--json` как есть (у эпика там вычисляемые children/progress) — лишнее тихо
// отбрасывается: осевший снимок устарел бы на первой же сдаче подквеста и врал читателям
// сырого /api/store. validateStore лишние ключи не ловит намеренно — в чужих store мусор
// уже лежит, строгость заблокировала бы любую запись; он уходит при следующем update.
// `satisfies Record<keyof T, true>` — компайл-проверка полноты: поле, добавленное в тип
// без строки здесь, не скомпилируется (как и опечатка в списке).

const QUEST_KEYS = {
  id: true, title: true, type: true, skillId: true, starId: true, parentQuestId: true,
  xpReward: true, dueDate: true, status: true, proposalNote: true, description: true, why: true,
  definitionOfDone: true, resources: true, result: true, resultHistory: true, dueDateHistory: true,
  acceptedAt: true, archivedAt: true, createdAt: true,
} satisfies Record<keyof Quest, true>

// Удалённое поле формата — не эхо вывода, а намерение, которое ядро больше не исполняет:
// оно проходит отбор насквозь, и validateStore отвергает payload с причиной (422 у API,
// контракт v4), а не теряет расписание молча
const RETIRED_QUEST_KEYS: readonly string[] = ['daysOfWeek']

const SKILL_KEYS = {
  id: true, emoji: true, name: true, wantStatement: true, lore: true, hue: true, glyphId: true,
  archived: true, createdAt: true,
} satisfies Record<keyof Skill, true>

const STAR_KEYS = {
  id: true, skillId: true, parentStarId: true, tier: true, title: true, criteria: true,
  xpTarget: true, litAt: true, evidence: true, createdAt: true,
} satisfies Record<keyof StarComponent, true>

const WISHLIST_ITEM_KEYS = {
  id: true, title: true, kind: true, price: true, repeatable: true, starId: true, sourceUrl: true,
  originalPrice: true, emoji: true, imageUrl: true, note: true, claimedAt: true, archived: true,
  createdAt: true,
} satisfies Record<keyof WishlistItem, true>

/** Копия payload только с ключами типа; ключи со значением undefined не переносятся
 * (null — значение: `parentStarId: null` и т.п. сохраняются). Порядок ключей — как в payload. */
function pickKnown<T extends object>(keys: Record<keyof T, true>, payload: T, retired: readonly string[] = []): T {
  // не объект — чужая форма: её отсекает граница API или validateStore, а не отбор
  if (typeof payload !== 'object' || payload === null) return payload
  const out: Partial<T> = {}
  for (const k of Object.keys(payload) as (keyof T & string)[])
    if ((Object.hasOwn(keys, k) || retired.includes(k)) && payload[k] !== undefined) out[k] = payload[k]
  return out as T
}

export const pickQuest = (q: Quest): Quest => pickKnown(QUEST_KEYS, q, RETIRED_QUEST_KEYS)
export const pickSkill = (s: Skill): Skill => pickKnown(SKILL_KEYS, s)
export const pickStar = (c: StarComponent): StarComponent => pickKnown(STAR_KEYS, c)
export const pickWishlistItem = (w: WishlistItem): WishlistItem => pickKnown(WISHLIST_ITEM_KEYS, w)
