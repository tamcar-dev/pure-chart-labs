# Pure Chart Labs

A local-first market research chart workspace built with React, Vite, and a custom HTML5 Canvas chart renderer.

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

- The app requests Deriv's public active-symbol catalogue and lists all returned active symbols, grouped by market and submarket (including forex, indices, commodities, cryptocurrency, and synthetic indices).
- A short built-in volatility-index list is used if catalogue discovery is unavailable.
- Each chart has its own symbol, timeframe, live market-data connection, local candle cache, replay state, and drawings.
- Historical loading pages backward in requests of up to 1,000 candles, targeting 10,000 candles per chart when Deriv has that much history available.
- Market data uses Deriv's public WebSocket endpoint; public market-data requests do not require account authentication.
- The application does not request account credentials or execute trades.

## CSV import

Use **Import CSV** to import OHLC candles into the first chart's selected market/timeframe cache. Supported formats include header-based `epoch/open/high/low/close` or `datetime/open/high/low/close`, separate `date,time,open,high,low,close` columns, comma/semicolon/tab separators, UTF-8 and UTF-16LE BOM input, and headerless MT-style columns `date,time,open,high,low,close,...`.

Timestamps are interpreted as Unix seconds/milliseconds or parseable date/time text. Rows with invalid OHLC relationships are skipped.

## Drawings

The workspace exposes only **Line** and **Box**. Select a tool and either click two chart points or drag to place it. Use **Cursor** to select a drawing; drag a line endpoint or a box edge to edit, and press Delete/Backspace to remove the selected drawing. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo, including drawing edits; per-chart controls also provide undo, redo, and clear. Drawings are anchored to time/price and stored locally per chart panel and market, so they remain available when switching timeframes. If the selected or most recent drawing would be off-screen after an interval change, the chart pans and scales to bring it into view. Existing timeframe-specific drawings are migrated into the shared chart/market set.

The chart renderer and drawing interactions are custom implementations. They are not TradingView's proprietary Charting Library and do not claim full TradingView parity.

## Offline

- Downloaded/imported candles are stored in IndexedDB per symbol and timeframe.
- The application shell and static assets are cached by the service worker after the first successful visit over HTTPS or localhost.
- Live feeds and unseen history require internet access.
- Local data is browser-profile-specific.

## Important limitations

- The history target is subject to Deriv's available data, public API behavior, and market-specific access.
- The application is a functional charting foundation, not a claim of complete TradingView parity.

## Tests

- `npm test` runs data, panel, and drawing-model unit tests.
- `npm run test:e2e` bundles the app with deterministic market-data and cache adapters, then tests canvas rendering, drawing interactions, persistence, undo/redo, and navigation with Playwright and Chromium. Install Playwright's Chromium browser if needed.
