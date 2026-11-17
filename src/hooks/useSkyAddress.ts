import { useCallback, useEffect, useRef, useState } from 'react'
import { formatAddress, parseAddress, type SkyAddress } from '../logic/address'

/**
 * Место на небе живёт в адресе страницы (`#skill=<id>` / `#star=<id>`), отдельного состояния
 * «открытая галактика / выбранная звезда» нет: App выводит место из адреса на каждом store
 * (`resolveAddress`). Поэтому ссылку не нужно «разбирать на старте»: пока цели в store нет,
 * адрес просто лежит и ждёт — канон с сервера приезжает позже первого рендера.
 *
 * `go` — навигация изнутри: адрес меняется через `replaceState`, «Назад» шаги не копит.
 * `onExternal` — адрес сменили снаружи (правка в строке браузера, переход по ссылке в ту же
 * вкладку, агент на телевизоре): App возвращает на экран само небо.
 */
export function useSkyAddress(onExternal: () => void): [SkyAddress, (next: SkyAddress) => void] {
  const [address, setAddress] = useState<SkyAddress>(() => parseAddress(location.hash))
  const external = useRef(onExternal)
  external.current = onExternal

  useEffect(() => {
    const onHashChange = () => {
      setAddress(parseAddress(location.hash))
      external.current()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const go = useCallback((next: SkyAddress) => {
    setAddress(next)
    try {
      // Относительная ссылка: путь и query страницы остаются, пустой хэш убирает и решётку
      history.replaceState(history.state, '', formatAddress(next) || location.pathname + location.search)
    } catch {
      // Браузер отказал в записи (Safari — больше 100 replaceState за 30 с, например при
      // зажатой стрелке листания галактик): место на экране верное, отстаёт только строка адреса
    }
  }, [])

  return [address, go]
}
