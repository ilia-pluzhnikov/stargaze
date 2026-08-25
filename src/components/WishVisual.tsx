import { useState } from 'react'
import type { WishlistItem } from '../types'

// Рендерим только http(s): data:/javascript:/мусор молча падают на эмодзи.
// UI-фильтр, не гейт ядра (спека цикла 15 §4).
const isHttp = (u: string) => /^https?:\/\//i.test(u)

/** Есть ли у позиции «лицо» — от этого зависит калибр вехи на треке. */
export function hasVisual(item: WishlistItem): boolean {
  return Boolean((item.imageUrl && isHttp(item.imageUrl)) || item.emoji)
}

/** Лицо позиции: картинка → эмодзи → null; битая картинка (onError) падает на эмодзи.
 * brokenUrl хранит именно URL — правка imageUrl сбрасывает фолбэк сама собой.
 * placeholder: вместо null — пустая плашка того же калибра (витрина держит ритм
 * списка, строка без визуала не читается заголовком); трек живёт без неё. */
export function WishVisual({ item, className, placeholder }: { item: WishlistItem; className?: string; placeholder?: boolean }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const url = item.imageUrl && isHttp(item.imageUrl) && item.imageUrl !== brokenUrl ? item.imageUrl : undefined
  const cls = (base: string) => (className ? `${className} ${base}` : base)
  if (url)
    return (
      <img
        className={cls('wv-img')} src={url} alt=""
        loading="lazy" referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(url)}
      />
    )
  if (item.emoji) return <span className={cls('wv-emoji')}>{item.emoji}</span>
  return placeholder ? <span className={cls('wv-empty')} aria-hidden /> : null
}
