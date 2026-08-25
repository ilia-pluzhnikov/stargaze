import type { Quest, Skill, StarComponent, Tier, XpEvent } from '../types'
import { TIERS } from '../types'

/** Доля звёзд ранга, достаточная для его взятия. */
export const RANK_RATIO = 0.6

/** Классы светимости (Йеркская система) — универсальные имена рангов.
 * Совпадают с геометрией неба: tierStyle.scale рисует высокие ранги крупнее. */
export const TIER_CLASS: Record<Tier, string> = {
  D: 'Карлик',
  C: 'Субгигант',
  B: 'Гигант',
  A: 'Сверхгигант',
  S: 'Гипергигант',
}

/** Имя ранга навыка: авторское из rankTitles, иначе класс светимости. */
export function rankTitle(skill: Pick<Skill, 'rankTitles'>, tier: Tier): string {
  return skill.rankTitles?.[tier] ?? TIER_CLASS[tier]
}

/** Сколько звёзд нужно зажечь при общем числе total. */
export function requiredStars(total: number): number {
  return total > 0 ? Math.ceil(total * RANK_RATIO) : 0
}

/** Канонический порядок: createdAt, затем id. */
const canonical = (a: StarComponent, b: StarComponent) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Все звёзды навыка в каноническом порядке. */
export function skillStars(stars: StarComponent[], skillId: string): StarComponent[] {
  return stars.filter((s) => s.skillId === skillId).sort(canonical)
}

/** Корневые звёзды навыка (начала треков). */
export function rootsOf(stars: StarComponent[], skillId: string): StarComponent[] {
  return skillStars(stars, skillId).filter((s) => s.parentStarId === null)
}

/** Дети узла в каноническом порядке. */
export function childrenOf(stars: StarComponent[], starId: string): StarComponent[] {
  return stars.filter((s) => s.parentStarId === starId).sort(canonical)
}

/** Предки от родителя к корню. На битом цикле в данных останавливается, не зависает. */
export function ancestorsOf(stars: StarComponent[], starId: string): StarComponent[] {
  const byId = new Map(stars.map((s) => [s.id, s]))
  const chain: StarComponent[] = []
  const seen = new Set<string>([starId])
  let cur = byId.get(starId)
  while (cur?.parentStarId) {
    const parent = byId.get(cur.parentStarId)
    if (!parent || seen.has(parent.id)) break
    chain.push(parent)
    seen.add(parent.id)
    cur = parent
  }
  return chain
}

/** Звёзды ранга по всему навыку, где бы ни висели в дереве. */
export function rankStars(stars: StarComponent[], skillId: string, tier: Tier): StarComponent[] {
  return skillStars(stars, skillId).filter((s) => s.tier === tier)
}

/** Ранги, существующие у навыка (есть хотя бы одна звезда), в порядке D→S. */
export function skillTiers(stars: StarComponent[], skillId: string): Tier[] {
  const present = new Set(skillStars(stars, skillId).map((s) => s.tier))
  return TIERS.filter((t) => present.has(t))
}

/** Ранг взят: непусто и зажжено ≥60% его звёзд (округление вверх). */
export function isRankAchieved(stars: StarComponent[], skillId: string, tier: Tier): boolean {
  const list = rankStars(stars, skillId, tier)
  const required = requiredStars(list.length)
  return required > 0 && list.filter((s) => !!s.litAt).length >= required
}

/** Момент взятия ранга: litAt K-й зажжённой звезды по времени, где K — порог. */
export function rankAchievedAt(stars: StarComponent[], skillId: string, tier: Tier): string | null {
  const list = rankStars(stars, skillId, tier)
  const required = requiredStars(list.length)
  const litAt = list.flatMap((s) => (s.litAt ? [s.litAt] : [])).sort()
  return required > 0 && litAt.length >= required ? litAt[required - 1] : null
}

/** Первый невзятый ранг навыка (по D→S среди существующих); null — всё взято или звёзд нет. */
export function currentRank(stars: StarComponent[], skillId: string): Tier | null {
  for (const t of skillTiers(stars, skillId)) {
    if (!isRankAchieved(stars, skillId, t)) return t
  }
  return null
}

/** Суммарный XP по квестам звезды (clamp 0). */
export function starXp(xpLog: XpEvent[], quests: Quest[], starId: string): number {
  const questIds = new Set(quests.filter((q) => q.starId === starId).map((q) => q.id))
  let total = 0
  for (const e of xpLog) if (questIds.has(e.questId)) total += e.amount
  return Math.max(0, total)
}

/** Прогресс заливки звезды 0..1 при заданном xpTarget; null, если цели нет. */
export function starProgress(star: StarComponent, xpLog: XpEvent[], quests: Quest[]): number | null {
  if (!star.xpTarget) return null
  return Math.min(1, starXp(xpLog, quests, star.id) / star.xpTarget)
}

/** Сводка для HUD галактики: ранги навыка и все его звёзды. */
export interface GalaxyStats {
  ranksDone: number
  ranksTotal: number
  starsLit: number
  starsTotal: number
}

export function galaxyStats(stars: StarComponent[], skillId: string): GalaxyStats {
  const own = skillStars(stars, skillId)
  const tiers = skillTiers(stars, skillId)
  return {
    ranksDone: tiers.filter((t) => isRankAchieved(stars, skillId, t)).length,
    ranksTotal: tiers.length,
    starsLit: own.filter((s) => !!s.litAt).length,
    starsTotal: own.length,
  }
}

/** Сводка галактики: всего рангов навыка и сколько взято. */
export function galaxySummary(stars: StarComponent[], skillId: string): { total: number; achieved: number } {
  const tiers = skillTiers(stars, skillId)
  return { total: tiers.length, achieved: tiers.filter((t) => isRankAchieved(stars, skillId, t)).length }
}
