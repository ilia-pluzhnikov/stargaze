import type { LedgerEvent, Quest, StarComponent, Store, Tier, WishlistItem, XpEvent } from '../types'
import { TIERS, WISHLIST_EMOJI_MAX } from '../types'
import { isCalendarDay } from './dates'
import { XP_REWARD_MAX } from './sparks'

// Техническая целостность store. Чистая: работает в браузере (import) и в node
// (storage/CLI/API). Факт-чекинг («правда ли пробежал 5 км») — не здесь, это
// забота агента-гейм-мастера поверх CLI.

const QUEST_TYPES = new Set(['repeating', 'short', 'mid', 'long'])
const QUEST_STATUSES = new Set(['active', 'done', 'archived', 'proposed'])
const TIER_SET = new Set(TIERS)
const LEDGER_KINDS = new Set(['earn', 'drain', 'moveFee', 'cancelFee', 'spend', 'adjust', 'reversal'])
const NEGATIVE_KINDS = new Set(['drain', 'moveFee', 'cancelFee', 'spend'])

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x)
// деньги (цены, суммы ledger) — только точная целочисленная арифметика
const isSafeInt = (x: unknown): x is number => isNum(x) && Number.isSafeInteger(x)

function checkDupIds(errors: string[], name: string, list: { id?: unknown }[]): void {
  const seen = new Set<unknown>()
  for (const item of list) {
    if (seen.has(item.id)) errors.push(`${name}: дубликат id ${JSON.stringify(item.id)}`)
    seen.add(item.id)
  }
}

