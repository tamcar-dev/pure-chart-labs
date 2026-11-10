import test from 'node:test'
import assert from 'node:assert/strict'
import {
  placePoint, createHistory, commit, undo, redo, parseStoredDrawings, pointFromPixel, toPixel,
  hitTest, hitTestItems, drawingsStorageKey, makePoint
} from '../src/drawings.js'

// Linear fake scales: 1 px = 10 seconds on x, 1 px = 0.25 price units on y (price falls as y grows).
const T0 = 1000
const timeScale = {
  timeToCoordinate: t => (t - T0) / 10,
  coordinateToTime: x => T0 + x * 10,
}
const series = {
  priceToCoordinate: p => (200 - p) * 4,
  coordinateToPrice: y => 200 - y / 4,
}
const toPix = p => toPixel(p, timeScale, series)

test('coordinate conversion round-trips and is consistent', () => {
  const px = { x: 120, y: 80 }
  const point = pointFromPixel(px, undefined, timeScale, series)
  assert.deepEqual(point, { time: 2200, price: 180 })
  assert.deepEqual(toPix(point), px)
})

test('explicit click time overrides coordinate lookup', () => {
  assert.deepEqual(pointFromPixel({ x: 0, y: 0 }, 1500, timeScale, series), { time: 1500, price: 200 })
})

test('coordinate conversion returns null instead of throwing for missing data', () => {
  assert.equal(pointFromPixel({ x: 1, y: 1 }, undefined, { coordinateToTime: () => null }, series), null)
  assert.equal(pointFromPixel({ x: 1, y: 1 }, undefined, timeScale, { coordinateToPrice: () => null }), null)
  assert.equal(pointFromPixel(null, undefined, timeScale, series), null)
  assert.equal(pointFromPixel({ x: 1, y: 1 }, undefined, timeScale, { coordinateToPrice: () => NaN }), null)
  assert.equal(toPixel({ time: 1000, price: 1 }, { timeToCoordinate: () => null }, series), null)
  assert.equal(toPixel({ time: 'x', price: 1 }, timeScale, series), null)
  assert.equal(toPixel(undefined, timeScale, series), null)
})

test('anchors survive a viewport shift: data stays put, pixels move', () => {
  const drawing = { a: { time: 1500, price: 150 }, b: { time: 1800, price: 170 } }
  const before = toPix(drawing.a)
  const shiftedScale = { timeToCoordinate: t => (t - T0) / 10 - 50 }   // user scrolled 50px
  const after = toPixel(drawing.a, shiftedScale, series)
  assert.equal(after.x, before.x - 50)
  assert.equal(after.y, before.y)
  assert.deepEqual(drawing.a, { time: 1500, price: 150 })              // model untouched
})

test('placePoint: single-click tools finish immediately', () => {
  const r = placePoint('horizontal', [], { time: 1, price: 2 })
  assert.deepEqual(r.pending, [])
  assert.deepEqual(r.drawing, { type: 'horizontal', a: { time: 1, price: 2 } })
})

test('placePoint: two-point tools need two clicks and keep pending in between', () => {
  const first = placePoint('trend', [], { time: 1, price: 2 })
  assert.equal(first.drawing, null)
  assert.equal(first.pending.length, 1)
  const second = placePoint('trend', first.pending, { time: 3, price: 4 })
  assert.deepEqual(second.drawing, { type: 'trend', a: { time: 1, price: 2 }, b: { time: 3, price: 4 } })
  assert.deepEqual(second.pending, [])
})

test('placePoint ignores unknown tools, prototype keys and null points', () => {
  assert.equal(placePoint('nope', [], { time: 1, price: 1 }).drawing, null)
  assert.equal(placePoint('constructor', [], { time: 1, price: 1 }).drawing, null)
  assert.equal(placePoint('trend', [], null).drawing, null)
})

test('history: add, undo, redo, and a new change clears redo', () => {
  let h = createHistory()
  h = commit(h, [{ id: 'a' }])
  h = commit(h, [{ id: 'a' }, { id: 'b' }])
  assert.equal(h.present.length, 2)
  h = undo(h)
  assert.deepEqual(h.present, [{ id: 'a' }])
  h = redo(h)
  assert.equal(h.present.length, 2)
  h = undo(h)
  h = commit(h, [{ id: 'z' }])
  assert.equal(h.future.length, 0)
  assert.equal(redo(h), h)
})

test('history: deletions are undoable too, and undo on empty history is a no-op', () => {
  let h = createHistory([{ id: 'a' }, { id: 'b' }])
  h = commit(h, [{ id: 'b' }])
  h = undo(h)
  assert.deepEqual(h.present.map(d => d.id), ['a', 'b'])
  assert.equal(undo(createHistory()).present.length, 0)
})

test('history: commit with identical array is ignored', () => {
  const items = [{ id: 'a' }]
  const h = createHistory(items)
  assert.equal(commit(h, items), h)
})

