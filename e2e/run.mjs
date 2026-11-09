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
await new Promise(r => server.listen(4173, r))

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] })
const results = []
let page, context

async function fresh() {
  if (context) await context.close()
  context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  page = await context.newPage()
  page.on('pageerror', e => results.push({ name: 'uncaught page error', ok: false, detail: e.message }))
  await page.goto('http://localhost:4173/')
  await page.waitForSelector('.chart-card .chart canvas')
  return page
}
const card = (i = 0) => page.locator('.chart-card').nth(i)
const chartBox = async (i = 0) => card(i).locator('.chart').boundingBox()
const at = async (fx, fy, i = 0) => { const b = await chartBox(i); return { x: b.x + b.width * fx, y: b.y + b.height * fy } }
const drawings = (i = 0) => card(i).locator('[data-testid=drawing]')
const tool = name => page.locator(`.toolstrip button[title="${name}"]`)
const clickAt = (x, y) => page.mouse.click(x, y)
async function line(i = 0) {
  const a = await at(.3, .35, i), b = await at(.65, .65, i)
  await clickAt(a.x, a.y); await clickAt(b.x, b.y)
}
async function box(i = 0) {
  const a = await at(.3, .35, i), b = await at(.65, .65, i)
  await clickAt(a.x, a.y); await clickAt(b.x, b.y)
}
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, detail: e.message.split('\n').slice(0, 3).join(' | ') }) }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }

await test('drawing overlay never blocks chart clicks, including while a tool is armed', async () => {
  await fresh()
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents) === 'none', 'overlay intercepts clicks in cursor mode')
  await tool('Line').click()
  const p = await at(.5, .5)
  const top = await page.evaluate(([x,y]) => document.elementFromPoint(x,y)?.tagName, [p.x,p.y])
  expect(top === 'CANVAS', `chart canvas is not target while tool armed: ${top}`)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents) === 'none', 'overlay intercepts clicks while armed')
})

await test('Line tool creates and saves a time/price-anchored line after two chart clicks', async () => {
  await fresh(); await tool('Line').click(); await line()
  expect(await drawings().count() === 1, `expected one line, got ${await drawings().count()}`)
  expect(await drawings().first().getAttribute('data-type') === 'trend', 'line has the wrong shape type')
  const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('pcl-drawings:v2:')))
  expect(saved.length === 1 && JSON.parse(saved[0][1]).length === 1, 'line not persisted under its chart context')
})

await test('Box tool creates a rectangle after two chart clicks', async () => {
  await fresh(); await tool('Box').click(); await box()
  expect(await drawings().count() === 1, 'box was not created')
  expect(await drawings().first().getAttribute('data-type') === 'rectangle', 'box has the wrong shape type')
  expect(await drawings().locator('rect').count() === 1, 'box rectangle is not visible')
})

await test('Line preview follows the cursor and Escape cancels a pending first point', async () => {
  await fresh(); await tool('Line').click()
  const a = await at(.3,.35); await clickAt(a.x,a.y)
  const m = await at(.5,.5); await page.mouse.move(m.x,m.y)
  expect(await card().locator('[data-testid=preview]').count() === 1, 'line preview did not appear')
  await page.keyboard.press('Escape')
  expect(await card().locator('[data-testid=pending]').count() === 0, 'Escape did not clear pending anchor')
  const b = await at(.65,.65); await clickAt(b.x,b.y)
  expect(await drawings().count() === 0, 'cancelled anchor completed a stale line')
})

await test('switching from Line to Box cancels a partial placement', async () => {
  await fresh(); await tool('Line').click()
  const a = await at(.3,.35); await clickAt(a.x,a.y)
  await tool('Box').click()
  expect(await card().locator('[data-testid=pending]').count() === 0, 'tool switch did not clear pending anchor')
  await box()
  expect(await drawings().count() === 1 && await drawings().first().getAttribute('data-type') === 'rectangle', 'the newly selected Box tool did not draw a box')
})

await test('select, delete, undo and redo a line', async () => {
  await fresh(); await tool('Line').click(); await line()
  const a = await at(.3,.35), b = await at(.65,.65)
  await page.locator('.iconbtn[title="Cursor"]').click()
  await clickAt((a.x+b.x)/2,(a.y+b.y)/2)
  expect(await drawings().locator('circle').count() > 0, 'line could not be selected')
  await page.keyboard.press('Delete')
  expect(await drawings().count() === 0, 'Delete did not remove selected line')
  await page.keyboard.press('Control+z')
  expect(await drawings().count() === 1, 'undo did not restore deleted line')
  await page.keyboard.press('Control+Shift+z')
  expect(await drawings().count() === 0, 'redo did not remove the line again')
})

await test('undo/redo buttons and Clear operate on drawings', async () => {
  await fresh(); await tool('Box').click(); await box()
  const undo = card().locator('button[title^="Undo"]'), redo = card().locator('button[title^="Redo"]')
  expect(!(await undo.isDisabled()), 'undo was disabled after drawing')
  await undo.click(); expect(await drawings().count() === 0, 'undo button did not remove the box')
  expect(!(await redo.isDisabled()), 'redo stayed disabled after undo')
  await redo.click(); expect(await drawings().count() === 1, 'redo button did not restore the box')
  await card().locator('button[title="Clear drawings"]').click()
  expect(await drawings().count() === 0, 'Clear did not remove the box')
})

await test('drawings survive reload and remain scoped to chart and timeframe', async () => {
  await fresh(); await tool('Line').click(); await line()
  await page.reload(); await page.waitForSelector('.chart-card .chart canvas')
  expect(await drawings().count() === 1, 'line did not survive page reload')
  await page.locator('button', { hasText: 'Add chart' }).click()
  await page.waitForSelector('.chart-card:nth-child(2) .chart canvas')
  await tool('Box').click(); await box(1)
  expect(await drawings(0).count() === 1 && await drawings(1).count() === 1, 'drawings were not isolated per chart')
  await card(0).locator('select[aria-label="Timeframe"]').selectOption('60')
  expect(await drawings(0).count() === 0, '15m line leaked into 1m context')
  await card(0).locator('select[aria-label="Timeframe"]').selectOption('900')
  expect(await drawings(0).count() === 1, 'line did not restore in original timeframe')
})

await test('drawings stay anchored to time/price when the time axis scrolls', async () => {
  await fresh(); await tool('Line').click(); await line()
  const before = await page.evaluate(() => { const l = document.querySelector('[data-testid=drawing] line'); return { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1') } })
  await page.evaluate(() => window.__fake.pan(50)); await page.waitForTimeout(50)
  const after = await page.evaluate(() => { const l = document.querySelector('[data-testid=drawing] line'); return { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1') } })
  expect(Math.abs((before.x1 - 50) - after.x1) < .01, `x moved ${before.x1}->${after.x1}`)
  expect(Math.abs(before.y1 - after.y1) < .01, 'y changed while scrolling')
})

await test('no uncaught page errors during drawing interactions', async () => {
  const errs = results.filter(r => r.name === 'uncaught page error')
  expect(errs.length === 0, errs.map(e => e.detail).join('; '))
})

if (context) await context.close()
await browser.close()
server.close()
const failed = results.filter(r => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
