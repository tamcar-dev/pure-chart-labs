import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts'
import { connectDeriv, fetchActiveSymbols, MARKET_FALLBACKS, CANDLE_HISTORY_LIMIT } from './deriv'
import { loadCandles, saveCandles } from './db'
import { parseCandleCSV } from './csv'
import { getBrowserStorage, loadPanels, savePanels } from './panels'
import {
  FIB_LEVELS, TOOL_POINTS, commit, createHistory, drawingsStorageKey, hitTestItems, parseStoredDrawings,
  placePoint, pointFromPixel, redo, toPixel, undo
} from './drawings'

const TIMEFRAMES = [
  ['1m',60],['2m',120],['5m',300],['10m',600],['15m',900],['30m',1800],
  ['1H',3600],['2H',7200],['4H',14400],['8H',28800],['1D',86400]
]
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const makePanel = (symbol='R_75') => ({ id: makeId(), symbol, tf:900 })

// Only the panel the user last interacted with responds to Delete / Escape / Ctrl+Z.
let activePanelId = null

function readDrawings(key, legacyKey) {
  try {
    const current = localStorage.getItem(key)
    if (current !== null) return parseStoredDrawings(current)
    const legacy = legacyKey ? localStorage.getItem(legacyKey) : null
    const items = parseStoredDrawings(legacy)
    if (items.length && writeDrawings(key, items)) localStorage.removeItem(legacyKey)
    return items
  } catch { return [] }
}
function writeDrawings(key, items) {
  try { localStorage.setItem(key, JSON.stringify(items)); return true }
  catch (e) { console.warn('Drawing save failed', e); return false }
}

// Presentational overlay. It never receives pointer events (CSS pointer-events: none), so the chart keeps
// scroll, zoom, crosshair and its own click handling while a tool is armed.
function DrawingOverlay({ items, pending, cursor, tool, selectedId, size, toPix }) {
  const w = size.w, h = size.h
  const previewAnchor = tool && TOOL_POINTS[tool] === 2 && pending.length === 1 ? toPix(pending[0]) : null
  const shapes = items.map(d => ({ d, a: toPix(d.a), b: d.b ? toPix(d.b) : null }))
  return <svg className="drawing-layer" width="100%" height="100%" aria-hidden="true">
    {shapes.map(({ d, a, b }) => a && <Shape key={d.id} type={d.type} a={a} b={b} w={w} h={h} selected={d.id === selectedId} />)}
    {previewAnchor && cursor && <Shape type={tool} a={previewAnchor} b={cursor} w={w} h={h} preview />}
    {pending.map((p, i) => {
      const c = toPix(p)
      return c ? <circle key={`pending-${i}`} data-testid="pending" cx={c.x} cy={c.y} r="4" fill="#e4b84f" /> : null
    })}
  </svg>
}

function Shape({ type, a, b, w, h, selected, preview }) {
  const color = preview ? '#9fb3c8' : '#e4b84f'
  const dash = preview ? '4 3' : undefined
  const sw = selected ? 2.5 : 1.5
  const handles = selected ? <g>
    <circle cx={a.x} cy={a.y} r="4" fill="#fff" stroke={color} />
    {b && <circle cx={b.x} cy={b.y} r="4" fill="#fff" stroke={color} />}
  </g> : null
  const attrs = { 'data-testid': preview ? 'preview' : 'drawing', 'data-type': type }
  let body = null
  if (type === 'horizontal') body = <line x1="0" x2={w} y1={a.y} y2={a.y} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
  else if (type === 'vertical') body = <line x1={a.x} x2={a.x} y1="0" y2={h} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
  else if (!b) return null
  else if (type === 'trend') body = <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
  else if (type === 'rectangle') body = <rect x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)} fill="#2eb6a3" fillOpacity=".10" stroke="#2eb6a3" strokeWidth={sw} strokeDasharray={dash} />
  else if (type === 'fibonacci') body = <g>{FIB_LEVELS.map(level => {
    const y = a.y + (b.y - a.y) * level
    return <g key={level}>
      <line x1="0" x2={w} y1={y} y2={y} stroke="#8b9eb3" strokeOpacity=".7" strokeDasharray="4 3" />
      <text x="8" y={y - 3} fill="#aeb9c7" fontSize="9">{Math.round(level * 1000) / 10}%</text>
    </g>
  })}</g>
  else return null
  return <g {...attrs}>{body}{handles}</g>
}

