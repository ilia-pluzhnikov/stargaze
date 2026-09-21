import type { Skill, SkyStore, StarComponent } from '../types'
import type { Constellation, ConstellationNode } from './layout'
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

/** Созвездие прошлого в сегодняшних координатах. `full` — `layoutConstellation` по полному
 * сегодняшнему набору звёзд навыка, `pastStars` — звёзды навыка из `skyAsOf`. Позиции и depth
 * берутся из `full` (раскладка от времени не зависит), объекты `star` — из прошлого, рёбра — по
 * уже перепривязанному `parentStarId`. Форма результата та же: код отрисовки не меняется. */
export function constellationAsOf(full: Constellation, pastStars: StarComponent[]): Constellation {
  const pastById = new Map(pastStars.map((s) => [s.id, s]))
  const nodes: ConstellationNode[] = []
  const indexById = new Map<string, number>()
  for (const n of full.nodes) {
    const star = pastById.get(n.star.id)
    if (!star) continue
    indexById.set(star.id, nodes.length)
    nodes.push({ star, depth: n.depth, x: n.x, y: n.y })
  }
  // как в layoutConstellation: i-е ребро ведёт в i-й узел; -1 — от корня
  const edges = nodes.map((n, i): [number, number] => [
    n.star.parentStarId === null ? -1 : indexById.get(n.star.parentStarId) ?? -1,
    i,
  ])
  return { root: full.root, nodes, edges }
}
