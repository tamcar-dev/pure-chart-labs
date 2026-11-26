const DB_NAME = 'pure-chart-labs';
const STORE = 'candles';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('symbol_tf', 'symbol_tf', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveCandles(symbol, granularity, candles) {
  if (!candles?.length) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const c of candles) store.put({ ...c, key: `${symbol}|${granularity}|${c.time}`, symbol_tf: `${symbol}|${granularity}` });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function loadCandles(symbol, granularity, limit = 10000) {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('symbol_tf').getAll(`${symbol}|${granularity}`);
    req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a,b) => a.time - b.time).slice(-limit).map(({key, symbol_tf, ...c}) => c);
}
