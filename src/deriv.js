const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public'
export const CANDLE_HISTORY_LIMIT = 10000

export function decimalsFromPipSize(pipSize) {
  const value = Number(pipSize)
  if (!Number.isFinite(value) || value <= 0) return null
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e')
  const decimals = (mantissa.split('.')[1] || '').length - Number(exponent)
  return Math.max(0, Math.min(12, decimals))
}

export const MARKET_FALLBACKS = [
  {symbol:'R_10',display_name:'Volatility 10 Index',group:'Synthetic Index · Random Index',decimals:3},
  {symbol:'R_25',display_name:'Volatility 25 Index',group:'Synthetic Index · Random Index',decimals:3},
  {symbol:'R_50',display_name:'Volatility 50 Index',group:'Synthetic Index · Random Index',decimals:4},
  {symbol:'R_75',display_name:'Volatility 75 Index',group:'Synthetic Index · Random Index',decimals:4},
  {symbol:'R_100',display_name:'Volatility 100 Index',group:'Synthetic Index · Random Index',decimals:2},
  {symbol:'1HZ10V',display_name:'Volatility 10 (1s) Index',group:'Synthetic Index · Random Index',decimals:2},
  {symbol:'1HZ25V',display_name:'Volatility 25 (1s) Index',group:'Synthetic Index · Random Index',decimals:2},
  {symbol:'1HZ50V',display_name:'Volatility 50 (1s) Index',group:'Synthetic Index · Random Index',decimals:2},
  {symbol:'1HZ75V',display_name:'Volatility 75 (1s) Index',group:'Synthetic Index · Random Index',decimals:2},
  {symbol:'1HZ100V',display_name:'Volatility 100 (1s) Index',group:'Synthetic Index · Random Index',decimals:2}
]

function categoryLabel(value) {
  if (!value) return ''
  return String(value).replace(/_/g, ' ').split(' ').map((word) => {
    if (word.toLowerCase() === 'otc') return 'OTC'
    return word ? word[0].toUpperCase() + word.slice(1) : word
  }).join(' ')
}

export function normalizeActiveSymbols(activeSymbols) {
  if (!Array.isArray(activeSymbols)) return []
  const bySymbol = new Map()
  for (const item of activeSymbols) {
    const symbol = String(item?.underlying_symbol || item?.symbol || '').trim()
    if (!symbol) continue
    const display_name = String(item.underlying_symbol_name || item.display_name || symbol).trim()
    const market = item.market_display_name || categoryLabel(item.market)
    const submarket = item.submarket_display_name || categoryLabel(item.submarket) || categoryLabel(item.subgroup)
    const decimals = decimalsFromPipSize(item.pip_size)
    const normalized = {symbol, display_name, group:[market, submarket].filter(Boolean).join(' · ') || 'Other Markets', ...(decimals == null ? {} : {decimals})}
    const previous = bySymbol.get(symbol)
    if (!previous) bySymbol.set(symbol, normalized)
    else bySymbol.set(symbol, {
      ...previous,
      ...(previous.display_name === symbol && display_name !== symbol ? {display_name} : {}),
      ...(previous.group === 'Other Markets' && normalized.group !== 'Other Markets' ? {group:normalized.group} : {}),
      ...(previous.decimals == null && decimals != null ? {decimals} : {}),
    })
  }
  return [...bySymbol.values()].sort((a,b)=>a.group.localeCompare(b.group)||a.display_name.localeCompare(b.display_name)||a.symbol.localeCompare(b.symbol))
}

export function fetchActiveSymbols(timeoutMs=9000) {
  return new Promise((resolve,reject)=>{
    let ws,done=false,timer
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);try{ws?.close()}catch{};err?reject(err):resolve(value)}
    try{ws=new WebSocket(WS_URL)}catch(e){reject(e);return}
    timer=setTimeout(()=>finish(new Error('Market catalogue request timed out')),timeoutMs)
    ws.onopen=()=>ws.send(JSON.stringify({active_symbols:'brief',req_id:1}))
    ws.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data)}catch{return}
      if(msg.error){finish(new Error(msg.error.message));return}
      if(msg.msg_type==='active_symbols'&&Array.isArray(msg.active_symbols)){
        const list=normalizeActiveSymbols(msg.active_symbols)
        finish(null,list.length?list:MARKET_FALLBACKS)
      }
    }
    ws.onerror=()=>finish(new Error('Could not load market catalogue'))
  })
}

function mergeSourceCandles(sourceCandles, targetGranularity, buckets) {
  const touched = new Set()
  for (const candle of sourceCandles) {
    const time = Math.floor(candle.time / targetGranularity) * targetGranularity
    let bucket = buckets.get(time)
    if (!bucket) {
      bucket = {time,open:candle.open,high:candle.high,low:candle.low,close:candle.close,firstTime:candle.time,lastTime:candle.time}
      buckets.set(time, bucket)
    } else {
      bucket.high = Math.max(bucket.high, candle.high)
      bucket.low = Math.min(bucket.low, candle.low)
      if (candle.time <= bucket.firstTime) { bucket.open = candle.open; bucket.firstTime = candle.time }
      if (candle.time >= bucket.lastTime) { bucket.close = candle.close; bucket.lastTime = candle.time }
    }
    touched.add(time)
  }
  return [...touched].map((time) => {
    const {open,high,low,close} = buckets.get(time)
    return {time,open,high,low,close}
  }).sort((a,b)=>a.time-b.time)
}

