#!/usr/bin/env node
// scripts/audit_world.mjs — map-invariant audit harness for Goblin Empire.
//
// Why this exists: the world is a single 1000×1000 handcrafted map assembled by
// many stacked generation passes (geography → regions → resources → wonders →
// texture → elevation → relief). Any one pass can silently strand a region,
// drop a mob into a wall, or break the elevation rules. The browser won't tell
// you — you'd just wander into a wall. This script regenerates the world and
// asserts the invariants that must hold for it to be playable and coherent.
//
// Run:  node scripts/audit_world.mjs        (exit 0 = sound, non-zero = broken)
//
// HARD invariants (fail the build): spawn walkable, every region reachable on
// foot from spawn, no enemy on an unwalkable tile, elevation rules hold
// (water < grass < rock, settlements raised). SOFT invariants (warn only):
// per-region mob density in sane bounds, no large stranded walkable island.

import { generateWorld, isWalkable, regionAt } from '../src/world/map.js';
import { T, TERRAIN_DEFS, REGION_ANCHORS } from '../src/world/worldData.js';

const SEED = Number(process.argv[2]) || 1337;
const fails = [], warns = [], notes = [];
const t0 = Date.now();
const w = generateWorld(SEED);
const genMs = Date.now() - t0;
const { W, H } = w;
const N = W * H;
const idx = (x, y) => y * W + x;

// ---------- flood fill of everything walkable from spawn ----------
const reach = new Uint8Array(N);
{
  const q = new Int32Array(N); let head = 0, tail = 0;
  const s = idx(w.spawn.x, w.spawn.y);
  reach[s] = 1; q[tail++] = s;
  while (head < tail) {
    const c = q[head++]; const x = c % W, y = (c - x) / W;
    const nb = [c - 1, c + 1, c - W, c + W];
    const ok = [x > 0, x < W - 1, y > 0, y < H - 1];
    for (let k = 0; k < 4; k++) { if (!ok[k]) continue; const n = nb[k]; if (reach[n] || w.collision[n]) continue; reach[n] = 1; q[tail++] = n; }
  }
}
let walkTotal = 0, walkReached = 0;
for (let i = 0; i < N; i++) { if (!w.collision[i]) { walkTotal++; if (reach[i]) walkReached++; } }

// ---------- 1. spawn walkable ----------
if (isWalkable(w, w.spawn.x, w.spawn.y)) notes.push(`spawn (${w.spawn.x},${w.spawn.y}) walkable`);
else fails.push(`spawn (${w.spawn.x},${w.spawn.y}) is NOT walkable`);

// ---------- 2. every region reachable from spawn (can you enter its bounds?) ----------
// A region passes if a meaningful share of its walkable ground is reachable on
// foot — you can get IN, even if its watery centre or far corners aren't. Regions
// sealed behind an earned shortcut (Troll Ridge's key gate) are expected to stay
// sealed until unlocked, so they're noted rather than failed.
const GATED = new Set(['troll']); // locked until a key/shortcut is earned
for (const a of REGION_ANCHORS) {
  if (!a.bounds) continue;
  const [x0, y0, x1, y1] = a.bounds;
  let wb = 0, rb = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); if (!w.collision[i]) { wb++; if (reach[i]) rb++; } }
  const frac = wb ? rb / wb : 0;
  if (frac >= 0.05) continue; // you can walk in
  if (GATED.has(a.id)) notes.push(`region "${a.name}" sealed (${(frac * 100).toFixed(1)}% reachable) — gated by design, opens with a shortcut`);
  else fails.push(`region "${a.name}" UNREACHABLE on foot — only ${(frac * 100).toFixed(1)}% of its ground reachable from spawn`);
}

// ---------- 3. elevation rules ----------
// rivers lowest → mountains highest → grass rolls in between → settlements raised
let wS = 0, wC = 0, wMax = 0, gS = 0, gC = 0, gMin = 255, gMax = 0, rS = 0, rC = 0, rMin = 255, setS = 0, setC = 0;
for (let i = 0; i < N; i++) {
  const t = w.terrain[i], e = w.elevation[i];
  if (t === T.WATER || t === T.WATER_DEEP || t === T.WATER_SHALLOW) { wS += e; wC++; if (e > wMax) wMax = e; }
  else if (t === T.ROCK || t === T.ROCK2) { rS += e; rC++; if (e < rMin) rMin = e; }
  else if (t === T.GRASS || t === T.GRASS2 || t === T.GRASS3 || t === T.GRASS_SHADOW) { gS += e; gC++; if (e < gMin) gMin = e; if (e > gMax) gMax = e; }
  else if (t === T.WALL || t === T.FLOOR) { setS += e; setC++; }
}
const wMean = wS / (wC || 1), gMean = gS / (gC || 1), rMean = rS / (rC || 1), setMean = setS / (setC || 1);
notes.push(`elevation  water≈${wMean.toFixed(1)}  grass≈${gMean.toFixed(1)} (roll ${gMin}–${gMax})  rock≈${rMean.toFixed(1)}  settlement≈${setMean.toFixed(1)}`);
if (!(wMean < gMean)) fails.push(`elevation rule broken: water (${wMean.toFixed(1)}) not below grass (${gMean.toFixed(1)})`);
if (!(gMean < rMean)) fails.push(`elevation rule broken: grass (${gMean.toFixed(1)}) not below rock (${rMean.toFixed(1)})`);
if (!(setMean > gMean)) fails.push(`elevation rule broken: settlement (${setMean.toFixed(1)}) not raised above grass (${gMean.toFixed(1)})`);
if (!(gMax > gMin + 10)) warns.push(`grassland looks flat (spread only ${gMin}–${gMax}) — expected rolling relief`);

