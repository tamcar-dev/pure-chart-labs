from pathlib import Path

src = Path('/tmp/base44-live.html').read_text()

def replace_once(old: str, new: str, label: str):
    global src
    count = src.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    src = src.replace(old, new, 1)

replace_once(
"""const m = String(str || '').trim().match(/^(\\d+(?:\\.\\d+)?)\\s*(s|m|h|d|w|mo)$/i);\n  if (!m) return null;\n  const n = parseFloat(m[1]);\n  const unit = m[2].toLowerCase();\n  if (!isFinite(n) || n <= 0) return null;\n  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 7 * 86400000, mo: 30 * 86400000 }[unit];\n  const ms = Math.round(n * mult);\n  if (!isFinite(ms) || ms < 5000 || ms > 366 * 86400000) return null;\n  const canon = { s: 's', m: 'm', h: 'H', d: 'D', w: 'W', mo: 'M' }[unit];\n""",
"""const m = String(str || '').trim().match(/^(\\d+(?:\\.\\d+)?)\\s*(mo|MO|Mo|mO|s|S|m|M|h|H|d|D|w|W)$/);\n  if (!m) return null;\n  const n = parseFloat(m[1]);\n  const rawUnit = m[2];\n  const isMonth = rawUnit === 'M' || rawUnit.toLowerCase() === 'mo';\n  const unit = isMonth ? 'mo' : rawUnit.toLowerCase();\n  if (!isFinite(n) || n <= 0) return null;\n  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 7 * 86400000, mo: 30 * 86400000 }[unit];\n  const ms = Math.round(n * mult);\n  if (!isFinite(ms) || ms < 5000 || ms > 366 * 86400000) return null;\n  const canon = { s: 's', m: 'm', h: 'H', d: 'D', w: 'W', mo: 'M' }[unit];\n""",
'month parser')

replace_once(
"""function sourceForTarget(targetLabel) {
  if (NATIVE_GRANULARITY[targetLabel] != null) {
    return { granularity: NATIVE_GRANULARITY[targetLabel], native: true, sourceLabel: targetLabel, construction: 'DERIV NATIVE' };
  }
  if (targetLabel === '6H')  return { granularity: 7200,  native: false, sourceLabel: '2H', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '8H')  return { granularity: 7200,  native: false, sourceLabel: '2H', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '12H') return { granularity: 14400, native: false, sourceLabel: '4H', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '1.75D') return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '3D')  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '5D')  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '7D')  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '1W')  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  if (targetLabel === '1M')  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'PURECHART AGGREGATED' };
  return { granularity: 60, native: true, sourceLabel: '1m', construction: 'DERIV NATIVE' };
}
""",
"""function sourceForTarget(targetLabel) {
  const tf = getTimeframe(targetLabel);
  const ms = tf.ms;
  // Fetch hints never override the persistent cache. HistStore.layerFor()
  // selects the best populated lower layer and supports non-divisor intervals.
  if (ms < 60000) return { granularity: 60, native: true, sourceLabel: '1m', construction: 'CACHED/TICK FALLBACK' };
  if (ms < 3600000) return { granularity: 60, native: true, sourceLabel: '1m', construction: 'CACHED LOCAL AGGREGATION' };
  if (ms < 86400000) return { granularity: 3600, native: false, sourceLabel: '1H', construction: 'CACHED LOCAL AGGREGATION' };
  return { granularity: 86400, native: false, sourceLabel: '1D', construction: 'CACHED LOCAL AGGREGATION' };
}
""",
'cache-aware source hint')

replace_once(
"""const HIST_LAYER_CAP = 6000;   // max candles per layer (oldest dropped)
const HIST_TICK_CAP = 4000;    // max cached ticks (sub-minute timeframes)
""",
"""const HIST_LAYER_CAP = 12000;  // lower-timeframe cache retained for local aggregation
const HIST_TICK_CAP = 4000;    // max cached ticks (sub-minute timeframes)
""",
'history cache capacity')

