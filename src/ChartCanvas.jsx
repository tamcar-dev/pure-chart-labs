import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { getTimeframe } from './chartSupport/timeframe.js';
import { formatPrice, formatTimestamp, formatTimeScale, guessDecimals } from './chartSupport/format.js';
import { DRAW_TOOLS, FIB_LEVELS, DEFAULT_DRAW_COLOR, createDrawing } from './chartSupport/drawings.js';

const MIN_PRICE_SCALE = 48;
const MAX_PRICE_SCALE = 140;
const MIN_TIME_SCALE = 24;
const MAX_TIME_SCALE = 44;
const MIN_BAR_WIDTH = 1.5;
const MAX_BAR_WIDTH = 96;

function niceStep(range, targetLines) {
  if (range <= 0) return 1;
  const raw = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

const ChartCanvas = forwardRef(function ChartCanvas(
  { candles, theme, symbol, timeframeLabel, decimals, gridVisible, formingIndex, emptyMessage, activeTool, drawings, onAddDrawing, onRemoveLastDrawing, onDeleteDrawing, onUndoDrawing, onRedoDrawing, onBeginDrawingEdit, onEndDrawingEdit, onUpdateDrawing, onMoveDrawing, onUpdateDrawingEdge, selectedId, onSelectDrawing },
  ref
) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const viewRef = useRef({ barWidth: 8, rightIndex: 0, priceShift: 0, priceZoom: 1 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const crossRef = useRef(null);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const pointersRef = useRef(new Map());
  const rafRef = useRef(0);
  const scaleRef = useRef({ priceWidth: 72, timeHeight: 28 });

  // Refs that always hold the latest props so native listeners stay fresh.
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const tfLabelRef = useRef(timeframeLabel);
  tfLabelRef.current = timeframeLabel;
  const decimalsRef = useRef(decimals);
  decimalsRef.current = decimals;
  const gridRef = useRef(gridVisible);
  gridRef.current = gridVisible;
  const formingRef = useRef(formingIndex);
  formingRef.current = formingIndex;
  const emptyMsgRef = useRef(emptyMessage);
  emptyMsgRef.current = emptyMessage;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const onAddDrawingRef = useRef(onAddDrawing);
  onAddDrawingRef.current = onAddDrawing;
  const onRemoveLastDrawingRef = useRef(onRemoveLastDrawing);
  onRemoveLastDrawingRef.current = onRemoveLastDrawing;
  const onDeleteDrawingRef = useRef(onDeleteDrawing);
  onDeleteDrawingRef.current = onDeleteDrawing;
  const onUndoDrawingRef = useRef(onUndoDrawing);
  onUndoDrawingRef.current = onUndoDrawing;
  const onRedoDrawingRef = useRef(onRedoDrawing);
  onRedoDrawingRef.current = onRedoDrawing;
  const onBeginDrawingEditRef = useRef(onBeginDrawingEdit);
  onBeginDrawingEditRef.current = onBeginDrawingEdit;
  const onEndDrawingEditRef = useRef(onEndDrawingEdit);
  onEndDrawingEditRef.current = onEndDrawingEdit;
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  onUpdateDrawingRef.current = onUpdateDrawing;
  const onMoveDrawingRef = useRef(onMoveDrawing);
  onMoveDrawingRef.current = onMoveDrawing;
  const onUpdateDrawingEdgeRef = useRef(onUpdateDrawingEdge);
  onUpdateDrawingEdgeRef.current = onUpdateDrawingEdge;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onSelectDrawingRef = useRef(onSelectDrawing);
  onSelectDrawingRef.current = onSelectDrawing;
  const drawInProgressRef = useRef(null);
  const dragPointRef = useRef(null);
  const dragMoveRef = useRef(null);
  const dragEdgeRef = useRef(null);
  const priceDragRef = useRef(null);
  const drawDragRef = useRef(null);
  const prevLenRef = useRef(0);
  const lastTapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    goToLatest: () => {
      const c = candlesRef.current;
      if (!c.length) return;
      viewRef.current.rightIndex = c.length - 1;
      viewRef.current.priceShift = 0;
      viewRef.current.priceZoom = 1;
      scheduleDraw();
    },
  }));

  // Jump to latest on first load or dataset change; follow new candles only
  // when the user is already at the latest — otherwise preserve their scroll
  // position so live ticks don't yank them back to the right edge.
  useEffect(() => {
    const c = candlesRef.current;
    const prevLen = prevLenRef.current;
    prevLenRef.current = c.length;
    if (!c.length) {
      scheduleDraw();
      return;
    }
    if (prevLen === 0 || c.length < prevLen) {
      viewRef.current.rightIndex = c.length - 1;
      viewRef.current.priceShift = 0;
      viewRef.current.priceZoom = 1;
      if (viewRef.current.barWidth < MIN_BAR_WIDTH) viewRef.current.barWidth = 8;
    } else if (c.length > prevLen) {
      if (Math.abs(viewRef.current.rightIndex - (prevLen - 1)) <= 0.25) {
        viewRef.current.rightIndex = c.length - 1;
      }
    }
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  useEffect(() => {
    drawInProgressRef.current = null;
    scheduleDraw();
  }, [activeTool, theme, symbol, timeframeLabel, decimals, gridVisible, formingIndex, drawings]);

  // Resize observer + non-passive wheel listener (attached once).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ro = new ResizeObserver(() => {
      resize();
      scheduleDraw();
    });
    ro.observe(wrap);
    resize();

    const wheelHandler = (e) => handleWheel(e);
    canvas.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', wheelHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resize() {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    sizeRef.current = { w, h, dpr };
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function scheduleDraw() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }

  function area() {
    const { w, h } = sizeRef.current;
    const { priceWidth, timeHeight } = scaleRef.current;
    return {
      x: 0,
      y: 0,
      w: Math.max(0, w - priceWidth),
      h: Math.max(0, h - timeHeight),
      priceX: w - priceWidth,
      priceWidth,
      timeHeight,
      timeY: h - timeHeight,
    };
  }

  // Fit the axis panels to what they actually draw: the price axis widens to
  // its widest tick label (plus the last-price tag), the time axis grows to a
  // single line of label text. Bounded so they never dominate the chart.
  function updateScaleMetrics(ctx, hi, lo, dec) {
    const { w } = sizeRef.current;
    const prev = scaleRef.current;

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    const step = niceStep(hi - lo, 7);
    let widest = Math.max(
      ctx.measureText(formatPrice(hi, dec)).width,
      ctx.measureText(formatPrice(lo, dec)).width
    );
    const start = Math.ceil(lo / step) * step;
    for (let p = start; p <= hi; p += step) {
      const tw = ctx.measureText(formatPrice(p, dec)).width;
      if (tw > widest) widest = tw;
    }
    const c = candlesRef.current;
    if (c.length) {
      const lastW = ctx.measureText(formatPrice(c[c.length - 1].close, dec)).width;
      if (lastW > widest) widest = lastW;
    }
    const maxW = Math.max(MIN_PRICE_SCALE, Math.min(MAX_PRICE_SCALE, Math.floor(w * 0.4)));
    const priceWidth = Math.max(MIN_PRICE_SCALE, Math.min(maxW, Math.ceil(widest + 18)));

    const m = ctx.measureText('00:00');
    const lineH = (m.actualBoundingBoxAscent || 8) + (m.actualBoundingBoxDescent || 3);
    const timeHeight = Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, Math.ceil(lineH + 16)));

    if (priceWidth !== prev.priceWidth || timeHeight !== prev.timeHeight) {
      scaleRef.current = { priceWidth, timeHeight };
    }
  }

  function visibleRange() {
    const a = area();
    const { barWidth, rightIndex } = viewRef.current;
    const c = candlesRef.current;
    const visibleCount = Math.ceil(a.w / barWidth) + 1;
    let right = Math.floor(rightIndex);
    if (right > c.length - 1) right = c.length - 1;
    if (right < 0) right = 0;
    let left = right - visibleCount + 1;
    if (left < 0) left = 0;
    return { left, right };
  }

  function priceRange(left, right) {
    const c = candlesRef.current;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = left; i <= right && i < c.length; i++) {
      const k = c[i];
      if (k.high > hi) hi = k.high;
      if (k.low < lo) lo = k.low;
    }
    if (!isFinite(hi)) {
      hi = 100;
      lo = 0;
    }
    const span = hi - lo || Math.abs(hi) || 1;
    const pad = span * 0.08;
    const mid = (hi + lo) / 2;
    // priceZoom > 1 stretches the price axis, < 1 compresses it.
    const half = (span / 2 + pad) * (viewRef.current.priceZoom || 1);
    const shift = viewRef.current.priceShift || 0;
    return { hi: mid + shift + half, lo: mid + shift - half };
  }

  function xOfIndex(i) {
    const a = area();
    const { barWidth, rightIndex } = viewRef.current;
    return a.w - (rightIndex - i + 0.5) * barWidth;
  }

  function indexAtX(x) {
    const a = area();
    const { barWidth, rightIndex } = viewRef.current;
    return rightIndex - (a.w - x) / barWidth + 0.5;
  }

  function yOfPrice(price, hi, lo) {
    const a = area();
    return a.y + ((hi - price) / (hi - lo)) * a.h;
  }

  function priceAtY(y, hi, lo) {
    const a = area();
    return hi - ((y - a.y) / a.h) * (hi - lo);
  }

  function visiblePriceRange() {
    const { left, right } = visibleRange();
    return priceRange(left, right);
  }

  // Map a timestamp to a fractional candle index (linear interpolation
  // between the two surrounding candles) so drawings stay anchored in time.
  function indexAtTimestamp(ts) {
    const c = candlesRef.current;
    if (!c.length) return 0;
    if (ts <= c[0].timestamp) return 0;
    const last = c.length - 1;
    if (ts >= c[last].timestamp) return last;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].timestamp < ts) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(0, lo - 1);
    const j = lo;
    const span = c[j].timestamp - c[i].timestamp || 1;
    return i + (ts - c[i].timestamp) / span;
  }

  function xOfTimestamp(ts) {
    return xOfIndex(indexAtTimestamp(ts));
  }

  function timestampAtX(x) {
    const c = candlesRef.current;
    if (!c.length) return null;
    const idx = indexAtX(x);
    const last = c.length - 1;
    if (last === 0) return c[0].timestamp;
    const i = Math.floor(idx);
    // Extrapolate past either end so drawings can be placed in blank space.
    if (i < 0) {
      const step = c[1].timestamp - c[0].timestamp || 1;
      return c[0].timestamp + idx * step;
    }
    if (i >= last) {
      const step = c[last].timestamp - c[last - 1].timestamp || 1;
      return c[last].timestamp + (idx - last) * step;
    }
    const f = idx - i;
    return c[i].timestamp + f * (c[i + 1].timestamp - c[i].timestamp);
  }

  function toolPoints(toolId) {
    const t = DRAW_TOOLS.find((d) => d.id === toolId);
    return t ? t.points : 0;
  }

  // Map a screen point to exact chart coordinates (time, price). No snapping:
  // shapes are placed and resized precisely where the user drags.
  function pointAt(mx, my) {
    const c = candlesRef.current;
    if (!c.length) return null;
    const a = area();
    if (mx < 0 || mx > a.w || my < 0 || my > a.timeY) return null;
    const ts = timestampAtX(mx);
    if (ts == null) return null;
    const { hi, lo } = visiblePriceRange();
    return { timestamp: ts, price: priceAtY(my, hi, lo) };
  }

  // Hit-test visible drawings' anchor points for drag-to-edit in cursor mode.
  function hitTestPoint(mx, my) {
    const drawings = drawingsRef.current || [];
    if (!drawings.length) return null;
    const { hi, lo } = visiblePriceRange();
    const a = area();
    for (const d of drawings) {
      if (d.hidden) continue;
      const pts = d.points || [];
      for (let pi = 0; pi < pts.length; pi++) {
        const py = yOfPrice(pts[pi].price, hi, lo);
        if (d.type === 'horizontal') {
          if (Math.abs(my - py) <= 10 && mx >= a.x && mx <= a.w) {
            return { drawingId: d.id, pointIndex: pi };
          }
        } else {
          const px = xOfTimestamp(pts[pi].timestamp);
          if (Math.hypot(mx - px, my - py) <= 12) {
            return { drawingId: d.id, pointIndex: pi };
          }
        }
      }
    }
    return null;
  }

  function pointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // Hit-test a drawing's body (not its anchor points) for move-in-cursor mode.
  function hitTestBody(mx, my) {
    const drawings = drawingsRef.current || [];
    if (!drawings.length) return null;
    const { hi, lo } = visiblePriceRange();
    for (const d of drawings) {
      if (d.hidden || d.type === 'horizontal') continue;
      const pts = d.points || [];
      if (pts.length < 2) continue;
      const x1 = xOfTimestamp(pts[0].timestamp);
      const y1 = yOfPrice(pts[0].price, hi, lo);
      const x2 = xOfTimestamp(pts[1].timestamp);
      const y2 = yOfPrice(pts[1].price, hi, lo);
      if (d.type === 'trendline') {
        if (pointToSegment(mx, my, x1, y1, x2, y2) <= 9) return d.id;
      } else {
        const left = Math.min(x1, x2) - 8;
        const right = Math.max(x1, x2) + 8;
        const top = Math.min(y1, y2) - 8;
        const bottom = Math.max(y1, y2) + 8;
        if (mx >= left && mx <= right && my >= top && my <= bottom) return d.id;
      }
    }
    return null;
  }

  // Hit-test a rectangle's edges (excluding corners) for side-drag resizing.
  function hitTestEdge(mx, my) {
    const drawings = drawingsRef.current || [];
    if (!drawings.length) return null;
    const { hi, lo } = visiblePriceRange();
    const near = 10;
    for (const d of drawings) {
      if (d.hidden || d.type !== 'rectangle') continue;
      const pts = d.points || [];
      if (pts.length < 2) continue;
      const x1 = xOfTimestamp(pts[0].timestamp);
      const y1 = yOfPrice(pts[0].price, hi, lo);
      const x2 = xOfTimestamp(pts[1].timestamp);
      const y2 = yOfPrice(pts[1].price, hi, lo);
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      if (Math.abs(my - top) <= near && mx > left + near && mx < right - near) return { drawingId: d.id, edge: 'top' };
      if (Math.abs(my - bottom) <= near && mx > left + near && mx < right - near) return { drawingId: d.id, edge: 'bottom' };
      if (Math.abs(mx - left) <= near && my > top + near && my < bottom - near) return { drawingId: d.id, edge: 'left' };
      if (Math.abs(mx - right) <= near && my > top + near && my < bottom - near) return { drawingId: d.id, edge: 'right' };
    }
    return null;
  }

  function handleDrawDown(e) {
    const tool = activeToolRef.current;
    if (!tool || tool === 'cursor') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const snapped = pointAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!snapped) return;
    const { timestamp: ts, price } = snapped;
    const pts = toolPoints(tool);
    if (pts <= 1) {
      onAddDrawingRef.current?.(createDrawing(tool, [{ timestamp: ts, price }]));
      drawInProgressRef.current = null;
      drawDragRef.current = null;
    } else if (drawInProgressRef.current) {
      // Second tap of a tap-tap placement: fix the second point.
      drawInProgressRef.current.points[1] = { timestamp: ts, price };
      onAddDrawingRef.current?.(drawInProgressRef.current);
      drawInProgressRef.current = null;
      drawDragRef.current = null;
    } else {
      // Begin drag-to-draw (also serves as the first tap of tap-tap).
      drawInProgressRef.current = createDrawing(tool, [
        { timestamp: ts, price },
        { timestamp: ts, price },
      ]);
      drawDragRef.current = { downX: e.clientX, downY: e.clientY, moved: false };
    }
    scheduleDraw();
  }

  function clampView() {
    const a = area();
    const c = candlesRef.current;
    if (!c.length) return;
    const { barWidth } = viewRef.current;
    const visibleCount = Math.ceil(a.w / barWidth) + 1;
    // Free movement: keep one screen of blank space on either side so the
    // chart can be dragged anywhere without snapping to an edge.
    if (viewRef.current.rightIndex > c.length - 1 + visibleCount) {
      viewRef.current.rightIndex = c.length - 1 + visibleCount;
    }
    if (viewRef.current.rightIndex < -visibleCount) viewRef.current.rightIndex = -visibleCount;
  }

  // Zoom the time axis by `factor` around the screen center.
  function zoomByCenter(factor) {
    const c = candlesRef.current;
    if (!c.length) return;
    const a = area();
    const cx = a.w / 2;
    const idx = indexAtX(cx);
    let bw = viewRef.current.barWidth * factor;
    bw = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, bw));
    viewRef.current.barWidth = bw;
    viewRef.current.rightIndex = idx - 0.5 + (a.w - cx) / bw;
    clampView();
    scheduleDraw();
  }

  // Reset to a comfortable view of the most recent candles (double-tap).
  function resetZoom() {
    const c = candlesRef.current;
    if (!c.length) return;
    const a = area();
    let bw = a.w / 120;
    bw = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, bw));
    viewRef.current.barWidth = bw;
    viewRef.current.rightIndex = c.length - 1;
    viewRef.current.priceShift = 0;
    viewRef.current.priceZoom = 1;
    clampView();
    scheduleDraw();
  }

  // Pan further back into history (negative = older candles).
  function panHistory(frac = 0.8) {
    if (!candlesRef.current.length) return;
    const a = area();
    const step = (a.w / viewRef.current.barWidth) * frac;
    viewRef.current.rightIndex -= step;
    clampView();
    scheduleDraw();
  }

  // Jump to the newest candle at the current zoom level.
  function goToLatestView() {
    const c = candlesRef.current;
    if (!c.length) return;
    viewRef.current.rightIndex = c.length - 1;
    viewRef.current.priceShift = 0;
    viewRef.current.priceZoom = 1;
    clampView();
    scheduleDraw();
  }

  function handleWheel(e) {
    e.preventDefault();
    const c = candlesRef.current;
    if (!c.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const a = area();
    if (mx > a.w) return; // ignore wheel over the price scale
    // Trackpad two-finger horizontal swipe pans the time axis.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      viewRef.current.rightIndex += e.deltaX / viewRef.current.barWidth;
      clampView();
      scheduleDraw();
      return;
    }
    const idx = indexAtX(mx);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    let bw = viewRef.current.barWidth * factor;
    bw = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, bw));
    viewRef.current.barWidth = bw;
    viewRef.current.rightIndex = idx - 0.5 + (a.w - mx) / bw;
    clampView();
    scheduleDraw();
  }

  function onPointerDown(e) {
    wrapRef.current?.focus({ preventScroll: true });
    const canvas = canvasRef.current;
    if (canvas && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const vals = [...pointersRef.current.values()];
      const midX = (vals[0].x + vals[1].x) / 2;
      const rect0 = canvasRef.current.getBoundingClientRect();
      pinchRef.current = {
        dist: Math.hypot(vals[0].x - vals[1].x, vals[0].y - vals[1].y),
        barWidth: viewRef.current.barWidth,
        anchorIndex: indexAtX(midX - rect0.left),
      };
      dragRef.current = null;
      dragPointRef.current = null;
      dragMoveRef.current = null;
      dragEdgeRef.current = null;
    } else if (pointersRef.current.size === 1) {
      // Dragging on the price scale stretches / shrinks the price axis.
      const rectA = canvasRef.current.getBoundingClientRect();
      const ax = e.clientX - rectA.left;
      const ay = e.clientY - rectA.top;
      const ar = area();
      if (ax > ar.w && ay <= ar.timeY) {
        const pr = visiblePriceRange();
        priceDragRef.current = {
          startZoom: viewRef.current.priceZoom || 1,
          startY: e.clientY,
          anchor: priceAtY(ay, pr.hi, pr.lo),
        };
        dragRef.current = null;
        dragPointRef.current = null;
        dragMoveRef.current = null;
        dragEdgeRef.current = null;
        return;
      }
      // Double-tap in cursor mode resets the zoom to fit recent candles.
      const now = Date.now();
      const last = lastTapRef.current;
      lastTapRef.current = { x: e.clientX, y: e.clientY, time: now };
      if (
        activeToolRef.current === 'cursor' &&
        last &&
        now - last.time < 300 &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24
      ) {
        lastTapRef.current = null;
        resetZoom();
        return;
      }
      if (activeToolRef.current && activeToolRef.current !== 'cursor') {
        handleDrawDown(e);
      } else {
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hit = hitTestPoint(mx, my);
        if (hit) {
          onBeginDrawingEditRef.current?.();
          onSelectDrawingRef.current?.(hit.drawingId);
          dragPointRef.current = hit;
        } else {
          const edge = hitTestEdge(mx, my);
          if (edge) {
            onBeginDrawingEditRef.current?.();
            onSelectDrawingRef.current?.(edge.drawingId);
            dragEdgeRef.current = edge;
          } else {
            const bodyId = hitTestBody(mx, my);
            if (bodyId) {
              onBeginDrawingEditRef.current?.();
              onSelectDrawingRef.current?.(bodyId);
              const { hi, lo } = visiblePriceRange();
              dragMoveRef.current = {
                drawingId: bodyId,
                lastTs: timestampAtX(mx),
                lastPrice: priceAtY(my, hi, lo),
              };
            } else {
              onSelectDrawingRef.current?.(null);
              dragRef.current = { x: e.clientX, y: e.clientY };
            }
          }
        }
      }
    }
  }

  function onPointerMove(e) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const a = area();
    const c = candlesRef.current;

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const vals = [...pointersRef.current.values()];
      const dist = Math.hypot(vals[0].x - vals[1].x, vals[0].y - vals[1].y);
      const midX = (vals[0].x + vals[1].x) / 2;
      const scale = dist / (pinchRef.current.dist || 1);
      let bw = pinchRef.current.barWidth * scale;
      bw = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, bw));
      const cmx = midX - rect.left;
      viewRef.current.barWidth = bw;
      // Keep the anchor candle under the moving pinch center: spreading the
      // fingers zooms around that point, sliding the midpoint pans the view.
      viewRef.current.rightIndex = pinchRef.current.anchorIndex - 0.5 + (a.w - cmx) / bw;
      clampView();
    } else if (priceDragRef.current) {
      // Vertical drag on the price scale: growth upward stretches the range,
      // downward compresses it, anchored on the price under the pointer.
      const zoomSpan = area();
      let z = priceDragRef.current.startZoom * Math.exp((priceDragRef.current.startY - e.clientY) / 220);
      z = Math.max(0.02, Math.min(60, z));
      viewRef.current.priceZoom = z;
      viewRef.current.priceShift = 0;
      const pr = visiblePriceRange();
      const t = Math.max(0, Math.min(1, (my - zoomSpan.y) / zoomSpan.h));
      viewRef.current.priceShift = priceDragRef.current.anchor - (pr.hi - t * (pr.hi - pr.lo));
    } else if (dragEdgeRef.current) {
      const snapped = pointAt(mx, my);
      if (snapped) {
        onUpdateDrawingEdgeRef.current?.(
          dragEdgeRef.current.drawingId,
          dragEdgeRef.current.edge,
          snapped
        );
      }
    } else if (dragPointRef.current) {
      const snapped = pointAt(mx, my);
      if (snapped) {
        onUpdateDrawingRef.current?.(
          dragPointRef.current.drawingId,
          dragPointRef.current.pointIndex,
          snapped
        );
      }
    } else if (dragMoveRef.current) {
      const { hi, lo } = visiblePriceRange();
      const ts = timestampAtX(mx);
      const pr = priceAtY(my, hi, lo);
      const dTs = ts - dragMoveRef.current.lastTs;
      const dPr = pr - dragMoveRef.current.lastPrice;
      if (dTs !== 0 || dPr !== 0) {
        onMoveDrawingRef.current?.(dragMoveRef.current.drawingId, dTs, dPr);
        dragMoveRef.current.lastTs = ts;
        dragMoveRef.current.lastPrice = pr;
      }
    } else if (drawInProgressRef.current) {
      const snapped = pointAt(mx, my);
      if (snapped) {
        drawInProgressRef.current.points[1] = snapped;
      }
      if (
        drawDragRef.current &&
        pointersRef.current.has(e.pointerId) &&
        Math.hypot(e.clientX - drawDragRef.current.downX, e.clientY - drawDragRef.current.downY) > 4
      ) {
        drawDragRef.current.moved = true;
      }
    } else if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const { barWidth } = viewRef.current;
      viewRef.current.rightIndex -= dx / barWidth;
      // Vertical drag moves the price axis freely.
      if (dy) {
        const { hi, lo } = visiblePriceRange();
        viewRef.current.priceShift = (viewRef.current.priceShift || 0) + (dy / a.h) * (hi - lo);
      }
      clampView();
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
    }

    // Cursor affordance for drag/edit in cursor mode.
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const tool = activeToolRef.current;
      const axisArea = area();
      let cur = 'crosshair';
      if (priceDragRef.current) cur = 'ns-resize';
      else if (mx > axisArea.w && my <= axisArea.timeY) cur = 'ns-resize';
      else if (tool === 'cursor') {
        if (dragPointRef.current || dragMoveRef.current || dragEdgeRef.current) cur = 'grabbing';
        else if (c.length && hitTestPoint(mx, my)) cur = 'grab';
        else if (c.length) {
          const he = hitTestEdge(mx, my);
          if (he) cur = he.edge === 'top' || he.edge === 'bottom' ? 'ns-resize' : 'ew-resize';
          else if (hitTestBody(mx, my)) cur = 'move';
          else cur = 'crosshair';
        } else cur = 'crosshair';
      }
      canvasEl.style.cursor = cur;
    }

    if (c.length && mx >= 0 && mx <= a.w && my >= 0 && my <= a.timeY) {
      crossRef.current = { x: mx, y: my };
    } else {
      crossRef.current = null;
    }
    scheduleDraw();
  }

  function onPointerUp(e) {
    const wasPinching = !!pinchRef.current;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      const editedDrawing = !!(dragPointRef.current || dragMoveRef.current || dragEdgeRef.current);
      dragRef.current = null;
      dragPointRef.current = null;
      dragMoveRef.current = null;
      dragEdgeRef.current = null;
      priceDragRef.current = null;
      // Finalize a drag-to-draw on release after movement; a tap (no movement)
      // leaves the drawing in progress for a second tap to place the end point.
      if (drawDragRef.current && drawInProgressRef.current && drawDragRef.current.moved) {
        onAddDrawingRef.current?.(drawInProgressRef.current);
        drawInProgressRef.current = null;
      }
      drawDragRef.current = null;
      if (editedDrawing) onEndDrawingEditRef.current?.();
    } else if (wasPinching && pointersRef.current.size === 1 && activeToolRef.current === 'cursor') {
      // One finger remains after a pinch — continue panning with it.
      const rem = [...pointersRef.current.values()][0];
      dragRef.current = { x: rem.x, y: rem.y };
      dragPointRef.current = null;
      dragMoveRef.current = null;
      dragEdgeRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function onPointerLeave() {
    crossRef.current = null;
    scheduleDraw();
  }

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) onRedoDrawingRef.current?.();
      else onUndoDrawingRef.current?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      e.stopPropagation();
      onRedoDrawingRef.current?.();
      return;
    }
    if (e.key === 'Escape') {
      crossRef.current = null;
      drawInProgressRef.current = null;
      scheduleDraw();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectedIdRef.current) onDeleteDrawingRef.current?.(selectedIdRef.current);
      else onRemoveLastDrawingRef.current?.();
      e.preventDefault();
    } else if (e.key === '+' || e.key === '=') {
      zoomByCenter(1.2);
    } else if (e.key === '-' || e.key === '_') {
      zoomByCenter(1 / 1.2);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!candlesRef.current.length) return;
      const a = area();
      const step = (a.w / viewRef.current.barWidth) * 0.2;
      viewRef.current.rightIndex += e.key === 'ArrowLeft' ? -step : step;
      clampView();
      scheduleDraw();
    } else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) {
        wrapRef.current?.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const c = candlesRef.current;
    const th = themeRef.current;
    if (!c.length) {
      ctx.fillStyle = th.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = th.text;
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emptyMsgRef.current || 'No data — import a CSV to begin.', w / 2, h / 2);
      return;
    }

    // Two passes: a provisional range, then re-derive the plot area once the
    // price axis has resized to fit its labels.
    const first = visibleRange();
    const firstRange = priceRange(first.left, first.right);
    const firstDec =
      decimalsRef.current != null
        ? decimalsRef.current
        : guessDecimals((firstRange.hi + firstRange.lo) / 2);
    updateScaleMetrics(ctx, firstRange.hi, firstRange.lo, firstDec);

    const a = area();
    const { left, right } = visibleRange();
    const { hi, lo } = priceRange(left, right);
    const dec = decimalsRef.current != null ? decimalsRef.current : guessDecimals((hi + lo) / 2);
    const tf = getTimeframe(tfLabelRef.current);

    // Background.
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);
    // Scale panels.
    ctx.fillStyle = th.scaleBg;
    ctx.fillRect(a.w, 0, a.priceWidth, h);
    ctx.fillRect(0, a.timeY, w, a.timeHeight);

    drawGrid(ctx, a, hi, lo, th, dec);
    drawTimeScale(ctx, a, left, right, tf, th);
    drawCandles(ctx, a, left, right, hi, lo, th, formingRef.current);
    drawLastPrice(ctx, a, hi, lo, th, dec);
    drawDrawings(ctx, a, hi, lo, th, dec);
    drawCrosshair(ctx, a, hi, lo, dec, tf, th);
    drawInfoBox(ctx, a, th, dec, tf);

    // Axis separators.
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.w + 0.5, 0);
    ctx.lineTo(a.w + 0.5, a.timeY);
    ctx.moveTo(0, a.timeY + 0.5);
    ctx.lineTo(w, a.timeY + 0.5);
    ctx.stroke();
  }

  function drawGrid(ctx, a, hi, lo, th, dec) {
    const step = niceStep(hi - lo, 7);
    const start = Math.ceil(lo / step) * step;
    ctx.lineWidth = 1;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let p = start; p <= hi; p += step) {
      const y = yOfPrice(p, hi, lo);
      if (y < a.y || y > a.timeY) continue;
      if (gridRef.current) {
        ctx.strokeStyle = th.grid;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(a.w, y + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = th.text;
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(p, dec), a.w + 8, y);
    }
  }

  function drawTimeScale(ctx, a, left, right, tf, th) {
    const { barWidth } = viewRef.current;
    const c = candlesRef.current;
    ctx.fillStyle = th.text;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const minLabelPx = 72;
    const stepCandles = Math.max(1, Math.ceil(minLabelPx / barWidth));
    for (let i = left; i <= right && i < c.length; i++) {
      if (i % stepCandles !== 0 && i !== left) continue;
      const x = xOfIndex(i);
      if (x < -40 || x > a.w + 40) continue;
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, a.timeY);
      ctx.lineTo(x + 0.5, a.timeY + 5);
      ctx.stroke();
      ctx.fillStyle = th.text;
      ctx.textAlign = 'left';
      ctx.fillText(formatTimeScale(c[i].timestamp, tf), x + 4, a.timeY + a.timeHeight / 2);
    }
  }

  function drawCandles(ctx, a, left, right, hi, lo, th, formingIndex) {
    const { barWidth } = viewRef.current;
    const c = candlesRef.current;
    const bodyWidth = Math.max(1, barWidth * 0.72);
    ctx.lineWidth = 1;
    for (let i = left; i <= right && i < c.length; i++) {
      const k = c[i];
      const x = xOfIndex(i);
      if (x < -barWidth || x > a.w + barWidth) continue;
      const bull = k.close >= k.open;
      const color = bull ? th.bull : th.bear;
      const forming = i === formingIndex;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const yH = yOfPrice(k.high, hi, lo);
      const yL = yOfPrice(k.low, hi, lo);
      const yO = yOfPrice(k.open, hi, lo);
      const yC = yOfPrice(k.close, hi, lo);
      // Wick
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yH);
      ctx.lineTo(Math.round(x) + 0.5, yL);
      ctx.stroke();
      // Body — forming candles are drawn hollow (dashed outline) to distinguish
      // them from completed candles. Completed candles are solid.
      const top = Math.min(yO, yC);
      const bh = Math.max(1, Math.abs(yC - yO));
      const bx = Math.round(x - bodyWidth / 2);
      const bw = Math.round(bodyWidth);
      if (forming) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillRect(bx, top, bw, bh);
        ctx.globalAlpha = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(bx + 0.5, top + 0.5, bw - 1, Math.max(1, bh - 1));
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        ctx.fillRect(bx, top, bw, bh);
      }
    }
  }

  function drawLastPrice(ctx, a, hi, lo, th, dec) {
    const c = candlesRef.current;
    const last = c[c.length - 1];
    if (!last) return;
    const y = yOfPrice(last.close, hi, lo);
    if (y < 0 || y > a.timeY) return;
    const bull = last.close >= last.open;
    const color = bull ? th.bull : th.bear;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(a.w, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillRect(a.w, y - 9, a.priceWidth, 18);
    ctx.fillStyle = '#fff';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(last.close, dec), a.w + 8, y);
  }

  function drawDrawings(ctx, a, hi, lo, th, dec) {
    const all = [...(drawingsRef.current || [])];
    if (drawInProgressRef.current) all.push(drawInProgressRef.current);
    for (const d of all) {
      if (d.hidden && d !== drawInProgressRef.current) continue;
      const preview = d === drawInProgressRef.current;
      const selected = d.id === selectedIdRef.current;
      ctx.save();
      if (preview) ctx.globalAlpha = 0.75;
      drawOne(ctx, a, hi, lo, th, dec, d, selected);
      ctx.restore();
      if (!preview) drawHandles(ctx, a, hi, lo, d, selected);
    }
  }

  function drawHandles(ctx, a, hi, lo, d, selected) {
    const pts = d.points || [];
    ctx.save();
    ctx.fillStyle = selected ? '#26a69a' : '#4a9eff';
    ctx.strokeStyle = '#0b0e11';
    ctx.lineWidth = 1;
    for (const p of pts) {
      const x = d.type === 'horizontal' ? a.w - 10 : xOfTimestamp(p.timestamp);
      const y = yOfPrice(p.price, hi, lo);
      ctx.beginPath();
      ctx.arc(x, y, selected ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Edge midpoint handles for rectangles — drag a side to resize it.
    if (d.type === 'rectangle' && pts.length >= 2 && !d.hidden) {
      const x1 = xOfTimestamp(pts[0].timestamp);
      const y1 = yOfPrice(pts[0].price, hi, lo);
      const x2 = xOfTimestamp(pts[1].timestamp);
      const y2 = yOfPrice(pts[1].price, hi, lo);
      const cx = (Math.min(x1, x2) + Math.max(x1, x2)) / 2;
      const cy = (Math.min(y1, y2) + Math.max(y1, y2)) / 2;
      const mids = [
        [cx, Math.min(y1, y2)],
        [cx, Math.max(y1, y2)],
        [Math.min(x1, x2), cy],
        [Math.max(x1, x2), cy],
      ];
      ctx.fillStyle = selected ? '#26a69a' : '#3b6fb0';
      for (const [mxp, myp] of mids) {
        ctx.beginPath();
        ctx.rect(mxp - 4, myp - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawOne(ctx, a, hi, lo, th, dec, d, selected) {
    const color = d.color || DEFAULT_DRAW_COLOR;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    const pts = d.points || [];

    if (d.type === 'horizontal' && pts[0]) {
      const y = yOfPrice(pts[0].price, hi, lo);
      if (y < a.y || y > a.timeY) return;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(a.w, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatPrice(pts[0].price, dec), 6, y - 2);
      return;
    }

    if (pts.length < 2) return;
    const x1 = xOfTimestamp(pts[0].timestamp);
    const y1 = yOfPrice(pts[0].price, hi, lo);
    const x2 = xOfTimestamp(pts[1].timestamp);
    const y2 = yOfPrice(pts[1].price, hi, lo);

    if (d.type === 'trendline') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (d.type === 'rectangle') {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.15;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = prevAlpha;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    } else if (d.type === 'fibonacci') {
      const hiP = Math.max(pts[0].price, pts[1].price);
      const loP = Math.min(pts[0].price, pts[1].price);
      const span = hiP - loP || 1;
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const lvl of FIB_LEVELS) {
        const p = hiP - lvl * span;
        const y = yOfPrice(p, hi, lo);
        if (y < a.y || y > a.timeY) continue;
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(left, y + 0.5);
        ctx.lineTo(right, y + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = prevAlpha;
        ctx.fillText(lvl.toFixed(3), left + 4, y);
      }
      ctx.strokeStyle = color;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = prevAlpha;
    }
  }

  function drawCrosshair(ctx, a, hi, lo, dec, tf, th) {
    const ch = crossRef.current;
    if (!ch) return;
    const x = Math.max(0, Math.min(a.w, ch.x));
    const y = Math.max(0, Math.min(a.timeY, ch.y));
    ctx.strokeStyle = th.crosshair;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, a.timeY);
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(a.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label on the right scale.
    const price = priceAtY(y, hi, lo);
    ctx.fillStyle = th.crosshair;
    ctx.fillRect(a.w, y - 9, a.priceWidth, 18);
    ctx.fillStyle = '#fff';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(price, dec), a.w + 8, y);

    // Time label on the bottom scale.
    const c = candlesRef.current;
    const idx = Math.round(indexAtX(x));
    const clamped = Math.max(0, Math.min(c.length - 1, idx));
    const k = c[clamped];
    if (k) {
      const label = formatTimeScale(k.timestamp, tf);
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = th.crosshair;
      ctx.fillRect(Math.max(0, Math.min(a.w - tw, x - tw / 2)), a.timeY, tw, a.timeHeight);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, a.timeY + a.timeHeight / 2);
    }
  }

  function drawInfoBox(ctx, a, th, dec, tf) {
    const c = candlesRef.current;
    let k = null;
    const ch = crossRef.current;
    if (ch) {
      const idx = Math.round(indexAtX(ch.x));
      k = c[Math.max(0, Math.min(c.length - 1, idx))];
    } else {
      k = c[Math.max(0, Math.min(c.length - 1, Math.round(viewRef.current.rightIndex)))];
    }
    if (!k) return;
    const bull = k.close >= k.open;
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // Header: symbol · timeframe
    ctx.fillStyle = bull ? th.bull : th.bear;
    ctx.fillText(`${symbolRef.current} · ${tfLabelRef.current}`, 12, 10);
    ctx.fillStyle = th.text;
    let y = 30;
    ctx.fillText(`O  ${formatPrice(k.open, dec)}`, 12, y);
    y += 16;
    ctx.fillText(`H  ${formatPrice(k.high, dec)}`, 12, y);
    y += 16;
    ctx.fillText(`L  ${formatPrice(k.low, dec)}`, 12, y);
    y += 16;
    ctx.fillStyle = bull ? th.bull : th.bear;
    ctx.fillText(`C  ${formatPrice(k.close, dec)}`, 12, y);
    y += 18;
    ctx.fillStyle = th.text;
    ctx.fillText(formatTimestamp(k.timestamp, tf), 12, y);
  }

  return (
    <div
      ref={wrapRef}
      className="canvas-chart"
      data-candle-count={candles?.length || 0}
      data-drawing-count={drawings?.length || 0}
      data-selected-drawing={selectedId || ''}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="canvas-chart__surface"
        data-testid="chart-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      {/* Navigate the time axis: zoom and scroll into past candles. */}
      <div className="canvas-chart__nav">
        <button
          onClick={() => zoomByCenter(1.3)}
          className="canvas-chart__nav-button"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomByCenter(1 / 1.3)}
          className="canvas-chart__nav-button"
          title="Zoom out"
        >
          −
        </button>
        <div className="canvas-chart__nav-divider" />
        <button
          onClick={() => panHistory()}
          className="canvas-chart__nav-button"
          title="Scroll to older candles"
        >
          ‹
        </button>
        <button
          onClick={() => goToLatestView()}
          className="canvas-chart__nav-button"
          title="Go to latest candle"
        >
          »
        </button>
      </div>
    </div>
  );
});

export default ChartCanvas;
