import React, { useEffect, useMemo, useRef, useState } from 'react'
import ChartCanvas from './ChartCanvas'
import { connectDeriv, fetchActiveSymbols, MARKET_FALLBACKS, CANDLE_HISTORY_LIMIT } from './deriv'
import { loadCandles, saveCandles } from './db'
import { parseCandleCSV } from './csv'
import { getBrowserStorage, loadPanels, savePanels } from './panels'
import { commit, createHistory, drawingsStorageKey, parseStoredDrawings, redo, undo } from './drawings'

const TIMEFRAMES = [
  ['1m',60],['2m',120],['5m',300],['10m',600],['15m',900],['30m',1800],
  ['1H',3600],['2H',7200],['4H',14400],['8H',28800],['1D',86400]
]
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const makePanel = (symbol='R_75') => ({ id: makeId(), symbol, tf:900 })
const CANVAS_THEME = {
  bg: '#090d12', scaleBg: '#0b1016', text: '#8290a3', grid: '#151d27',
  bull: '#26a69a', bear: '#ef5350', crosshair: '#526174'
}

function readDrawings(key, panelId, symbol) {
  try {
    const storage = localStorage
    const merged = new Map(parseStoredDrawings(storage.getItem(key)).map((drawing) => [drawing.id, drawing]))
    const legacyPrefix = `pcl-drawings:v2:${panelId}:${symbol}:`
    const legacyKeys = []
    for (let i = 0; i < storage.length; i++) {
      const storedKey = storage.key(i)
      if (storedKey?.startsWith(legacyPrefix)) legacyKeys.push(storedKey)
    }
    const panelLegacyKey = `pcl-drawings:${panelId}`
    if (storage.getItem(panelLegacyKey) !== null) legacyKeys.push(panelLegacyKey)
    if (!legacyKeys.length) return [...merged.values()]

    for (const legacyKey of legacyKeys.sort()) {
      for (const drawing of parseStoredDrawings(storage.getItem(legacyKey))) {
        if (!merged.has(drawing.id)) merged.set(drawing.id, drawing)
      }
    }
    const items = [...merged.values()]
    if (writeDrawings(key, items)) legacyKeys.forEach((legacyKey) => storage.removeItem(legacyKey))
    return items
  } catch { return [] }
}
function writeDrawings(key, items) {
  try { localStorage.setItem(key, JSON.stringify(items)); return true }
  catch (e) { console.warn('Drawing save failed', e); return false }
}