replace_once(
"""  // Pick the source layer for a target timeframe: the finest layer whose
  // granularity divides the target AND whose coverage yields ≥100 bars;
  // otherwise the coarsest valid layer (which maximises bar depth).
  layerFor(tf) {
    const ms = tf.ms;
    if (ms < 60000) return { name: 'ticks', gran: Math.max(1, Math.round(ms / 1000)) };
    const cands = [['m1', 60000], ['h1', 3600000], ['d1', 86400000]]
      .filter(([, g]) => ms >= g && ms % g === 0);
    if (!cands.length) return { name: 'ticks', gran: Math.max(1, Math.round(ms / 1000)) };
    let pick = cands[cands.length - 1];
    for (const cand of cands) {
      const arr = this[cand[0]];
      if (arr.length > 2) {
        const span = arr[arr.length - 1].timestamp - arr[0].timestamp;
        if (span / ms >= 100) { pick = cand; break; }
      }
    }
    return { name: pick[0], gran: pick[1] };
  }
""",
"""  // Pick a populated cached layer that is not coarser than the target.
  // Exact divisibility is intentionally not required: custom 1.75D (42h)
  // aggregates from cached daily candles instead of falling back to ticks.
  layerFor(tf) {
    const ms = tf.ms;
    if (ms < 60000) return { name: 'ticks', gran: Math.max(1, Math.round(ms / 1000)) };
    const cands = [['m1', 60000], ['h1', 3600000], ['d1', 86400000]]
      .filter(([, g]) => ms >= g)
      .filter(([name]) => this[name].length > 2);
    if (!cands.length) return { name: 'ticks', gran: Math.max(1, Math.round(ms / 1000)) };
    let pick = cands[cands.length - 1];
    for (const cand of cands) {
      const arr = this[cand[0]];
      const span = arr[arr.length - 1].timestamp - arr[0].timestamp;
      if (span / ms >= 100) { pick = cand; break; }
    }
    return { name: pick[0], gran: pick[1] };
  }
""",
'local source layer selection')

replace_once(
"""fetchLayer(code, 60, 3, sock),
      fetchLayer(code, 3600, 3, sock),
      fetchLayer(code, 86400, 2, sock),
""",
"""fetchLayer(code, 60, 10, sock),
      fetchLayer(code, 3600, 8, sock),
      fetchLayer(code, 86400, 4, sock),
""",
'deeper initial cache fill')

replace_once(
"""  { id: 'trendline',  label: 'Trend Line',            points: 2, hint: 'Click or drag two points' },\n  { id: 'horizontal', label: 'Horizontal Line',       points: 1, hint: 'Click to place at a price' },\n  { id: 'fibonacci',  label: 'Fibonacci Retracement', points: 2, hint: 'Drag between swing points' },\n""",
"""  { id: 'trendline',    label: 'Trend Line',            points: 2, hint: 'Click or drag two points' },\n  { id: 'vertical',     label: 'Vertical Line',         points: 1, hint: 'Click to place at a time' },\n  { id: 'horizontal',   label: 'Horizontal Line',       points: 1, hint: 'Click to place at a price' },\n  { id: 'fibonacci',    label: 'Fibonacci Retracement', points: 2, hint: 'Drag between swing points' },\n  { id: 'long_position', label: 'Long Position',        points: 3, hint: 'Entry, stop, target' },\n  { id: 'short_position',label: 'Short Position',       points: 3, hint: 'Entry, stop, target' },\n""",
'drawing tools')

replace_once(
"""  minus: '<path d=\"M5 12h14\"/>',\n  rows: '<path d=\"M4 5h16\"/><path d=\"M4 12h16\"/><path d=\"M4 19h16\"/>',\n""",
"""  minus: '<path d=\"M5 12h14\"/>',\n  vertical: '<path d=\"M12 3v18\"/>',\n  rows: '<path d=\"M4 5h16\"/><path d=\"M4 12h16\"/><path d=\"M4 19h16\"/>',\n  position: '<path d=\"m5 19 14-14\"/><path d=\"M13 5h6v6\"/>',\n""",
'icons')

replace_once(
"""    for (const d of drawings) {\n      if (d.hidden || d.type === 'horizontal') continue;\n      if (d.type === 'text') {\n""",
"""    for (const d of drawings) {\n      if (d.hidden || d.type === 'horizontal') continue;\n      if (d.type === 'vertical') {\n        const pt = (d.points || [])[0];\n        if (!pt) continue;\n        const x = this.xOfTimestamp(pt.timestamp);\n        if (Math.abs(mx - x) <= 9 && my >= 0 && my <= this.area().timeY) return d.id;\n        continue;\n      }\n      if (d.type === 'text') {\n""",
'vertical body hit test')

replace_once(
"""    if (pts <= 1) {\n      this.cb.onAddDrawing && this.cb.onAddDrawing(createDrawing(tool, [{ timestamp: ts, price }]));\n      this.drawInProgress = null;\n      this.drawDrag = null;\n    } else if (this.drawInProgress) {\n""",
"""    if (tool === 'long_position' || tool === 'short_position') {\n      if (!this.drawInProgress) {\n        this.drawInProgress = createDrawing(tool, [{ timestamp: ts, price }]);\n        this.drawDrag = null;\n      } else {\n        this.drawInProgress.points.push({ timestamp: ts, price });\n        if (this.drawInProgress.points.length >= pts) {\n          this.cb.onAddDrawing && this.cb.onAddDrawing(this.drawInProgress);\n          this.drawInProgress = null;\n        }\n      }\n    } else if (pts <= 1) {\n      this.cb.onAddDrawing && this.cb.onAddDrawing(createDrawing(tool, [{ timestamp: ts, price }]));\n      this.drawInProgress = null;\n      this.drawDrag = null;\n    } else if (this.drawInProgress) {\n""",
'risk reward placement')

