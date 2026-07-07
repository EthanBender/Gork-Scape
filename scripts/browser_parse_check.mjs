#!/usr/bin/env node
// scripts/browser_parse_check.mjs — REAL-browser-engine parse gate.
//
// Why this exists: on 2026-07-04 the game was down all day because
// src/ui/wiki.js contained a \' escape inside a single-quoted string inside a
// template expression. Browser V8 rejects it ("SyntaxError: Missing } in
// template expression") but `node --check` accepts the full file — a
// context-dependent parser divergence — so scripts/smoke.mjs green-lit the
// commit and Cloudflare Pages published a build that black-screened every
// player (hotfix: 1d509ad). `node --check` is therefore NOT the authority on
// "will the browser parse this"; only a browser engine is. This script asks
// one directly.
//
// What it does: starts a tiny static server over the repo, launches headless
// Chromium (playwright), loads a stub page that dynamically imports
// /src/main.js, and classifies the outcome:
//   - import resolves                        → PASS (whole graph parsed + ran)
//   - import rejects with a RUNTIME error    → PASS (graph parsed; "Phaser is
//     not defined" etc. is expected — the stub loads no CDN scripts)
//   - import rejects with a SyntaxError      → FAIL (the 2026-07-04 class)
//   - nothing settles within the timeout     → FAIL (can't verify ≠ green)
//
// The page is hermetic: every non-localhost request is blocked, so a CDN
// hiccup can never fail CI, and CI never depends on the network beyond
// installing playwright itself.
//
// Usage:    node scripts/browser_parse_check.mjs [repoRoot]
// Requires: npm install --no-save playwright && npx playwright install chromium
//           (CI-only heavyweight dep — the game itself stays zero-build.
//           This is NOT part of the local always-run gate chain.)
// Exit:     0 = browser parsed the graph; 1 = parse failure (or unverifiable);
//           2 = playwright not installed.

import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const ENTRY = '/src/main.js';
const STUB_PATH = '/__parse_check__.html';
const SETTLE_TIMEOUT_MS = 60_000;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    '❌ browser parse gate: playwright is not installed.\n' +
    '   npm install --no-save playwright && npx playwright install chromium'
  );
  process.exit(2);
}

if (!existsSync(resolve(ROOT, '.' + ENTRY))) {
  console.error(`❌ browser parse gate: ${ENTRY} not found under ${ROOT}`);
  process.exit(1);
}

// ---------------------------------------------------------------- stub page
// Reuse the REAL index.html's import map (e.g. the 'three' CDN mapping) so
// bare specifiers resolve exactly as they do in production. External fetches
// are blocked anyway; the map only needs to make specifiers *resolvable*.
const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const importmap = (indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1];

const STUB = `<!DOCTYPE html><meta charset="utf-8"><title>parse check</title>
${importmap ? `<script type="importmap">${importmap}</script>` : ''}
<script type="module">
  window.__parse = { done: false };
  import(${JSON.stringify(ENTRY)}).then(
    () => { window.__parse = { done: true, ok: true, how: 'resolved' }; },
    (e) => {
      window.__parse = {
        done: true,
        ok: !(e instanceof SyntaxError),
        how: 'rejected',
        name: (e && e.constructor && e.constructor.name) || typeof e,
        message: String((e && e.message) || e),
      };
    }
  );
</script>`;

// ------------------------------------------------------------ static server
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === STUB_PATH) {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(STUB);
    return;
  }
  const file = resolve(ROOT, '.' + urlPath);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------------ browser
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();

  // Chrome reports module compile errors to the console with exact file:line —
  // the single most useful diagnostic. Collect everything error-shaped.
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location();
    const where = loc && loc.url ? ` (${loc.url.replace(base, '')}:${loc.lineNumber + 1}:${loc.columnNumber + 1})` : '';
    consoleErrors.push(m.text() + where);
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));

  // Hermetic: nothing leaves localhost.
  await page.route('**/*', (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort()
  );

  await page.goto(base + STUB_PATH);
  let result;
  try {
    await page.waitForFunction(() => window.__parse && window.__parse.done, null, { timeout: SETTLE_TIMEOUT_MS });
    result = await page.evaluate(() => window.__parse);
  } catch {
    result = { done: false };
  }

  const files = walk(resolve(ROOT, 'src'))
    .map((f) => '/' + relative(ROOT, f).split('\\').join('/'))
    .sort();

  if (result.done && result.ok) {
    const detail = result.how === 'resolved'
      ? 'import graph parsed AND executed'
      : `import graph parsed; rejected at runtime with ${result.name}: ${result.message} — expected, the stub loads no CDN scripts`;
    console.log(`✅ browser parse gate passed — Chromium parsed ${ENTRY} (${files.length} src modules): ${detail}.`);
  } else {
    failed = true;
    console.error(`\n❌ browser parse gate FAILED — Chromium could not parse the module graph of ${ENTRY}.`);
    if (result.done) console.error(`   import() rejected with ${result.name}: ${result.message}`);
    else console.error(`   import() did not settle within ${SETTLE_TIMEOUT_MS / 1000}s — treating unverifiable as red.`);

    if (consoleErrors.length) {
      console.error('\n   Browser console (file:line points at the culprit):');
      for (const e of consoleErrors) console.error('     ' + e);
    }

    // Per-file probe: import every src module individually and list the ones
    // Chromium itself rejects as unparseable. Importers of a broken module
    // reject with the SAME propagated SyntaxError, so the culprit is the
    // rejecting module that imports no OTHER rejecting module (a leaf).
    const bad = await page.evaluate(async (list) => {
      const out = [];
      for (const f of list) {
        try {
          await Promise.race([
            import(f),
            new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 5000)),
          ]);
        } catch (e) {
          if (e instanceof SyntaxError) out.push({ f, message: String(e.message || e) });
        }
      }
      return out;
    }, files);
    if (bad.length) {
      const badSet = new Set(bad.map((b) => b.f));
      const importsBadModule = (webPath) => {
        const src = readFileSync(resolve(ROOT, '.' + webPath), 'utf8');
        const specs = [...src.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
        return specs.some((spec) => {
          let p = '/' + relative(ROOT, resolve(dirname(resolve(ROOT, '.' + webPath)), spec)).split('\\').join('/');
          if (!p.endsWith('.js')) p += '.js';
          return badSet.has(p);
        });
      };
      const leaves = bad.filter((b) => !importsBadModule(b.f));
      console.error('\n   Modules Chromium rejects:');
      for (const b of bad) console.error(`     ${b.f} — ${b.message}`);
      if (leaves.length && leaves.length < bad.length) {
        console.error('\n   Most likely culprit (rejects, but imports no other rejecting module):');
        for (const b of leaves) console.error(`     ${b.f} — ${b.message}`);
      }
    }
    console.error(
      '\n   Note: `node --check` may PASS these files — browser V8 and Node diverge on\n' +
      '   context-dependent syntax (2026-07-04: \\\' inside a template-expression string).\n' +
      '   Trust the browser; it is what players run.\n'
    );
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
