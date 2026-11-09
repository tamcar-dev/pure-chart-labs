// Bundle the real app with deterministic feed and cache adapters for browser interaction tests.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, 'dist')
const mocks = {
  deriv: path.join(here, 'mock-deriv.js'),
  db: path.join(here, 'mock-db.js'),
}
await build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true, outdir: out, format: 'esm', jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
  plugins: [{
    name: 'e2e-adapters',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/(deriv|db)$/ }, (args) => {
        const target = args.path.slice(2)
        if (mocks[target]) return { path: mocks[target] }
      })
    }
  }],
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning'
})
fs.writeFileSync(path.join(out, 'index.html'),
  fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('/src/main.jsx', '/main.js')
    .replace('</head>', '<link rel="stylesheet" href="/main.css"></head>'))
console.log('bundle ok:', out)
