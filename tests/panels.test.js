import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPanels, savePanels, PANELS_STORAGE_KEY } from '../src/panels.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    data
  }
}
const makePanel = () => ({ id: 'default', symbol: 'R_75', tf: 900 })

test('save then load round-trips panels and strips UI-only fields', () => {
  const storage = memoryStorage()
  const panels = [{ id: 'a', symbol: 'R_10', tf: 60, refresh: 123 }]
  assert.equal(savePanels(storage, panels), true)
  assert.deepEqual(JSON.parse(storage.data[PANELS_STORAGE_KEY]), [{ id: 'a', symbol: 'R_10', tf: 60 }])
  assert.deepEqual(loadPanels(storage, makePanel), [{ id: 'a', symbol: 'R_10', tf: 60 }])
})

test('loads default panel when storage is empty', () => {
  assert.deepEqual(loadPanels(memoryStorage(), makePanel), [makePanel()])
})

test('corrupt JSON falls back to default', () => {
  const storage = memoryStorage({ [PANELS_STORAGE_KEY]: '{oops' })
  assert.deepEqual(loadPanels(storage, makePanel), [makePanel()])
})

test('invalid entries are dropped; default is used only when none survive', () => {
  const storage = memoryStorage({
    [PANELS_STORAGE_KEY]: JSON.stringify([{ id: 'x', symbol: 'R_10', tf: 'bad' }, { id: '', symbol: 'R_10', tf: 60 }])
  })
  assert.deepEqual(loadPanels(storage, makePanel), [makePanel()])
  const mixed = memoryStorage({
    [PANELS_STORAGE_KEY]: JSON.stringify([{ id: 'x', symbol: 'R_10', tf: 'bad' }, { id: 'ok', symbol: 'R_25', tf: 60 }])
  })
  assert.deepEqual(loadPanels(mixed, makePanel), [{ id: 'ok', symbol: 'R_25', tf: 60 }])
})

test('null storage (blocked localStorage) does not throw', () => {
  assert.deepEqual(loadPanels(null, makePanel), [makePanel()])
  assert.equal(savePanels(null, []), false)
})

test('savePanels reports quota/storage failures instead of throwing', () => {
  const failing = { setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(savePanels(failing, [{ id: 'a', symbol: 'R_10', tf: 60 }]), false)
})
