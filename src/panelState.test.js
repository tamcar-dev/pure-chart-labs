import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPanels, savePanels, PANELS_STORAGE_KEY } from './panelState.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('restores panel IDs and settings unchanged so drawings keep their storage key', () => {
  const saved = [{ id: 'stable-panel', symbol: 'R_75', tf: 900 }]
  const storage = memoryStorage({ [PANELS_STORAGE_KEY]: JSON.stringify(saved) })
  const restored = loadPanels(storage, () => assert.fail('should not create a new panel'))
  assert.deepEqual(restored, saved)
  assert.equal(`pcl-drawings:${restored[0].id}`, 'pcl-drawings:stable-panel')
})

test('falls back to one new panel when saved JSON is corrupt', () => {
  let created = 0
  const storage = memoryStorage({ [PANELS_STORAGE_KEY]: '{broken' })
  const fallback = { id: 'new-id', symbol: 'R_75', tf: 900 }
  assert.deepEqual(loadPanels(storage, () => { created++; return fallback }), [fallback])
  assert.equal(created, 1)
})

test('falls back to one new panel when storage is empty', () => {
  const fallback = { id: 'new-id', symbol: 'R_75', tf: 900 }
  assert.deepEqual(loadPanels(memoryStorage(), () => fallback), [fallback])
})

test('drops invalid entries and preserves every valid panel', () => {
  const valid = { id: 'valid', symbol: 'R_25', tf: 300 }
  const storage = memoryStorage({ [PANELS_STORAGE_KEY]: JSON.stringify([
    { id: '', symbol: 'R_75', tf: 900 },
    { id: 'bad-timeframe', symbol: 'R_75', tf: -60 },
    { id: 'bad-type', symbol: 'R_75', tf: '900' },
    { id: 'bad-symbol', symbol: '', tf: 900 },
    valid,
  ]) })
  assert.deepEqual(loadPanels(storage, () => assert.fail('valid entries should be retained')), [valid])
})

test('saves only panel identity and chart settings for reload', () => {
  const storage = memoryStorage()
  const panels = [{ id: 'p1', symbol: 'R_50', tf: 300, refresh: 123 }]
  assert.equal(savePanels(storage, panels), true)
  assert.deepEqual(JSON.parse(storage.getItem(PANELS_STORAGE_KEY)), [{ id: 'p1', symbol: 'R_50', tf: 300 }])
})

test('reports storage quota or write failures without throwing', () => {
  const storage = { setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(savePanels(storage, [{ id: 'p1', symbol: 'R_50', tf: 300 }]), false)
})
