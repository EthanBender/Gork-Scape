// src/world/geo2.js — Geography 2.0: the macro world derived from simulated
// process instead of authored stamps. The old generator drew a disc-lake,
// polygon-highlands and rectangle-farms onto a grass field, so the world map
// read as disjointed shapes. Here every layer is CAUSED by the previous one:
//
//   heightfield  →  where mountains and the coast are
//   hydrology    →  priority-flood fills every depression to its spill level,
//                   flow accumulation then routes every drop downhill — rivers
//                   are the cells where flow concentrates (tributaries emerge
//                   free), lakes are the ponds the fill discovered, and every
//                   river PROVABLY reaches the sea
//   moisture     →  wet near water → forests hug rivers; dry plateaus stay open
//   sites        →  the town sits at a ford, farms on the floodplain, the dock
//                   where lake meets land — humans obey the land.
//
// buildMacro(seed) is pure + deterministic and touches nothing else — the live
// generator ignores it until generateWorld opts in (see ROADMAP: Geo2 flip).

import { T } from './worldData.js';

export const GW = 1000, GH = 1000;
const N = GW * GH;
const idx = (x, y) => y * GW + x;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// ---- deterministic noise ----------------------------------------------------
const hash2 = (x, y, s) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 974634751);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 5) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 101); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function ridged(x, y, s, oct = 4) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { const n = 1 - Math.abs(2 * vnoise(x * f, y * f, s + o * 77) - 1); sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.1; }
  return sum / norm;
}

// ---- tiny binary min-heap (for priority-flood) --------------------------------
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() { const k = this.k, v = this.v, top = v[0], n = k.length - 1;
    k[0] = k[n]; v[0] = v[n]; k.pop(); v.pop(); let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r;
      if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    return top; }
  get size() { return this.k.length; }
}

