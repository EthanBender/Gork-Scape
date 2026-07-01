// test/run.mjs — zero-dependency test runner for Goblin Empire.
//
// Why this exists: `scripts/smoke.mjs` only checks that modules *parse* and that
// imports/exports line up. It cannot catch a wrong XP formula, a broken order
// match, or a misclassified monster. These are unit tests for the pure, headless
// game logic — the stuff whose correctness you otherwise can't see without
// playing. Run:  node test/run.mjs   (exit 0 = green, 1 = failures).
//
// No build step, no npm deps — same constraints as the rest of the repo. Test
// files are `test/*.test.mjs`; each imports { test } from './run.mjs' and calls
// it. Import this file for its side-effect-free helpers; running THIS file
// discovers and executes every *.test.mjs.

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// ---- registry -------------------------------------------------------------
const cases = [];
export function test(name, fn) { cases.push({ name, fn }); }

// ---- assertions (throw on failure with a readable message) ----------------
export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'not equal'}\n    expected: ${e}\n    actual:   ${a}`);
}
export function almost(actual, expected, tol = 1e-6, msg) {
  if (Math.abs(actual - expected) > tol) throw new Error(`${msg || 'not ~equal'}: expected ${expected}±${tol}, got ${actual}`);
}
export function throws(fn, msg = 'expected throw') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg);
}

// ---- fetch shim: let modules that fetch local JSON run under Node ----------
// gameData.js does `await fetch(url)` for the data JSON. In Node there's no HTTP
// server, so map those URLs to on-disk reads. This unlocks testing the economy
// modules (crafting/drops) that hydrate from the registry — not just the pure
// zero-import ones. Call installFetchShim() before importing gameData.
import { readFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function installFetchShim() {
  if (globalThis.__geFetchShim) return;
  globalThis.__geFetchShim = true;
  globalThis.fetch = async (url) => {
    // Accept 'src/data/x.json', './data/x.json', '/src/data/x.json', etc.
    let rel = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\.?\//, '');
    if (!rel.startsWith('src/')) rel = rel.replace(/^data\//, 'src/data/');
    const body = readFileSync(join(ROOT, rel), 'utf8');
    return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
  };
}

// ---- runner ---------------------------------------------------------------
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
  for (const f of files) await import(pathToFileURL(join(here, f)).href);

  let pass = 0, fail = 0;
  const failures = [];
  for (const c of cases) {
    try {
      await c.fn();
      pass++;
    } catch (err) {
      fail++;
      failures.push({ name: c.name, err });
    }
  }

  for (const { name, err } of failures) {
    console.error(`\x1b[31m✗ ${name}\x1b[0m\n    ${err.message.replace(/\n/g, '\n    ')}`);
  }
  const total = pass + fail;
  const color = fail ? '\x1b[31m' : '\x1b[32m';
  console.log(`${color}${fail ? '✗' : '✓'} ${pass}/${total} passed\x1b[0m across ${files.length} files.`);
  process.exit(fail ? 1 : 0);
}

// Only run the discovery loop when invoked directly (not when a test file
// imports us for { test, assert, ... }).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
