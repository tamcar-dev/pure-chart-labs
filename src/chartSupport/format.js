const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function guessDecimals(price) {
  const abs = Math.abs(price)
  if (abs >= 1000 || abs >= 10) return 2
  if (abs >= 1) return 4
  return 5
}

export function formatPrice(price, decimals) {
  if (decimals == null) decimals = guessDecimals(price)
  if (!Number.isFinite(Number(price))) return '—'
  return Number(price).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatDateShort(timestamp) {
  const date = new Date(timestamp)
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export function formatTimestamp(timestamp, timeframe) {
  const date = new Date(timestamp)
  const ms = timeframe?.ms || 0
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  if (ms >= 24 * 60 * 60 * 1000) {
    if (ms >= 7 * 24 * 60 * 60 * 1000) return `${month} ${year}`
    return `${day} ${month} ${year}`
  }
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} ${hours}:${minutes}`
}

export function formatTimeScale(timestamp, timeframe) {
  const date = new Date(timestamp)
  const ms = timeframe?.ms || 0
  if (ms >= 30 * 24 * 60 * 60 * 1000) return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  if (ms >= 24 * 60 * 60 * 1000) {
    if (ms >= 7 * 24 * 60 * 60 * 1000) return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
    return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]}`
  }
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
