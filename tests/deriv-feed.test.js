import test from 'node:test'
import assert from 'node:assert/strict'
import { connectDeriv } from '../src/deriv.js'

const eightHourAnchor = Math.floor(1700000100 / 28800) * 28800
const fourHourAnchor = Math.floor(1700000100 / 14400) * 14400
const currentFourHourTime = fourHourAnchor + 2 * 3600 + 30

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static sent = []

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.OPEN
    setTimeout(() => this.onopen?.(), 0)
  }

  send(serialized) {
    const request = JSON.parse(serialized)
    FakeWebSocket.sent.push(request)
    if (request.ticks_history) {
      const candles = request.granularity === 7200
        ? [
            { epoch: eightHourAnchor, open: 1.1, high: 1.3, low: 1.0, close: 1.2 },
            { epoch: eightHourAnchor + 7200, open: 1.2, high: 1.5, low: 1.1, close: 1.4 },
            { epoch: eightHourAnchor + 14400, open: 1.4, high: 1.6, low: 0.9, close: 1.5 },
            { epoch: eightHourAnchor + 21600, open: 1.5, high: 1.8, low: 1.2, close: 1.7 },
          ]
        : request.granularity === 60
          ? (() => {
              const endMinute = Math.floor(currentFourHourTime / 60) * 60
              const firstMinute = endMinute - 239 * 60
              return Array.from({ length: 240 }, (_, index) => {
                const epoch = firstMinute + index * 60
                if (epoch < fourHourAnchor) return { epoch, open: 99, high: 100, low: 98, close: 99.5 }
                if (epoch === fourHourAnchor) return { epoch, open: 1.01, high: 1.04, low: 1.00, close: 1.03 }
                return { epoch, open: 1.03, high: 1.20, low: 0.98, close: 1.05 }
              })
            })()
          : [{ epoch: request.granularity === 28800 ? eightHourAnchor : request.granularity === 14400 ? fourHourAnchor : 1700000100, open: 1.1, high: 1.2, low: 1.0, close: 1.15 }]
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({
        msg_type: 'candles',
        req_id: request.req_id,
        candles,
      }) }), 0)
    } else if (request.ticks) {
      const sourceGranularity = FakeWebSocket.sent.findLast((item) => item.ticks_history)?.granularity
      const epoch = sourceGranularity === 7200 ? eightHourAnchor + 7 * 3600 + 30 : sourceGranularity === 60 ? currentFourHourTime : 1700000130
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({
        msg_type: 'tick',
        req_id: request.req_id,
        tick: { epoch, quote: 1.175, symbol: request.ticks },
        subscription: { id: 'test-subscription' },
      }) }), 0)
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    setTimeout(() => this.onclose?.(), 0)
  }
}

test('connectDeriv refines only the active 4H candle from aligned 1m history', async () => {
  const fourHour = await runFakeFeed(14400)
  const minuteHistory = fourHour.requests.find((request) => request.ticks_history && request.granularity === 60)
  assert.equal(minuteHistory?.count, 240)
  assert.equal(minuteHistory?.adjust_start_time, 1)
  assert.equal(fourHour.requests.find((request) => request.ticks === 'frxEURUSD')?.subscribe, 1)

  const activeBars = fourHour.candles.filter((bar) => bar.time === fourHourAnchor)
  assert.equal(activeBars.length, 2, 'native history and the active-bucket refinement should share one anchor')
  assert.deepEqual(activeBars.at(-1), {
    time: fourHourAnchor,
    open: 1.01,
    high: 1.20,
    low: 0.98,
    close: 1.05,
  })
  assert.equal(fourHour.candles.some((bar) => bar.time === fourHourAnchor - 4 * 3600), false,
    'the incomplete previous bucket must not be emitted')
  assert.deepEqual(fourHour.tick, { time: currentFourHourTime, price: 1.175 })
})

async function runFakeFeed(granularity) {
  const descriptors = Object.fromEntries(['WebSocket', 'navigator', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  FakeWebSocket.sent = []
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })

  let tick = null
  const candles = []
  let cleanup
  try {
    cleanup = connectDeriv({
      symbol: 'frxEURUSD',
      granularity,
      onCandles: (next) => candles.push(...next),
      onTick: (next) => { tick = next },
      onStatus() {},
    })
    const deadline = Date.now() + 1500
    while (!tick && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    return { requests: FakeWebSocket.sent.slice(), candles, tick }
  } finally {
    cleanup?.()
    for (const key of ['WebSocket', 'navigator', 'window']) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key])
      else delete globalThis[key]
    }
  }
}

test('connectDeriv aligns history, aggregates 8H from UTC 2H candles, and subscribes to live ticks', async () => {
  const native = await runFakeFeed(300)
  const nativeHistory = native.requests.find((request) => request.ticks_history)
  const nativeTicks = native.requests.find((request) => request.ticks === 'frxEURUSD')
  assert.equal(nativeHistory?.adjust_start_time, 1)
  assert.equal(nativeHistory?.granularity, 300)
  assert.equal(nativeTicks?.subscribe, 1, 'native timeframe did not subscribe to raw ticks')
  assert.deepEqual(native.tick, { time: 1700000130, price: 1.175 })

  const eightHour = await runFakeFeed(28800)
  const history = eightHour.requests.find((request) => request.ticks_history && request.granularity === 28800)
  const recentSource = eightHour.requests.find((request) => request.ticks_history && request.granularity === 7200)
  const ticks = eightHour.requests.find((request) => request.ticks === 'frxEURUSD')
  assert.equal(history?.granularity, 28800, 'full 8H history should retain the native request')
  assert.equal(history?.adjust_start_time, 1)
  assert.equal(recentSource?.granularity, 7200, 'recent 8H candles should be verified from 2H sources')
  assert.equal(recentSource?.adjust_start_time, 1)
  assert.equal(ticks?.subscribe, 1)
  assert.equal(eightHour.requests.filter((request) => request.ticks_history).length, 2)
  assert.equal(eightHour.candles.length, 2)
  assert.deepEqual(eightHour.candles.at(-1), {
    time: eightHourAnchor,
    open: 1.1,
    high: 1.8,
    low: 0.9,
    close: 1.7,
  })
  assert.deepEqual(eightHour.tick, { time: eightHourAnchor + 7 * 3600 + 30, price: 1.175 })
})
