import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts'
import { connectDeriv, fetchActiveSymbols, MARKET_FALLBACKS } from './deriv'
import { loadCandles, saveCandles } from './db'
import { parseCandleCSV } from './csv'

const TIMEFRAMES = [
  ['1m',60],['2m',120],['5m',300],['10m',600],['15m',900],['30m',1800],
  ['1H',3600],['2H',7200],['4H',14400],['8H',28800],['1D',86400]
]
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const makePanel = (symbol='R_75') => ({ id: makeId(), symbol, tf:900 })

function DrawingLayer({ chart, series, tool, drawings, setDrawings, panelId }) {
  const [points, setPoints] = useState([])
  const [,setRevision] = useState(0)
  const [size, setSize] = useState({w:0,h:0})
  const svgRef = useRef(null)
  useEffect(() => {
    if (!svgRef.current) return
    const ro = new ResizeObserver(entries => {
      const r=entries[0].contentRect; setSize({w:r.width,h:r.height})
    })
    ro.observe(svgRef.current); return () => ro.disconnect()
  }, [])
  useEffect(() => { setPoints([]) }, [tool, panelId])
  useEffect(() => {
    if (!chart) return
    const redraw=()=>setRevision(v=>v+1)
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw)
    chart.subscribeCrosshairMove(redraw)
    return ()=>{chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);chart.unsubscribeCrosshairMove(redraw)}
  },[chart])
  useEffect(() => {
    if (!chart || !series || !tool) return
    const handleChartClick = param => {
      if (!param.point) return
      const {x,y}=param.point
      const time=param.time ?? chart.timeScale().coordinateToTime(x)
      const price=series.coordinateToPrice(y)
      if (time == null || price == null) return
      const p={time,price}
      if (tool==='horizontal' || tool==='vertical') {
        setDrawings(d=>[...d,{id:makeId(),type:tool,a:p}]); return
      }
      const next=[...points,p]
      if (next.length===2) {
        setDrawings(d=>[...d,{id:makeId(),type:tool,a:next[0],b:next[1]}]); setPoints([])
      } else setPoints(next)
    }
    chart.subscribeClick(handleChartClick)
    return () => chart.unsubscribeClick(handleChartClick)
  },[chart,series,tool,points,setDrawings])
  const coords = p => ({ x:chart?.timeScale().timeToCoordinate(p.time), y:series?.priceToCoordinate(p.price) })
  return <svg ref={svgRef} className={`drawing-layer ${tool?'drawing-active':''}`} width="100%" height="100%">
    {drawings.map(d=>{
      const a=coords(d.a), b=d.b?coords(d.b):null
      if (a.x==null || a.y==null) return null
      if (d.type==='horizontal') return <line key={d.id} x1="0" x2={size.w} y1={a.y} y2={a.y} stroke="#e4b84f" strokeWidth="1.5" />
      if (d.type==='vertical') return <line key={d.id} x1={a.x} x2={a.x} y1="0" y2={size.h} stroke="#e4b84f" strokeWidth="1.5" />
      if (!b || b.x==null || b.y==null) return null
      if (d.type==='rectangle') return <rect key={d.id} x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)} fill="#2eb6a3" fillOpacity=".10" stroke="#2eb6a3" strokeWidth="1.5"/>
      if (d.type==='fibonacci') return <g key={d.id}>{[0,.236,.382,.5,.618,.786,1].map(level=>{const y=a.y+(b.y-a.y)*level;return <g key={level}><line x1="0" x2={size.w} y1={y} y2={y} stroke="#8b9eb3" strokeOpacity=".7" strokeDasharray="4 3"/><text x="8" y={y-3} fill="#aeb9c7" fontSize="9">{Math.round(level*1000)/10}%</text></g>})}</g>
      return <line key={d.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e4b84f" strokeWidth="1.5"/>
    })}
    {points.map((p,i)=>{const c=coords(p);return c.x==null||c.y==null?null:<circle key={i} cx={c.x} cy={c.y} r="4" fill="#e4b84f"/>})}
  </svg>
}

