#!/usr/bin/env node
// scripts/chunk_inspect.mjs — walk the world in 100×100 windows and reason about
// each one LOCALLY: is the terrain realistic, and do its borders blend with the
// neighbours it touches? The world is 1000×1000, so a 10×10 grid of 100 chunks.
//
//   node scripts/chunk_inspect.mjs                 # overview: the whole 10×10 grid
//   node scripts/chunk_inspect.mjs 3 4             # detail for chunk column 3, row 4
//   node scripts/chunk_inspect.mjs 3 4 full        # + full 100×100 ascii (not downsampled)
//
// Chunk (cx,cy) covers tiles x∈[cx*100 .. cx*100+99], y∈[cy*100 .. cy*100+99].

import { generateWorld, regionAt } from '../src/world/map.js';
import { T, TERRAIN_DEFS } from '../src/world/worldData.js';

const CS = 100; // chunk size in tiles
const w = generateWorld(Number(process.env.SEED) || 1337);
const W = w.W, H = w.H, ter = w.terrain, elev = w.elevation;
const at = (x, y) => ter[y * W + x];

// ---- terrain → category + glyph -------------------------------------------
const WATER = new Set([T.WATER, T.WATER_DEEP, T.WATER_SHALLOW]);
const ROCK = new Set([T.ROCK, T.ROCK2, T.CLIFF]);
const GRASS = new Set([T.GRASS, T.GRASS2, T.GRASS3, T.GRASS_SHADOW]);
const SANDY = new Set([T.SAND, T.WET_SAND, T.SAND_SHADOW]);
const SWAMPY = new Set([T.SWAMP, T.MUD]);
const PATH = new Set([T.ROAD, T.BRIDGE, T.DIRT, T.DIRT_SHADOW]);
const BUILT = new Set([T.WALL, T.FLOOR]);
function cat(t) {
  if (WATER.has(t)) return 'water';
  if (ROCK.has(t)) return 'rock';
  if (SWAMPY.has(t)) return 'swamp';
  if (SANDY.has(t)) return 'sand';
  if (PATH.has(t)) return 'path';
  if (BUILT.has(t)) return 'built';
  if (t === T.FIELD) return 'field';
  if (GRASS.has(t)) return 'grass';
  return 'other';
}
const GLYPH = { water: '~', rock: '^', swamp: 'm', sand: ':', path: '=', built: '#', field: 'f', grass: '.', other: '?' };
// finer water/rock detail for the ascii so shores/cliffs read
function glyph(t) {
  if (t === T.WATER_DEEP) return '≈';
  if (t === T.WATER_SHALLOW) return '-';
  if (t === T.CLIFF) return 'v';
  if (t === T.ROAD || t === T.BRIDGE) return '=';
  return GLYPH[cat(t)];
}

// ---- object bucketing ------------------------------------------------------
function objectsIn(x0, y0, x1, y1) {
  const kinds = { tree: 0, ore: 0, fishing: 0, decor: 0, structure: 0, shortcut: 0, other: 0 };
  for (const o of w.objects) {
    if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
    if (o.shortcut) kinds.shortcut++;
    else if (o.type === 'decor') kinds.decor++;
    else if (o.type === 'structure') kinds.structure++;
    else if (o.type === 'resource') { kinds[o.skill === 'Woodcutting' ? 'tree' : o.skill === 'Mining' ? 'ore' : o.blocking === false ? 'fishing' : 'other']++; }
    else kinds.other++;
  }
  let mobs = 0; for (const s of w.enemySpawns) if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) mobs++;
  return { kinds, mobs };
}

// ---- overview: 10×10 grid of dominant terrain -----------------------------
function overview() {
  console.log('\nWORLD OVERVIEW — 10×10 grid of 100×100 chunks  (col,row).  dominant terrain + feature flags\n');
  console.log('     ' + Array.from({ length: 10 }, (_, cx) => 'c' + cx + '  ').join(''));
  for (let cy = 0; cy < 10; cy++) {
    let row = 'r' + cy + '  ';
    for (let cx = 0; cx < 10; cx++) {
      const x0 = cx * CS, y0 = cy * CS;
      const counts = {};
      for (let y = y0; y < y0 + CS; y += 3) for (let x = x0; x < x0 + CS; x += 3) { const c = cat(at(x, y)); counts[c] = (counts[c] || 0) + 1; }
      const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const { kinds, mobs } = objectsIn(x0, y0, x0 + CS - 1, y0 + CS - 1);
      const flag = kinds.structure > 0 ? '*' : kinds.shortcut > 0 ? '$' : mobs > 8 ? '!' : ' ';
      row += (GLYPH[dom] + flag).padEnd(2) + '  ';
    }
    console.log(row);
  }
  console.log('\n  ~ water  ^ rock  m swamp  : sand  = path  # built  f field  . grass   |  * structure  $ shortcut  ! dense mobs');
  console.log('  detail:  node scripts/chunk_inspect.mjs <col> <row>\n');
}

