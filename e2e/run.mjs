import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(4173, resolve))

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] })
const results = []
let page, context

async function fresh() {
  if (context) await context.close()
  context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  page = await context.newPage()
  page.on('pageerror', (error) => results.push({ name: 'uncaught page error', ok: false, detail: error.message }))
  await page.goto('http://localhost:4173/')
  await page.waitForSelector('.canvas-chart__surface')
  await page.waitForFunction(() => Number(document.querySelector('.canvas-chart')?.dataset.candleCount || 0) >= 200)
  return page
}
const card = (i = 0) => page.locator('.chart-card').nth(i)
const canvas = (i = 0) => card(i).locator('[data-testid="chart-canvas"]')
const chartBox = async (i = 0) => canvas(i).boundingBox()
const at = async (fx, fy, i = 0) => { const b = await chartBox(i); return { x: b.x + b.width * fx, y: b.y + b.height * fy } }
const tool = (name) => page.locator(`.toolstrip button[title="${name}"]`)
const storedDrawings = async () => page.evaluate(() => {
  const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
  return entry ? JSON.parse(entry[1]) : []
})
const clickAt = (point) => page.mouse.click(point.x, point.y)
async function drawTwoPoints(fx1 = .3, fy1 = .35, fx2 = .65, fy2 = .65, i = 0) {
  await clickAt(await at(fx1, fy1, i))
  await clickAt(await at(fx2, fy2, i))
  await page.waitForFunction(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    return entry && JSON.parse(entry[1]).length > 0
  })
}
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }) }
  catch (error) { results.push({ name, ok: false, detail: error.message.split('\n').slice(0, 3).join(' | ') }) }
}
const expect = (condition, message) => { if (!condition) throw new Error(message) }

await test('canvas renders the fetched candle history and navigation controls', async () => {
  await fresh()
  expect(Number(await card().locator('.canvas-chart').getAttribute('data-candle-count')) >= 200, 'expected candles in canvas adapter')
  expect(await card().locator('.canvas-chart__nav-button').count() === 4, 'zoom/history controls are missing')
})

await test('Line tool creates a time/price anchored line and persists it', async () => {
  await fresh(); await tool('Line').click(); await drawTwoPoints()
  const drawings = await storedDrawings()
  expect(drawings.length === 1 && drawings[0].type === 'trend', 'expected one persisted trend line')
  expect(Number.isFinite(drawings[0].a.time) && Number.isFinite(drawings[0].b.price), 'line is not anchored in time/price coordinates')
})

await test('Box tool creates a persisted rectangle', async () => {
  await fresh(); await tool('Box').click(); await drawTwoPoints()
  const drawings = await storedDrawings()
  expect(drawings.length === 1 && drawings[0].type === 'rectangle', 'expected a persisted rectangle')
})

await test('Box can also be placed with a drag gesture', async () => {
  await fresh(); await tool('Box').click()
  const a = await at(.32,.32), b = await at(.62,.62)
  await page.mouse.move(a.x,a.y); await page.mouse.down()
  await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up()
  await page.waitForFunction(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    return entry && JSON.parse(entry[1]).length === 1
  })
  expect((await storedDrawings())[0].type === 'rectangle', 'drag-to-draw did not create a rectangle')
})

await test('Escape cancels a pending Line anchor and prevents a stale completion', async () => {
  await fresh(); await tool('Line').click()
  await clickAt(await at(.3, .35)); await page.keyboard.press('Escape')
  await clickAt(await at(.65, .65)); await page.waitForTimeout(50)
  expect((await storedDrawings()).length === 0, 'cancelled anchor completed a stale line')
})

await test('switching from Line to Box cancels partial placement', async () => {
  await fresh(); await tool('Line').click(); await clickAt(await at(.3, .35))
  await tool('Box').click(); await drawTwoPoints()
  const drawings = await storedDrawings()
  expect(drawings.length === 1 && drawings[0].type === 'rectangle', 'partial Line anchor leaked into Box placement')
})

