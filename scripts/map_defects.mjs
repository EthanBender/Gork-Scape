#!/usr/bin/env node
// scripts/map_defects.mjs — mechanical map-defect scanner. The EYES of the
// map design pass: finds every collision snag, dead tile, orphaned object and
// building-logic break, so the model doing the pass never has to "notice"
// anything — it just works the list, chunk by chunk.
//
//   node scripts/map_defects.mjs              # summary: counts by class + worst chunks
//   node scripts/map_defects.mjs 4 4          # every defect in chunk (col 4, row 4)
//   node scripts/map_defects.mjs json > d.json# full machine-readable dump
//
// Defect classes (each entry: { class, x, y, note }):
//   speckle        — a lone terrain tile in a field of another (reads as noise)
//   dead_pocket    — walkable area cut off from spawn (size in note)
//   obj_water      — a land object (tree/ore/structure/decor) standing in water
//   fish_dry       — a fishing spot with no water under it
//   sealed_obj     — an interactive labelled object no player can ever reach
//   wall_orphan    — a 1-tile WALL fragment attached to nothing
//   sealed_room    — a FLOOR room with no doorway to the outside
// Exits non-zero if any class exceeds its budget (CI-friendly).

import { generateWorld, isWalkable } from '../src/world/map.js';
import { T } from '../src/world/worldData.js';

const w = generateWorld(Number(process.env.SEED) || 1337);
const { W, H } = w;
const idx = (x, y) => y * W + x;
const t = (x, y) => w.terrain[idx(x, y)];
const defects = [];
const add = (cls, x, y, note = '') => defects.push({ cls, x, y, note });

const WATERS = new Set([T.WATER, T.WATER_DEEP, T.WATER_SHALLOW]);
const GRASSY = new Set([T.GRASS, T.GRASS2, T.GRASS3, T.GRASS_SHADOW]);
const cat = (v) => WATERS.has(v) ? 'water' : GRASSY.has(v) ? 'grass'
  : (v === T.ROCK || v === T.ROCK2 || v === T.CLIFF) ? 'rock'
  : (v === T.SWAMP || v === T.MUD) ? 'swamp'
  : (v === T.SAND || v === T.WET_SAND || v === T.SAND_SHADOW) ? 'sand' : 'other';

// ---- reachability from spawn (shared by several checks) ----
const reach = new Uint8Array(W * H);
{
  const q = [idx(w.spawn.x, w.spawn.y)]; reach[q[0]] = 1; let head = 0;
  while (head < q.length) {
    const c = q[head++]; const x = c % W, y = (c - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (!reach[j] && !w.collision[j]) { reach[j] = 1; q.push(j); }
    }
  }
}

// ---- 1. speckles: lone tile of one category inside another ----
for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
  const c = cat(t(x, y));
  if (c === 'other') continue;
  const n = [cat(t(x + 1, y)), cat(t(x - 1, y)), cat(t(x, y + 1)), cat(t(x, y - 1))];
  const uniq = new Set(n);
  if (uniq.size === 1 && !uniq.has(c) && !uniq.has('other')) add('speckle', x, y, `${c} in ${n[0]}`);
}

// ---- 2. dead pockets: walkable areas unreachable from spawn ----
{
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (w.collision[i] || reach[i] || seen[i]) continue;
    const q = [i]; seen[i] = 1; const cells = [];
    while (q.length) {
      const c = q.pop(); cells.push(c);
      const x = c % W, y = (c - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = idx(nx, ny);
        if (!seen[j] && !w.collision[j] && !reach[j]) { seen[j] = 1; q.push(j); }
      }
    }
    // gated content (troll ridge interior etc.) is by-design; only sub-500 pockets
    // are treated as accidents worth listing individually
    if (cells.length < 500) { const c0 = cells[0]; add('dead_pocket', c0 % W, ((c0 - c0 % W) / W), `size ${cells.length}`); }
  }
}

// ---- 3. objects standing in the wrong terrain ----
for (const o of w.objects) {
  const v = t(o.x, o.y);
  const isFishing = o.type === 'resource' && o.blocking === false;
  if (isFishing) { if (!WATERS.has(v)) add('fish_dry', o.x, o.y, o.label || 'fishing spot'); continue; }
  if (WATERS.has(v) && (o.type === 'resource' || o.type === 'decor' || (o.type === 'structure' && !/bridge|dock|boat|water|spring|waterfall/i.test(o.label || '')))) {
    add('obj_water', o.x, o.y, `${o.type}:${o.label || o.resKey || o.color}`);
  }
}

// ---- 4. sealed interactive objects: labelled + interactive but unreachable ----
for (const o of w.objects) {
  if (!o.label || o.type === 'decor') continue;
  let ok = false;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = o.x + dx, y = o.y + dy;
    if (x >= 0 && y >= 0 && x < W && y < H && reach[idx(x, y)]) { ok = true; break; }
  }
  if (!ok) add('sealed_obj', o.x, o.y, o.label);
}

