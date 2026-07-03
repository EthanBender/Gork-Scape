#!/usr/bin/env node
// scripts/elevation_audit.mjs — per-chunk ELEVATION coherence check.
//
// audit_world.mjs already checks the GLOBAL elevation means (water < grass <
// rock, settlement proud). This checks the same rules LOCALLY, chunk by chunk,
// so the spiral map crawl (docs/MAP_DESIGN_PASS.md) can confirm each 100×100
// window's heights read like real terrain, not just the world average.
//
//   node scripts/elevation_audit.mjs              # summary + worst chunks + PASS/FAIL vs budget
//   node scripts/elevation_audit.mjs 5 5          # detail for chunk col 5, row 5 (sample violations)
//   node scripts/elevation_audit.mjs spiral       # every chunk in center-out spiral order
//
// Violation classes (all "the height contradicts the terrain type"):
//   water_high     — a water tile sitting at land height (elevation > 55)
//   rock_low       — a rock/mountain tile below hill height (elevation < 105)
//   water_perched  — a water tile higher than an adjacent non-water LAND tile
//                    (a river/pond can never sit above its own bank)

import { generateWorld } from '../src/world/map.js';
import { T } from '../src/world/worldData.js';

const CS = 100;
const w = generateWorld(Number(process.env.SEED) || 1337);
const W = w.W, H = w.H, E = w.elevation, TR = w.terrain;
const idx = (x, y) => y * W + x;
const WATER = new Set([T.WATER, T.WATER_DEEP, T.WATER_SHALLOW]);
const ROCK = new Set([T.ROCK, T.ROCK2, T.CLIFF]);

// thresholds — a tile only counts as broken when it clearly contradicts its type
const WATER_HIGH = 55;   // water above this is "on a hill"
const ROCK_LOW = 105;    // rock below this is "in a ditch"
const PERCH = 6;         // water this much above an adjacent land tile = perched

function scanChunk(cx, cy) {
  const v = { water_high: [], rock_low: [], water_perched: [] };
  for (let y = cy * CS; y < cy * CS + CS; y++) {
    for (let x = cx * CS; x < cx * CS + CS; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const i = idx(x, y), t = TR[i], e = E[i];
      if (WATER.has(t)) {
        if (e > WATER_HIGH) v.water_high.push([x, y, e]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = idx(x + dx, y + dy);
          if (!WATER.has(TR[j]) && e > E[j] + PERCH) { v.water_perched.push([x, y, e]); break; }
        }
      } else if (ROCK.has(t)) {
        if (e < ROCK_LOW) v.rock_low.push([x, y, e]);
      }
    }
  }
  return v;
}

// budgets: the geo2 terrain-aware re-pin makes local elevation fully coherent,
// so these are pinned at ZERO — any future terrain edit that leaves water on a
// hill or a mountain in a ditch FAILS CI. Water lowest, rock highest, always.
const BUDGET = { water_high: 0, rock_low: 0, water_perched: 0 };

function totals() {
  const t = { water_high: 0, rock_low: 0, water_perched: 0 };
  const perChunk = [];
  for (let cy = 0; cy < H / CS; cy++) for (let cx = 0; cx < W / CS; cx++) {
    const v = scanChunk(cx, cy);
    const n = v.water_high.length + v.rock_low.length + v.water_perched.length;
    t.water_high += v.water_high.length; t.rock_low += v.rock_low.length; t.water_perched += v.water_perched.length;
    if (n) perChunk.push({ cx, cy, n, v });
  }
  return { t, perChunk };
}

// center-out spiral order over the 10×10 grid (from the middle chunk)
function spiralOrder(cols, rows) {
  const cx0 = Math.floor(cols / 2), cy0 = Math.floor(rows / 2);
  const seen = new Set(), order = [];
  let x = cx0, y = cy0, step = 1;
  const push = (px, py) => { if (px >= 0 && py >= 0 && px < cols && py < rows && !seen.has(px + ',' + py)) { seen.add(px + ',' + py); order.push([px, py]); } };
  push(x, y);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // R, D, L, U
  let d = 0;
  while (order.length < cols * rows) {
    for (let twice = 0; twice < 2; twice++) {
      const [dx, dy] = dirs[d % 4];
      for (let s = 0; s < step; s++) { x += dx; y += dy; push(x, y); }
      d++;
    }
    step++;
  }
  return order;
}

const arg = process.argv.slice(2);
if (arg.length === 2 && arg[0] !== 'spiral') {
  const cx = +arg[0], cy = +arg[1];
  const v = scanChunk(cx, cy);
  const n = v.water_high.length + v.rock_low.length + v.water_perched.length;
  console.log(`ELEVATION (c${cx},r${cy}) — ${n} violations`);
  for (const cls of Object.keys(v)) for (const [x, y, e] of v[cls].slice(0, 20)) console.log(`  ${cls.padEnd(14)} (${x},${y})  elev ${e}`);
  process.exit(0);
}

const { t, perChunk } = totals();
if (arg[0] === 'spiral') {
  console.log('ELEVATION AUDIT — center-out spiral (only chunks with violations shown)');
  const order = spiralOrder(W / CS, H / CS);
  let rank = 0;
  for (const [cx, cy] of order) {
    rank++;
    const hit = perChunk.find((p) => p.cx === cx && p.cy === cy);
    if (hit) console.log(`  #${String(rank).padStart(3)}  c${cx},r${cy}  ${hit.n} violations`);
  }
  process.exit(0);
}

console.log('ELEVATION AUDIT — per-chunk coherence');
console.log('──────────────────────────────────────────────────');
for (const [cls, val] of Object.entries(t)) console.log(`  ${cls.padEnd(15)}${val}`);
console.log(`  ${'TOTAL'.padEnd(15)}${t.water_high + t.rock_low + t.water_perched}`);
perChunk.sort((a, b) => b.n - a.n);
console.log('\nworst chunks:');
for (const p of perChunk.slice(0, 10)) console.log(`  c${p.cx},r${p.cy}  ${String(p.n).padStart(4)}  → node scripts/elevation_audit.mjs ${p.cx} ${p.cy}`);
let fail = false;
for (const [cls, max] of Object.entries(BUDGET)) if (t[cls] > max) { console.log(`  ❌ ${cls}: ${t[cls]} exceeds budget ${max}`); fail = true; }
console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${fail ? 'over budget' : 'within budgets'})`);
process.exit(fail ? 1 : 0);
