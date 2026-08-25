import { describe, expect, it } from 'vitest'
import { CliError, resolveId, table } from './helpers'

const items = [{ id: 'q_abc123' }, { id: 'q_abd456' }, { id: 'q_xyz789' }]

describe('resolveId', () => {
  it('уникальный префикс находит', () => expect(resolveId(items, 'q_x', 'квест')).toBe('q_xyz789'))
  it('полный id находит', () => expect(resolveId(items, 'q_abc123', 'квест')).toBe('q_abc123'))
  it('неоднозначный префикс — CliError со списком', () => {
    expect(() => resolveId(items, 'q_ab', 'квест')).toThrow(CliError)
    expect(() => resolveId(items, 'q_ab', 'квест')).toThrow(/q_abc123/)
  })
  it('не найден — CliError', () => expect(() => resolveId(items, 'нет', 'квест')).toThrow(/не найден/))
  it('точный id выигрывает у потомков-префиксов', () => {
    const nested = [{ id: 'c_streams_2' }, { id: 'c_streams_2x1' }, { id: 'c_streams_2x2' }]
    expect(resolveId(nested, 'c_streams_2', 'звезда')).toBe('c_streams_2')
  })
})

describe('table', () => {
  it('выравнивает колонки', () => {
    expect(table([['a', 'bb'], ['ccc', 'd']])).toBe('a    bb\nccc  d')
  })
})