function ChartPanel({ panel, markets, onChange, onRemove, tool }) {
  const el = useRef(null), wrapRef = useRef(null)
  const chartRef = useRef(null), seriesRef = useRef(null), barsRef = useRef([]), modeRef = useRef('LIVE')
  const toolRef = useRef(tool), panelIdRef = useRef(panel.id)
  toolRef.current = tool
  panelIdRef.current = panel.id

  const [status,setStatus] = useState(navigator.onLine ? 'connecting' : 'offline')
  const [chartApi,setChartApi] = useState(null)
  const [price,setPrice] = useState(null), [loaded,setLoaded] = useState(false)
  const [mode,setMode] = useState('LIVE'), [replayIndex,setReplayIndex] = useState(0)
  const [, setViewVersion] = useState(0)
  const [cursor,setCursor] = useState(null)
  const [size,setSize] = useState({ w:0, h:0 })

  // Drawing state is tied to one drawing context (panel + market + timeframe). Switching context
  // shows that context's saved drawings; nothing from another market or timeframe is drawn or overwritten.
  const ctxKey = drawingsStorageKey(panel.id, panel.symbol, panel.tf)
  const legacyKey = `pcl-drawings:${panel.id}`
  const legacyKeyRef = useRef(legacyKey)
  legacyKeyRef.current = legacyKey
  const ctxKeyRef = useRef(ctxKey)
  ctxKeyRef.current = ctxKey
  const [store,setStore] = useState(() => ({ key: ctxKey, history: createHistory(readDrawings(ctxKey, legacyKey)), pending: [], selectedId: null }))
  const view = store.key === ctxKey ? store : { key: ctxKey, history: createHistory(readDrawings(ctxKey, legacyKey)), pending: [], selectedId: null }

  const updateView = useCallback(fn => setStore(s => {
    const key = ctxKeyRef.current
    const base = s.key === key ? s : { key, history: createHistory(readDrawings(key, legacyKeyRef.current)), pending: [], selectedId: null }
    return { ...base, ...fn(base) }
  }), [])

  // Persist only the context that is currently active. The guard stops a stale state from being written under a new key.
  useEffect(() => {
    if (store.key !== ctxKey) return
    writeDrawings(ctxKey, store.history.present)
  }, [store.key, store.history.present, ctxKey])

  // Changing tool cancels any half-finished placement.
  useLayoutEffect(() => { setCursor(null); updateView(() => ({ pending: [], selectedId: null })) }, [tool, updateView])

  const label = markets.find(m => m.symbol === panel.symbol)?.display_name || panel.symbol
  const timeframe = TIMEFRAMES.find(x => x[1] === panel.tf)?.[0] || `${panel.tf}s`

  useEffect(() => { modeRef.current = mode }, [mode])

  // Chart + every subscription that reads chart state. Handlers read refs and updater functions, so they never go stale.
  useEffect(() => {
    const chart = createChart(el.current, {
      autoSize: true, layout: { background: { color: '#090d12' }, textColor: '#8290a3', fontFamily: 'Arial', fontSize: 11 },
      grid: { vertLines: { color: '#151d27' }, horzLines: { color: '#151d27' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#526174', labelBackgroundColor: '#263445' }, horzLine: { color: '#526174', labelBackgroundColor: '#263445' } },
      rightPriceScale: { borderColor: '#202a36' }, timeScale: { borderColor: '#202a36', timeVisible: true, secondsVisible: false },
      handleScroll: true, handleScale: true
    })
    const series = chart.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' })
    const ts = chart.timeScale()
    chartRef.current = chart; seriesRef.current = series
    setChartApi({ chart, series })

    const bump = () => setViewVersion(v => v + 1)
    const pixelTo = p => toPixel(p, ts, series)

    const onClick = param => {
      if (!param?.point) return
      activePanelId = panelIdRef.current
      const activeTool = toolRef.current
      if (activeTool) {
        const point = pointFromPixel(param.point, param.time, ts, series)
        if (!point) return // chart cannot map this position (e.g. no data yet)
        updateView(v => {
          const { pending, drawing } = placePoint(activeTool, v.pending, point)
          if (!drawing) return { pending }
          return { pending, history: commit(v.history, [...v.history.present, { ...drawing, id: makeId() }]), selectedId: null }
        })
        return
      }
      updateView(v => ({ selectedId: hitTestItems(v.history.present, param.point, pixelTo) }))
    }
    const onMove = param => {
      if (!toolRef.current || !param?.point) { setCursor(null); return }
      setCursor(param.point)
    }

    ts.subscribeVisibleTimeRangeChange(bump)
    chart.subscribeClick(onClick)
    chart.subscribeCrosshairMove(onMove)

    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    if (wrapRef.current) ro.observe(wrapRef.current)

    return () => {
      ro.disconnect()
      ts.unsubscribeVisibleTimeRangeChange(bump)
      chart.unsubscribeClick(onClick)
      chart.unsubscribeCrosshairMove(onMove)
      setChartApi(null)
      chart.remove()
    }
  }, [updateView])

  // Keyboard: Escape cancels, Delete removes selection, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) undo and redo.
  useEffect(() => {
    const onKey = e => {
      if (activePanelId !== panelIdRef.current) return
      if (/INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || '')) return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        setCursor(null)
        updateView(() => ({ pending: [], selectedId: null }))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        updateView(v => v.selectedId
          ? { history: commit(v.history, v.history.present.filter(d => d.id !== v.selectedId)), selectedId: null }
          : {})
        e.preventDefault()
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        updateView(v => ({ history: e.shiftKey ? redo(v.history) : undo(v.history), selectedId: null }))
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        updateView(v => ({ history: redo(v.history), selectedId: null }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [updateView])

  useEffect(() => {
    let cancelled=false
    barsRef.current=[];setLoaded(false);setPrice(null);setMode('LIVE')
    ;(async()=>{
      try{
        const cached=await loadCandles(panel.symbol,panel.tf,CANDLE_HISTORY_LIMIT)
        if(cancelled)return
        const merged=new Map(cached.map(b=>[b.time,b]))
        barsRef.current.forEach(b=>merged.set(b.time,b))
        barsRef.current=[...merged.values()].sort((a,b)=>a.time-b.time).slice(-CANDLE_HISTORY_LIMIT)
        seriesRef.current?.setData(barsRef.current)
        if(barsRef.current.length)chartRef.current?.timeScale().fitContent()
      }catch(e){console.warn('Candle cache read failed',e)}
      if(!cancelled)setLoaded(true)
    })()
    const cleanup=connectDeriv({
      symbol:panel.symbol,granularity:panel.tf,
      onStatus:s=>{if(!cancelled)setStatus(s)},
      onCandles:incoming=>{
        if(cancelled||!incoming.length)return
        const map=new Map(barsRef.current.map(b=>[b.time,b]))
        incoming.forEach(b=>map.set(b.time,b))
        const merged=[...map.values()].sort((a,b)=>a.time-b.time).slice(-CANDLE_HISTORY_LIMIT)
        barsRef.current=merged;seriesRef.current?.setData(merged)
        saveCandles(panel.symbol,panel.tf,incoming).catch(e=>console.warn('Candle cache write failed',e))
        const last=merged.at(-1);if(last)setPrice(last.close)
      },
      onTick:tick=>{
        if(cancelled||!Number.isFinite(tick.price))return
        const start=Math.floor(tick.time/panel.tf)*panel.tf,bars=barsRef.current,last=bars.at(-1)
        let next
        if(last&&last.time===start)next={...last,high:Math.max(last.high,tick.price),low:Math.min(last.low,tick.price),close:tick.price}
        else if(!last||start>last.time)next={time:start,open:tick.price,high:tick.price,low:tick.price,close:tick.price}
        else return
        if(last&&last.time===start)bars[bars.length-1]=next;else bars.push(next)
        if(bars.length>CANDLE_HISTORY_LIMIT)bars.splice(0,bars.length-CANDLE_HISTORY_LIMIT)
        if(modeRef.current!=='REPLAY')seriesRef.current?.update(next);setPrice(tick.price)
        saveCandles(panel.symbol,panel.tf,[next]).catch(e=>console.warn(e))
      }
    })
    return()=>{cancelled=true;cleanup()}
  },[panel.symbol,panel.tf,panel.refresh])

  const replay=()=>{if(!barsRef.current.length)return;const n=Math.max(1,barsRef.current.length-100);setReplayIndex(n);setMode('REPLAY');seriesRef.current?.setData(barsRef.current.slice(0,n))}
  const step=()=>{const n=Math.min(replayIndex+1,barsRef.current.length);setReplayIndex(n);seriesRef.current?.setData(barsRef.current.slice(0,n))}
  const exit=()=>{setMode('LIVE');seriesRef.current?.setData(barsRef.current);chartRef.current?.timeScale().fitContent()}

  const undoDrawing = () => updateView(v => ({ history: undo(v.history), selectedId: null }))
  const redoDrawing = () => updateView(v => ({ history: redo(v.history), selectedId: null }))
  const clearDrawings = () => updateView(v => ({ history: commit(v.history, []), pending: [], selectedId: null }))

  const toPix = p => chartApi ? toPixel(p, chartApi.chart.timeScale(), chartApi.series) : null
  const canUndo = view.history.past.length > 0, canRedo = view.history.future.length > 0
  const hasDrawings = view.history.present.length > 0

  return <article className="chart-card">
    <div className="chart-card-head">
      <select aria-label="Market" value={panel.symbol} onChange={e=>onChange({...panel,symbol:e.target.value})}>
        {markets.map(m=><option key={m.symbol} value={m.symbol}>{m.display_name} · {m.symbol}</option>)}
      </select>
      <select aria-label="Timeframe" value={panel.tf} onChange={e=>onChange({...panel,tf:Number(e.target.value)})}>
        {TIMEFRAMES.map(([name,seconds])=><option key={seconds} value={seconds}>{name}</option>)}
      </select>
      <span className={`mini-status ${status==='connected'?'ok':''}`}>{status.toUpperCase()}</span>
      <span className="head-price">{price==null?'—':price.toLocaleString(undefined,{maximumFractionDigits:5})}</span>
      <button className="tiny-btn" onClick={()=>chartRef.current?.timeScale().fitContent()} title="Fit chart">Fit</button>
      <button className="tiny-btn" onClick={mode==='REPLAY'?exit:replay}>{mode==='REPLAY'?'Exit':'Replay'}</button>
      {mode==='REPLAY'&&<button className="tiny-btn" onClick={step}>Step</button>}
      <button className="tiny-btn" onClick={undoDrawing} title="Undo (Ctrl+Z)" disabled={!canUndo}>↶</button>
      <button className="tiny-btn" onClick={redoDrawing} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo}>↷</button>
      <button className="tiny-btn danger" onClick={clearDrawings} title="Clear drawings" disabled={!hasDrawings}>Clear</button>
      <button className="tiny-btn danger" onClick={()=>onRemove(panel.id)} title="Remove chart">×</button>
    </div>
    <div ref={wrapRef} className={`chart-wrap ${tool?'tool-active':''}`}>
      <div ref={el} className="chart"/>
      <DrawingOverlay items={view.history.present} pending={view.pending} cursor={cursor} tool={tool}
        selectedId={view.selectedId} size={size} toPix={toPix}/>
      {!loaded&&<div className="loading">Loading cached candles…</div>}
      {loaded&&!barsRef.current.length&&status!=='connected'&&<div className="loading">No cached history. Check connection or import a CSV.</div>}
    </div>
    <div className="chart-card-foot"><span>{label} · {timeframe} · {mode}</span><span>{barsRef.current.length.toLocaleString()} bars</span></div>
  </article>
}

export default function App(){
  const [markets,setMarkets]=useState(MARKET_FALLBACKS)
  const [panels,setPanels]=useState(() => loadPanels(getBrowserStorage(), makePanel))
  const [tool,setTool]=useState(null),[marketStatus,setMarketStatus]=useState('Loading markets…')
  const [csvMessage,setCsvMessage]=useState('')
  const fileRef=useRef(null)
  useEffect(()=>{ savePanels(getBrowserStorage(), panels) },[panels])
  useEffect(()=>{
    let alive=true
    fetchActiveSymbols().then(list=>{if(alive&&list.length){setMarkets(list);setMarketStatus(`${list.length} markets available`)}})
      .catch(()=>{if(alive)setMarketStatus('Using built-in market list')})
    return()=>{alive=false}
  },[])
  const addChart=()=>setPanels(p=>[...p,makePanel(p[0]?.symbol||'R_75')])
  const updatePanel=(next)=>setPanels(p=>p.map(x=>x.id===next.id?next:x))
  const importCSV=async e=>{
    const file=e.target.files?.[0];if(!file)return
    try{
      const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),utf16=bytes[0]===0xff&&bytes[1]===0xfe,text=new TextDecoder(utf16?'utf-16le':'utf-8').decode(buffer),rows=parseCandleCSV(text)
      if(!rows.length)throw new Error('No valid OHLC rows found. Expected time/date, open, high, low, close columns.')
      const target=panels[0]
      await saveCandles(target.symbol,target.tf,rows)
      setCsvMessage(`Imported ${rows.length.toLocaleString()} candles into ${target.symbol} · ${TIMEFRAMES.find(x=>x[1]===target.tf)?.[0]}. The chart is refreshing.`)
      const panelId=target.id
      setPanels(p=>p.map(x=>x.id===panelId?{...x,refresh:Date.now()}:x))
    }catch(err){setCsvMessage(`CSV import failed: ${err.message}`)}
    e.target.value=''
  }
  return <main className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◈</span><b>Pure</b><span>Chart</span><small className="labs">LABS</small></div>
      <div className="divider"/>
      <div className="workspace-title"><b>Market workspace</b><span>{marketStatus}</span></div>
      <div className="top-spacer"/>
      <button className="navbtn" onClick={addChart}>＋ Add chart</button>
      <button className="navbtn" onClick={()=>fileRef.current?.click()}>⇧ Import CSV</button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={importCSV}/>
      <button className="iconbtn" onClick={()=>setTool(null)} title="Cursor">⌖</button>
      <span className="status"><i className="online"/> LOCAL-FIRST</span>
    </header>
    <div className="toolstrip">
      <span>DRAW</span>
      {[['trend','／','Line'],['rectangle','□','Box']].map(([id,glyph,title])=><button key={id} title={title} className={tool===id?'selected':''} onClick={()=>setTool(tool===id?null:id)}>{glyph}</button>)}
      <span className="tool-hint">{tool?`Click twice on the chart · Esc cancels · ⌖ returns to cursor`:'Cursor: click a drawing to select · Delete removes it · Ctrl+Z undoes'}</span>
      {csvMessage&&<span className="csv-message">{csvMessage}</span>}
    </div>
    <section className={`workspace chart-grid count-${Math.min(panels.length,4)}`}>
      {panels.map(panel=><ChartPanel key={panel.id} panel={panel} markets={markets} onChange={updatePanel} onRemove={id=>setPanels(p=>p.length>1?p.filter(x=>x.id!==id):p)} tool={tool}/>)}
    </section>
    <footer className="bottom"><span>PURE CHART LABS · RESEARCH WORKSPACE</span><span>Public market data only · No trade execution · CSV and cached history stay in this browser</span></footer>
  </main>
}
