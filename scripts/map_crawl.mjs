#!/usr/bin/env node
// scripts/map_crawl.mjs — THE systematic map-crawl driver.
//
// The map is a 10×10 grid of 100×100 chunks. This walks them in a center-out
// SPIRAL (starting at the middle chunk and winding outward) so the design pass
// covers the whole world in a fixed order and can never "miss" a chunk. For
// each chunk it shows BOTH health signals the pass cares about:
//   • defects   — from scripts/map_defects.mjs (the authoritative gate)
//   • elevation — from scripts/elevation_audit.mjs (water low / rock high, local)
//
//   node scripts/map_crawl.mjs            # the spiral worklist + the NEXT chunk to fix
//   node scripts/map_crawl.mjs all        # include the already-clean chunks too
//
// Workflow: run this → open the NEXT chunk it names with
//   node scripts/map_defects.mjs <c> <r>   and   node scripts/elevation_audit.mjs <c> <r>
// → fix in src/data/map_patches.json → re-run the two audits → commit → repeat.

import { execSync } from 'node:child_process';
import { generateWorld } from '../src/world/map.js';
import { T } from '../src/world/worldData.js';

const CS = 100;
const showAll = process.argv[2] === 'all';

// --- authoritative defects, bucketed per chunk (one world-gen, via the gate) ---
const defects = JSON.parse(execSync('node scripts/map_defects.mjs json', { cwd: process.cwd(), maxBuffer: 1 << 24 }).toString());
const defByChunk = {};
for (const d of defects) { const k = `${(d.x / CS) | 0},${(d.y / CS) | 0}`; defByChunk[k] = (defByChunk[k] || 0) + 1; }

// --- elevation coherence, per chunk (inline scan of the same world) ---
const w = generateWorld(Number(process.env.SEED) || 1337);
const W = w.W, H = w.H, E = w.elevation, TR = w.terrain, idx = (x, y) => y * W + x;
const WATER = new Set([T.WATER, T.WATER_DEEP, T.WATER_SHALLOW]);
const ROCK = new Set([T.ROCK, T.ROCK2, T.CLIFF]);
const elevByChunk = {};
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = idx(x, y), t = TR[i], e = E[i]; let bad = false;
  if (WATER.has(t)) {
    if (e > 55) bad = true;
    else for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!WATER.has(TR[idx(x + dx, y + dy)]) && e > E[idx(x + dx, y + dy)] + 6) { bad = true; break; }
  } else if (ROCK.has(t) && e < 105) bad = true;
  if (bad) { const k = `${(x / CS) | 0},${(y / CS) | 0}`; elevByChunk[k] = (elevByChunk[k] || 0) + 1; }
}

// --- center-out spiral order over the grid ---
const cols = W / CS, rows = H / CS;
const cx0 = cols >> 1, cy0 = rows >> 1, seen = new Set(), order = [];
const push = (px, py) => { if (px >= 0 && py >= 0 && px < cols && py < rows && !seen.has(px + ',' + py)) { seen.add(px + ',' + py); order.push([px, py]); } };
let x = cx0, y = cy0, step = 1, dir = 0; push(x, y);
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
while (order.length < cols * rows) { for (let twice = 0; twice < 2; twice++) { const [dx, dy] = dirs[dir % 4]; for (let s = 0; s < step; s++) { x += dx; y += dy; push(x, y); } dir++; } step++; }

// --- report ---
console.log('MAP CRAWL — center-out spiral coverage');
console.log(`start c${cx0},r${cy0} · ${order.length} chunks · defects from map_defects, elevation from elevation_audit`);
console.log('─'.repeat(56));
let clean = 0, next = null;
for (let r = 0; r < order.length; r++) {
  const [cx, cy] = order[r], k = `${cx},${cy}`;
  const dN = defByChunk[k] || 0, eN = elevByChunk[k] || 0;
  const ok = !dN && !eN;
  if (ok) clean++;
  if (!ok && !next) next = [cx, cy, dN, eN];
  if (!ok || showAll) console.log(`  #${String(r + 1).padStart(3)}  c${cx},r${cy}  ${ok ? '✓ clean' : `defects ${String(dN).padStart(3)} · elevation ${String(eN).padStart(3)}`}`);
}
console.log('─'.repeat(56));
console.log(`${clean}/${order.length} chunks clean.`);
if (next) console.log(`NEXT → c${next[0]},r${next[1]}  (defects ${next[2]}, elevation ${next[3]})\n      node scripts/map_defects.mjs ${next[0]} ${next[1]} && node scripts/elevation_audit.mjs ${next[0]} ${next[1]}`);
else console.log('The whole map is clean. 🎉');