function ChartPanel({ panel, markets, onChange, onRemove, tool, onStatus }) {
  const el=useRef(null), chartRef=useRef(null), seriesRef=useRef(null), barsRef=useRef([]), modeRef=useRef('LIVE')
  const [status,setStatus]=useState(navigator.onLine?'connecting':'offline'), [chartApi,setChartApi]=useState(null)
  const [price,setPrice]=useState(null), [loaded,setLoaded]=useState(false), [mode,setMode]=useState('LIVE'), [redoDrawings,setRedoDrawings]=useState([])
  const [replayIndex,setReplayIndex]=useState(0), [drawings,setDrawings]=useState([])
  const label=markets.find(m=>m.symbol===panel.symbol)?.display_name || panel.symbol
  const timeframe=TIMEFRAMES.find(x=>x[1]===panel.tf)?.[0] || `${panel.tf}s`
  const storageKey=`pcl-drawings:${panel.id}`
  useEffect(()=>{try{setDrawings(JSON.parse(localStorage.getItem(storageKey)||'[]'))}catch{setDrawings([])}},[storageKey])
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(drawings))}catch{}},[storageKey,drawings])
  useEffect(()=>{modeRef.current=mode},[mode])
  useEffect(()=>{
    const chart=createChart(el.current,{
      autoSize:true, layout:{background:{color:'#090d12'},textColor:'#8290a3',fontFamily:'Arial',fontSize:11},
      grid:{vertLines:{color:'#151d27'},horzLines:{color:'#151d27'}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#526174',labelBackgroundColor:'#263445'},horzLine:{color:'#526174',labelBackgroundColor:'#263445'}},
      rightPriceScale:{borderColor:'#202a36'},timeScale:{borderColor:'#202a36',timeVisible:true,secondsVisible:false},
      handleScroll:true,handleScale:true
    })
    const series=chart.addSeries(CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350'})
    chartRef.current=chart;seriesRef.current=series;setChartApi({chart,series})
    return ()=>{setChartApi(null);chart.remove()}
  },[])
  useEffect(()=>{
    let cancelled=false
    barsRef.current=[];setLoaded(false);setPrice(null);setMode('LIVE')
    ;(async()=>{
      try{
        const cached=await loadCandles(panel.symbol,panel.tf)
        if(cancelled)return
        const merged=new Map(cached.map(b=>[b.time,b]))
        barsRef.current.forEach(b=>merged.set(b.time,b))
        barsRef.current=[...merged.values()].sort((a,b)=>a.time-b.time).slice(-5000)
        seriesRef.current?.setData(barsRef.current)
        if(barsRef.current.length)chartRef.current?.timeScale().fitContent()
      }catch(e){console.warn('Candle cache read failed',e)}
      if(!cancelled)setLoaded(true)
    })()
    const cleanup=connectDeriv({
      symbol:panel.symbol,granularity:panel.tf,
      onStatus:s=>{if(!cancelled){setStatus(s);onStatus?.(s)}},
      onCandles:incoming=>{
        if(cancelled||!incoming.length)return
        const map=new Map(barsRef.current.map(b=>[b.time,b]))
        incoming.forEach(b=>map.set(b.time,b))
        const merged=[...map.values()].sort((a,b)=>a.time-b.time).slice(-5000)
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
        if(modeRef.current!=='REPLAY')seriesRef.current?.update(next);setPrice(tick.price)
        saveCandles(panel.symbol,panel.tf,[next]).catch(e=>console.warn(e))
      }
    })
    return()=>{cancelled=true;cleanup()}
  },[panel.symbol,panel.tf,panel.refresh])
  const replay=()=>{if(!barsRef.current.length)return;const n=Math.max(1,barsRef.current.length-100);setReplayIndex(n);setMode('REPLAY');seriesRef.current?.setData(barsRef.current.slice(0,n))}
  const step=()=>{const n=Math.min(replayIndex+1,barsRef.current.length);setReplayIndex(n);seriesRef.current?.setData(barsRef.current.slice(0,n))}
  const exit=()=>{setMode('LIVE');seriesRef.current?.setData(barsRef.current);chartRef.current?.timeScale().fitContent()}
  const updateDrawings=updater=>{setDrawings(current=>typeof updater==='function'?updater(current):updater);setRedoDrawings([])}
  const undoDrawing=()=>{if(!drawings.length)return;setRedoDrawings(r=>[...r,drawings.at(-1)]);setDrawings(drawings.slice(0,-1))}
  const redoDrawing=()=>{if(!redoDrawings.length)return;setDrawings(d=>[...d,redoDrawings.at(-1)]);setRedoDrawings(redoDrawings.slice(0,-1))}
  const clearDrawings=()=>{setDrawings([]);setRedoDrawings([])}
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
      <button className="tiny-btn" onClick={undoDrawing} title="Undo drawing" disabled={!drawings.length}>↶</button><button className="tiny-btn" onClick={redoDrawing} title="Redo drawing" disabled={!redoDrawings.length}>↷</button><button className="tiny-btn danger" onClick={clearDrawings} title="Clear drawings">Clear</button>
      <button className="tiny-btn danger" onClick={()=>onRemove(panel.id)} title="Remove chart">×</button>
    </div>
    <div className="chart-wrap">
      <div ref={el} className="chart"/>
      <DrawingLayer chart={chartApi?.chart} series={chartApi?.series} tool={tool} drawings={drawings} setDrawings={updateDrawings} panelId={panel.id}/>
      {!loaded&&<div className="loading">Loading cached candles…</div>}
      {loaded&&!barsRef.current.length&&status!=='connected'&&<div className="loading">No cached history. Check connection or import a CSV.</div>}
    </div>
    <div className="chart-card-foot"><span>{label} · {timeframe} · {mode}</span><span>{barsRef.current.length.toLocaleString()} bars</span></div>
  </article>
}

export default function App(){
  const [markets,setMarkets]=useState(MARKET_FALLBACKS)
  const [panels,setPanels]=useState([makePanel()])
  const [tool,setTool]=useState(null),[marketStatus,setMarketStatus]=useState('Loading markets…')
  const [csvMessage,setCsvMessage]=useState('')
  const fileRef=useRef(null)
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
  const activeTool=tool
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
      {[['trend','／','Trend line'],['horizontal','―','Horizontal line'],['vertical','│','Vertical line'],['rectangle','□','Rectangle'],['fibonacci','F','Fibonacci']].map(([id,glyph,title])=><button key={id} title={title} className={tool===id?'selected':''} onClick={()=>setTool(tool===id?null:id)}>{glyph}</button>)}
      <span className="tool-hint">{tool?`Click ${tool==='horizontal'?'once':'twice'} on a chart to draw · select Cursor to stop`:'Select a drawing tool, then draw directly on a chart'}</span>
      {csvMessage&&<span className="csv-message">{csvMessage}</span>}
    </div>
    <section className={`workspace chart-grid count-${Math.min(panels.length,4)}`}>
      {panels.map(panel=><ChartPanel key={panel.id} panel={panel} markets={markets} onChange={updatePanel} onRemove={id=>setPanels(p=>p.length>1?p.filter(x=>x.id!==id):p)} tool={activeTool}/>)}
    </section>
    <footer className="bottom"><span>PURE CHART LABS · RESEARCH WORKSPACE</span><span>Public market data only · No trade execution · CSV and cached history stay in this browser</span></footer>
  </main>
}
