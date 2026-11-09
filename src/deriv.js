const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public'

export const MARKET_FALLBACKS = [
  {symbol:'R_10',display_name:'Volatility 10 Index'},
  {symbol:'R_25',display_name:'Volatility 25 Index'},
  {symbol:'R_50',display_name:'Volatility 50 Index'},
  {symbol:'R_75',display_name:'Volatility 75 Index'},
  {symbol:'R_100',display_name:'Volatility 100 Index'},
  {symbol:'1HZ10V',display_name:'Volatility 10 (1s) Index'},
  {symbol:'1HZ25V',display_name:'Volatility 25 (1s) Index'},
  {symbol:'1HZ50V',display_name:'Volatility 50 (1s) Index'},
  {symbol:'1HZ75V',display_name:'Volatility 75 (1s) Index'},
  {symbol:'1HZ100V',display_name:'Volatility 100 (1s) Index'}
]

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
        const list=msg.active_symbols.filter(x=>x.symbol&&/synthetic|derived/i.test(`${x.market||''} ${x.market_display_name||''} ${x.submarket||''}`))
          .map(x=>({symbol:x.symbol,display_name:x.display_name||x.symbol}))
          .sort((a,b)=>a.display_name.localeCompare(b.display_name))
        finish(null,list.length?list:MARKET_FALLBACKS)
      }
    }
    ws.onerror=()=>finish(new Error('Could not load market catalogue'))
  })
}

export function connectDeriv({symbol,granularity,onCandles,onTick,onStatus}) {
  let ws=null,stopped=false,retryTimer=null,requestId=1,subscriptionId=null,attempt=0
  const send=payload=>{
    if(ws?.readyState===WebSocket.OPEN){
      const req_id=requestId++
      ws.send(JSON.stringify({...payload,req_id}))
      return req_id
    }
    return null
  }
  const connect=()=>{
    if(stopped||!navigator.onLine){onStatus('offline');return}
    onStatus(attempt?'reconnecting':'connecting')
    try{ws=new WebSocket(WS_URL)}catch(e){scheduleRetry();return}
    ws.onopen=()=>{
      attempt=0;onStatus('connected')
      send({ticks_history:symbol,count:3000,end:'latest',style:'candles',granularity,subscribe:1})
    }
    ws.onmessage=event=>{
      let msg;try{msg=JSON.parse(event.data)}catch{return}
      if(msg.error){onStatus(`error: ${msg.error.message}`);return}
      if(msg.subscription?.id)subscriptionId=msg.subscription.id
      if(msg.msg_type==='candles'||Array.isArray(msg.candles)){
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
    window.removeEventListener('online',online);window.removeEventListener('offline',offline)
    if(subscriptionId)send({forget:subscriptionId})
    try{ws?.close()}catch{}
  }
}
