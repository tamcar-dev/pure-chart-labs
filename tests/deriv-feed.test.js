import test from 'node:test'
import assert from 'node:assert/strict'
import { connectDeriv } from '../src/deriv.js'

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
      const candle = { epoch: 1700000100, open: 1.1, high: 1.2, low: 1.0, close: 1.15 }
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({
        msg_type: 'candles',
        req_id: request.req_id,
        candles: [candle],
      }) }), 0)
    } else if (request.ticks) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({
        msg_type: 'tick',
        req_id: request.req_id,
        tick: { epoch: 1700000130, quote: 1.175, symbol: request.ticks },
        subscription: { id: 'test-subscription' },
      }) }), 0)
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    setTimeout(() => this.onclose?.(), 0)
  }
}

test('connectDeriv aligns history requests and subscribes to raw live ticks', async () => {
  const descriptors = {
    WebSocket: Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  }
  const hadWindow = 'window' in globalThis
  FakeWebSocket.sent = []
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })

  let tick = null
  let candleCount = 0
  let cleanup
  try {
    cleanup = connectDeriv({
      symbol: 'frxEURUSD',
      granularity: 300,
      onCandles: (candles) => { candleCount += candles.length },
      onTick: (next) => { tick = next },
      onStatus() {},
    })
    const deadline = Date.now() + 1500
    while (!tick && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))

    const historyRequest = FakeWebSocket.sent.find((request) => request.ticks_history)
    const tickRequest = FakeWebSocket.sent.find((request) => request.ticks === 'frxEURUSD')
    assert.equal(historyRequest?.adjust_start_time, 1)
    assert.equal(historyRequest?.granularity, 300)
    assert.ok(candleCount > 0, 'historical candle response was not delivered')
    assert.equal(tickRequest?.subscribe, 1, 'live feed did not subscribe to raw ticks')
    assert.deepEqual(tick, { time: 1700000130, price: 1.175 })
  } finally {
    cleanup?.()
    for (const key of ['WebSocket', 'navigator', 'window']) {
      const descriptor = descriptors[key]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else if (key !== 'window' || !hadWindow) delete globalThis[key]
    }
  }
})
