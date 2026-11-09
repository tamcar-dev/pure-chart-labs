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
Select Trend line, Horizontal line, Vertical line, Rectangle or Fibonacci, then click on a chart (once for horizontal/vertical, twice for the others). Drawings are saved locally per chart panel and have per-chart undo/redo/clear controls. Drawings are not exported into the candle CSV.

## Offline
- Downloaded/imported candles are stored in IndexedDB per symbol and timeframe.
- The application shell and static assets are cached by the service worker after the first successful visit over HTTPS or localhost.
- Live feeds and unseen history require internet access.
- Local data is browser-profile-specific.

## Important limitations
- Deriv catalogue availability and symbol access depend on the public API and may change.
- Weekly/monthly aggregation, Fibonacci tools, channels, indicators, full-featured replay, drawing selection/editing/deletion, channels, measurement, indicators, full-featured replay, and gap-repair backfill are not implemented in this release.
- This is a repaired functional foundation, not a claim of complete TradingView parity.
