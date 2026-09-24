import type { Store } from '../types'
import type { Action } from './store'

// Очередь действий серверного режима: что не удалось отправить — лежит здесь
// и доигрывается при появлении сети. Хранилище инжектится (тестируемость).
//
// После ренейма 2026-07 очередь живёт в двух ключах: новые действия пишутся
// только в stargaze.queue.v2, но legacy-ключ questlog.queue.v2 мог остаться
// с неотправленными действиями — его дренируем первым (он старше) и вечно.
// Copy/delete между ключами нет намеренно: перенос без подтверждения сервера
// рисковал бы потерять действия при падении между copy и delete.

export interface KV {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export const QUEUE_KEY = 'stargaze.queue.v2'
export const LEGACY_QUEUE_KEY = 'questlog.queue.v2'

function readQueueKey(kv: KV, key: string): Action[] {
  try {
    const raw = kv.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Action[]) : []
  } catch {
    return []
  }
}

function writeQueueKey(kv: KV, key: string, queue: Action[]): void {
  if (queue.length === 0) kv.removeItem(key)
  else kv.setItem(key, JSON.stringify(queue))
}

/** Read-only снимок очереди: legacy впереди (он старше), затем новый ключ. */
export function loadQueue(kv: KV): Action[] {
  return [...readQueueKey(kv, LEGACY_QUEUE_KEY), ...readQueueKey(kv, QUEUE_KEY)]
}

/** Дописать действие в хвост. Пишет только в новый ключ — legacy не пополняется. */
export function appendQueue(kv: KV, action: Action): void {
  writeQueueKey(kv, QUEUE_KEY, [...readQueueKey(kv, QUEUE_KEY), action])
}

/** Дренаж очереди: по одному действию, с перечитыванием KV между отправками.
 * post возвращает канонический Store или null (сервер недоступен — стоп).
 * Возвращает последний канонический store и признак «очередь пуста».
 *
 * Корректность: appendQueue только ДОПИСЫВАЕТ в хвост нового ключа (legacy
 * не пополняется никогда); параллельно работает не более одного дренажа
 * (вызывающая сторона держит флаг flushing.current) — поэтому удаление
 * головы из того же ключа, откуда её прочитали, сразу после свежего чтения
 * безопасно, даже если за время await postAction дописали новые действия. */
export async function drainQueue(
  kv: KV,
  post: (a: Action) => Promise<Store | null>,
): Promise<{ last: Store | null; drained: boolean }> {
  let last: Store | null = null
  for (;;) {
    // Свежее чтение на каждой итерации; сначала опустошаем legacy-ключ.
    const legacy = readQueueKey(kv, LEGACY_QUEUE_KEY)
    const key = legacy.length > 0 ? LEGACY_QUEUE_KEY : QUEUE_KEY
    const queue = legacy.length > 0 ? legacy : readQueueKey(kv, QUEUE_KEY)
    if (queue.length === 0) return { last, drained: true }
    const res = await post(queue[0])
    if (!res) return { last, drained: false } // сервер недоступен — очередь не трогаем
    last = res
    writeQueueKey(kv, key, readQueueKey(kv, key).slice(1)) // перечитать: за время POST могли дописать
  }
}

// Отметка последней успешной связи с сервером. Есть отметка — этот браузер бывал в
// серверном режиме, и локальный режим для него — деградация (показана копия, правки на
// сервер не попадут), а не норма, как на localhost без API.
export const SERVER_SEEN_KEY = 'stargaze.server-seen'

export function markServerSeen(kv: KV, at: string): void {
  try {
    kv.setItem(SERVER_SEEN_KEY, at)
  } catch {
    // квота/приватный режим — без отметки баннер просто не покажется
  }
}

/** ISO-время последней связи или null: не бывал на сервере, мусор в ключе, хранилище недоступно. */
export function lastServerSeen(kv: KV): string | null {
  try {
    const at = kv.getItem(SERVER_SEEN_KEY)
    return at && !Number.isNaN(Date.parse(at)) ? at : null
  } catch {
    return null
  }
}
