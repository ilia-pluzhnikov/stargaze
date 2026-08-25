export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: 1 | 2 = 1,
  ) {
    super(message)
  }
}

/** Резолв id по уникальному префиксу (как в git). */
export function resolveId(items: { id: string }[], prefix: string, kind: string): string {
  const hits = items.filter((x) => x.id.startsWith(prefix))
  if (hits.length === 1) return hits[0].id
  if (hits.length === 0) throw new CliError(`${kind} с id «${prefix}» не найден`)
  // точное совпадение выигрывает: полный id не должен глохнуть из-за потомков-префиксов
  const exact = hits.find((x) => x.id === prefix)
  if (exact) return exact.id
  throw new CliError(`префикс «${prefix}» неоднозначен: ${hits.map((x) => x.id).join(', ')}`)
}

/** Простая таблица: колонки по максимальной ширине, два пробела между ними. */
export function table(rows: string[][]): string {
  if (rows.length === 0) return ''
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)))
  return rows
    .map((r) => r.map((cell, col) => (col === r.length - 1 ? cell : (cell ?? '').padEnd(widths[col]))).join('  ').trimEnd())
    .join('\n')
}
