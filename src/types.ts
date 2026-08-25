export type QuestType = 'repeating' | 'short' | 'mid' | 'long'
export type QuestStatus = 'active' | 'done' | 'archived' | 'proposed'

export interface Character {
  name: string
  avatar: string // эмодзи
}

/** Навык = галактика на небе. */
export interface Skill {
  id: string
  emoji: string
  name: string
  wantStatement: string // «что я хочу от навыка»
  lore?: string // абзац-описание школы под именем галактики; нет = показываем wantStatement
  hue: number // 0..360 — оттенок галактики
  glyphId?: string // глиф-фигура созвездия (см. components/skyGlyphs.ts); нет = без глифа
  rankTitles?: Partial<Record<Tier, string>> // { D: 'Разминка', … }
  archived: boolean
  createdAt: string // ISO
}

export type Tier = 'D' | 'C' | 'B' | 'A' | 'S'
/** Ранги в порядке лестницы мастерства. */
export const TIERS: readonly Tier[] = ['D', 'C', 'B', 'A', 'S']

/** Звезда — узел дерева навыка. Трек = путь в дереве; развилка = несколько детей. */
export interface StarComponent {
  id: string
  skillId: string
  parentStarId: string | null // null = растёт из ядра галактики
  tier: Tier
  title: string
  criteria?: string // критерий зажигания
  xpTarget?: number // порог визуальной заливки (опционально)
  litAt?: string // ISO; зажжена (только ручное действие)
  evidence?: string // чем подтверждено
  createdAt: string
}

/** Материал квеста: с чем работать (база, документ, тред). Без url — допустимо, но анти-паттерн. */
export interface QuestResource {
  title: string
  url?: string
}

/** Пункт Definition of Done; done переживает сессии (mid/long идут неделями). */
export interface QuestDodItem {
  text: string
  done?: boolean
}

/** Итог завершённого квеста: что появилось в результате. */
export interface QuestResult {
  summary: string // краткий итог — обязателен
  artifactUrl?: string // ссылка на появившийся артефакт
  evidence?: string // измеримый сигнал («7 ответов, 2 заявки»)
  skippedDod?: string[] // пункты DoD, пропущенные при force-завершении (пишет только редьюсер)
  skippedQuestIds?: string[] // active-дети, пропущенные при force-завершении эпика (пишет только редьюсер)
}

/** Отменённый итог: след прошлой попытки завершения (uncomplete не стирает историю). */
export interface QuestPastResult extends QuestResult {
  cancelledAt: string // ts отката
}

export interface Quest {
  id: string
  title: string
  type: QuestType
  skillId: string | null // null = XP только персонажу
  starId?: string | null // привязка к звезде-компоненту (фолбэк — навык)
  parentQuestId?: string | null // null/нет = обычный квест; иначе — подквест эпика (один уровень)
  xpReward: number
  daysOfWeek?: number[] // repeating: 0=вс..6=сб; пусто/нет = каждый день
  dueDate?: string // short/mid/long: 'YYYY-MM-DD'
  status: QuestStatus
  proposalNote?: string // агент: зачем предлагает (только у status='proposed')
  description?: string // что сделать, подробно
  why?: string // зачем — мотивация
  definitionOfDone?: QuestDodItem[]
  resources?: QuestResource[]
  result?: QuestResult // только у done не-repeating; пишется через completeQuest
  resultHistory?: QuestPastResult[] // отменённые итоги, копятся при uncomplete
  dueDateHistory?: QuestDueDateMove[] // финансовый журнал переносов
  acceptedAt?: string // ISO; пишет только редьюсер при acceptQuest
  archivedAt?: string // ISO; пишет только редьюсер при archiveQuest
  createdAt: string
}

export interface XpEvent {
  id: string
  ts: string // ISO
  day: string // 'YYYY-MM-DD' в локальном поясе на момент события
  questId: string
  skillId: string | null
  amount: number // отрицательный при откате отметки
}

/** Кошелёк искр — второй append-only контур рядом с xpLog. */
export type LedgerKind =
  | 'earn'      // выплата за сдачу/тик, > 0
  | 'drain'     // материализованное капание, < 0
  | 'moveFee'   // платный перенос дедлайна, < 0
  | 'cancelFee' // неустойка за отмену контракта, < 0
  | 'spend'     // покупка из витрины или произвольная трата, < 0
  | 'adjust'    // ручная корректировка с причиной, любой знак
  | 'reversal'  // точечный разворот более раннего события

export interface LedgerEvent {
  id: string      // genId('l')
  ts: string      // ISO
  day: string     // 'YYYY-MM-DD' — как в XpEvent, пишется при создании
  kind: LedgerKind
  amount: number  // целое, ≠ 0; знак — по kind
  questId?: string    // earn/drain/moveFee/cancelFee
  itemId?: string     // spend по витрине
  note?: string       // обязателен у adjust и у spend без itemId
  opId?: string       // идемпотентность (purchase/spend) и связка сдачи
  reversesId?: string // только у reversal: id разворачиваемого события
}

/** Потолок длины emoji в UTF-16 юнитах: составные ZWJ-эмодзи длинные, «настоящесть» не проверяем. */
export const WISHLIST_EMOJI_MAX = 16

/** Позиция вишлиста: мелкая (цена в искрах) или крупная (якорь — звезда). */
export interface WishlistItem {
  id: string       // genId('w')
  title: string
  kind: 'small' | 'big'
  price?: number   // small: целое > 0, если задана; без цены — «хочу», купить нельзя
  repeatable?: boolean // small: true — покупается многократно; отсутствие — разовая («куплена» — факт в ledger)
  starId?: string  // big: якорь; навык и ранг выводятся из звезды, дублировать нечего
  sourceUrl?: string     // ссылка на товар/источник; справочная
  originalPrice?: string // исходная цена свободным текстом («2800 ฿»); ядро её не парсит
  emoji?: string         // «лицо» позиции: один эмодзи; ядро графемы не разбирает
  imageUrl?: string      // картинка товара; «только http(s)» и фолбэк на emoji — обязанность веба
  note?: string
  claimedAt?: string // big: отмечено «получено»; необратимо
  archived?: boolean // спрятана из витрины (удаления нет — только архив)
  createdAt: string
}

/** Финансовый журнал переносов дедлайна; пишет только редьюсер. */
export interface QuestDueDateMove {
  from: string // 'YYYY-MM-DD'
  to: string
  day: string  // день операции — по нему считается квота
  ts: string
  fee?: number // > 0, если перенос был платным
}

export interface Store {
  version: 3
  character: Character
  skills: Skill[]
  stars: StarComponent[]
  quests: Quest[]
  xpLog: XpEvent[] // единственный источник правды для XP, уровней, стриков
  ledger?: LedgerEvent[] // кошелёк искр; нет = пустая история
  wishlist?: WishlistItem[]
}

export const QUEST_TYPE_LABEL: Record<QuestType, string> = {
  repeating: 'Повторяющийся',
  short: 'Краткосрочный',
  mid: 'Среднесрочный',
  long: 'Долгосрочный',
}

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  earn: 'награда',
  drain: 'капание',
  moveFee: 'платный перенос',
  cancelFee: 'неустойка',
  spend: 'трата',
  adjust: 'корректировка',
  reversal: 'откат',
}

export const DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
