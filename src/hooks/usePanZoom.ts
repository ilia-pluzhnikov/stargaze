import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

// Свободная навигация по небу: зум колесом к курсору + пан драгом.
// Раскладка не трогается — меняется только viewBox (спека Небо-2 §11).

const MAX_ZOOM_IN = 5 // во сколько раз можно приблизить относительно полного вида
const MAX_ZOOM_OUT = 0.55 // насколько можно отдалить (мир занимает 55% ширины кадра)
const CLICK_TOLERANCE_PX = 5 // сдвиг меньше этого — клик, а не драг

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PanZoom {
  svgRef: React.RefObject<SVGSVGElement | null>
  viewBox: string
  isMoved: boolean
  isPanning: boolean
  reset: () => void
  handlers: {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void
    onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => void
    onClickCapture: (e: React.MouseEvent<SVGSVGElement>) => void
  }
}

export function usePanZoom(worldW: number, worldH: number): PanZoom {
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: worldW, h: worldH })
  const [isPanning, setIsPanning] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: number; cx: number; cy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  // Центр кадра не выпускаем за границы мира — небо нельзя утащить в пустоту насовсем.
  const clampView = useCallback(
    (x: number, y: number, w: number, h: number): ViewBox => ({
      x: Math.min(Math.max(x, -w / 2), worldW - w / 2),
      y: Math.min(Math.max(y, -h / 2), worldH - h / 2),
      w,
      h,
    }),
    [worldW, worldH],
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Нативный слушатель: React вешает onWheel пассивно, preventDefault там не работает.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const m = svg.getScreenCTM()
      if (!m) return
      const cursor = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // Firefox шлёт строки, не пиксели
      const factor = Math.exp(dy * 0.0016)
      setVb((v) => {
        const w = Math.min(Math.max(v.w * factor, worldW / MAX_ZOOM_IN), worldW / MAX_ZOOM_OUT)
        const k = w / v.w
        if (k === 1) return v
        // Точка под курсором остаётся на месте
        return clampView(cursor.x - (cursor.x - v.x) * k, cursor.y - (cursor.y - v.y) * k, w, v.h * k)
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [worldW, clampView])

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    drag.current = { id: e.pointerId, cx: e.clientX, cy: e.clientY, moved: false }
    // Захват указателя НЕ ставим здесь: на <svg> он уводит target последующего
    // click на сам svg, и onClick дочерних <g> (звёзды, галактики) не срабатывает —
    // клик по небу «проглатывается». Ставим захват в onPointerMove, когда
    // начался настоящий драг (moved ⇒ клик и так подавляется).
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.cx
      const dy = e.clientY - d.cy
      if (!d.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE_PX) return
      if (!d.moved) {
        d.moved = true
        // Драг начался — теперь захват безопасен (клик уже подавлен) и нужен,
        // чтобы пан не прерывался, если курсор ушёл за край svg.
        e.currentTarget.setPointerCapture(d.id)
        setIsPanning(true)
      }
      d.cx = e.clientX
      d.cy = e.clientY
      const m = svgRef.current?.getScreenCTM()
      if (!m) return
      setVb((v) => clampView(v.x - dx / m.a, v.y - dy / m.d, v.w, v.h))
    },
    [clampView],
  )

  const endDrag = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return
    suppressClick.current = drag.current.moved
    drag.current = null
    setIsPanning(false)
  }, [])

  // После драга click всё равно прилетает — гасим его, чтобы не открыть галактику/звезду случайно.
  const onClickCapture = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.stopPropagation()
    e.preventDefault()
  }, [])

  const isMoved = vb.x !== 0 || vb.y !== 0 || vb.w !== worldW
  const reset = useCallback(() => setVb({ x: 0, y: 0, w: worldW, h: worldH }), [worldW, worldH])

  return {
    svgRef,
    viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
    isMoved,
    isPanning,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture },
  }
}
