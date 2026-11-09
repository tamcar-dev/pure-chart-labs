import { useEffect, useRef, useState } from 'react'

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`

export default function DrawingOverlay({ chart, series, tool, drawings, setDrawings, panelId }) {
  const [start, setStart] = useState(null)
  const [preview, setPreview] = useState(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const svgRef = useRef(null)

  useEffect(() => {
    setStart(null)
    setPreview(null)
  }, [tool, panelId])

  useEffect(() => {
    if (!svgRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(svgRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!chart || !series || !tool) return
    const pointFrom = param => {
      if (!param?.point) return null
      const time = param.time ?? chart.timeScale().coordinateToTime(param.point.x)
      const price = series.coordinateToPrice(param.point.y)
      return time == null || price == null ? null : { time, price }
    }
    const onMove = param => {
      if (!start) return
      const point = pointFrom(param)
      if (point) setPreview(point)
    }
    const onClick = param => {
      const point = pointFrom(param)
      if (!point) return
      if (!start) {
        setStart(point)
        setPreview(point)
        return
      }
      setDrawings(list => [...list, { id: makeId(), type: tool, a: start, b: point }])
      setStart(null)
      setPreview(null)
    }
    chart.subscribeCrosshairMove(onMove)
    chart.subscribeClick(onClick)
    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.unsubscribeClick(onClick)
    }
  }, [chart, series, tool, start, setDrawings])

  const coords = point => ({
    x: chart?.timeScale().timeToCoordinate(point.time),
    y: series?.priceToCoordinate(point.price),
  })
  const renderShape = (drawing, ghost = false) => {
    const a = coords(drawing.a)
    const b = drawing.b ? coords(drawing.b) : null
    if (a.x == null || a.y == null || !b || b.x == null || b.y == null) return null
    const stroke = ghost ? '#e4b84f88' : '#e4b84f'
    if (drawing.type === 'box') {
      return <rect key={drawing.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
        fill="#2eb6a3" fillOpacity=".10" stroke={stroke} strokeWidth="1.6" />
    }
    return <line key={drawing.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
      stroke={stroke} strokeWidth="1.6" />
  }
  const draft = start && preview ? { id: 'drawing-preview', type: tool, a: start, b: preview } : null

  return <svg ref={svgRef} className={`drawing-layer ${tool ? 'drawing-active' : ''}`} width="100%" height="100%" aria-hidden="true">
    {drawings.map(drawing => renderShape(drawing))}
    {draft && renderShape(draft, true)}
  </svg>
}
