export interface LevelInfo {
  level: number
  into: number // XP, набранный внутри текущего уровня
  toNext: number // сколько всего XP стоит текущий уровень
}

/** Стоимость перехода навыка с уровня n на n+1: 100, 150, 200, ... */
export function skillCostToNext(level: number): number {
  return 100 + 50 * (level - 1)
}

/** Стоимость перехода персонажа: 300, 450, 600, ... */
export function charCostToNext(level: number): number {
  return 300 + 150 * (level - 1)
}

export function levelFromXp(xp: number, costToNext: (level: number) => number): LevelInfo {
  let level = 1
  let rest = Math.max(0, xp)
  while (rest >= costToNext(level)) {
    rest -= costToNext(level)
    level++
  }
  return { level, into: rest, toNext: costToNext(level) }
}

export const skillLevel = (xp: number): LevelInfo => levelFromXp(xp, skillCostToNext)
export const charLevel = (xp: number): LevelInfo => levelFromXp(xp, charCostToNext)