export function connectDeriv({symbol,granularity,onCandles,onTick,onStatus}) {
  const sourceGranularity = granularity === 8 * 60 * 60 ? 2 * 60 * 60 : granularity
  const aggregationFactor = granularity / sourceGranularity
  const sourceHistoryLimit = CANDLE_HISTORY_LIMIT * aggregationFactor + aggregationFactor - 1
  const targetBuckets = new Map()
  let ws=null,stopped=false,retryTimer=null,requestId=1,subscriptionId=null,attempt=0
  const pending=new Map()
  const send=payload=>{
    if(ws?.readyState===WebSocket.OPEN){
      const req_id=requestId++
      ws.send(JSON.stringify({...payload,req_id}))
      return req_id
    }
    return null
  }
  const requestHistory=(end,count,subscribe=0)=>new Promise((resolve,reject)=>{
    const req_id=send({ticks_history:symbol,count,end,style:'candles',granularity:sourceGranularity,adjust_start_time:1,...(subscribe?{subscribe}: {})})
    if(req_id==null){reject(new Error('History request could not be sent'));return}
    const timer=setTimeout(()=>{pending.delete(req_id);reject(new Error('Candle history request timed out'))},15000)
    pending.set(req_id,{resolve,reject,timer})
  })
  const connect=()=>{
    if(stopped||!navigator.onLine){onStatus('offline');return}
    onStatus(attempt?'reconnecting':'connecting')
    try{ws=new WebSocket(WS_URL)}catch(e){scheduleRetry();return}
    ws.onopen=async()=>{
      attempt=0;onStatus('connected')
      try{
        let end='latest',loaded=0,lastOldest=Infinity
        while(!stopped&&loaded<sourceHistoryLimit){
          const count=Math.min(1000,sourceHistoryLimit-loaded)
          const msg=await requestHistory(end,count)
          if(msg.error)throw new Error(msg.error.message)
          const candles=(msg.candles||[]).map(c=>({time:Number(c.epoch??c.open_time??c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}))
            .filter(c=>Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(Number.isFinite))
          if(!candles.length)break
          const targetCandles = aggregationFactor === 1 ? candles : mergeSourceCandles(candles, granularity, targetBuckets)
          if(targetCandles.length)onCandles(targetCandles)
          const oldest=Math.min(...candles.map(c=>c.time))
          if(oldest>=lastOldest)break
          lastOldest=oldest
          loaded+=candles.length
          end=String(Math.floor(oldest)-sourceGranularity)
          if(candles.length<count)break
        }
        if(!stopped)send({ticks:symbol,subscribe:1})
      }catch(error){
        if(!stopped)onStatus(`history error: ${error.message}`)
      }
    }
    ws.onmessage=event=>{
      let msg;try{msg=JSON.parse(event.data)}catch{return}
      const waiting=pending.get(msg.req_id)
      if(waiting){clearTimeout(waiting.timer);pending.delete(msg.req_id);waiting.resolve(msg)}
      if(msg.error){onStatus(`error: ${msg.error.message}`);return}
      if(msg.subscription?.id)subscriptionId=msg.subscription.id
      if(!waiting&&(msg.msg_type==='candles'||Array.isArray(msg.candles))){
        const bars=(msg.candles||[]).map(c=>({
          time:Number(c.epoch??c.open_time??c.time),
          open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)
        })).filter(c=>Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(Number.isFinite))
        if(bars.length)onCandles(bars)
      }
      if(msg.msg_type==='ohlc'&&msg.ohlc){
        const c=msg.ohlc,bar={time:Number(c.open_time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}
        if([bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite))onCandles([bar])
      }
      if(msg.msg_type==='tick'&&msg.tick)onTick({time:Number(msg.tick.epoch),price:Number(msg.tick.quote)})
    }
    ws.onerror=()=>onStatus('connection issue')
    ws.onclose=()=>{subscriptionId=null;if(!stopped)scheduleRetry()}
  }
  const scheduleRetry=()=>{
    if(stopped)return
    attempt++;onStatus(navigator.onLine?'reconnecting':'offline')
    clearTimeout(retryTimer)
    retryTimer=setTimeout(connect,Math.min(30000,1500*2**Math.min(attempt,4)))
  }
  const online=()=>{if(!stopped&&(!ws||ws.readyState===WebSocket.CLOSED))connect()}
  const offline=()=>{onStatus('offline');try{ws?.close()}catch{}}
  window.addEventListener('online',online);window.addEventListener('offline',offline)
  connect()
  return()=>{
    stopped=true;clearTimeout(retryTimer)
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Connection closed'))}
    pending.clear()
    window.removeEventListener('online',online);window.removeEventListener('offline',offline)
    if(subscriptionId)send({forget:subscriptionId})
    try{ws?.close()}catch{}
  }
}