function ChartPanel({ panel, markets, onChange, onRemove, tool, onDrawingCreated }) {
  const canvasRef = useRef(null)
  const barsRef = useRef([])
  const modeRef = useRef('LIVE')
  const panelIdRef = useRef(panel.id)
  panelIdRef.current = panel.id

  const [status,setStatus] = useState(navigator.onLine ? 'connecting' : 'offline')
  const [price,setPrice] = useState(null)
  const [loaded,setLoaded] = useState(false)
  const [bars,setBars] = useState([])
  const [formingIndex,setFormingIndex] = useState(-1)
  const [mode,setMode] = useState('LIVE')
  const [replayIndex,setReplayIndex] = useState(0)
  const [store,setStore] = useState(null)
  const editBaseRef = useRef(null)

  // Drawings are shared across timeframes for this chart and market, anchored to time/price.
  const ctxKey = drawingsStorageKey(panel.id, panel.symbol)
  const drawContextRef = useRef({ panelId: panel.id, symbol: panel.symbol })
  drawContextRef.current = { panelId: panel.id, symbol: panel.symbol }
  const keyRef = useRef(ctxKey)
  keyRef.current = ctxKey
  const view = store?.key === ctxKey
    ? store
    : { key: ctxKey, history: createHistory(readDrawings(ctxKey, panel.id, panel.symbol)), selectedId: null }
  const updateView = (fn) => setStore((current) => {
    const key = keyRef.current
    const base = current?.key === key
      ? current
      : { key, history: createHistory(readDrawings(key, drawContextRef.current.panelId, drawContextRef.current.symbol)), selectedId: null }
    return { ...base, ...fn(base) }
  })

  useEffect(() => {
    if (store?.key === ctxKey) writeDrawings(ctxKey, store.history.present)
  }, [store, ctxKey])

  const selectedMarket = markets.find((m) => m.symbol === panel.symbol)
  const label = selectedMarket?.display_name || panel.symbol
  const priceDecimals = selectedMarket?.decimals ?? null
  const timeframe = TIMEFRAMES.find((x) => x[1] === panel.tf)?.[0] || `${panel.tf}s`
  const activeTool = tool === 'trend' ? 'trendline' : tool === 'rectangle' ? 'rectangle' : tool === 'long' ? 'long_position' : tool === 'short' ? 'short_position' : 'cursor'
  const marketGroups = useMemo(() => {
    const groups = new Map()
    for (const market of markets) {
      const group = market.group || 'Other Markets'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(market)
    }
    return [...groups.entries()]
  }, [markets])

  // Existing Deriv data and IndexedDB cache are kept intact; only the canvas adapter converts epoch seconds to ms.
  useEffect(() => {
    let cancelled = false
    barsRef.current = []
    setBars([])
    setFormingIndex(-1)
    setLoaded(false)
    setPrice(null)
    setMode('LIVE')
    setReplayIndex(0)
    setStatus(navigator.onLine ? 'connecting' : 'offline')
    ;(async () => {
      try {
        const cached = await loadCandles(panel.symbol, panel.tf, CANDLE_HISTORY_LIMIT)
        if (cancelled) return
        const merged = new Map(cached.map((bar) => [bar.time, bar]))
        barsRef.current.forEach((bar) => merged.set(bar.time, bar))
        const next = [...merged.values()].sort((a,b) => a.time-b.time).slice(-CANDLE_HISTORY_LIMIT)
        barsRef.current = next
        setBars(next)
        if (next.length) setPrice(next.at(-1).close)
      } catch (error) { console.warn('Candle cache read failed', error) }
      if (!cancelled) setLoaded(true)
    })()

    const cleanup = connectDeriv({
      symbol: panel.symbol,
      granularity: panel.tf,
      onStatus: (next) => { if (!cancelled) setStatus(next) },
      onCandles: (incoming) => {
        if (cancelled || !incoming.length) return
        const map = new Map(barsRef.current.map((bar) => [bar.time, bar]))
        incoming.forEach((bar) => map.set(bar.time, bar))
        const next = [...map.values()].sort((a,b) => a.time-b.time).slice(-CANDLE_HISTORY_LIMIT)
        barsRef.current = next
        setBars(next)
        setFormingIndex(next.length ? next.length - 1 : -1)
        saveCandles(panel.symbol, panel.tf, incoming).catch((error) => console.warn('Candle cache write failed', error))
        if (next.length) setPrice(next.at(-1).close)
      },
      onTick: (tick) => {
        if (cancelled || !Number.isFinite(tick.price)) return
        const start = Math.floor(tick.time / panel.tf) * panel.tf
        const nextBars = [...barsRef.current]
        const last = nextBars.at(-1)
        let next
        if (last && last.time === start) {
          next = { ...last, high: Math.max(last.high, tick.price), low: Math.min(last.low, tick.price), close: tick.price }
          nextBars[nextBars.length - 1] = next
        } else if (!last || start > last.time) {
          next = { time: start, open: tick.price, high: tick.price, low: tick.price, close: tick.price }
          nextBars.push(next)
        } else return
        if (nextBars.length > CANDLE_HISTORY_LIMIT) nextBars.splice(0, nextBars.length-CANDLE_HISTORY_LIMIT)
        barsRef.current = nextBars
        setBars(nextBars)
        setFormingIndex(nextBars.length - 1)
        if (modeRef.current !== 'REPLAY') setPrice(tick.price)
        saveCandles(panel.symbol, panel.tf, [next]).catch((error) => console.warn('Candle cache write failed', error))
      }
    })
    return () => { cancelled = true; cleanup() }
  }, [panel.symbol,panel.tf,panel.refresh])

  useEffect(() => { modeRef.current = mode }, [mode])

  const displayedBars = useMemo(
    () => mode === 'REPLAY' ? bars.slice(0, replayIndex) : bars,
    [bars, mode, replayIndex]
  )
  const canvasCandles = useMemo(() => displayedBars.map((bar) => ({
    timestamp: bar.time * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close
  })), [displayedBars])
  const visibleFormingIndex = mode === 'REPLAY' ? -1 : Math.min(formingIndex, canvasCandles.length - 1)
  const canvasDrawings = useMemo(() => view.history.present.map((drawing) => ({
    id: drawing.id,
    type: drawing.type === 'position' ? `${drawing.direction}_position` : drawing.type === 'trend' ? 'trendline' : drawing.type === 'rectangle' ? 'rectangle' : drawing.type,
    points: (drawing.type === 'position' ? [drawing.a, drawing.b, drawing.c] : [drawing.a, drawing.b].filter(Boolean))
      .map((point) => ({ timestamp: point.time * 1000, price: point.price })),
    color: drawing.color,
    hidden: drawing.hidden
  })), [view.history.present])

  const replay=()=>{
    if (!barsRef.current.length) return
    const n = Math.max(1, barsRef.current.length - 100)
    setReplayIndex(n)
    setMode('REPLAY')
  }
  const step=()=>setReplayIndex((index) => Math.min(index + 1, barsRef.current.length))
  const exit=()=>{ setMode('LIVE'); setReplayIndex(0); canvasRef.current?.goToLatest() }
  const undoDrawing = () => updateView((v) => ({ history: undo(v.history), selectedId: null }))
  const redoDrawing = () => updateView((v) => ({ history: redo(v.history), selectedId: null }))
  const clearDrawings = () => updateView((v) => ({ history: commit(v.history, []), selectedId: null }))
  const beginDrawingEdit = () => { editBaseRef.current = view.history.present }
  const endDrawingEdit = () => {
    const original = editBaseRef.current
    editBaseRef.current = null
    if (!original) return
    updateView((v) => v.history.present === original ? {} : {
      history: commit({ ...v.history, present: original }, v.history.present)
    })
  }
  const canUndo = view.history.past.length > 0
  const canRedo = view.history.future.length > 0
  const hasDrawings = view.history.present.length > 0

  function addCanvasDrawing(drawing) {
    if (drawing.type === 'long_position' || drawing.type === 'short_position') {
      const [entry, stop, target] = drawing.points || []
      if (!entry || !stop || !target) return
      const targetTime = target.timestamp / 1000
      const saved = {
        id: drawing.id,
        type: 'position',
        direction: drawing.type === 'long_position' ? 'long' : 'short',
        a: { time: entry.timestamp / 1000, price: entry.price },
        b: { time: targetTime, price: stop.price },
        c: { time: targetTime, price: target.price },
      }
      updateView((v) => ({ history: commit(v.history, [...v.history.present, saved]), selectedId: null }))
      onDrawingCreated?.()
      return
    }
    const type = drawing.type === 'trendline' ? 'trend' : drawing.type === 'rectangle' ? 'rectangle' : null
    if (!type || drawing.points.length < 2) return
    const [a,b] = drawing.points
    const saved = {
      id: drawing.id,
      type,
      a: { time: a.timestamp / 1000, price: a.price },
      b: { time: b.timestamp / 1000, price: b.price },
      color: drawing.color
    }
    updateView((v) => ({ history: commit(v.history, [...v.history.present, saved]), selectedId: null }))
    onDrawingCreated?.()
  }

  function deleteDrawing(id) {
    updateView((v) => ({ history: commit(v.history, v.history.present.filter((d) => d.id !== id)), selectedId: null }))
  }

  function updatePoint(id, pointIndex, point) {
    const converted = { time: point.timestamp / 1000, price: point.price }
    updateView((v) => ({ history: { ...v.history, present: v.history.present.map((d) => {
      if (d.id !== id) return d
      if (d.type === 'position') {
        if (pointIndex === 0) return { ...d, a: converted }
        if (pointIndex === 1) return { ...d, b: converted, c: { ...d.c, time: converted.time } }
        if (pointIndex === 2) return { ...d, b: { ...d.b, time: converted.time }, c: converted }
      }
      return pointIndex === 0 ? { ...d, a: converted } : { ...d, b: converted }
    }) } }))
  }

  function moveDrawing(id, deltaMs, deltaPrice) {
    const deltaSeconds = deltaMs / 1000
    updateView((v) => ({ history: { ...v.history, present: v.history.present.map((d) => d.id !== id ? d : {
      ...d,
      a: { time: d.a.time + deltaSeconds, price: d.a.price + deltaPrice },
      ...(d.b ? { b: { time: d.b.time + deltaSeconds, price: d.b.price + deltaPrice } } : {}),
      ...(d.c ? { c: { time: d.c.time + deltaSeconds, price: d.c.price + deltaPrice } } : {})
    }) } }))
  }

  function updateDrawingEdge(id, edge, point) {
    const snapped = { time: point.timestamp / 1000, price: point.price }
    updateView((v) => ({ history: { ...v.history, present: v.history.present.map((d) => {
      if (d.id !== id || d.type !== 'rectangle' || !d.b) return d
      const a = { ...d.a }, b = { ...d.b }
      if (edge === 'top') (a.price >= b.price ? a : b).price = snapped.price
      else if (edge === 'bottom') (a.price <= b.price ? a : b).price = snapped.price
      else if (edge === 'left') (a.time <= b.time ? a : b).time = snapped.time
      else if (edge === 'right') (a.time >= b.time ? a : b).time = snapped.time
      return { ...d, a, b }
    }) } }))
  }

  return <article className="chart-card">
    <div className="chart-card-head">
      <select aria-label="Market" value={panel.symbol} onChange={(e)=>onChange({...panel,symbol:e.target.value})}>
        {!markets.some((market)=>market.symbol===panel.symbol)&&<option value={panel.symbol}>{panel.symbol} (not in active catalogue)</option>}
        {marketGroups.map(([group,items])=><optgroup key={group} label={`${group} (${items.length})`}>
          {items.map((market)=><option key={market.symbol} value={market.symbol}>{market.display_name} · {market.symbol}</option>)}
        </optgroup>)}
      </select>
      <select aria-label="Timeframe" value={panel.tf} onChange={(e)=>onChange({...panel,tf:Number(e.target.value)})}>
        {TIMEFRAMES.map(([name,seconds])=><option key={seconds} value={seconds}>{name}</option>)}
      </select>
      <span className={`mini-status ${status==='connected'?'ok':''}`}>{status.toUpperCase()}</span>
      <span className="head-price">{price==null?'—':price.toLocaleString(undefined,{minimumFractionDigits:priceDecimals??0,maximumFractionDigits:priceDecimals??5})}</span>
      <button className="tiny-btn" onClick={()=>canvasRef.current?.goToLatest()} title="Go to latest candle">Fit</button>
      <button className="tiny-btn" onClick={mode==='REPLAY'?exit:replay}>{mode==='REPLAY'?'Exit':'Replay'}</button>
      {mode==='REPLAY'&&<button className="tiny-btn" onClick={step}>Step</button>}
      <button className="tiny-btn" onClick={undoDrawing} title="Undo (Ctrl+Z)" disabled={!canUndo}>↶</button>
      <button className="tiny-btn" onClick={redoDrawing} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo}>↷</button>
      <button className="tiny-btn danger" onClick={clearDrawings} title="Clear drawings" disabled={!hasDrawings}>Clear</button>
      <button className="tiny-btn danger" onClick={()=>onRemove(panel.id)} title="Remove chart">×</button>
    </div>
    <div className={`chart-wrap ${tool?'tool-active':''}`}>
      <ChartCanvas
        ref={canvasRef}
        candles={canvasCandles}
        theme={CANVAS_THEME}
        symbol={label}
        timeframeLabel={timeframe}
        decimals={priceDecimals}
        gridVisible={true}
        formingIndex={visibleFormingIndex}
        emptyMessage={!loaded ? 'Loading candles…' : status !== 'connected' ? 'No cached history. Check connection or import a CSV.' : 'Waiting for Deriv market data…'}
        activeTool={activeTool}
        drawings={canvasDrawings}
        onAddDrawing={addCanvasDrawing}
        onRemoveLastDrawing={() => updateView((v) => ({ history: commit(v.history, v.history.present.slice(0,-1)), selectedId: null }))}
        onDeleteDrawing={deleteDrawing}
        onUndoDrawing={undoDrawing}
        onRedoDrawing={redoDrawing}
        onBeginDrawingEdit={beginDrawingEdit}
        onEndDrawingEdit={endDrawingEdit}
        onUpdateDrawing={updatePoint}
        onMoveDrawing={moveDrawing}
        onUpdateDrawingEdge={updateDrawingEdge}
        selectedId={view.selectedId}
        onSelectDrawing={(id) => updateView(() => ({ selectedId: id }))}
      />
    </div>
    <div className="chart-card-foot"><span>{label} · {timeframe} · {mode}</span><span>{bars.length.toLocaleString()} bars</span></div>
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
    fetchActiveSymbols().then((list)=>{if(alive&&list.length){setMarkets(list);setMarketStatus(`${list.length} active symbols available`)}})
      .catch(()=>{if(alive)setMarketStatus('Using built-in market list')})
    return()=>{alive=false}
  },[])
  const addChart=()=>setPanels((p)=>[...p,makePanel(p[0]?.symbol||'R_75')])
  const updatePanel=(next)=>setPanels((p)=>p.map((x)=>x.id===next.id?next:x))
  const importCSV=async (e)=>{
    const file=e.target.files?.[0];if(!file)return
    try{
      const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),utf16=bytes[0]===0xff&&bytes[1]===0xfe,text=new TextDecoder(utf16?'utf-16le':'utf-8').decode(buffer),rows=parseCandleCSV(text)
      if(!rows.length)throw new Error('No valid OHLC rows found. Expected time/date, open, high, low, close columns.')
      const target=panels[0]
      await saveCandles(target.symbol,target.tf,rows)
      setCsvMessage(`Imported ${rows.length.toLocaleString()} candles into ${target.symbol} · ${TIMEFRAMES.find((x)=>x[1]===target.tf)?.[0]}. The chart is refreshing.`)
      const panelId=target.id
      setPanels((p)=>p.map((x)=>x.id===panelId?{...x,refresh:Date.now()}:x))
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
      {[['trend','／','Line'],['rectangle','□','Box'],['long','↗','Long Position'],['short','↘','Short Position']].map(([id,glyph,title])=><button key={id} title={title} aria-label={title} className={tool===id?'selected':''} onClick={()=>setTool(tool===id?null:id)}>{glyph}</button>)}
      <span className="tool-hint">{tool==='long'||tool==='short'?'Click Entry, Stop, Target · Esc cancels · ⌖ returns to cursor':tool?'Drag or click two points · Esc cancels · ⌖ returns to cursor':'Cursor: select/move drawings · Delete removes selected · Ctrl+Z undoes'}</span>
      {csvMessage&&<span className="csv-message">{csvMessage}</span>}
    </div>
    <section className={`workspace chart-grid count-${Math.min(panels.length,4)}`}>
      {panels.map((panel)=><ChartPanel key={panel.id} panel={panel} markets={markets} onChange={updatePanel} onRemove={(id)=>setPanels((p)=>p.length>1?p.filter((x)=>x.id!==id):p)} tool={tool} onDrawingCreated={()=>setTool(null)}/>) }
    </section>
    <footer className="bottom"><span>PURE CHART LABS · RESEARCH WORKSPACE</span><span>Public market data only · No trade execution · CSV and cached history stay in this browser</span></footer>
  </main>
}
