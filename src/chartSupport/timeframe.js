export const TIMEFRAMES = [
  { label: '1m', ms: 60_000 }, { label: '2m', ms: 120_000 }, { label: '3m', ms: 180_000 },
  { label: '5m', ms: 300_000 }, { label: '10m', ms: 600_000 }, { label: '15m', ms: 900_000 },
  { label: '30m', ms: 1_800_000 }, { label: '1H', ms: 3_600_000 }, { label: '2H', ms: 7_200_000 },
  { label: '4H', ms: 14_400_000 }, { label: '6H', ms: 21_600_000 }, { label: '8H', ms: 28_800_000 },
  { label: '12H', ms: 43_200_000 }, { label: '1D', ms: 86_400_000 }, { label: '1W', ms: 604_800_000 },
  { label: '1M', ms: 2_592_000_000 }
]

export function getTimeframe(label) {
  return TIMEFRAMES.find((tf) => tf.label === label) || TIMEFRAMES[0]
}
