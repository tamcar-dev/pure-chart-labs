export const PANELS_STORAGE_KEY = 'pcl-panels:v1'
export const SUPPORTED_TIMEFRAMES = new Set([60,120,300,600,900,1800,3600,7200,14400,28800,86400])

// Returns the browser's localStorage, or null if storage is blocked (privacy modes, sandboxed iframes).
export function getBrowserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadPanels(storage, makePanel) {
  try {
    const parsed = JSON.parse(storage.getItem(PANELS_STORAGE_KEY) || 'null')
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed
        .filter(panel =>
          panel &&
          typeof panel.id === 'string' && panel.id !== '' &&
          typeof panel.symbol === 'string' &&
          SUPPORTED_TIMEFRAMES.has(panel.tf)
        )
        .map(({ id, symbol, tf }) => ({ id, symbol, tf }))
      if (valid.length) return valid
    }
  } catch {
    // Corrupt JSON or unavailable storage: fall through to the default panel
  }
  return [makePanel()]
}

export function savePanels(storage, panels) {
  try {
    storage.setItem(
      PANELS_STORAGE_KEY,
      JSON.stringify(panels.map(({ id, symbol, tf }) => ({ id, symbol, tf })))
    )
    return true
  } catch {
    return false
  }
}
