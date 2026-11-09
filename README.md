# Pure Chart Labs — offline-first starter

This is the first runnable milestone: a local-first V75 chart terminal with a dark layout, Deriv public market-data connection, timeframe selection, IndexedDB candle cache, offline shell caching, and a basic candle replay stepper.

## Requirements
- Node.js 20+ and npm
- Internet for the first install and for live Deriv market data

## Run on Linux
```bash
unzip pure-chart-labs.zip
cd pure-chart-labs
npm install
npm run dev
```
Open the local URL printed by Vite (usually http://localhost:5173).

## Build and run the production version
```bash
npm run build
npm run preview
```

## Offline behaviour
- Candles received from Deriv are saved in IndexedDB in this browser profile.
- The app shell is cached by a service worker after the app is visited over localhost or HTTPS.
- Previously saved candles remain viewable without internet.
- Live updates and downloading unseen history require internet.
- Use the same browser profile/device to access the local candle database.

## Important first-milestone limitations
- V75 uses Deriv symbol `R_75`.
- This is a charting application, not a trading execution terminal; it does not place trades or request account credentials.
- The initial version requests Deriv candle history and subscriptions for supported minute/hour/day granularities. Weekly/monthly aggregation, advanced drawing tools, indicators, full replay controls, symbol catalogue, and robust gap-repair are planned next.
- API availability and endpoint behaviour can change; verify against Deriv's current public API documentation if the feed changes.

## Data/API references
- https://developers.deriv.me/docs/data/ticks-history/
- https://developers.deriv.me/docs/data/ticks/
- https://developers.deriv.me/docs/workflows/
- https://tradingview.github.io/lightweight-charts/docs
