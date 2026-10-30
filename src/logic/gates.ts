import type { Store } from '../types'
import { isCalendarDay } from './dates'
import { dayInGameTz, gameTzOffset, provisionForQuest, settlementDay } from './sparks'
import { ACTION_TYPES, type Action } from './store'

// Граница API. Агент-гейм-мастер ходит в игру только через POST /api/action, и
// тихий 200 на отказ заставлял его перечитывать store после каждой записи. Здесь
// ответ ядра на «почему не применилось»: форма payload (400), отказ сдачи квеста
// с причиной (422) и сам факт применения (заголовок). Голова только переводит в HTTP.

/** Вид поля payload: id/ts/string — строки, day — 'YYYY-MM-DD', object — сущность
 * целиком (её глубокую форму проверяет validateStore при записи). */
type Kind = 'id' | 'day' | 'ts' | 'string' | 'number' | 'boolean' | 'object'

// Вид поля выводится из его типа в union: строку не объявить числом, необязательное
// поле помечается «?», а пропущенное или лишнее поле таблица не скомпилирует
type KindOf<V> = V extends string ? 'id' | 'day' | 'ts' | 'string'
  : V extends number ? 'number'
  : V extends boolean ? 'boolean'
  : 'object'
type Fields<A> = {
  [K in Exclude<keyof A, 'type'>]-?: {} extends Pick<A, K>
    ? `${KindOf<Exclude<A[K], undefined>>}?`
    : KindOf<A[K]>
}

// Форма каждого типа Action: если union пополнится, таблица перестанет компилироваться
const SHAPES: { [T in Action['type']]: Fields<Extract<Action, { type: T }>> } = {
  completeQuest: { questId: 'id', day: 'day', ts: 'ts', result: 'object?', force: 'boolean?' },
  uncompleteQuest: { questId: 'id', day: 'day', ts: 'ts' },
  addQuest: { quest: 'object' },
  updateQuest: { quest: 'object' },
  archiveQuest: { questId: 'id', day: 'day', ts: 'ts' },
  proposeQuest: { quest: 'object' },
  acceptQuest: { questId: 'id', ts: 'ts' },
  rejectQuest: { questId: 'id' },
  addSkill: { skill: 'object' },
  updateSkill: { skill: 'object' },
  archiveSkill: { skillId: 'id' },
  addStar: { star: 'object' },
  updateStar: { star: 'object' },
  removeStar: { starId: 'id' },
  lightStar: { starId: 'id', ts: 'ts', evidence: 'string?' },
  unlightStar: { starId: 'id' },
  setCharacter: { character: 'object' },
  importStore: { store: 'object' },
  resetToSeed: {},
  moveDueDate: { questId: 'id', to: 'day', day: 'day', ts: 'ts' },
  addWishlistItem: { item: 'object' },
  updateWishlistItem: { item: 'object' },
  archiveWishlistItem: { itemId: 'id' },
  purchaseItem: { itemId: 'id', day: 'day', ts: 'ts', opId: 'string?' },
  spendSparks: { amount: 'number', note: 'string', day: 'day', ts: 'ts', opId: 'string?' },
  claimReward: { itemId: 'id', ts: 'ts' },
  adjustSparks: { amount: 'number', note: 'string', day: 'day', ts: 'ts' },
  setGameTz: { offsetMin: 'number' },
}

const EXPECTED: Record<Kind, string> = {
  id: 'ожидается строка-id',
  day: 'ожидается день YYYY-MM-DD',
  ts: 'ожидается строка ISO-времени',
  string: 'ожидается строка',
  number: 'ожидается число',
  boolean: 'ожидается true или false',
  object: 'ожидается объект',
}

const fits = (kind: Kind, v: unknown): boolean => {
  switch (kind) {
    case 'id': case 'ts': case 'string': return typeof v === 'string'
    case 'day': return typeof v === 'string' && isCalendarDay(v)
    case 'number': return typeof v === 'number'
    case 'boolean': return typeof v === 'boolean'
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v)
  }
}

const ID_FIELDS: readonly string[] = ['questId', 'skillId', 'starId', 'itemId']

/** Почему payload не годится по форме — текст для 400; null = форма верна.
 * Проверяет обязательные поля и примитивные типы ровно по union Action;
 * необязательные — только тип, если поле есть. null в необязательном поле —
 * «поля нет»: так его шлют агенты (`None` в Python); перед редьюсером его
 * убирает dropNullOptionals. Сущности внутри не разбирает. */
