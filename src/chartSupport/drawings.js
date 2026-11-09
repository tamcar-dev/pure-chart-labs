export const DRAW_TOOLS = [
  { id: 'cursor', label: 'Cursor', icon: 'MousePointer2', points: 0 },
  { id: 'trendline', label: 'Trend Line', icon: 'PenLine', points: 2 },
  { id: 'horizontal', label: 'Horizontal Line', icon: 'Minus', points: 1 },
  { id: 'fibonacci', label: 'Fibonacci Retracement', icon: 'Rows3', points: 2 },
  { id: 'rectangle', label: 'Rectangle', icon: 'Square', points: 2 },
]

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]
export const DEFAULT_DRAW_COLOR = '#4a9eff'

export function createDrawing(type, points, color = DEFAULT_DRAW_COLOR) {
  return {
    id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    points,
    color,
    hidden: false,
  }
}