test('parseStoredDrawings keeps valid entries and drops corrupt ones', () => {
  const raw = JSON.stringify([
    { id: '1', type: 'trend', a: { time: 1, price: 2 }, b: { time: 3, price: 4 } },
    { id: '2', type: 'horizontal', a: { time: 1, price: 2 } },
    { id: '3', type: 'trend', a: { time: 1, price: 2 } },              // missing b
    { id: '4', type: 'constructor', a: { time: 1, price: 2 } },        // prototype key
    { id: '', type: 'horizontal', a: { time: 1, price: 2 } },          // empty id
    { id: '5', type: 'vertical', a: { time: 'NaN', price: 2 } },       // non-numeric
    null
  ])
  const out = parseStoredDrawings(raw)
  assert.deepEqual(out.map(d => d.id), ['1', '2'])
  assert.equal(out[1].b, undefined)
})

test('parseStoredDrawings tolerates invalid JSON, non-arrays and null', () => {
  assert.deepEqual(parseStoredDrawings('{not json'), [])
  assert.deepEqual(parseStoredDrawings('{"a":1}'), [])
  assert.deepEqual(parseStoredDrawings(null), [])
})

test('parseStoredDrawings migrates the earlier Line and Box names', () => {
  const raw = JSON.stringify([
    { id: 'line-1', type: 'line', a: { time: 1, price: 2 }, b: { time: 3, price: 4 } },
    { id: 'box-1', type: 'box', a: { time: 5, price: 6 }, b: { time: 7, price: 8 } }
  ])
  assert.deepEqual(parseStoredDrawings(raw).map(d => d.type), ['trend', 'rectangle'])
})

test('drawings storage key is shared across timeframes but isolated by panel and market', () => {
  const a = drawingsStorageKey('p1', 'R_75', 900)
  assert.equal(a, drawingsStorageKey('p1', 'R_75', 60))
  assert.notEqual(a, drawingsStorageKey('p1', 'R_10', 900))
  assert.notEqual(a, drawingsStorageKey('p2', 'R_75', 900))
})

test('hit testing: horizontal and vertical lines within tolerance', () => {
  const h = { type: 'horizontal', a: { time: 1500, price: 150 } }
  const v = { type: 'vertical', a: { time: 1500, price: 150 } }
  const at = toPix(h.a)
  assert.equal(hitTest(h, { x: 999, y: at.y + 3 }, toPix), true)
  assert.equal(hitTest(h, { x: at.x, y: at.y + 30 }, toPix), false)
  assert.equal(hitTest(v, { x: at.x - 2, y: 999 }, toPix), true)
  assert.equal(hitTest(v, { x: at.x + 30, y: 0 }, toPix), false)
})

test('hit testing: trend line uses distance to the segment, not the bounding box', () => {
  const d = { type: 'trend', a: { time: 1000, price: 200 }, b: { time: 2000, price: 100 } }
  const a = toPix(d.a), b = toPix(d.b)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  assert.equal(hitTest(d, mid, toPix), true)
  assert.equal(hitTest(d, { x: mid.x + 20, y: mid.y - 20 }, toPix), false) // inside the box, far from the line
})

test('hit testing: rectangle counts interior and edges, fibonacci hits a level line', () => {
  const rect = { type: 'rectangle', a: { time: 1000, price: 200 }, b: { time: 2000, price: 100 } }
  const a = toPix(rect.a), b = toPix(rect.b)
  assert.equal(hitTest(rect, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, toPix), true)
  assert.equal(hitTest(rect, { x: b.x + 100, y: b.y }, toPix), false)

  const fib = { type: 'fibonacci', a: { time: 1000, price: 200 }, b: { time: 2000, price: 100 } }
  const y50 = a.y + (b.y - a.y) * 0.5
  assert.equal(hitTest(fib, { x: 5, y: y50 + 2 }, toPix), true)
  assert.equal(hitTest(fib, { x: 5, y: y50 + 15 }, toPix), false)
})

test('hit testing returns null for drawings that cannot be mapped to pixels', () => {
  const unmappable = { type: 'trend', a: { time: 1, price: 1 }, b: { time: 2, price: 2 } }
  assert.equal(hitTest(unmappable, { x: 0, y: 0 }, () => null), false)
})

test('hitTestItems returns the topmost (last drawn) match, or null', () => {
  const items = [
    { id: 'bottom', type: 'horizontal', a: { time: 1500, price: 150 } },
    { id: 'top', type: 'horizontal', a: { time: 1500, price: 150 } }
  ]
  const y = toPix(items[0].a).y
  assert.equal(hitTestItems(items, { x: 0, y }, toPix), 'top')
  assert.equal(hitTestItems(items, { x: 0, y: y + 500 }, toPix), null)
})

test('makePoint rejects non-finite values', () => {
  assert.equal(makePoint(NaN, 1), null)
  assert.equal(makePoint(1, Infinity), null)
  assert.equal(makePoint('5', '6'), null) // strict: stored values must already be numbers
  assert.deepEqual(makePoint(5, 6), { time: 5, price: 6 })
})
