#!/usr/bin/env node
// scripts/coherence_audit.mjs — HUMAN-coherence audit. map_defects.mjs finds
// reachability faults; this finds things that look WRONG to a person even where
// everything is reachable: stray walls, walls in water, objects clipping into
// walls, doubled objects, isolated cliffs/elevation spikes, and shadows with no
// slope to cast them. Unreachable islands are FINE (they enrich the world) — this
// audit is about visual sense, not access.
//
//   node scripts/coherence_audit.mjs            # counts by class + worst chunks + PASS/FAIL
//   node scripts/coherence_audit.mjs 4 4        # detail for one chunk
//
// Classes:
//   wall_stub      — a 2-6 tile WALL fragment with no building FLOOR (a wall to nowhere)
//   wall_in_water  — a WALL tile ringed by water (a wall in a lake)
//   obj_embedded   — a tree/ore/structure sitting ON a WALL or in DEEP water (clipping)
//   obj_stack      — two blocking objects on the same tile (they overlap on screen)
//   orphan_cliff   — a CLIFF with no rock/cliff neighbour and no elevation drop (a cliff in a meadow)
//   orphan_shadow  — a shadow-variant tile with no higher tile to its north (a shadow with no caster)
//   elev_spike     — a walkable tile 28+ above OR below all four neighbours (a pillar / pit)

import { generateWorld } from '../src/world/map.js';
import { T } from '../src/world/worldData.js';

const CS = 100;
const w = generateWorld(Number(process.env.SEED) || 1337);
const W = w.W, H = w.H, TR = w.terrain, E = w.elevation, idx = (x, y) => y * W + x;
const WATER = new Set([T.WATER, T.WATER_DEEP, T.WATER_SHALLOW]);
const ROCKY = new Set([T.ROCK, T.ROCK2, T.CLIFF]);
const SHADOW = new Set([T.GRASS_SHADOW, T.DIRT_SHADOW, T.SAND_SHADOW]);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

const objAt = new Map();
for (const o of w.objects) { const k = o.x + ',' + o.y; if (!objAt.has(k)) objAt.set(k, []); objAt.get(k).push(o); }

// Authored POI scenes place walls (crypts, ruins, camps) and let trees grow
// through them on purpose — overgrown ruins are atmosphere, not a bug. Exempt
// any wall/clip within ±5 of a labelled STRUCTURE (not resources/trees, which
// are everywhere and would exempt the whole map). Matches map_defects' rule.
const nearStructure = new Set();
for (const o of w.objects) if (o.label && o.type === 'structure') for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const x = o.x + dx, y = o.y + dy; if (x >= 0 && y >= 0 && x < W && y < H) nearStructure.add(idx(x, y)); }

const items = [];
const add = (cls, x, y) => items.push({ cls, x, y });

for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  const i = idx(x, y), t = TR[i], e = E[i];
  if (t === T.CLIFF) {
    let rocky = false, drop = 0;
    for (const [dx, dy] of N8) { const j = idx(x + dx, y + dy); if (ROCKY.has(TR[j])) rocky = true; drop = Math.max(drop, Math.abs(e - E[j])); }
    if (!rocky && drop < 14) add('orphan_cliff', x, y);
  }
  if (SHADOW.has(t)) { if (!(E[idx(x, y - 1)] - e >= 14 || E[idx(x, y - 2)] - e >= 22)) add('orphan_shadow', x, y); }
  if (!WATER.has(t) && !ROCKY.has(t) && w.collision[i] === 0) {
    const nb = N4.map(([dx, dy]) => E[idx(x + dx, y + dy)]);
    if (nb.every((v) => e - v > 28) || nb.every((v) => v - e > 28)) add('elev_spike', x, y);
  }
  if (t === T.WALL && !nearStructure.has(i)) { let wn = 0; for (const [dx, dy] of N4) if (WATER.has(TR[idx(x + dx, y + dy)])) wn++; if (wn >= 3) add('wall_in_water', x, y); }
  const os = objAt.get(x + ',' + y);
  if (os) {
    if (os.filter((o) => o.blocking).length > 1) add('obj_stack', x, y);
    if (!nearStructure.has(i) && os.some((o) => o.type === 'structure' || o.type === 'resource') && (t === T.WALL || t === T.WATER_DEEP)) add('obj_embedded', x, y);
  }
}
// wall stubs: 8-connected WALL components of size 2..6 with no adjacent FLOOR
{
  const seen = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y); if (TR[i] !== T.WALL || seen[i]) continue;
    const q = [i]; seen[i] = 1; const cells = []; let floor = false;
    while (q.length) {
      const c = q.pop(); cells.push(c); const cx = c % W, cy = (c - cx) / W;
      for (const [dx, dy] of N8) { const j = idx(cx + dx, cy + dy); if (TR[j] === T.FLOOR) floor = true; if (TR[j] === T.WALL && !seen[j]) { seen[j] = 1; q.push(j); } }
    }
    if (!floor && cells.length >= 2 && cells.length <= 6) { const c0 = cells[0]; add('wall_stub', c0 % W, (c0 - c0 % W) / W); }
  }
}

const mode = process.argv[2];
if (mode !== undefined && process.argv[3] !== undefined) {
  const cx = +mode, cy = +process.argv[3];
  const hit = items.filter((d) => ((d.x / CS) | 0) === cx && ((d.y / CS) | 0) === cy);
  console.log(`\nCOHERENCE (c${cx},r${cy}) — ${hit.length}`);
  for (const d of hit) console.log(`  ${d.cls.padEnd(14)} (${d.x},${d.y})`);
  process.exit(0);
}

const byClass = {}, byChunk = {};
for (const d of items) { byClass[d.cls] = (byClass[d.cls] || 0) + 1; const k = `c${(d.x / CS) | 0},r${(d.y / CS) | 0}`; byChunk[k] = (byChunk[k] || 0) + 1; }
console.log('HUMAN-COHERENCE AUDIT');
console.log('─'.repeat(50));
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(15)}${v}`);
console.log(`  ${'TOTAL'.padEnd(15)}${items.length}`);
if (Object.keys(byChunk).length) {
  console.log('\nworst chunks:');
  for (const [k, v] of Object.entries(byChunk).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k.padEnd(10)} ${v}   → node scripts/coherence_audit.mjs ${k.replace('c', '').replace('r', ' ').replace(',', ' ')}`);
}
// budget: ratcheted down as the pass fixes them. elev_spike/orphan_cliff tolerate a tiny tail (generator noise).
const BUDGET = { wall_stub: 0, wall_in_water: 0, obj_embedded: 0, obj_stack: 2, orphan_cliff: 2, orphan_shadow: 0, elev_spike: 2 };
let fail = false;
for (const [cls, max] of Object.entries(BUDGET)) if ((byClass[cls] || 0) > max) { console.log(`  ❌ ${cls}: ${byClass[cls]} exceeds budget ${max}`); fail = true; }
console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${fail ? 'over budget' : 'within budgets'})`);
process.exit(fail ? 1 : 0);
