import React, { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts'
import { connectDeriv } from './deriv'
import { loadCandles, saveCandles } from './db'

const SYMBOL = 'R_75';
const TIMEFRAMES = [
  ['1m',60],['2m',120],['5m',300],['10m',600],['15m',900],['30m',1800],
  ['1H',3600],['2H',7200],['4H',14400],['8H',28800],['1D',86400]
];

function App() {
  const chartEl = useRef(null), chartRef = useRef(null), seriesRef = useRef(null), barsRef = useRef([]);
  const [tf, setTf] = useState(900), [status, setStatus] = useState(navigator.onLine ? 'connecting' : 'offline');
  const [mode, setMode] = useState('LIVE'), [lastPrice, setLastPrice] = useState(null);
  const [loaded, setLoaded] = useState(false), [replayIndex, setReplayIndex] = useState(0);
  const [symbolName] = useState('Volatility 75 Index');

  useEffect(() => {
    const chart = createChart(chartEl.current, {
      autoSize: true,
      layout: { background: { color: '#090d12' }, textColor: '#8290a3', fontFamily: 'Arial', fontSize: 11 },
      grid: { vertLines: { color: '#151d27' }, horzLines: { color: '#151d27' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#526174', labelBackgroundColor: '#263445' }, horzLine: { color: '#526174', labelBackgroundColor: '#263445' } },
      rightPriceScale: { borderColor: '#202a36' },
      timeScale: { borderColor: '#202a36', timeVisible: true, secondsVisible: false },
      handleScroll: true, handleScale: true
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350'
    });
    chartRef.current = chart; seriesRef.current = series;
    const resize = new ResizeObserver(() => chart.applyOptions({}));
    resize.observe(chartEl.current);
    return () => { resize.disconnect(); chart.remove(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    barsRef.current = []; setLoaded(false); setLastPrice(null); setMode('LIVE');
    (async () => {
      try {
        const cached = await loadCandles(SYMBOL, tf);
        if (cancelled) return;
        barsRef.current = cached;
        seriesRef.current?.setData(cached);
        if (cached.length) chartRef.current?.timeScale().fitContent();
      } catch (e) { console.warn('Local database unavailable', e); }
      if (!cancelled) setLoaded(true);
    })();
    const cleanup = connectDeriv({
      symbol: SYMBOL, granularity: tf,
      onStatus: s => { if (!cancelled) setStatus(s); },
      onCandles: incoming => {
        if (cancelled || !incoming.length) return;
        const map = new Map(barsRef.current.map(b => [b.time, b]));
        for (const b of incoming) map.set(b.time, b);
        const merged = [...map.values()].sort((a,b) => a.time-b.time).slice(-3000);
        barsRef.current = merged;
        seriesRef.current?.setData(merged);
        saveCandles(SYMBOL, tf, incoming).catch(console.warn);
        const last = merged.at(-1); if (last) setLastPrice(last.close);
      },
      onTick: tick => {
        if (cancelled || mode === 'REPLAY' || !Number.isFinite(tick.price)) return;
        const start = Math.floor(tick.time / tf) * tf;
        const bars = barsRef.current;
        const last = bars.at(-1);
        let next;
        if (last && last.time === start) next = { ...last, high:Math.max(last.high,tick.price), low:Math.min(last.low,tick.price), close:tick.price };
        else if (!last || start > last.time) next = { time:start, open:tick.price, high:tick.price, low:tick.price, close:tick.price };
        else return;
        if (last && last.time === start) bars[bars.length-1] = next; else bars.push(next);
        seriesRef.current?.update(next); setLastPrice(tick.price);
        saveCandles(SYMBOL, tf, [next]).catch(console.warn);
      }
    });
    return () => { cancelled = true; cleanup(); };
  }, [tf]);

  useEffect(() => {
    const online = () => setStatus('connecting');
    const offline = () => setStatus('offline');
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  const beginReplay = () => {
    if (!barsRef.current.length) return;
    setReplayIndex(Math.max(1, barsRef.current.length - 100)); setMode('REPLAY');
    seriesRef.current?.setData(barsRef.current.slice(0, Math.max(1, barsRef.current.length - 100)));
  };
  const replayStep = () => {
    const next = Math.min(replayIndex + 1, barsRef.current.length);
    setReplayIndex(next);
    seriesRef.current?.setData(barsRef.current.slice(0, next));
  };
  const exitReplay = () => { setMode('LIVE'); seriesRef.current?.setData(barsRef.current); chartRef.current?.timeScale().fitContent(); };

  return <main className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◈</span><b>Pure</b><span>Chart</span></div>
      <div className="divider"/>
      <div className="symbol"><small>DERIV</small><div><b>{symbolName}</b><span>{SYMBOL}</span></div><span className="chevron">⌄</span></div>
      <nav className="timeframes">{TIMEFRAMES.map(([label, seconds]) =>
        <button key={seconds} className={tf===seconds?'active':''} onClick={()=>setTf(seconds)}>{label}</button>)}</nav>
      <div className="top-spacer"/>
      <div className="status"><i className={status==='connected'?'online':''}/>{status==='connected'?'DERIV LIVE':status.toUpperCase()}</div>
      <button className="navbtn" onClick={()=>{setMode('LIVE');chartRef.current?.timeScale().scrollToRealTime()}}>Latest</button>
      {mode==='REPLAY' ? <button className="navbtn" onClick={replayStep}>▷ Step</button> : <button className="navbtn" onClick={beginReplay}>▷ Replay</button>}
      {mode==='REPLAY' && <button className="navbtn" onClick={exitReplay}>Exit replay</button>}
      <button className="iconbtn" title="Settings">⚙</button>
    </header>
    <section className="workspace">
      <aside className="tools"><button className="selected">⌖</button><button>／</button><button>－</button><button>▤</button><button>□</button><button>↶</button><button>▥</button></aside>
      <section className="chart-panel">
        <div className="chart-heading"><span>{symbolName} · {TIMEFRAMES.find(x=>x[1]===tf)?.[0]}</span><small>{lastPrice==null?'Waiting for price':lastPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}</small></div>
        <div ref={chartEl} className="chart" />
        {!loaded && <div className="loading">Loading locally stored candles…</div>}
        {loaded && !barsRef.current.length && status!=='connected' && <div className="loading">No saved candles yet. Connect to the internet to download the first history.</div>}
        <div className="chart-footer"><span>{mode==='REPLAY'?'REPLAY MODE':'MARKET DATA'}</span><span>{barsRef.current.length.toLocaleString()} candles cached</span></div>
      </section>
      <aside className="data-panel">
        <div className="panel-title">ⓘ &nbsp; Data <span>⌃</span></div>
        <dl>
          <dt>Symbol</dt><dd>{symbolName}</dd><dt>Code</dt><dd>{SYMBOL}</dd>
          <dt>Source</dt><dd className="accent">DERIV API</dd><dt>Connection</dt><dd className={status==='connected'?'accent':'warn'}>{status.toUpperCase()}</dd>
          <dt>Timeframe</dt><dd>{TIMEFRAMES.find(x=>x[1]===tf)?.[0]}</dd><dt>Construction</dt><dd>DERIV CANDLES</dd>
          <dt>Storage</dt><dd>LOCAL INDEXEDDB</dd><dt>Cached bars</dt><dd>{barsRef.current.length.toLocaleString()}</dd>
          <dt>Mode</dt><dd>{mode}</dd>
        </dl>
        <p className="panel-note">Historical candles are stored on this device and remain available offline.</p>
      </aside>
    </section>
    <footer className="bottom"><span>PURE CHART LABS · LOCAL-FIRST TERMINAL</span><span>Data updates require internet · Cached charts work offline</span></footer>
  </main>
}
export default App
