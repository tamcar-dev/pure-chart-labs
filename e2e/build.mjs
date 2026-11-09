// Bundles the real app with a stand-in chart module (see fake-lightweight-charts.js).
// Use this to test React/DOM interaction logic. It does NOT test the real chart library's rendering.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, 'dist')
await build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true, outdir: out, format: 'esm', jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
  alias: { 'lightweight-charts': path.join(here, 'fake-lightweight-charts.js') },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning'
})
fs.writeFileSync(path.join(out, 'index.html'),
  fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('/src/main.jsx', '/main.js')
    .replace('</head>', '<link rel="stylesheet" href="/main.css"></head>'))
console.log('bundle ok:', out)
