import test from 'node:test'
import assert from 'node:assert/strict'
import { decimalsFromPipSize, normalizeActiveSymbols } from '../src/deriv.js'

test('derives exact price precision from Deriv pip size', () => {
  assert.equal(decimalsFromPipSize(0.00001), 5)
  assert.equal(decimalsFromPipSize(0.001), 3)
  assert.equal(decimalsFromPipSize(0.01), 2)
  assert.equal(decimalsFromPipSize(0.25), 2)
  assert.equal(decimalsFromPipSize(1e-7), 7)
  assert.equal(decimalsFromPipSize(0), null)
  assert.equal(decimalsFromPipSize(-0.01), null)
})

test('normalizes current Deriv active-symbol fields across market categories', () => {
  const symbols = normalizeActiveSymbols([
    { underlying_symbol: 'R_75', underlying_symbol_name: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.0001 },
    { underlying_symbol: 'frxEURUSD', underlying_symbol_name: 'EUR/USD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001 },
    { underlying_symbol: 'frxXAUUSD', underlying_symbol_name: 'Gold/USD', market: 'commodities', submarket: 'metals', pip_size: 0.01 },
    { underlying_symbol: '1SPX500', underlying_symbol_name: 'US 500', market: 'indices', submarket: 'americas_OTC' },
  ])

  assert.equal(symbols.length, 4)
  assert.deepEqual(symbols.map((item) => item.group), [
    'Commodities · Metals',
    'Forex · Major Pairs',
    'Indices · Americas OTC',
    'Synthetic Index · Random Index',
  ])
  assert.equal(symbols.find((item) => item.symbol === 'frxEURUSD')?.display_name, 'EUR/USD')
  assert.equal(symbols.find((item) => item.symbol === 'R_75')?.decimals, 4)
  assert.equal(symbols.find((item) => item.symbol === 'frxEURUSD')?.decimals, 5)
  assert.equal(symbols.find((item) => item.symbol === 'frxXAUUSD')?.decimals, 2)
})

test('supports legacy symbol fields, removes invalid entries, and deduplicates by symbol', () => {
  const symbols = normalizeActiveSymbols([
    { symbol: 'R_75', display_name: 'Volatility 75 Index', market_display_name: 'Derived', submarket_display_name: 'Volatility' },
    { symbol: 'R_75', display_name: 'Duplicate label', market: 'synthetic_index' },
    { symbol: '', display_name: 'No identifier', market: 'forex' },
    null,
  ])

  assert.deepEqual(symbols, [{ symbol: 'R_75', display_name: 'Volatility 75 Index', group: 'Derived · Volatility' }])
})
