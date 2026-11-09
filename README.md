# Pure Chart Labs

A local-first market research chart workspace built with React, Vite and Lightweight Charts.

## Run locally
Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

## Markets and data
- The app requests Deriv's public active-symbol catalogue and filters it to synthetic/derived markets.
- A short built-in volatility-index list is used if catalogue discovery is unavailable.
- Each chart has its own symbol, timeframe, live market-data connection, local candle cache, replay state and drawings.
- History is fetched in pages, targeting up to 10,000 candles per chart when Deriv has that much data available.
- Market data uses Deriv's current public WebSocket endpoint; public market-data requests do not require account authentication.
- The application does not request account credentials or execute trades.

## CSV import
Use **Import CSV** to import OHLC candles into the first chart's selected market/timeframe cache. Supported formats:
- Header-based `epoch/open/high/low/close` or `datetime/open/high/low/close`.
- Separate `date,time,open,high,low,close` columns.
- Comma-, semicolon- or tab-separated files.
- UTF-8 and UTF-16LE BOM input.
- Headerless MT-style columns `date,time,open,high,low,close,...`.

Timestamps are interpreted as Unix seconds/milliseconds or parseable date/time text. The CSV import is intentionally conservative: rows with invalid OHLC relationships are skipped.

## Drawings
The workspace exposes only **Line** and **Box**. Choose one, then click two chart points; click **Cursor** to select a drawing, then use Delete/Backspace to remove it. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo; per-chart buttons also provide undo, redo and clear. Drawings are anchored to time/price, saved locally per panel, market and timeframe, and are not exported in candle CSV files.

These are custom SVG overlays connected to Lightweight Charts' chart events and coordinate APIs. They are not TradingView's proprietary Charting Library drawing tools and do not provide full TradingView parity.

## Offline
- Downloaded/imported candles are stored in IndexedDB per symbol and timeframe.
- The application shell and static assets are cached by the service worker after the first successful visit over HTTPS or localhost.
- Live feeds and unseen history require internet access.
- Local data is browser-profile-specific.

## Important limitations
- Deriv catalogue availability and symbol access depend on the public API and may change.
- Weekly/monthly aggregation, channels, indicators, full-featured replay, dragging/editing drawing anchors, measurement, and gap-repair backfill are not implemented in this release.
- This is a repaired functional foundation, not a claim of complete TradingView parity.

## Tests
- `npm test` runs data, panel and drawing-model unit tests.
- `npm run test:e2e` builds a fake-chart browser bundle and tests drawing interactions with Chromium (install Playwright's Chromium first if needed). The fake chart verifies UI/event wiring, not the real chart library's rendering.
