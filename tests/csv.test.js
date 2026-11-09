import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCandleCSV } from '../src/csv.js'

test('parses epoch OHLC headers',()=>{
  const rows=parseCandleCSV('epoch,open,high,low,close\n1794240000,1,2,0.5,1.5')
  assert.equal(rows.length,1)
  assert.deepEqual(rows[0],{time:1794240000,open:1,high:2,low:0.5,close:1.5})
})
test('parses MT-style date and time columns without a header',()=>{
  const rows=parseCandleCSV('2026.11.09,12:00,1,2,0.5,1.5,10\n2026.11.09,12:01,1.5,2.1,1.2,2,11')
  assert.equal(rows.length,2)
  assert.equal(rows[1].close,2)
  assert.equal(rows[1].time-rows[0].time,60)
})
test('parses separate date/time header and removes duplicate timestamps',()=>{
  const rows=parseCandleCSV('Date;Time;Open;High;Low;Close\n2026.11.09;12:00;1;2;0.5;1.5\n2026.11.09;12:00;1;2;0.5;1.5')
  assert.equal(rows.length,1)
})
test('rejects invalid OHLC relationships',()=>{
  assert.equal(parseCandleCSV('time,open,high,low,close\n1794240000,1,0.8,0.5,1.5').length,0)
})