// ---- 5. orphan wall fragments (walls near a labelled structure are furniture:
// shrine posts, gate towers, standing stones — intentional singles) ----
{
  const furniture = new Set();
  for (const o of w.objects) if (o.label) for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) furniture.add(idx(o.x + dx, o.y + dy));
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    if (t(x, y) !== T.WALL || furniture.has(idx(x, y))) continue;
    let wn = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (t(x + dx, y + dy) === T.WALL) wn++;
    if (wn === 0) add('wall_orphan', x, y);
  }
}

// ---- 6. sealed rooms: FLOOR clusters with no walkable doorway ----
{
  const seen = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y);
    if (t(x, y) !== T.FLOOR || seen[i]) continue;
    const q = [i]; seen[i] = 1; const cells = []; let hasDoor = false;
    while (q.length) {
      const c = q.pop(); cells.push(c);
      const cx = c % W, cy = (c - cx) / W;
      if (reach[c]) hasDoor = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = idx(cx + dx, cy + dy);
        if (t(cx + dx, cy + dy) === T.FLOOR && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    if (!hasDoor && cells.length >= 4) { const c0 = cells[0]; add('sealed_room', c0 % W, (c0 - c0 % W) / W, `floor cells ${cells.length}`); }
  }
}

// ---- report ----
const mode = process.argv[2];
const CS = 100;
const chunkOf = (d) => `c${(d.x / CS) | 0},r${(d.y / CS) | 0}`;

if (mode === 'json') { console.log(JSON.stringify(defects)); process.exit(0); }
if (mode !== undefined && process.argv[3] !== undefined) {
  const cx = +mode, cy = +process.argv[3];
  const inChunk = defects.filter((d) => ((d.x / CS) | 0) === cx && ((d.y / CS) | 0) === cy);
  console.log(`\nDEFECTS in chunk (c${cx},r${cy}) — ${inChunk.length} total`);
  for (const d of inChunk) console.log(`  ${d.cls.padEnd(12)} (${d.x},${d.y})  ${d.note}`);
  process.exit(0);
}

const byClass = {}; const byChunk = {};
for (const d of defects) { byClass[d.cls] = (byClass[d.cls] || 0) + 1; const k = chunkOf(d); byChunk[k] = (byChunk[k] || 0) + 1; }

// `spiral` — every chunk in center-out spiral order (the crawl coverage list;
// see docs/MAP_DESIGN_PASS.md). Prints defect count per chunk so the crawl can
// confirm it visited each one, not just the worst.
if (mode === 'spiral') {
  const cols = W / CS, rows = H / CS;
  const cx0 = cols >> 1, cy0 = rows >> 1, seen = new Set(), order = [];
  const push = (px, py) => { if (px >= 0 && py >= 0 && px < cols && py < rows && !seen.has(px + ',' + py)) { seen.add(px + ',' + py); order.push([px, py]); } };
  let x = cx0, y = cy0, step = 1, d = 0; push(x, y);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (order.length < cols * rows) { for (let twice = 0; twice < 2; twice++) { const [dx, dy] = dirs[d % 4]; for (let s = 0; s < step; s++) { x += dx; y += dy; push(x, y); } d++; } step++; }
  let clean = 0;
  for (let r = 0; r < order.length; r++) { const [cx, cy] = order[r]; const n = byChunk[`c${cx},r${cy}`] || 0; if (!n) clean++; else console.log(`  #${String(r + 1).padStart(3)}  c${cx},r${cy}  ${n} defects`); }
  console.log(`\n${clean}/${order.length} chunks defect-clean (spiral from center c${cx0},r${cy0}).`);
  process.exit(0);
}

console.log('\nMAP DEFECT SCAN');
console.log('─'.repeat(50));
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`);
console.log(`  ${'TOTAL'.padEnd(14)} ${defects.length}`);
console.log('\nworst chunks (fix these first):');
for (const [k, v] of Object.entries(byChunk).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k.padEnd(10)} ${v} defects   → node scripts/map_defects.mjs ${k.replace('c', '').replace('r', ' ').replace(',', ' ')}`);
// budgets: hard classes must be zero; soft classes have slack
// Budgets = today's baseline + small slack. A regression FAILS CI; the design
// pass RATCHETS these down as it fixes chunks (see docs/MAP_DESIGN_PASS.md).
const BUDGET = { sealed_obj: 36, sealed_room: 0, fish_dry: 0, obj_water: 0, dead_pocket: 154, speckle: 5, wall_orphan: 207 };
let fail = false;
for (const [cls, max] of Object.entries(BUDGET)) if ((byClass[cls] || 0) > max) { console.log(`  ❌ ${cls}: ${byClass[cls]} exceeds budget ${max}`); fail = true; }
console.log(fail ? '\nRESULT: FAIL (over budget)\n' : '\nRESULT: PASS (within budgets)\n');
process.exit(fail ? 1 : 0);
