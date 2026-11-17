import type { Skill, StarComponent, Store } from '../types'

/**
 * Адрес места на небе — то, что веб держит в хэше страницы:
 * `#skill=<id>` — галактика, `#star=<id>` — звезда (её галактика подразумевается),
 * пустой — общее небо. Формат — публичный контракт для внешних страниц (API.md,
 * «Адреса веба»): менять только совместимо.
 *
 * Модуль чистый: строку хэша ему передают, `location` он не знает.
 */
export interface SkyAddress {
  star?: string
  skill?: string
}

/** Куда адрес привёл на конкретном store. `skill: null` — общее небо. */
export interface SkyPlace {
  skill: Skill | null
  /** Выбранная звезда; всегда из галактики `skill`. */
  star: StarComponent | null
}

const decode = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null // оборванный %-код: ключ считаем отсутствующим, остальные живут
  }
}

/**
 * Разбор хэша (`location.hash`, решётка необязательна). Не бросает: чужая ссылка — чужие
 * данные. Незнакомые ключи пропускаются — формат можно расширять, не ломая старые вкладки;
 * пустое и нечитаемое значение — как отсутствие ключа; при повторе ключа берётся первое годное.
 */
export function parseAddress(hash: string): SkyAddress {
  const address: SkyAddress = {}
  for (const pair of hash.replace(/^#/, '').split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const key = pair.slice(0, eq)
    if (key !== 'star' && key !== 'skill') continue
    if (address[key] !== undefined) continue
    const value = decode(pair.slice(eq + 1))
    if (value) address[key] = value
  }
  return address
}

/** Хэш для адреса, с решёткой; общее небо — пустая строка. Обратна `parseAddress`. */
export function formatAddress(address: SkyAddress): string {
  const pairs: string[] = []
  if (address.star) pairs.push(`star=${encodeURIComponent(address.star)}`)
  if (address.skill) pairs.push(`skill=${encodeURIComponent(address.skill)}`)
  return pairs.length ? `#${pairs.join('&')}` : ''
}

/**
 * Адрес звезды, каким его пишет сам веб: вместе с её галактикой. Звезду может удалить другой
 * клиент (агент через API) — тогда запасной `skill` оставляет экран в галактике, а не уводит
 * на общее небо.
 */
export function starAddress(star: Pick<StarComponent, 'id' | 'skillId'>): SkyAddress {
  return { star: star.id, skill: star.skillId }
}

/**
 * Куда ведёт адрес на этом store. Цели нет — общее небо, без ошибки: id не найден, навык
 * в архиве, звезда архивного навыка. Заданы оба ключа — выигрывает `star`, `skill` —
 * запасной: срабатывает, когда звезда не открылась.
 *
 * Разрешать на каждом store заново, а не один раз при загрузке: первый рендер идёт по копии
 * из браузера или по сиду, канон приезжает позже — цель ссылки может появиться в store
 * только тогда. Адрес — намерение, которое живёт, пока его не сменят.
 */
export function resolveAddress(store: Pick<Store, 'skills' | 'stars'>, address: SkyAddress): SkyPlace {
  const openSkill = (id: string) => store.skills.find((s) => s.id === id && !s.archived) ?? null
  if (address.star) {
    const star = store.stars.find((s) => s.id === address.star)
    const skill = star ? openSkill(star.skillId) : null
    if (star && skill) return { skill, star }
  }
  return { skill: address.skill ? openSkill(address.skill) : null, star: null }
}
