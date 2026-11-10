// Pure drawing-domain logic: no React, no DOM, no chart library imports.
// Drawings are stored in chart coordinates ({ time, price }) so they stay anchored when the viewport moves.

export const TOOL_POINTS = Object.freeze({ horizontal: 1, vertical: 1, trend: 2, rectangle: 2, fibonacci: 2 })
export const FIB_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1])
export const HIT_TOLERANCE = 6
const HISTORY_LIMIT = 200

export const isToolId = tool => Object.prototype.hasOwnProperty.call(TOOL_POINTS, tool)

export function isValidPoint(p) {
  return !!p && Number.isFinite(p.time) && Number.isFinite(p.price)
}

export function makePoint(time, price) {
  return isValidPoint({ time, price }) ? { time: Number(time), price: Number(price) } : null
}

export function drawingsStorageKey(panelId, symbol) {
  return `pcl-drawings:v3:${panelId}:${symbol}`
}

export function parseStoredDrawings(raw) {
  let data
  try {
    data = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out = []
  for (const d of data) {
    if (!d || typeof d.id !== 'string' || !d.id) continue
    const type = d.type === 'line' ? 'trend' : d.type === 'box' ? 'rectangle' : d.type
    if (!isToolId(type)) continue
    const a = makePoint(d.a?.time, d.a?.price)
    if (!a) continue
    if (TOOL_POINTS[type] === 1) {
      out.push({ id: d.id, type, a })
      continue
    }
    const b = makePoint(d.b?.time, d.b?.price)
    if (!b) continue
    out.push({ id: d.id, type, a, b })
  }
  return out
}

// Converts a chart pixel (and optional time from the chart's click param) into a data point.
// Returns null when the chart cannot map the position (e.g. no data, or whitespace with no time).
export function pointFromPixel(pixel, time, timeScale, series) {
  if (!pixel) return null
  const t = time ?? timeScale?.coordinateToTime?.(pixel.x)
  const price = series?.coordinateToPrice?.(pixel.y)
  return makePoint(typeof t === 'number' ? t : NaN, price)
}

// Converts a data point to pixels. Returns null when the point is not currently on screen-mappable data.
export function toPixel(point, timeScale, series) {
  if (!isValidPoint(point)) return null
  const x = timeScale?.timeToCoordinate?.(point.time)
  const y = series?.priceToCoordinate?.(point.price)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

// One click for single-point tools, two for two-point tools. Returns the next pending list and any finished drawing.
export function placePoint(tool, pending, point) {
  if (!isToolId(tool) || !point) return { pending, drawing: null }
  const need = TOOL_POINTS[tool]
  const next = [...pending, point]
  if (next.length < need) return { pending: next, drawing: null }
  const drawing = need === 1 ? { type: tool, a: next[0] } : { type: tool, a: next[0], b: next[1] }
  return { pending: [], drawing }
}

// Snapshot-based history: every change (add, delete, clear) is undoable, and redo is cleared by any new change.
export function createHistory(present = []) {
  return { past: [], present, future: [] }
}

export function commit(history, next) {
  if (next === history.present) return history
  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past,
    present: next,
    future: []
  }
}

export function undo(history) {
  if (!history.past.length) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future]
  }
}

export function redo(history) {
  if (!history.future.length) return history
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1)
  }
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// toPix maps a data point to pixels (or null). pt is a pixel point. Returns true if pt hits the drawing.
export function hitTest(drawing, pt, toPix, tol = HIT_TOLERANCE) {
  const a = toPix(drawing.a)
  if (!a) return false
  if (drawing.type === 'horizontal') return Math.abs(pt.y - a.y) <= tol
  if (drawing.type === 'vertical') return Math.abs(pt.x - a.x) <= tol
  const b = drawing.b ? toPix(drawing.b) : null
  if (!b) return false
  if (drawing.type === 'trend') return distanceToSegment(pt, a, b) <= tol
  if (drawing.type === 'rectangle') {
    const x0 = Math.min(a.x, b.x) - tol, x1 = Math.max(a.x, b.x) + tol
    const y0 = Math.min(a.y, b.y) - tol, y1 = Math.max(a.y, b.y) + tol
    return pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1
  }
  if (drawing.type === 'fibonacci') {
    return FIB_LEVELS.some(level => Math.abs(pt.y - (a.y + (b.y - a.y) * level)) <= tol)
  }
  return false
}

// Topmost drawing wins (last drawn is drawn last, so it is checked first).
export function hitTestItems(items, pt, toPix) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitTest(items[i], pt, toPix)) return items[i].id
  }
  return null
}
