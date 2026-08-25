import { describe, expect, it } from 'vitest'
import { charLevel, skillCostToNext, skillLevel } from './xp'

describe('skillCostToNext', () => {
  it('растёт линейно: 100, 150, 200', () => {
    expect(skillCostToNext(1)).toBe(100)
    expect(skillCostToNext(2)).toBe(150)
    expect(skillCostToNext(3)).toBe(200)
  })
})

describe('skillLevel', () => {
  it('0 XP → уровень 1, 0/100', () => {
    expect(skillLevel(0)).toEqual({ level: 1, into: 0, toNext: 100 })
  })
  it('99 XP → всё ещё уровень 1', () => {
    expect(skillLevel(99)).toEqual({ level: 1, into: 99, toNext: 100 })
  })
  it('100 XP → ровно уровень 2', () => {
    expect(skillLevel(100)).toEqual({ level: 2, into: 0, toNext: 150 })
  })
  it('250 XP → ровно уровень 3 (100 + 150)', () => {
    expect(skillLevel(250)).toEqual({ level: 3, into: 0, toNext: 200 })
  })
  it('отрицательный XP не роняет — уровень 1', () => {
    expect(skillLevel(-50).level).toBe(1)
  })
})

describe('charLevel', () => {
  it('порог первого уровня персонажа — 300 XP', () => {
    expect(charLevel(299).level).toBe(1)
    expect(charLevel(300).level).toBe(2)
  })
  it('750 XP → уровень 3 (300 + 450)', () => {
    expect(charLevel(750)).toEqual({ level: 3, into: 0, toNext: 600 })
  })
})