export function actionShapeError(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'ожидается объект действия { type, … }'
  const a = x as Record<string, unknown>
  if (a.type === undefined) return 'нет поля type'
  if (typeof a.type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(a.type))
    return `неизвестное действие «${String(a.type)}»`
  const type = a.type as Action['type']
  for (const [field, spec] of Object.entries(SHAPES[type]) as [string, string][]) {
    const optional = spec.endsWith('?')
    const kind = (optional ? spec.slice(0, -1) : spec) as Kind
    const v = a[field]
    if (v === undefined || (optional && v === null)) {
      if (optional) continue
      // частая ошибка агента: id сущности под общим именем
      if (ID_FIELDS.includes(field) && a.id !== undefined) return `${type}: поле называется ${field}, не id`
      return `${type}: нет поля ${field}`
    }
    if (!fits(kind, v)) return `${type}: ${field} — ${EXPECTED[kind]}`
  }
  return null
}

/** Действие без необязательных полей со значением null — после actionShapeError.
 * Редьюсер ждёт «поля нет», а не null: `evidence: null` осел бы в звезду. */
export function dropNullOptionals(action: Action): Action {
  const out: Record<string, unknown> = { ...action }
  for (const [field, spec] of Object.entries(SHAPES[action.type]) as [string, string][])
    if (spec.endsWith('?') && out[field] === null) delete out[field]
  return out as Action
}

/** Отказ сдачи квеста: текст и, где есть, перечень того, что держит сдачу. */
export interface CompleteRefusal {
  error: string
  dod?: string[]
  children?: { id: string; title: string }[]
}

/** Почему completeQuest будет отвергнут редьюсером — для 422 на границе API; null —
 * применится или это тихий no-op (нет квеста, архив, proposed, повторная сдача,
 * вторая отметка за день). Зеркало ветки completeQuest редьюсера в том же порядке
 * проверок: любой отказ отсюда там — возврат того же store (держат тесты). */
export function completeQuestRefusal(store: Store, action: Extract<Action, { type: 'completeQuest' }>): CompleteRefusal | null {
  const quest = store.quests.find((q) => q.id === action.questId)
  if (!quest || quest.status === 'archived' || quest.status === 'proposed') return null
  if (quest.type === 'repeating') {
    const tsDay = typeof action.ts === 'string' ? dayInGameTz(action.ts, gameTzOffset(store)) : ''
    if (isCalendarDay(tsDay) && action.day > tsDay)
      return { error: `отметка наперёд: день ${action.day} позже игрового дня ts (${tsDay})` }
    return null
  }
  if (quest.status === 'done') return null
  const summary = action.result?.summary
  if (typeof summary !== 'string' || !summary.trim()) return { error: 'нужен итог: result.summary' }
  if (!action.force) {
    const dod = (quest.definitionOfDone ?? []).filter((d) => !d.done).map((d) => d.text)
    if (dod.length > 0) return { error: `квест «${quest.title}» не завершён: незакрытые пункты DoD`, dod }
    const open = store.quests.filter((c) => c.parentQuestId === quest.id && c.status === 'active')
    if (open.length > 0)
      return { error: `эпик «${quest.title}» не завершён: активные подквесты`, children: open.map((c) => ({ id: c.id, title: c.title })) }
  }
  // мусорный ts у контракта со сроком: день расчёта не вычислить, долг уходит в NaN — редьюсер
  // отказывает и при force. Без этой ветки агент получил бы 200 «не применилось» без причины
  const tz = gameTzOffset(store)
  if (!Number.isFinite(provisionForQuest(quest, settlementDay(action.day, action.ts, tz), tz)))
    return { error: `ts «${action.ts}» не читается как ISO-момент — день расчёта не вычислить` }
  return null
}

/** Изменило ли действие store. Ссылочного равенства мало: часть веток редьюсера
 * пересобирает store и на no-op (unlightStar/archiveSkill с чужим id, setCharacter тем же),
 * поэтому срезы с новой ссылкой сравниваются по содержимому. */
export function storeChanged(prev: Store, next: Store): boolean {
  if (prev === next) return false
  const a = prev as unknown as Record<string, unknown>
  const b = next as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true
  return false
}
