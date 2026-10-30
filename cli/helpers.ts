import { resolveIdPrefix, ViewError } from '../src/logic/views'

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: 1 | 2 = 1,
  ) {
    super(message)
  }
}

/** Резолв id по уникальному префиксу (как в git) — ядро; отказ — CliError с кодом 1. */
export function resolveId(items: { id: string }[], prefix: string, kind: string): string {
  try {
    return resolveIdPrefix(items, prefix, kind)
  } catch (e) {
    throw e instanceof ViewError ? new CliError(e.message) : e
  }
}

/** Простая таблица: колонки по максимальной ширине, два пробела между ними. */
export function table(rows: string[][]): string {
  if (rows.length === 0) return ''
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)))
  return rows
    .map((r) => r.map((cell, col) => (col === r.length - 1 ? cell : (cell ?? '').padEnd(widths[col]))).join('  ').trimEnd())
    .join('\n')
}