replace_once(
"""    } else if (this.drawInProgress) {\n      const snapped = this.pointAt(mx, my);\n      if (snapped) {\n        this.drawInProgress.points[1] = snapped;\n      }\n      if (\n""",
"""    } else if (this.drawInProgress && this.drawInProgress.points.length >= 2) {\n      const snapped = this.pointAt(mx, my);\n      if (snapped) {\n        this.drawInProgress.points[this.drawInProgress.points.length - 1] = snapped;\n      }\n      if (\n""",
'preview update')

replace_once(
"""    if (d.type === 'horizontal' && pts[0]) {\n      const y = this.yOfPrice(pts[0].price, hi, lo);\n""",
"""    if (d.type === 'vertical' && pts[0]) {\n      const x = this.xOfTimestamp(pts[0].timestamp);\n      if (x < a.x || x > a.w) return;\n      ctx.beginPath();\n      ctx.moveTo(x + 0.5, a.y);\n      ctx.lineTo(x + 0.5, a.timeY);\n      ctx.stroke();\n      return;\n    }\n    if (d.type === 'horizontal') {\n      const y = this.yOfPrice(pts[0].price, hi, lo);\n""",
'vertical render')

replace_once(
"""    if (pts.length < 2) return;\n    const x1 = this.xOfTimestamp(pts[0].timestamp);\n""",
"""    if ((d.type === 'long_position' || d.type === 'short_position') && pts.length >= 3) {\n      const x1 = this.xOfTimestamp(pts[0].timestamp);\n      const x2 = this.xOfTimestamp(pts[2].timestamp);\n      const yEntry = this.yOfPrice(pts[0].price, hi, lo);\n      const yStop = this.yOfPrice(pts[1].price, hi, lo);\n      const yTarget = this.yOfPrice(pts[2].price, hi, lo);\n      const left = Math.min(x1, x2), right = Math.max(x1, x2);\n      const riskTop = Math.min(yEntry, yStop), riskBottom = Math.max(yEntry, yStop);\n      const rewardTop = Math.min(yEntry, yTarget), rewardBottom = Math.max(yEntry, yTarget);\n      ctx.save();\n      ctx.globalAlpha = 0.20; ctx.fillStyle = '#ef5350'; ctx.fillRect(left, riskTop, right - left, riskBottom - riskTop);\n      ctx.globalAlpha = 0.20; ctx.fillStyle = '#26a69a'; ctx.fillRect(left, rewardTop, right - left, rewardBottom - rewardTop);\n      ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.setLineDash([5, 4]);\n      ctx.beginPath(); ctx.moveTo(left, yEntry); ctx.lineTo(right, yEntry); ctx.stroke();\n      ctx.setLineDash(dashPatternFor(d));\n      ctx.restore();\n      const risk = Math.abs(pts[0].price - pts[1].price);\n      const reward = Math.abs(pts[2].price - pts[0].price);\n      const rr = risk > 0 ? reward / risk : 0;\n      ctx.fillStyle = color; ctx.font = '10px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';\n      ctx.fillText(`${d.type === 'long_position' ? 'Long' : 'Short'} · R:R ${rr.toFixed(2)}`, left + 4, Math.max(12, Math.min(a.timeY - 4, Math.min(rewardTop, riskTop) - 3)));\n      return;\n    }\n    if (pts.length < 2) return;\n    const x1 = this.xOfTimestamp(pts[0].timestamp);\n""",
'risk reward render')

replace_once(
"""    { trendline: 'slash', horizontal: 'minus', fibonacci: 'rows', rectangle: 'square' }[t.id],\n""",
"""    { trendline: 'slash', vertical: 'vertical', horizontal: 'minus', fibonacci: 'rows', long_position: 'position', short_position: 'position', rectangle: 'square' }[t.id],\n""",
'left toolbar icons')

replace_once(
"""const TYPE_LABEL = { trendline: 'Trend Line', horizontal: 'Horizontal', fibonacci: 'Fibonacci', rectangle: 'Rectangle', text: 'Text' };\nconst TYPE_ICON = { trendline: 'slash', horizontal: 'minus', fibonacci: 'rows', rectangle: 'square', text: 'pencil' };\n""",
"""const TYPE_LABEL = { trendline: 'Trend Line', vertical: 'Vertical Line', horizontal: 'Horizontal', fibonacci: 'Fibonacci', long_position: 'Long Position', short_position: 'Short Position', rectangle: 'Rectangle', text: 'Text' };\nconst TYPE_ICON = { trendline: 'slash', vertical: 'vertical', horizontal: 'minus', fibonacci: 'rows', long_position: 'position', short_position: 'position', rectangle: 'square', text: 'pencil' };\n""",
'drawing manager labels')

out = Path('/home/ubuntu/pure-chart-labs/base44-repair-patched.html')
out.write_text(src)
print(out)
print('bytes', out.stat().st_size)