// ---- border blend: compare this chunk's edge with the neighbour's abutting line
function seam(cx, cy, dir) {
  const [dx, dy] = dir;
  const nx = cx + dx, ny = cy + dy;
  if (nx < 0 || ny < 0 || nx >= 10 || ny >= 10) return null;
  let unnatural = 0, flips = 0, prev = null, samples = 0;
  for (let i = 0; i < CS; i++) {
    // tile on our edge, and the neighbour tile just across the border
    let ax, ay, bx, by;
    if (dx !== 0) { ax = dx > 0 ? cx * CS + CS - 1 : cx * CS; ay = cy * CS + i; bx = ax + dx; by = ay; }
    else { ay = dy > 0 ? cy * CS + CS - 1 : cy * CS; ax = cx * CS + i; bx = ax; by = ay + dy; }
    const ca = cat(at(ax, ay)), cb = cat(at(bx, by));
    samples++;
    // "unnatural" adjacency = a hard jump with no transition band
    const bad = (ca === 'water' && cb === 'rock') || (ca === 'rock' && cb === 'water') ||
      (at(ax, ay) === T.WATER_DEEP && cb !== 'water') || (at(bx, by) === T.WATER_DEEP && ca !== 'water') ||
      (ca === 'swamp' && cb === 'sand') || (ca === 'sand' && cb === 'swamp');
    if (bad) unnatural++;
    if (prev !== null && prev !== cb) flips++;
    prev = cb;
  }
  return { dir: dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N', unnatural, flips, samples };
}

// ---- detail for one chunk --------------------------------------------------
function detail(cx, cy, full) {
  const x0 = cx * CS, y0 = cy * CS, x1 = x0 + CS - 1, y1 = y0 + CS - 1;
  console.log(`\n=== CHUNK (col ${cx}, row ${cy}) — tiles x[${x0}..${x1}] y[${y0}..${y1}] ===`);
  // regions present (corners + centre)
  const regs = new Set([regionAt(x0, y0), regionAt(x1, y0), regionAt(x0, y1), regionAt(x1, y1), regionAt(x0 + 50, y0 + 50)]);
  console.log('regions: ' + [...regs].join(', '));
  // composition
  const comp = {}; let n = 0, emn = 255, emx = 0, esum = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = cat(at(x, y)); comp[c] = (comp[c] || 0) + 1; n++; const e = elev[y * W + x]; if (e < emn) emn = e; if (e > emx) emx = e; esum += e; }
  const pct = Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join('  ');
  console.log('terrain: ' + pct);
  console.log(`elevation: ${emn}–${emx} (mean ${(esum / n).toFixed(0)})`);
  const { kinds, mobs } = objectsIn(x0, y0, x1, y1);
  console.log('objects: ' + Object.entries(kinds).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('  ') + `  | mobs ${mobs}`);
  // border seams
  const seams = [[0, -1], [1, 0], [0, 1], [-1, 0]].map((d) => seam(cx, cy, d)).filter(Boolean);
  console.log('borders (unnatural jumps / category flips per 100 edge tiles):');
  for (const s of seams) console.log(`   ${s.dir}: unnatural ${s.unnatural}   flips ${s.flips}` + (s.unnatural > 6 ? '   <-- HARD SEAM' : ''));
  // ascii
  const step = full ? 1 : 2;
  console.log(`\nascii (${full ? '1' : '2'} tile/char):  ~≈ water  ^v rock  m swamp  : sand  = path  # built  f field  . grass`);
  for (let y = y0; y <= y1; y += step) {
    let row = '';
    for (let x = x0; x <= x1; x += step) row += glyph(at(x, y));
    console.log(row);
  }
}

// ---- seam scan: every border, worst first ---------------------------------
function seamScan() {
  const rows = [];
  for (let cy = 0; cy < 10; cy++) for (let cx = 0; cx < 10; cx++) {
    for (const d of [[1, 0], [0, 1]]) { // E and S only (each border counted once)
      const s = seam(cx, cy, d);
      if (s) rows.push({ cx, cy, ...s });
    }
  }
  rows.sort((a, b) => b.unnatural - a.unnatural);
  console.log('\nBORDER SEAM SCAN — worst first (unnatural = hard biome jumps w/o transition, per 100 edge tiles)\n');
  for (const r of rows.slice(0, 24)) console.log(`  (c${r.cx},r${r.cy}) ${r.dir}: unnatural ${String(r.unnatural).padStart(3)}   flips ${r.flips}` + (r.unnatural > 6 ? '   <-- HARD SEAM' : ''));
  const hard = rows.filter((r) => r.unnatural > 6).length;
  console.log(`\n  ${hard} border(s) over the hard-seam threshold (>6). ${rows.length} borders scanned.\n`);
}

// ---- main ------------------------------------------------------------------
const a = process.argv.slice(2).filter((s) => s !== 'full');
if (a[0] === 'seams') seamScan();
else if (a.length < 2) overview();
else detail(Number(a[0]), Number(a[1]), process.argv.includes('full'));
