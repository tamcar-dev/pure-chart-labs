const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
export function connectDeriv({ symbol, granularity, onCandles, onTick, onStatus }) {
  let ws, stopped = false, retryTimer, requestId = 1;
  let subscriptionId = null;
  const send = payload => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...payload, req_id: requestId++ })); };
  const connect = () => {
    if (stopped) return;
    onStatus('connecting');
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      onStatus('connected');
      send({ ticks_history: symbol, count: 3000, end: 'latest', style: 'candles', granularity, subscribe: 1 });
    };
    ws.onmessage = event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.error) { onStatus('error: ' + msg.error.message); return; }
      if (msg.msg_type === 'candles' || msg.candles) {
        const bars = (msg.candles || []).map(c => ({
          time: Number(c.epoch ?? c.open_time ?? c.time),
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
        })).filter(c => Number.isFinite(c.time) && Number.isFinite(c.open));
        if (bars.length) onCandles(bars);
        if (msg.subscription?.id) subscriptionId = msg.subscription.id;
      }
      if (msg.msg_type === 'ohlc' && msg.ohlc) {
        const c = msg.ohlc;
        onCandles([{ time:Number(c.open_time), open:Number(c.open), high:Number(c.high), low:Number(c.low), close:Number(c.close) }]);
      }
      if (msg.msg_type === 'tick' && msg.tick) onTick({ time:Number(msg.tick.epoch), price:Number(msg.tick.quote) });
    };
    ws.onclose = () => {
      subscriptionId = null;
      if (!stopped) { onStatus('offline'); retryTimer = setTimeout(connect, 3000); }
    };
    ws.onerror = () => onStatus('connection issue');
  };
  connect();
  return () => {
    stopped = true; clearTimeout(retryTimer);
    if (subscriptionId) send({ forget: subscriptionId });
    try { ws?.close(); } catch {}
  };
}
