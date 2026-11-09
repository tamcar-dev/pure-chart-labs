// Test stand-in for lightweight-charts. Mirrors the API surface the app uses, with linear scales.
// It is NOT the real library: it exists so the app's React + DOM interaction code can run in a browser.
export const CrosshairMode = { Normal: 0 }
export const CandlestickSeries = { type: 'Candlestick' }
const T0 = 1700000000
const state = { offset: 0 }
window.__fake = { state, charts: [] }

export function createChart(el) {
  const canvas = document.createElement('canvas')
  canvas.className = 'fake-canvas'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  el.appendChild(canvas)
  const clickHandlers = new Set(), moveHandlers = new Set(), rangeHandlers = new Set()
  const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const timeToCoordinate = t => (t - T0) / 60 - state.offset
  const coordinateToTime = x => Math.round(T0 + (x + state.offset) * 60)
  const series = {
    setData() {}, update() {},
    priceToCoordinate: p => (200 - p) * 4,
    coordinateToPrice: y => 200 - y / 4
  }
  const timeScale = {
    timeToCoordinate, coordinateToTime,
    fitContent() {},
    subscribeVisibleTimeRangeChange: f => rangeHandlers.add(f),
    unsubscribeVisibleTimeRangeChange: f => rangeHandlers.delete(f)
  }
  const onClick = e => { const point = local(e); const param = { point, time: coordinateToTime(point.x) }; clickHandlers.forEach(h => h(param)) }
  const onMove = e => { const point = local(e); moveHandlers.forEach(h => h({ point, time: coordinateToTime(point.x) })) }
  const onLeave = () => moveHandlers.forEach(h => h({ point: undefined }))
  el.addEventListener('click', onClick)
  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  const chart = {
    addSeries: () => series,
    timeScale: () => timeScale,
    subscribeClick: f => clickHandlers.add(f),
    unsubscribeClick: f => clickHandlers.delete(f),
    subscribeCrosshairMove: f => moveHandlers.add(f),
    unsubscribeCrosshairMove: f => moveHandlers.delete(f),
    remove() {
      el.removeEventListener('click', onClick); el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave); canvas.remove()
    }
  }
  // Test hook: simulate the user scrolling the time axis by dx pixels.
  window.__fake.pan = dx => { state.offset += dx; rangeHandlers.forEach(h => h()) }
  window.__fake.charts.push(chart)
  return chart
}