await test('selected drawing can be deleted; undo and redo restore it', async () => {
  await fresh(); await tool('Line').click(); await drawTwoPoints()
  const a = await at(.3, .35)
  await page.locator('.iconbtn[title="Cursor"]').click()
  await clickAt(a)
  await page.waitForTimeout(50)
  expect(!!await card().locator('.canvas-chart').getAttribute('data-selected-drawing'), 'canvas did not select the line at its first endpoint')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    return entry && JSON.parse(entry[1]).length === 0
  })
  await page.keyboard.press('Control+z')
  await page.waitForFunction(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    return entry && JSON.parse(entry[1]).length === 1
  })
  await page.keyboard.press('Control+Shift+z')
  await page.waitForFunction(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    return entry && JSON.parse(entry[1]).length === 0
  })
})

await test('line endpoint drag updates its saved time/price anchor', async () => {
  await fresh(); await tool('Line').click(); await drawTwoPoints()
  const before = (await storedDrawings())[0].a
  const start = await at(.3,.35), end = await at(.42,.25)
  await page.mouse.move(start.x,start.y); await page.mouse.down()
  await page.mouse.move(end.x,end.y,{steps:8}); await page.mouse.up()
  await page.waitForFunction((original) => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    if (!entry) return false
    const drawing = JSON.parse(entry[1])[0]
    return drawing && (drawing.a.time !== original.time || drawing.a.price !== original.price)
  }, before)
  expect((await storedDrawings())[0].a.time !== before.time, 'dragged anchor timestamp did not change')
  await page.keyboard.press('Control+z')
  await page.waitForFunction((original) => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    if (!entry) return false
    const drawing = JSON.parse(entry[1])[0]
    return drawing && drawing.a.time === original.time && drawing.a.price === original.price
  }, before)
})

await test('rectangle edge drag resizes one side and is undoable', async () => {
  await fresh(); await tool('Box').click(); await drawTwoPoints(.3,.35,.65,.65)
  const before = (await storedDrawings())[0]
  const edge = await at(.475,.35), target = await at(.475,.25)
  await page.mouse.move(edge.x,edge.y); await page.mouse.down()
  await page.mouse.move(target.x,target.y,{steps:8}); await page.mouse.up()
  await page.waitForFunction((original) => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    if (!entry) return false
    const drawing = JSON.parse(entry[1])[0]
    return drawing && (drawing.a.price !== original.a.price || drawing.b.price !== original.b.price)
  }, before)
  await page.keyboard.press('Control+z')
  await page.waitForFunction((original) => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith('pcl-drawings:v2:'))
    if (!entry) return false
    const drawing = JSON.parse(entry[1])[0]
    return drawing && drawing.a.price === original.a.price && drawing.b.price === original.b.price
  }, before)
})

await test('drawing remains persisted after reload and is scoped to its chart/timeframe', async () => {
  await fresh(); await tool('Line').click(); await drawTwoPoints()
  await page.reload()
  await page.waitForSelector('.canvas-chart__surface')
  await page.waitForFunction(() => Number(document.querySelector('.canvas-chart')?.dataset.candleCount || 0) >= 200)
  expect((await storedDrawings()).length === 1, 'drawing did not survive reload')
  await card().locator('select[aria-label="Timeframe"]').selectOption('60')
  expect((await storedDrawings()).length === 1, 'switching timeframe overwrote stored context')
  await card().locator('select[aria-label="Timeframe"]').selectOption('900')
  expect((await storedDrawings()).length === 1, 'drawing was lost after returning to its original timeframe')
})

await test('canvas responds to zoom and pan input', async () => {
  await fresh()
  const before = await canvas().evaluate((el) => el.toDataURL())
  await card().locator('.canvas-chart__nav-button[title="Zoom in"]').click()
  await page.waitForTimeout(80)
  const afterZoom = await canvas().evaluate((el) => el.toDataURL())
  expect(before !== afterZoom, 'zoom control did not change rendered chart pixels')
  const box = await chartBox()
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(50)
})

await test('no uncaught page errors during canvas interactions', async () => {
  const errors = results.filter((result) => result.name === 'uncaught page error')
  expect(errors.length === 0, errors.map((error) => error.detail).join('; '))
})

if (context) await context.close()
await browser.close()
server.close()
const failed = results.filter((result) => !result.ok)
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n      ${result.detail}`}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