export function buildMacro(seed = 1337) {
  const S = seed | 0;
  const height = new Float32Array(N);

  // ---- 1. heightfield ---------------------------------------------------------
  // North mountain wall (noise-modulated passes), rolling hilly interior, fractal
  // south coast, and one authored *cause*: a broad warped depression so the
  // drainage has somewhere to pool. The lake's SHAPE stays emergent.
  for (let y = 0; y < GH; y++) {
    const ny = y / GH;
    for (let x = 0; x < GW; x++) {
      const nx = x / GW;
      const base = fbm(x / 300, y / 300, S) * 0.55 + fbm(x / 120, y / 120, S + 7) * 0.20;
      const hills = ridged(x / 260, y / 260, S + 17) * 0.10;                    // rolling interior relief
      const wall = clamp01((0.27 - ny) / 0.27);
      const wallVar = 0.35 + 0.65 * fbm(x / 190, 7, S + 13);                    // passes through the wall
      const mountains = ridged(x / 130, y / 130, S + 29) * Math.pow(wall, 1.15) * wallVar;
      const shoulder = Math.max(clamp01((0.07 - nx) / 0.07), clamp01((nx - 0.95) / 0.05)) * 0.25;
      const tilt = 0.20 * (1 - ny);                                             // the whole land drains south
      const warp = (fbm(x / 140, y / 140, S + 41) - 0.5) * 0.18;               // fractal coastline
      const coast = clamp01(((ny + warp) - 0.78) / 0.22);
      const bw = 0.6 + 0.8 * fbm(x / 130, y / 130, S + 55);                     // warped (non-circular) basin
      const br = Math.hypot(x - 700, y - 470) / (165 * bw);
      const basin = Math.pow(clamp01(1 - br), 1.5);
      height[idx(x, y)] = 0.20 + 0.30 * base + hills + tilt + 0.95 * mountains + shoulder - 0.80 * coast * coast - 0.30 * basin;
    }
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { const v = height[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < N; i++) height[i] = (height[i] - mn) / (mx - mn);
  const SEA = 0.15;

  // ---- 2. hydrology: priority-flood + flow accumulation -------------------------
  // Fill every depression to its spill level. `filled - height` > 0 marks ponds
  // (the big one is THE lake); the filled surface is monotone, so steepest
  // descent on it always reaches the sea — rivers cannot get stuck by design.
  const filled = new Float32Array(height);
  {
    const seen = new Uint8Array(N); const heap = new Heap();
    for (let x = 0; x < GW; x++) { for (const y of [0, GH - 1]) { const i = idx(x, y); if (!seen[i]) { seen[i] = 1; heap.push(filled[i], i); } } }
    for (let y = 0; y < GH; y++) { for (const x of [0, GW - 1]) { const i = idx(x, y); if (!seen[i]) { seen[i] = 1; heap.push(filled[i], i); } } }
    for (let i = 0; i < N; i++) if (height[i] < SEA && !seen[i]) { seen[i] = 1; heap.push(filled[i], i); } // sea drains too
    while (heap.size) {
      const i = heap.pop(); const x = i % GW, y = (i - x) / GW;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx2 = x + dx, ny2 = y + dy;
        if (nx2 < 0 || ny2 < 0 || nx2 >= GW || ny2 >= GH) continue;
        const j = idx(nx2, ny2);
        if (seen[j]) continue; seen[j] = 1;
        if (filled[j] < filled[i] + 1e-5) filled[j] = filled[i] + 1e-5; // fill to spill
        heap.push(filled[j], j);
      }
    }
  }

  // water mask: sea, then ponds (filled noticeably above ground)
  const water = new Uint8Array(N); // 0 none, 1 sea, 2 lake/pond, 3 river
  for (let i = 0; i < N; i++) { if (height[i] < SEA) water[i] = 1; else if (filled[i] - height[i] > 0.02) water[i] = 2; }

  // flow accumulation: visit cells from high to low on the filled surface,
  // pass each cell's accumulated "rain" to its steepest downhill neighbour.
  const order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(N).fill(1);
  const down = new Int32Array(N).fill(-1);
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const i = idx(x, y); let best = -1, bh = filled[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const j = idx(x + dx, y + dy); if (filled[j] < bh) { bh = filled[j]; best = j; }
    }
    down[i] = best;
  }
  for (const i of order) { const d = down[i]; if (d >= 0) acc[d] += acc[i]; }

  // rivers: where flow concentrates (skip sea/lake cells; width from accumulation)
  const RIVER_ACC = 1400;
  for (let y = 2; y < GH - 2; y++) for (let x = 2; x < GW - 2; x++) {
    const i = idx(x, y);
    if (water[i] || acc[i] < RIVER_ACC) continue;
    const w = acc[i] > 30000 ? 3 : acc[i] > 8000 ? 2 : 1;
    for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
      if (dx * dx + dy * dy > w * w + 0.5) continue;
      const j = idx(x + dx, y + dy); if (!water[j]) water[j] = 3;
    }
  }

  // the lake = biggest pond; small mountain tarns stay as charm
  let lakeSize = 0, lakeSeed = -1;
  { const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (water[i] !== 2 || seen[i]) continue;
      const q = [i]; seen[i] = 1; let size = 0;
      while (q.length) { const c = q.pop(); size++;
        const x = c % GW, y = (c - x) / GW;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = idx(x + dx, y + dy); if (j >= 0 && j < N && water[j] === 2 && !seen[j]) { seen[j] = 1; q.push(j); } } }
      if (size > lakeSize) { lakeSize = size; lakeSeed = i; }
    }
  }

  // ---- 3. moisture + biomes -----------------------------------------------------
  const dist = new Uint16Array(N).fill(60000);
  { const q = []; let head = 0;
    for (let i = 0; i < N; i++) if (water[i]) { dist[i] = 0; q.push(i); }
    while (head < q.length) {
      const i = q[head++]; const x = i % GW, y = (i - x) / GW, d = dist[i] + 1;
      if (d > 220) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx2 = x + dx, ny2 = y + dy; if (nx2 >= 0 && ny2 >= 0 && nx2 < GW && ny2 < GH) { const j = idx(nx2, ny2); if (dist[j] > d) { dist[j] = d; q.push(j); } } }
    }
  }

  const terrain = new Uint8Array(N).fill(T.GRASS);
  const forest = new Uint8Array(N);
  const swamp = new Uint8Array(N);
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const i = idx(x, y);
    if (water[i]) { terrain[i] = T.WATER; continue; }
    const h = height[i];
    const moist = Math.exp(-dist[i] / 55) + 0.45 * fbm(x / 160, y / 160, S + 61); // rainfall bands + water proximity
    const slope = Math.abs(h - height[idx(x + 1, y)]) + Math.abs(h - height[idx(x, y + 1)]);
    if (h > 0.68 + 0.07 * fbm(x / 60, y / 60, S + 67)) { terrain[i] = T.ROCK; continue; }
    if (dist[i] <= 3 && h < SEA + 0.03) { terrain[i] = T.SAND; continue; }        // beaches
    // bog: flat wet lowland along the lake→sea drainage and the coastal plain (the delta)
    if (h < 0.32 && slope < 0.006 && moist > 0.62 && y > 500 && fbm(x / 110, y / 110, S + 75) > 0.42) { terrain[i] = T.SWAMP; swamp[i] = 1; continue; }
    // forests: broad belts in the wet lowlands + riparian ribbons hugging every river
    if ((moist > 0.74 && h < 0.58 && fbm(x / 90, y / 90, S + 71) > 0.50) ||
        (dist[i] < 8 && h < 0.60 && fbm(x / 40, y / 40, S + 73) > 0.46)) forest[i] = 1;
  }
  for (let d = 0; d < 3; d++) for (let x = 0; x < GW; x++) terrain[idx(x, d)] = T.ROCK;
  for (let d = 0; d < 3; d++) for (let y = 0; y < GH; y++) { if (height[idx(d, y)] >= SEA) terrain[idx(d, y)] = T.ROCK; if (height[idx(GW - 1 - d, y)] >= SEA) terrain[idx(GW - 1 - d, y)] = T.ROCK; }

  // ---- 4. sites: humans obey the land -------------------------------------------
  // Town: a ford — a big-flow river cell, mid-map, with flat open banks.
  let town = null, bestScore = -Infinity;
  for (let y = 280; y < 680; y += 2) for (let x = 220; x < 780; x += 2) {
    const i = idx(x, y);
    if (water[i] !== 3 || acc[i] < RIVER_ACC * 2) continue;
    let open = 0; for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) if (terrain[idx(x + dx, y + dy)] === T.GRASS) open++;
    const score = open * 50 - Math.hypot(x - 500, y - 470);
    if (score > bestScore) { bestScore = score; town = [x, y]; }
  }
  const nearestOf = (mask, fx, fy) => { let best = null, bd = Infinity; for (let y = 6; y < GH - 6; y += 2) for (let x = 6; x < GW - 6; x += 2) { const i = idx(x, y); if (!mask(i, x, y)) continue; const d = Math.hypot(x - fx, y - fy); if (d < bd) { bd = d; best = [x, y]; } } return best; };
  const [tx, ty] = town || [500, 470];
  const lakeIsBig = (i) => { if (water[i] !== 2) return false; return lakeSeed >= 0 && Math.abs((i % GW) - (lakeSeed % GW)) < 260 && Math.abs(((i - i % GW) / GW) - ((lakeSeed - lakeSeed % GW) / GW)) < 260; };
  const sites = {
    town: town || [500, 470],
    dock: nearestOf(lakeIsBig, tx, ty),
    quarry: nearestOf((i, x, y) => terrain[i] === T.ROCK && y > 130 && y < 400, tx, ty),
    farm: nearestOf((i, x, y) => terrain[i] === T.GRASS && dist[i] < 12 && y > ty + 20, tx, ty + 70),
    bogHeart: nearestOf((i) => swamp[i] === 1, 700, 720),
    forestWest: nearestOf((i, x) => forest[i] === 1 && x < tx - 80, tx, ty),
    forestEast: nearestOf((i, x) => forest[i] === 1 && x > tx + 80, tx, ty),
  };

  return { W: GW, H: GH, seed: S, height, filled, acc, terrain, water, forest, swamp, waterDist: dist, seaLevel: SEA, lakeSize, sites };
}
