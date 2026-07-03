#!/usr/bin/env node
// scripts/poi_inventory.mjs — the worklist for the POI BUILD-OUT pass.
//
// Most labelled landmarks already get an authored multi-tile scene from the
// world-gen buildScene kit. This lists the ones that DON'T read as a place yet:
//   BARE  — a lone marker with almost nothing around it
//   THIN  — has a scene, but a sparse one (few elements) worth enriching
// so the build-out pass can work a concrete list instead of eyeballing 950 POIs.
// This is an INVENTORY (never fails CI) — build-out is authoring, judged by eye.
//
//   node scripts/poi_inventory.mjs           # summary by type: bare / thin / rich
//   node scripts/poi_inventory.mjs bare      # every bare marker (label @ x,y)
//   node scripts/poi_inventory.mjs thin      # every thin scene

import { generateWorld } from '../src/world/map.js';
import { T } from '../src/world/worldData.js';

const w = generateWorld(Number(process.env.SEED) || 1337);
const W = w.W, H = w.H, TR = w.terrain, idx = (x, y) => y * W + x;
const PATH = new Set([T.DIRT, T.DIRT_SHADOW, T.ROAD, T.BRIDGE]);
const objAt = new Map();
for (const o of w.objects) { const k = o.x + ',' + o.y; if (!objAt.has(k)) objAt.set(k, []); objAt.get(k).push(o); }

// Narrative landmarks = labelled structures that aren't gather nodes.
const pois = w.objects.filter((o) => o.label && o.type === 'structure' && !/\(Lv \d+\)/.test(o.label) && !o.skill && !o.nodeId);

function scene(o, R = 6) {
  let wall = 0, floor = 0, decor = 0, structs = 0, path = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = o.x + dx, y = o.y + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const t = TR[idx(x, y)]; if (t === T.WALL) wall++; else if (t === T.FLOOR) floor++; else if (PATH.has(t)) path++;
    const os = objAt.get(x + ',' + y); if (os) for (const b of os) { if (b === o) continue; if (b.type === 'decor') decor++; else if (b.type === 'structure') structs++; }
  }
  return { wall, floor, decor, structs, path, weight: wall + floor + decor + structs * 2 };
}

const rows = pois.map((o) => ({ o, s: scene(o) }));
const isBare = (s) => s.weight < 4;
const isThin = (s) => !isBare(s) && s.weight < 12; // has *something* but sparse

const mode = process.argv[2];
if (mode === 'bare' || mode === 'thin') {
  const pick = mode === 'bare' ? isBare : (s) => isThin(s);
  const list = rows.filter((r) => pick(r.s)).sort((a, b) => a.o.label.localeCompare(b.o.label));
  console.log(`${mode.toUpperCase()} landmarks (${list.length}):`);
  for (const r of list) console.log(`  ${r.o.label.padEnd(28)} @ ${r.o.x},${r.o.y}   (w${r.s.wall} f${r.s.floor} d${r.s.decor})`);
  process.exit(0);
}

let bare = 0, thin = 0, rich = 0;
const byType = new Map();
for (const { o, s } of rows) {
  const cls = isBare(s) ? 'bare' : isThin(s) ? 'thin' : 'rich';
  if (cls === 'bare') bare++; else if (cls === 'thin') thin++; else rich++;
  const k = o.label.replace(/\s*\(.*\)$/, ''); if (!byType.has(k)) byType.set(k, { bare: 0, thin: 0, rich: 0 }); byType.get(k)[cls]++;
}
console.log('POI BUILD-OUT INVENTORY (narrative landmarks)');
console.log('─'.repeat(50));
console.log(`  ${pois.length} landmarks:  ${rich} rich · ${thin} THIN (enrich) · ${bare} BARE (build)`);
console.log('\ntypes with bare/thin instances worth building out:');
const t = [...byType.entries()].filter(([, v]) => v.bare || v.thin).sort((a, b) => (b[1].bare + b[1].thin) - (a[1].bare + a[1].thin));
for (const [k, v] of t.slice(0, 25)) console.log(`  bare ${String(v.bare).padStart(2)} · thin ${String(v.thin).padStart(2)} · rich ${String(v.rich).padStart(3)}   ${k}`);
console.log('\n(node scripts/poi_inventory.mjs bare|thin  for the full list — the build-out worklist)');
