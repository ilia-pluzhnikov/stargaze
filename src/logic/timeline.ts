import type { Skill, SkyStore, StarComponent } from '../types'
import { dayInGameTz } from './sparks'

// История неба выводится из нынешнего store: createdAt/litAt звёзд, createdAt навыков и
// day событий xpLog. Это приближение («сегодняшняя структура, отфильтрованная по времени»),
// не снимок: погашенные и удалённые звёзды, прежние названия и родители невосстановимы.
// Единица времени — игровой день 'YYYY-MM-DD' (UTC+7).

/** Навыки и звёзды, существовавшие на конец игрового дня `day`. */
function starsAsOf(skillsIn: Skill[], starsIn: StarComponent[], day: string): { skills: Skill[]; stars: StarComponent[] } {
  const skills = skillsIn.filter((s) => dayInGameTz(s.createdAt) <= day)
  const skillIds = new Set(skills.map((s) => s.id))
  const alive = starsIn.filter((s) => skillIds.has(s.skillId) && dayInGameTz(s.createdAt) <= day)
  const aliveIds = new Set(alive.map((s) => s.id))
  const byId = new Map(starsIn.map((s) => [s.id, s]))

  // Звезду могли перенести под более новую: в прошлом её держит ближайший существовавший
  // предок, иначе — ядро галактики. Дерево проекции всегда связное; цикл в данных обрывается.
  const survivingParent = (star: StarComponent): string | null => {
    const seen = new Set<string>([star.id])
    let parentId = star.parentStarId
    while (parentId !== null && !seen.has(parentId)) {
      if (aliveIds.has(parentId)) return parentId
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentStarId ?? null
    }
    return null
  }

  const stars = alive.map((s): StarComponent => {
    const { litAt, evidence, ...rest } = s
    const base = { ...rest, parentStarId: survivingParent(s) }
    if (litAt === undefined || dayInGameTz(litAt) > day) return base
    return evidence === undefined ? { ...base, litAt } : { ...base, litAt, evidence }
  })
  return { skills, stars }
}

/** Небо на конец игрового дня `day`. Вход не мутируется; к результату применимы все обычные
 * селекторы (`isRankAchieved`, `galaxyStats`, `starProgress`, `skillXpTotal`, `charXpTotal`). */
export function skyAsOf(store: SkyStore, day: string): SkyStore {
  return {
    ...starsAsOf(store.skills, store.stars, day),
    // истории статусов квестов нет — «сделанность» на дату потребитель выводит из xpLog
    quests: store.quests.filter((q) => dayInGameTz(q.createdAt) <= day),
    // именно day, не ts: отметка привычки задним числом и её откат несут один day —
    // пара всегда по одну сторону среза
    xpLog: store.xpLog.filter((e) => e.day <= day),
  }
}