// ---------- 4. mob / object integrity ----------
let mobOnWall = 0; const seen = new Set(); let dupMob = 0;
for (const s of w.enemySpawns) {
  if (!isWalkable(w, s.x, s.y)) mobOnWall++;
  const k = s.x + ',' + s.y; if (seen.has(k)) dupMob++; else seen.add(k);
}
if (mobOnWall) fails.push(`${mobOnWall} enemy spawn(s) sit on an unwalkable tile`);
if (dupMob) warns.push(`${dupMob} enemy spawn(s) share a tile with another mob`);
const spawnObj = w.objectAt.get(w.spawn.x + ',' + w.spawn.y);
if (spawnObj && spawnObj.blocking) fails.push(`a blocking object (${spawnObj.label || spawnObj.type}) sits on the spawn tile`);

// ---------- 5. per-region mob density (soft) ----------
for (const a of REGION_ANCHORS) {
  if (!a.bounds) continue;
  const [x0, y0, x1, y1] = a.bounds;
  let n = 0; for (const s of w.enemySpawns) if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) n++;
  const areaHundred = ((x1 - x0) * (y1 - y0)) / 10000; // per 100×100 tiles
  const d = n / (areaHundred || 1);
  if (d > 10) warns.push(`region "${a.name}" over-packed: ${d.toFixed(1)} mobs / 100² (${n} mobs)`);
  if (a.mobs && a.mobs.length && n === 0) warns.push(`region "${a.name}" expects mobs but has none inside its bounds`);
}

// ---------- 6. stranded land — is any large pocket accidentally walled off? (soft) ----------
// Total stranded ground is expected (gated regions, lake islands). What matters
// is whether one big CONNECTED pocket sits in a non-gated region — that signals a
// pass accidentally sealed somewhere the player should be able to reach.
const stranded = walkTotal - walkReached;
const seenC = new Uint8Array(N);
let biggest = 0, biggestSample = -1;
for (let i0 = 0; i0 < N; i0++) {
  if (w.collision[i0] || reach[i0] || seenC[i0]) continue;
  let size = 0; const stack = [i0]; seenC[i0] = 1;
  while (stack.length) {
    const c = stack.pop(); size++; const x = c % W, y = (c - x) / W;
    const nb = [c - 1, c + 1, c - W, c + W]; const ok = [x > 0, x < W - 1, y > 0, y < H - 1];
    for (let k = 0; k < 4; k++) { if (!ok[k]) continue; const n = nb[k]; if (w.collision[n] || reach[n] || seenC[n]) continue; seenC[n] = 1; stack.push(n); }
  }
  if (size > biggest) { biggest = size; biggestSample = i0; }
}
notes.push(`connectivity ${(100 * walkReached / walkTotal).toFixed(2)}% reachable from spawn (${stranded} tiles stranded, largest pocket ${biggest})`);
if (biggestSample >= 0 && biggest > 1500) {
  const bx = biggestSample % W, by = (biggestSample - biggestSample % W) / W;
  const rg = regionAt(bx, by);
  const gatedNames = [...GATED].map(id => (REGION_ANCHORS.find(z => z.id === id) || {}).name);
  if (!gatedNames.includes(rg)) warns.push(`largest stranded pocket (${biggest} tiles) is in "${rg}" near (${bx},${by}) — check it isn't accidentally walled off`);
}

// ---------- report ----------
const line = '─'.repeat(66);
console.log(`\n${line}\n  GOBLIN EMPIRE — world audit   seed ${SEED}   gen ${genMs}ms\n${line}`);
console.log(`  ${W}×${H}  objects ${w.objects.length}  mobs ${w.enemySpawns.length}  friendlies ${w.friendlies.length}`);
for (const n of notes) console.log(`  · ${n}`);
if (warns.length) { console.log(`\n  ⚠  ${warns.length} warning(s):`); for (const s of warns) console.log(`     - ${s}`); }
if (fails.length) { console.log(`\n  ❌ ${fails.length} FAILURE(S):`); for (const s of fails) console.log(`     - ${s}`); }
console.log(line);
if (fails.length) { console.log(`  RESULT: FAIL\n`); process.exit(1); }
console.log(`  RESULT: PASS${warns.length ? ` (with ${warns.length} warning[s])` : ''}\n`); process.exit(0);
