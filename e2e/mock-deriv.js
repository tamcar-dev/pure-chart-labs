export const CANDLE_HISTORY_LIMIT = 10000
export const MARKET_FALLBACKS = [
  { symbol: 'R_75', display_name: 'Volatility 75 Index', group: 'Synthetic Index · Random Index', decimals: 4 },
  { symbol: 'R_10', display_name: 'Volatility 10 Index', group: 'Synthetic Index · Random Index', decimals: 3 },
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', group: 'Forex · Major Pairs', decimals: 5 },
  { symbol: 'frxUSDJPY', display_name: 'USD/JPY', group: 'Forex · Major Pairs', decimals: 3 },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', group: 'Forex · Major Pairs', decimals: 5 },
  { symbol: 'frxXAUUSD', display_name: 'Gold/USD', group: 'Commodities · Metals', decimals: 2 },
]

export async function fetchActiveSymbols() { return MARKET_FALLBACKS }

export function connectDeriv({ symbol, granularity, onCandles, onStatus }) {
  let stopped = false
  const count = 2000
  const latest = Math.floor(Date.now() / 1000 / granularity) * granularity
  const candles = Array.from({ length: count }, (_, index) => {
    const time = latest - (count - 1 - index) * granularity
    const open = 100 + Math.sin(index / 9) * 4
    const close = 100 + Math.sin((index + 1) / 9) * 4
    return {
      time,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
    }
  })
  onStatus('connected')
  const timer = setTimeout(() => { if (!stopped) onCandles(candles) }, 10)
  return () => { stopped = true; clearTimeout(timer) }
}