export function validateStore(x: unknown): string[] {
  const errors: string[] = []
  if (!isObj(x)) return ['store: не объект']
  if (x.version !== 3) errors.push(`version: ожидается 3, получено ${JSON.stringify(x.version)}`)
  if (!isObj(x.character) || !isStr(x.character.name) || !isStr(x.character.avatar))
    errors.push('character: ожидается { name: string, avatar: string }')
  let brokenArrays = false
  for (const key of ['skills', 'stars', 'quests', 'xpLog'] as const) {
    if (!Array.isArray(x[key])) {
      errors.push(`${key}: не массив`)
      brokenArrays = true
    }
  }
  if (brokenArrays) return errors // без каркаса дальше проверять нечего

  const skills = x.skills as Store['skills']
  const stars = x.stars as StarComponent[]
  const quests = x.quests as Quest[]
  const xpLog = x.xpLog as XpEvent[]

  checkDupIds(errors, 'skills', skills)
  checkDupIds(errors, 'stars', stars)
  checkDupIds(errors, 'quests', quests)
  checkDupIds(errors, 'xpLog', xpLog)

  const skillIds = new Set(skills.map((s) => s.id))
  skills.forEach((s, i) => {
    if (!isStr(s.id) || !isStr(s.name) || !isStr(s.emoji) || !isStr(s.wantStatement))
      errors.push(`skills[${i}]: битые строковые поля`)
    if (!isNum(s.hue)) errors.push(`skills[${i}] (${s.id}): hue — не число`)
    if (typeof s.archived !== 'boolean') errors.push(`skills[${i}] (${s.id}): archived — не boolean`)
    if (s.glyphId !== undefined && !isStr(s.glyphId))
      errors.push(`skills[${i}] (${s.id}): glyphId — не строка`)
    if (s.rankTitles !== undefined) {
      if (!isObj(s.rankTitles)) errors.push(`skills[${i}] (${s.id}): rankTitles — не объект`)
      else {
        for (const [k, v] of Object.entries(s.rankTitles)) {
          if (!TIER_SET.has(k as Tier))
            errors.push(`skills[${i}] (${s.id}): rankTitles — ключ ${JSON.stringify(k)} вне D|C|B|A|S`)
          else if (!isStr(v)) errors.push(`skills[${i}] (${s.id}): rankTitles.${k} — не строка`)
        }
      }
    }
  })

  const starById = new Map(stars.map((c) => [c.id, c]))
  stars.forEach((c, i) => {
    if (!isStr(c.id) || !isStr(c.title)) errors.push(`stars[${i}]: битые строковые поля`)
    if (!skillIds.has(c.skillId)) errors.push(`stars[${i}] (${c.id}): skillId ${JSON.stringify(c.skillId)} не найден`)
    if (!TIER_SET.has(c.tier)) errors.push(`stars[${i}] (${c.id}): tier ${JSON.stringify(c.tier)} вне D|C|B|A|S`)
    if (c.parentStarId !== null) {
      const p = starById.get(c.parentStarId)
      if (!p) errors.push(`stars[${i}] (${c.id}): parentStarId ${JSON.stringify(c.parentStarId)} не найден`)
      else if (p.skillId !== c.skillId)
        errors.push(`stars[${i}] (${c.id}): родитель ${p.id} из другого навыка (${p.skillId} ≠ ${c.skillId})`)
    }
    if (c.xpTarget !== undefined && (!isNum(c.xpTarget) || c.xpTarget <= 0))
      errors.push(`stars[${i}] (${c.id}): xpTarget — не число > 0`)
    if (c.evidence !== undefined && !c.litAt) errors.push(`stars[${i}] (${c.id}): evidence без litAt`)
  })
  // циклы parentStarId — от каждой звезды поднимаемся к корню, встретили уже
  // виденную на этом пути звезду — цикл (само-ссылка тоже ловится тут).
  for (const c of stars) {
    const seen = new Set<string>([c.id])
    let cur = c
    for (;;) {
      if (cur.parentStarId === null || cur.parentStarId === undefined) break
      const p = starById.get(cur.parentStarId)
      if (!p) break
      if (seen.has(p.id)) {
        errors.push(`stars: цикл parentStarId через ${c.id}`)
        break
      }
      seen.add(p.id)
      cur = p
    }
  }

  const questById = new Map(quests.map((q) => [q.id, q]))
  quests.forEach((q, i) => {
    if (!isStr(q.id) || !isStr(q.title)) errors.push(`quests[${i}]: битые строковые поля`)
    if (!QUEST_TYPES.has(q.type)) errors.push(`quests[${i}] (${q.id}): неизвестный type ${JSON.stringify(q.type)}`)
    if (!QUEST_STATUSES.has(q.status)) errors.push(`quests[${i}] (${q.id}): неизвестный status ${JSON.stringify(q.status)}`)
    if (!isInt(q.xpReward) || q.xpReward <= 0) errors.push(`quests[${i}] (${q.id}): xpReward — не целое > 0`)
    if (isInt(q.xpReward) && q.xpReward > XP_REWARD_MAX)
      errors.push(`quests[${i}] (${q.id}): xpReward больше потолка ${XP_REWARD_MAX}`)
    if (q.skillId !== null && !skillIds.has(q.skillId))
      errors.push(`quests[${i}] (${q.id}): skillId ${JSON.stringify(q.skillId)} не найден`)
    if (q.starId != null) {
      const star = starById.get(q.starId)
      if (!star) errors.push(`quests[${i}] (${q.id}): starId ${JSON.stringify(q.starId)} не найден`)
      else if (star.skillId !== q.skillId)
        errors.push(
          `quests[${i}] (${q.id}): starId ${q.starId} принадлежит навыку ${star.skillId}, а квест — ${JSON.stringify(q.skillId)}`,
        )
    }
    if (q.parentQuestId != null) {
      if (!isStr(q.parentQuestId)) errors.push(`quests[${i}] (${q.id}): parentQuestId — не строка`)
      else {
        const p = questById.get(q.parentQuestId)
        if (!p) errors.push(`quests[${i}] (${q.id}): parentQuestId ${JSON.stringify(q.parentQuestId)} не найден`)
        else {
          if (p.id === q.id) errors.push(`quests[${i}] (${q.id}): parentQuestId ссылается сам на себя`)
          else if (p.parentQuestId != null)
            errors.push(`quests[${i}] (${q.id}): родитель ${p.id} сам подквест — второй уровень запрещён`)
          if (p.type === 'repeating')
            errors.push(`quests[${i}] (${q.id}): родитель ${p.id} — repeating и не может быть эпиком`)
        }
      }
      if (q.type === 'repeating') errors.push(`quests[${i}] (${q.id}): repeating-квест не может быть подквестом`)
    }
    if (q.proposalNote !== undefined && q.status !== 'proposed')
      errors.push(`quests[${i}] (${q.id}): proposalNote у статуса ${q.status}`)
    if (q.description !== undefined && !isStr(q.description))
      errors.push(`quests[${i}] (${q.id}): description — не строка`)
    if (q.why !== undefined && !isStr(q.why)) errors.push(`quests[${i}] (${q.id}): why — не строка`)
    if (q.definitionOfDone !== undefined) {
      if (!Array.isArray(q.definitionOfDone)) errors.push(`quests[${i}] (${q.id}): definitionOfDone — не массив`)
      else
        q.definitionOfDone.forEach((d, j) => {
          if (!isObj(d) || !isStr(d.text) || d.text.trim() === '')
            errors.push(`quests[${i}] (${q.id}): definitionOfDone[${j}] — нужен непустой text`)
          else if (d.done !== undefined && typeof d.done !== 'boolean')
            errors.push(`quests[${i}] (${q.id}): definitionOfDone[${j}].done — не boolean`)
        })
    }
    if (q.resources !== undefined) {
      if (!Array.isArray(q.resources)) errors.push(`quests[${i}] (${q.id}): resources — не массив`)
      else
        q.resources.forEach((r, j) => {
          if (!isObj(r) || !isStr(r.title) || r.title.trim() === '')
            errors.push(`quests[${i}] (${q.id}): resources[${j}] — нужен непустой title`)
          else if (r.url !== undefined && !isStr(r.url))
            errors.push(`quests[${i}] (${q.id}): resources[${j}].url — не строка`)
        })
    }
    const checkResult = (r: unknown, where: string): void => {
      if (!isObj(r) || !isStr(r.summary) || r.summary.trim() === '') {
        errors.push(`quests[${i}] (${q.id}): ${where} — нужен непустой summary`)
        return
      }
      if (r.artifactUrl !== undefined && !isStr(r.artifactUrl))
        errors.push(`quests[${i}] (${q.id}): ${where}.artifactUrl — не строка`)
      if (r.evidence !== undefined && !isStr(r.evidence))
        errors.push(`quests[${i}] (${q.id}): ${where}.evidence — не строка`)
      if (r.skippedDod !== undefined && (!Array.isArray(r.skippedDod) || r.skippedDod.some((t) => !isStr(t))))
        errors.push(`quests[${i}] (${q.id}): ${where}.skippedDod — не массив строк`)
      if (r.skippedQuestIds !== undefined && (!Array.isArray(r.skippedQuestIds) || r.skippedQuestIds.some((t) => !isStr(t))))
        errors.push(`quests[${i}] (${q.id}): ${where}.skippedQuestIds — не массив строк`)
    }
    if (q.result !== undefined) {
      // done без result — валидно (легаси, завершён до цикла «Карточка квеста»)
      checkResult(q.result, 'result')
      if (q.status !== 'done' && q.status !== 'archived') errors.push(`quests[${i}] (${q.id}): result у статуса ${q.status}`)
      if (q.type === 'repeating') errors.push(`quests[${i}] (${q.id}): result у repeating-квеста`)
    }
    if (q.resultHistory !== undefined) {
      if (!Array.isArray(q.resultHistory)) errors.push(`quests[${i}] (${q.id}): resultHistory — не массив`)
      else
        q.resultHistory.forEach((r, j) => {
          checkResult(r, `resultHistory[${j}]`)
          if (isObj(r) && !isStr(r.cancelledAt))
            errors.push(`quests[${i}] (${q.id}): resultHistory[${j}].cancelledAt — не строка`)
        })
      if (q.type === 'repeating') errors.push(`quests[${i}] (${q.id}): resultHistory у repeating-квеста`)
    }
    if (q.daysOfWeek !== undefined) {
      if (!Array.isArray(q.daysOfWeek) || q.daysOfWeek.some((d) => !isInt(d) || d < 0 || d > 6))
        errors.push(`quests[${i}] (${q.id}): daysOfWeek — не массив целых 0..6`)
    }
    if (q.dueDate !== undefined && !isCalendarDay(q.dueDate))
      errors.push(`quests[${i}] (${q.id}): dueDate — не календарная дата YYYY-MM-DD`)
    if (q.acceptedAt !== undefined && !isStr(q.acceptedAt))
      errors.push(`quests[${i}] (${q.id}): acceptedAt — не строка`)
    if (q.archivedAt !== undefined && !isStr(q.archivedAt))
      errors.push(`quests[${i}] (${q.id}): archivedAt — не строка`)
    if (q.dueDateHistory !== undefined) {
      if (!Array.isArray(q.dueDateHistory)) errors.push(`quests[${i}] (${q.id}): dueDateHistory — не массив`)
      else {
        const hist = q.dueDateHistory
        hist.forEach((m, j) => {
          if (!isObj(m) || !isStr(m.ts) || !isStr(m.from) || !isCalendarDay(m.from) ||
              !isStr(m.to) || !isCalendarDay(m.to) || !isStr(m.day) || !isCalendarDay(m.day)) {
            errors.push(`quests[${i}] (${q.id}): dueDateHistory[${j}] — нужны календарные from/to/day и ts`)
            return
          }
          if (m.from === m.to) errors.push(`quests[${i}] (${q.id}): dueDateHistory[${j}] — from совпадает с to`)
          if (m.fee !== undefined && (!isInt(m.fee) || m.fee <= 0))
            errors.push(`quests[${i}] (${q.id}): dueDateHistory[${j}].fee — не целое > 0`)
        })
        for (let j = 1; j < hist.length; j++)
          if (isObj(hist[j]) && isObj(hist[j - 1]) && hist[j].from !== hist[j - 1].to)
            errors.push(`quests[${i}] (${q.id}): dueDateHistory разорвана на [${j}]`)
        const last = hist[hist.length - 1]
        if (last !== undefined && isObj(last) && q.dueDate !== last.to)
          errors.push(`quests[${i}] (${q.id}): dueDate ${JSON.stringify(q.dueDate)} ≠ последнего to ${JSON.stringify(last.to)}`)
      }
    }
  })

  const netByQuestDay = new Map<string, number>()
  const posCount = new Map<string, number>()
  const negCount = new Map<string, number>()
  xpLog.forEach((e, i) => {
    if (!isStr(e.id) || !isStr(e.ts)) errors.push(`xpLog[${i}]: битые строковые поля`)
    if (!isStr(e.day) || !isCalendarDay(e.day)) errors.push(`xpLog[${i}] (${e.id}): day не в формате YYYY-MM-DD`)
    if (!isInt(e.amount) || e.amount === 0) errors.push(`xpLog[${i}] (${e.id}): amount — не целое ≠ 0`)
    const q = questById.get(e.questId)
    if (!q) {
      errors.push(`xpLog[${i}] (${e.id}): questId ${JSON.stringify(e.questId)} не найден`)
      return
    }
    // skillId события — снимок навыка на момент события (append-only). Перепривязка квеста к другому навыку легальна.
    // Проверяем только существование: если skillId ≠ null, он должен ссылаться на реальный навык.
    if (e.skillId !== null && !skillIds.has(e.skillId))
      errors.push(`xpLog[${i}] (${e.id}): skillId ${JSON.stringify(e.skillId)} не найден`)
    if (q.status === 'proposed') errors.push(`xpLog[${i}] (${e.id}): событие у proposed-квеста ${q.id}`)
    const key = `${e.questId} ${e.day}`
    netByQuestDay.set(key, (netByQuestDay.get(key) ?? 0) + e.amount)
    if (e.amount > 0) posCount.set(key, (posCount.get(key) ?? 0) + 1)
    else negCount.set(key, (negCount.get(key) ?? 0) + 1)
  })
  for (const [key, net] of netByQuestDay) {
    const [questId, day] = key.split(' ')
    if (net < 0) errors.push(`xpLog: отрицательный net ${net} у квеста ${questId} за ${day}`)
    const q = questById.get(questId)
    if (q?.type === 'repeating' && (posCount.get(key) ?? 0) > (negCount.get(key) ?? 0) + 1)
      errors.push(`xpLog: повторная отметка repeating-квеста ${questId} за ${day} без компенсации`)
  }

  if (x.wishlist !== undefined && !Array.isArray(x.wishlist)) errors.push('wishlist: не массив')
  const wishlist = (Array.isArray(x.wishlist) ? x.wishlist : []) as WishlistItem[]
  checkDupIds(errors, 'wishlist', wishlist)
  const bigStars = new Set<string>()
  wishlist.forEach((w, i) => {
    if (!isStr(w.id) || !isStr(w.title) || w.title.trim() === '')
      errors.push(`wishlist[${i}]: нужен id и непустой title`)
    if (!isStr(w.createdAt)) errors.push(`wishlist[${i}] (${w.id}): createdAt — не строка`)
    if (w.note !== undefined && !isStr(w.note)) errors.push(`wishlist[${i}] (${w.id}): note — не строка`)
    if (w.archived !== undefined && typeof w.archived !== 'boolean')
      errors.push(`wishlist[${i}] (${w.id}): archived — не boolean`)
    if (w.sourceUrl !== undefined && (!isStr(w.sourceUrl) || w.sourceUrl.trim() === ''))
      errors.push(`wishlist[${i}] (${w.id}): sourceUrl — непустая строка`)
    if (w.originalPrice !== undefined && (!isStr(w.originalPrice) || w.originalPrice.trim() === ''))
      errors.push(`wishlist[${i}] (${w.id}): originalPrice — непустая строка`)
    if (w.emoji !== undefined && (!isStr(w.emoji) || w.emoji.trim() === '' || w.emoji.length > WISHLIST_EMOJI_MAX))
      errors.push(`wishlist[${i}] (${w.id}): emoji — непустая строка до ${WISHLIST_EMOJI_MAX} юнитов`)
    if (w.imageUrl !== undefined && (!isStr(w.imageUrl) || w.imageUrl.trim() === ''))
      errors.push(`wishlist[${i}] (${w.id}): imageUrl — непустая строка`)
    if (w.repeatable !== undefined && typeof w.repeatable !== 'boolean')
      errors.push(`wishlist[${i}] (${w.id}): repeatable — не boolean`)
    if (w.kind === 'small') {
      if (w.price !== undefined && (!isSafeInt(w.price) || w.price <= 0))
        errors.push(`wishlist[${i}] (${w.id}): цена, если задана, — целое > 0`)
      if (w.starId !== undefined)
        errors.push(`wishlist[${i}] (${w.id}): small не имеет якоря starId`)
      if (w.claimedAt !== undefined) errors.push(`wishlist[${i}] (${w.id}): claimedAt только у big`)
    } else if (w.kind === 'big') {
      if (w.price !== undefined) errors.push(`wishlist[${i}] (${w.id}): у big нет цены — разблокируется звездой`)
      if (w.repeatable !== undefined)
        errors.push(`wishlist[${i}] (${w.id}): repeatable только у small — big разовая по механике`)
      if (!isStr(w.starId) || !starById.has(w.starId))
        errors.push(`wishlist[${i}] (${w.id}): starId ${JSON.stringify(w.starId)} не найден`)
      if (w.claimedAt !== undefined && !isStr(w.claimedAt))
        errors.push(`wishlist[${i}] (${w.id}): claimedAt — не строка`)
      if (!w.archived && isStr(w.starId)) {
        if (bigStars.has(w.starId)) errors.push(`wishlist[${i}] (${w.id}): дубль big-награды на звезду ${w.starId}`)
        bigStars.add(w.starId)
      }
    } else errors.push(`wishlist[${i}] (${w.id}): неизвестный kind ${JSON.stringify(w.kind)}`)
  })

  if (x.ledger !== undefined && !Array.isArray(x.ledger)) errors.push('ledger: не массив')
  const ledger = (Array.isArray(x.ledger) ? x.ledger : []) as LedgerEvent[]
  checkDupIds(errors, 'ledger', ledger)
  const wishIds = new Set(wishlist.map((w) => w.id))
  const ledgerIdx = new Map<string, { e: LedgerEvent; idx: number }>()
  ledger.forEach((e, i) => {
    if (isStr(e.id) && !ledgerIdx.has(e.id)) ledgerIdx.set(e.id, { e, idx: i })
  })
  const reversedTargets = new Set<string>()
  ledger.forEach((e, i) => {
    if (!isStr(e.id) || !isStr(e.ts)) errors.push(`ledger[${i}]: битые строковые поля`)
    if (!isStr(e.day) || !isCalendarDay(e.day))
      errors.push(`ledger[${i}] (${e.id}): day — не календарная дата`)
    if (!LEDGER_KINDS.has(e.kind)) {
      errors.push(`ledger[${i}] (${e.id}): неизвестный kind ${JSON.stringify(e.kind)}`)
      return
    }
    if (!isSafeInt(e.amount) || e.amount === 0)
      errors.push(`ledger[${i}] (${e.id}): amount — не целое ≠ 0`)
    if (e.kind === 'earn' && e.amount <= 0) errors.push(`ledger[${i}] (${e.id}): earn должен быть > 0`)
    if (NEGATIVE_KINDS.has(e.kind) && e.amount >= 0)
      errors.push(`ledger[${i}] (${e.id}): ${e.kind} должен быть < 0`)
    if (e.questId !== undefined && !questById.has(e.questId))
      errors.push(`ledger[${i}] (${e.id}): questId ${JSON.stringify(e.questId)} не найден`)
    if (e.itemId !== undefined && !wishIds.has(e.itemId))
      errors.push(`ledger[${i}] (${e.id}): itemId ${JSON.stringify(e.itemId)} не найден`)
    if (e.note !== undefined && !isStr(e.note)) errors.push(`ledger[${i}] (${e.id}): note — не строка`)
    if (e.opId !== undefined && !isStr(e.opId)) errors.push(`ledger[${i}] (${e.id}): opId — не строка`)
    if (e.kind === 'adjust' && (!isStr(e.note) || e.note.trim() === ''))
      errors.push(`ledger[${i}] (${e.id}): adjust требует note`)
    if (e.kind === 'spend' && e.itemId === undefined && (!isStr(e.note) || e.note.trim() === ''))
      errors.push(`ledger[${i}] (${e.id}): spend без itemId требует note`)
    if (e.kind === 'reversal') {
      const target = e.reversesId !== undefined ? ledgerIdx.get(e.reversesId) : undefined
      if (!target || target.idx >= i)
        errors.push(`ledger[${i}] (${e.id}): reversal должен указывать на более раннее событие`)
      else {
        if (e.amount !== -target.e.amount)
          errors.push(`ledger[${i}] (${e.id}): reversal amount ${e.amount} ≠ −цели ${-target.e.amount}`)
        if (reversedTargets.has(e.reversesId as string))
          errors.push(`ledger[${i}] (${e.id}): второй reversal на ${e.reversesId}`)
        reversedTargets.add(e.reversesId as string)
      }
    } else if (e.reversesId !== undefined)
      errors.push(`ledger[${i}] (${e.id}): reversesId только у reversal`)
  })

  return errors
}
