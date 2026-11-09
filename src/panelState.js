export const PANELS_STORAGE_KEY = 'pcl-panels:v1'

export function loadPanels(storage, makePanel) {
  try {
    const parsed = JSON.parse(storage.getItem(PANELS_STORAGE_KEY) || 'null')
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed.filter(panel =>
        panel && typeof panel.id === 'string' && panel.id &&
        typeof panel.symbol === 'string' && Number.isFinite(panel.tf)
      ).map(({ id, symbol, tf }) => ({ id, symbol, tf }))
      if (valid.length) return valid
    }
  } catch {}
  return [makePanel()]
}

export function savePanels(storage, panels) {
  try {
    storage.setItem(PANELS_STORAGE_KEY, JSON.stringify(
      panels.map(({ id, symbol, tf }) => ({ id, symbol, tf }))
    ))
    return true
  } catch {
    return false
  }
}
