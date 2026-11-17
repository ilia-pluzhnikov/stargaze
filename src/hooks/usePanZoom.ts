import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { gestureView, moveView } from '../logic/panZoom'
import type { Frame, Point, ViewBox } from '../logic/panZoom'

// Свободная навигация по небу: зум колесом к курсору или щипком двумя пальцами, пан драгом.
// Раскладка не трогается — меняется только viewBox (спека Небо-2 §11). Геометрия — logic/panZoom.

const CLICK_TOLERANCE_PX = 5 // сдвиг меньше этого — клик, а не драг
const MAX_POINTERS = 2 // третий палец в жесте не участвует

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

/** Экранный прямоугольник, в который вписан viewBox. Матрица и viewBox читаются из DOM одного
 *  кадра, а сама рамка от зума и пана не зависит — поэтому она годится и для состояния, которое
 *  ещё не отрисовано (два пальца шлют по событию каждый, до перерисовки их приходит несколько). */
function frameOf(svg: SVGSVGElement): Frame | null {
  const m = svg.getScreenCTM()
  if (!m) return null
  const box = svg.viewBox.baseVal
  const frame = { left: m.e + box.x * m.a, top: m.f + box.y * m.d, width: box.width * m.a, height: box.height * m.d }
  return frame.width > 0 && frame.height > 0 ? frame : null
}

export function usePanZoom(worldW: number, worldH: number): PanZoom {
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: worldW, h: worldH })
  const [isPanning, setIsPanning] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const world = useMemo(() => ({ w: worldW, h: worldH }), [worldW, worldH])
  const pointers = useRef(new Map<number, Point>()) // указатели, прижатые к небу, в экранных координатах
  const moved = useRef(false) // жест перестал быть кликом: сдвиг дальше допуска или второй палец
  const suppressClick = useRef(false)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Нативный слушатель: React вешает onWheel пассивно, preventDefault там не работает.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const frame = frameOf(svg)
      if (!frame) return
      const cursor = { x: e.clientX, y: e.clientY }
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // Firefox шлёт строки, не пиксели
      setVb((v) => moveView(v, frame, world, cursor, cursor, Math.exp(dy * 0.0016)))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [world])

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const held = pointers.current
    // Первый указатель нового касания: всё, что осталось в карте, — пальцы, чей pointerup до нас
    // не дошёл (элемент под ними перерисовался). И click прошлого жеста уже либо пришёл, либо
    // его не будет: тач после длинного драга click не шлёт, флаг съел бы следующий тап.
    if (e.isPrimary) {
      held.clear()
      moved.current = false
      suppressClick.current = false
    }
    if (held.size >= MAX_POINTERS) return
    held.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Захват указателя НЕ ставим здесь: на <svg> он уводит target последующего
    // click на сам svg, и onClick дочерних <g> (звёзды, галактики) не срабатывает —
    // клик по небу «проглатывается». Ставим захват в onPointerMove, когда
    // начался настоящий жест (moved ⇒ клик и так подавляется).
    if (held.size === MAX_POINTERS) {
      moved.current = true // два пальца — уже щипок, а не тап
      setIsPanning(true)
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const held = pointers.current
      const prev = held.get(e.pointerId)
      if (!prev) return
      const now = { x: e.clientX, y: e.clientY }
      if (!moved.current) {
        if (Math.hypot(now.x - prev.x, now.y - prev.y) < CLICK_TOLERANCE_PX) return
        moved.current = true
        setIsPanning(true)
      }
      // Жест начался — теперь захват безопасен (клик уже подавлен) и нужен,
      // чтобы пан не прерывался, если указатель ушёл за край svg.
      const svg = e.currentTarget
      if (!svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId)
      const before = [...held.values()]
      held.set(e.pointerId, now)
      const after = [...held.values()]
      const frame = frameOf(svg)
      if (!frame) return
      setVb((v) => gestureView(v, frame, world, before, after))
    },
    [world],
  )

  const endPointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const held = pointers.current
    if (!held.delete(e.pointerId)) return
    if (held.size > 0) return // щипок кончился, оставшийся палец продолжает таскать небо
    suppressClick.current = moved.current
    moved.current = false
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
    handlers: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onClickCapture },
  }
}
