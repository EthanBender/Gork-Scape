// src/world/map.js
// ONE authored Goblin Empire world, reverse-engineered from the approved image
// pack. Region centers/bounds, road polylines, landmark coordinates and the
// resource distribution come straight from worldData (which mirrors the JSON
// pack). Generation only paints terrain TEXTURE inside authored shapes; every
// location is hand-built with real tiles + objects. Do not regenerate layout.

import {
  WORLD_W, WORLD_H, CHUNK, DEFAULT_SEED, T, TERRAIN_DEFS, REGION_ANCHORS,
  RESOURCE_TYPES, ENEMY_TYPES, ROADS, LANDMARKS, MOB_MAP, SHORTCUTS,
} from './worldData.js';
// The design database (items/monsters/nodes). Loaded via resilient top-level
// await; empty in Node so world-gen falls back to the hand-authored baseline.
import { GameData } from '../data/gameData.js';
import { WILDERNESS } from './wilderness.js';
import { buildMacro, Heap } from './geo2.js';

export const TILE_SIZE = 32;
export { WORLD_W, WORLD_H, CHUNK, TERRAIN_DEFS, T };
export const REGIONS = REGION_ANCHORS;

const idx = (x, y) => y * WORLD_W + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;
const chunkKey = (x, y) => ((y / CHUNK) | 0) + ',' + ((x / CHUNK) | 0);
const prettify = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function makeRng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash2(ix, iy, seed) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) ^ seed; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, seed) { const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0); const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed); const ab = a + (b - a) * fx; return ab + ((c + (d - c) * fx) - ab) * fy; }

// ===================================================================
// AUTHORED TERRAIN (matches the image within each region's bounds).
// ===================================================================
const LAKE = [[622, 430], [665, 378], [735, 362], [808, 382], [858, 432], [874, 498], [856, 562], [806, 606], [735, 624], [668, 608], [628, 548], [615, 486]];
const LAKE_ISLAND = { x: 745, y: 520, r: 12 };
const RIVERS = [
  { pts: [[432, 130], [400, 240], [362, 330], [332, 435], [308, 520], [284, 610], [262, 690], [236, 770], [208, 850]], w: 3 }, // Willow (through Chopper's + Riverlands)
  { pts: [[615, 150], [640, 250], [664, 340], [694, 405]], w: 3 },  // north inlet -> Grublake
  { pts: [[735, 560], [705, 640], [685, 710], [725, 775]], w: 2 },  // lake drainage -> Bog (roads.json waterline)
];
const HIGHLANDS = [
  { poly: [[700, 0], [992, 0], [992, 172], [830, 168], [740, 120], [700, 58]], density: 0.72 }, // Troll Ridge
  { poly: [[440, 0], [712, 0], [712, 92], [560, 106], [440, 58]], density: 0.55 },               // north mountain band
  { poly: [[500, 70], [736, 70], [736, 288], [560, 292], [500, 182]], density: 0.42 },           // Northern Mine Hills
];
const BOG = [[600, 632], [770, 624], [806, 700], [790, 800], [700, 842], [610, 806], [595, 700]];
const FORESTS = [
  { poly: [[252, 298], [428, 296], [430, 452], [262, 454], [250, 360]], kinds: ['tree', 'tree', 'tree', 'tree_oak'], density: 0.15, mushroom: false }, // Chopper's Hollow
  { poly: [[702, 212], [978, 214], [980, 472], [720, 474], [702, 340]], kinds: ['tree_oak', 'tree_oak', 'tree'], density: 0.16, mushroom: false },      // Eastern Oakwoods
  { poly: [[118, 702], [388, 700], [390, 942], [130, 944], [116, 820]], kinds: ['tree_dead', 'tree', 'tree_dead'], density: 0.14, mushroom: true },      // Mushroom Forest
  { poly: [[92, 42], [388, 42], [390, 258], [110, 260], [92, 150]], kinds: ['tree', 'tree', 'tree_oak'], density: 0.12, mushroom: false },                // Old Forest Ruins
];

// ===================================================================
export function generateWorld(seed = DEFAULT_SEED, opts = {}) {
  seed = (seed >>> 0) || DEFAULT_SEED;
  // Geography 2.0 (process-derived macro world, src/world/geo2.js) is the DEFAULT
  // as of 2026-07-03 (owner green-light: "take this map to functional"). The legacy
  // stamped map remains reachable for comparison via {geo2:false}, GEO2=0, or ?geo2=0.
  const GEO2 = opts.geo2 ?? !((typeof process !== 'undefined' && process.env && process.env.GEO2 === '0') ||
    (typeof location !== 'undefined' && /[?&]geo2=0/.test(location.search)));
  const macro = GEO2 ? buildMacro(seed) : null;
  const rng = makeRng(seed);
  const Sr = seed ^ 0x51ed, Sg = seed ^ 0x2a3b;

  const terrain = new Uint8Array(WORLD_W * WORLD_H);
  const objects = [];
  const objectAt = new Map();
  const occupied = new Set();
  const enemySpawns = [];
  const friendlies = [];   // non-combat NPCs (tutors, prospectors, farmers…)
  const dbLoaded = ((GameData && GameData.monsters) || []).length > 0; // when true, DB is the sole monster source; baseline region-mobs are dropped
  const okey = (x, y) => x + ',' + y;
  // Hub-translation offsets: the authored hub builders (town, farm, quarry, dock…)
  // were written against legacy pack coordinates. Under GEO2 each builder runs
  // inside withOffset(), which shifts every terrain/object helper so the SAME
  // authored layout lands at its geographically-chosen site (ford, floodplain,
  // rock seam). Builders read terrain through the shifted getT, so their
  // water/rock adaptivity adapts to the REAL local geography.
  let OFFX = 0, OFFY = 0;
  const setT = (x, y, t) => { x += OFFX; y += OFFY; if (inB(x, y)) terrain[idx(x, y)] = t; };
  const getT = (x, y) => { x += OFFX; y += OFFY; return inB(x, y) ? terrain[idx(x, y)] : T.ROCK; };

  // geometry helpers
  const pip = (px, py, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const pbox = (poly) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [Math.max(0, x0 | 0), Math.max(0, y0 | 0), Math.min(WORLD_W - 1, Math.ceil(x1)), Math.min(WORLD_H - 1, Math.ceil(y1))]; };
  const fillPoly = (poly, fn) => { const [x0, y0, x1, y1] = pbox(poly); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (pip(x + 0.5, y + 0.5, poly)) fn(x, y); };
  function catmull(p, t) { const i = Math.min(Math.floor(t), p.length - 2), f = t - i; const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)]; const f2 = f * f, f3 = f2 * f; const cx = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * f + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * f2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * f3); const cy = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * f + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3); return [cx, cy]; }
  const disc = (cx, cy, r, fn) => { const r2 = r * r; for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { const dx = x - cx, dy = y - cy; if (inB(x, y) && dx * dx + dy * dy <= r2) fn(x, y); } };
  const alongPath = (pts, fn, step = 0.03) => { for (let t = 0; t < pts.length - 1; t += step) { const [x, y] = catmull(pts, t); fn(x, y); } };

  // object helpers (placeObj applies the hub-translation offset; structure/decor
  // pre-check against the SHIFTED position so occupancy stays consistent)
  const placeObj = (o, interactive = true) => { o.x += OFFX; o.y += OFFY; objects.push(o); if (interactive) { objectAt.set(okey(o.x, o.y), o); occupied.add(okey(o.x, o.y)); } return o; };
  const structure = (x, y, label, color, skill = null, blocking = true) => { if (!inB(x + OFFX, y + OFFY) || occupied.has(okey(x + OFFX, y + OFFY))) return null; return placeObj({ x, y, type: 'structure', label, color, skill, blocking, depleted: false }); };
  const decor = (x, y, color, size, shape) => { if (!inB(x + OFFX, y + OFFY) || occupied.has(okey(x + OFFX, y + OFFY))) return; placeObj({ x, y, type: 'decor', color, size, shape, blocking: false }, false); };
  // Run an authored builder translated to a new site. Enemy/friendly pushes inside
  // the builder bypass the helpers, so shift whatever it appended afterwards.
  const withOffset = (dx, dy, fn) => {
    const e0 = enemySpawns.length, f0 = friendlies.length;
    OFFX = dx; OFFY = dy;
    try { fn(); } finally {
      OFFX = 0; OFFY = 0;
      for (let i = e0; i < enemySpawns.length; i++) { enemySpawns[i].x += dx; enemySpawns[i].y += dy; if (enemySpawns[i].homeX !== undefined) { enemySpawns[i].homeX += dx; enemySpawns[i].homeY += dy; } }
      for (let i = f0; i < friendlies.length; i++) { friendlies[i].x += dx; friendlies[i].y += dy; }
    }
  };
  const isGrass = (x, y) => getT(x, y) === T.GRASS;
  const landish = (x, y) => { const t = getT(x, y); return t === T.GRASS || t === T.DIRT || t === T.SAND || t === T.SWAMP || t === T.FLOOR; };
  const openGround = (x, y) => isGrass(x, y) && !occupied.has(okey(x, y));
  const nearRock = (x, y, rad) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (getT(x + dx, y + dy) === T.ROCK) return true; return false; };
  const nearWater = (x, y, rad) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (getT(x + dx, y + dy) === T.WATER) return true; return false; };
  const waterShore = (x, y) => getT(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const t = getT(x + dx, y + dy); return t === T.SAND || t === T.GRASS || t === T.DIRT || t === T.SWAMP || t === T.BRIDGE; });
  const resObj = (x, y, k) => { const d = RESOURCE_TYPES[k]; return placeObj({ x, y, type: 'resource', resKey: k, skill: d.skill, level: d.level, tool: d.tool, drop: d.drop, xp: d.xp, low: d.low, high: d.high, label: d.label, color: d.color, deplete: d.deplete, respawn: d.respawn, blocking: d.blocking !== false, depleted: false, respawnAt: 0 }); };

  // A walkable building (RuneScape overworld style): FLOOR interior, WALL
  // perimeter, a 1-tile door you walk through, and the station/counter object
  // inside. No roof, no interior instance — you just walk in.
  function building(cx, cy, hw, hh, label, color, skill = null, door = 'S') {
    for (let y = cy - hh; y <= cy + hh; y++) for (let x = cx - hw; x <= cx + hw; x++) setT(x, y, T.FLOOR);
    for (let x = cx - hw - 1; x <= cx + hw + 1; x++) { setT(x, cy - hh - 1, T.WALL); setT(x, cy + hh + 1, T.WALL); }
    for (let y = cy - hh - 1; y <= cy + hh + 1; y++) { setT(cx - hw - 1, y, T.WALL); setT(cx + hw + 1, y, T.WALL); }
    if (door === 'S') setT(cx, cy + hh + 1, T.FLOOR);
    else if (door === 'N') setT(cx, cy - hh - 1, T.FLOOR);
    else if (door === 'E') setT(cx + hw + 1, cy, T.FLOOR);
    else setT(cx - hw - 1, cy, T.FLOOR);
    if (label) structure(cx, cy, label, color, skill); // counter/station inside, click to use
  }

  // Distance from a point to the nearest edge of a polygon (for feathered,
  // no-hard-stop region blending).
  function segDist(px, py, ax, ay, bx, by) { const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay; const c1 = vx * wx + vy * wy; if (c1 <= 0) return Math.hypot(px - ax, py - ay); const c2 = vx * vx + vy * vy; if (c2 <= c1) return Math.hypot(px - bx, py - by); const t = c1 / c2; return Math.hypot(px - (ax + t * vx), py - (ay + t * vy)); }
  function edgeDist(px, py, poly) { let m = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist(px, py, poly[i][0], poly[i][1], poly[j][0], poly[j][1])); return m; }
  // Iterate a polygon expanded by `feather`, calling fn(x, y, depth) where
  // depth is +dist inside the polygon and -dist just outside it. Lets fills ramp
  // density from the interior to zero a bit past the edge, so nothing stops hard.
  function polyFeather(poly, feather, fn) { const [x0, y0, x1, y1] = pbox(poly); for (let y = y0 - feather; y <= y1 + feather; y++) for (let x = x0 - feather; x <= x1 + feather; x++) { if (!inB(x, y)) continue; const inside = pip(x + 0.5, y + 0.5, poly); const d = edgeDist(x + 0.5, y + 0.5, poly); if (!inside && d > feather) continue; fn(x, y, inside ? d : -d); } }
  const ramp = (depth, at, span) => Math.max(0, Math.min(1, (depth + at) / span));

  if (GEO2) {
    // ---- GEO2 base: the macro world IS the geography (sea, lake, rivers, rock,
    // beaches, bog, all process-derived — see geo2.js). Nothing stamped here.
    terrain.set(macro.terrain);
  } else {
  // ---- PASS 1: base grass + border ----
  terrain.fill(T.GRASS);
  for (let x = 0; x < WORLD_W; x++) for (const y of [0, 1, 2, WORLD_H - 3, WORLD_H - 2, WORLD_H - 1]) terrain[idx(x, y)] = T.ROCK;
  for (let y = 0; y < WORLD_H; y++) for (const x of [0, 1, 2, WORLD_W - 3, WORLD_W - 2, WORLD_W - 1]) terrain[idx(x, y)] = T.ROCK;

  // ---- PASS 2: highlands (rock texture + passes), feathered at the edges ----
  for (const h of HIGHLANDS) polyFeather(h.poly, 18, (x, y, depth) => {
    const factor = ramp(depth, 12, 26); // rock density fades toward/just past the edge
    const n = vnoise(x / 6, y / 6, Sr) * 0.6 + vnoise(x / 22, y / 22, Sr) * 0.4;
    if (n < h.density * factor) setT(x, y, T.ROCK);
    else if (getT(x, y) === T.GRASS && depth > -12 && depth < 8 && vnoise(x / 4, y / 4, Sr + 2) > 0.84) decor(x, y, 0x6a6a6a, 6, 'rect'); // occasional boulders in the transition band (sparse — the rock terrain already reads as mountain)
  });

  // ---- PASS 2b: lake + rivers + bog ----
  fillPoly(LAKE, (x, y) => setT(x, y, T.WATER));
  disc(LAKE_ISLAND.x, LAKE_ISLAND.y, LAKE_ISLAND.r, (x, y) => setT(x, y, T.GRASS));
  // beach ring
  for (const [lx, ly] of LAKE) disc(lx, ly, 3, (x, y) => { if (getT(x, y) === T.GRASS && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => getT(x + dx, y + dy) === T.WATER)) setT(x, y, T.SAND); });
  for (const r of RIVERS) alongPath(r.pts, (cx, cy) => disc(cx, cy, r.w + 0.6 * vnoise(cx, cy, Sr), (x, y) => { if (getT(x, y) !== T.ROCK) setT(x, y, T.WATER); }));
  polyFeather(BOG, 16, (x, y, depth) => {
    const t = getT(x, y); if (t === T.WATER || t === T.ROCK) return;
    const factor = ramp(depth, 10, 24);
    if (depth > 8) setT(x, y, vnoise(x / 9, y / 9, Sg) < 0.36 ? T.WATER : T.SWAMP); // solid bog interior
    else if (factor > 0 && hash2(x, y, Sg + 5) < factor) { setT(x, y, T.SWAMP); if (vnoise(x / 5, y / 5, Sg + 2) > 0.82) decor(x, y, 0x6fae7a, 4, 'rect'); } // dithered swamp/grass fringe with reeds
  });
  }

  // ---- GEO2: regions become LABELS on the derived geography ----------------------
  // Same region identities (names, levels, mob lists), new homes chosen by querying
  // the macro world. REGION_ANCHORS entries are mutated in place, so every anchor-
  // driven system downstream (mobs, tiers, regionAt) follows automatically.
  const A = {}; for (const a of REGION_ANCHORS) A[a.id] = a;
  if (GEO2) {
    const centroidOf = (pred) => { let sx = 0, sy = 0, n = 0; for (let y = 6; y < WORLD_H - 6; y += 3) for (let x = 6; x < WORLD_W - 6; x += 3) { if (pred(idx(x, y), x, y)) { sx += x; sy += y; n++; } } return n ? [Math.round(sx / n), Math.round(sy / n)] : null; };
    const s = macro.sites, mv = (id, xy, fallback) => { const p = xy || fallback; const a = A[id]; a.x = p[0]; a.y = p[1]; a.bounds = [Math.max(3, a.x - a.r), Math.max(3, a.y - a.r), Math.min(WORLD_W - 4, a.x + a.r), Math.min(WORLD_H - 4, a.y + a.r)]; };
    const [tx0, ty0] = s.town;
    mv('settlement', s.town);
    mv('grubpit', s.quarry, [tx0 - 60, ty0 - 90]);
    mv('farmlands', s.farm, [tx0, ty0 + 90]);
    mv('grublake', centroidOf((i) => macro.water[i] === 2), [700, 470]);
    mv('bog', s.bogHeart, [700, 800]);
    mv('mushroom', centroidOf((i, x, y) => macro.forest[i] === 1 && x < 420 && y > 600), [250, 780]);
    mv('choppers', centroidOf((i, x, y) => macro.forest[i] === 1 && x < tx0 - 60 && y > 250 && y < 620), s.forestWest || [tx0 - 160, ty0]);
    mv('willow', centroidOf((i, x, y) => macro.forest[i] === 1 && macro.waterDist[i] < 10 && x < tx0 && y > ty0), [tx0 - 140, ty0 + 150]);
    mv('oakwoods', centroidOf((i, x, y) => macro.forest[i] === 1 && x > tx0 + 100 && y < 620), s.forestEast || [tx0 + 200, ty0]);
    mv('minehills', centroidOf((i, x, y) => macro.terrain[i] === T.ROCK && y > 90 && y < 300 && x > 350 && x < 750), [600, 180]);
    mv('troll', centroidOf((i, x, y) => macro.terrain[i] === T.ROCK && y < 120 && x > 600), [820, 70]);
    mv('rival', centroidOf((i, x, y) => macro.terrain[i] === T.GRASS && x > 780 && y > 700 && !macro.forest[i]), [850, 800]);
    mv('ruins', centroidOf((i, x, y) => macro.forest[i] === 1 && x < 420 && y < 300), [240, 160]);
  }

  // ---- PASS 3: Goblin Settlement (authored at 500,455; under GEO2 the whole
  // layout is translated to the river ford the hydrology chose) ----
  const TB = { x0: 450, y0: 405, x1: 555, y1: 510, cx: 500, cy: 455 };
  const townOff = GEO2 ? { dx: A.settlement.x - 500, dy: A.settlement.y - 455 } : { dx: 0, dy: 0 };
  const buildTown = () => {
    const { x0, y0, x1, y1, cx, cy } = TB;
    // [economy lane] Gorkholm coherence pass — see CENTRAL_REGION_DESIGN.md.
    // A goblin keep-town at the great crossroads: a fountain plaza at the heart,
    // the Chief's gatehouse-keep guarding the north approach, four gate-WARDS each
    // themed to the road/trade that feeds it (N=ore→forge, E=water→wharf,
    // S=farm→greengate, W=timber→craft), and a warren of back-alley housing in the
    // gaps. Every fixture sits where its raw materials arrive. Nothing is random.
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setT(x, y, T.GRASS);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = x0 + 1; x <= x1 - 1; x++) setT(x, y, T.ROAD); // E-W avenue
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = y0 + 1; y <= y1 - 1; y++) setT(x, y, T.ROAD); // N-S avenue
    disc(cx, cy, 8, (x, y) => setT(x, y, T.FLOOR)); // plaza
    // Fountain sits off the exact crossroads (the 4 main roads originate at cx,cy
    // and would otherwise bridge over it); this spot stays water in the plaza.
    const fx = cx + 4, fy = cy - 3;
    disc(fx, fy, 1, (x, y) => setT(x, y, T.WATER)); // fountain pool
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) decor(fx + dx, fy + dy, 0x8a8a7a, 4, 'rect'); // fountain rim
    // perimeter wall + 4 road gates + gatehouse towers
    for (let x = x0; x <= x1; x++) { setT(x, y0, T.WALL); setT(x, y1, T.WALL); }
    for (let y = y0; y <= y1; y++) { setT(x0, y, T.WALL); setT(x1, y, T.WALL); }
    for (const g of [-1, 0, 1]) { setT(cx + g, y0, T.ROAD); setT(cx + g, y1, T.ROAD); setT(x0, cy + g, T.ROAD); setT(x1, cy + g, T.ROAD); }
    for (const [gx, gy] of [[cx, y0], [cx, y1]]) for (const dx of [-2, 2]) decor(gx + dx, gy, 0x555046, 6, 'rect');
    for (const [gx, gy] of [[x0, cy], [x1, cy]]) for (const dy of [-2, 2]) decor(gx, gy + dy, 0x555046, 6, 'rect');
    TB.gates = { N: [cx, y0 - 1], S: [cx, y1 + 1], W: [x0 - 1, cy], E: [x1 + 1, cy] };

    // ---- THE KEEP: Chief's gatehouse guarding the north approach to the plaza.
    // The N avenue passes through its central FLOOR passage; Bank/Chief in the
    // west wing (the guarded vault), War Table/Quest Board in the east wing. ----
    (function keep() {
      const a0 = 489, b0 = 419, a1 = 511, b1 = 434;
      for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) setT(x, y, T.FLOOR);
      for (let x = a0 - 1; x <= a1 + 1; x++) { setT(x, b0 - 1, T.WALL); setT(x, b1 + 1, T.WALL); }
      for (let y = b0 - 1; y <= b1 + 1; y++) { setT(a0 - 1, y, T.WALL); setT(a1 + 1, y, T.WALL); }
      for (const g of [-1, 0, 1]) { setT(cx + g, b0 - 1, T.ROAD); setT(cx + g, b1 + 1, T.ROAD); } // N+S passage openings
      for (let y = b0; y <= b1; y++) { setT(497, y, T.WALL); setT(503, y, T.WALL); } // passage walls (x499-501 open)
      setT(497, 427, T.FLOOR); setT(503, 427, T.FLOOR); // wing doors off the passage
      structure(493, 424, 'Chief Hall', 0x7a5a8a); structure(493, 431, 'Bank', 0xc9a24a);   // west wing
      structure(507, 424, 'War Table', 0x9a5a4a); structure(507, 431, 'Quest Board', 0x8a6a3a); // east wing
    })();

    // ---- FORGE WARD (N gate ↔ ore road): metal from the northern mines ----
    building(485, 412, 2, 1, 'Town Furnace', 0x7a3a2a, 'Smithing', 'S');
    building(515, 412, 2, 1, 'Town Anvil', 0x3a3a3a, 'Smithing', 'S');
    building(477, 412, 1, 1, 'Weapon Shop', 0x9a5a4a, null, 'S');
    building(523, 412, 1, 1, 'Armour Shop', 0x6a7a9a, null, 'S');
    // [economy lane] Tinker's Workbench — a world node for the Tinkering skill
    // (replaces the old floating HUD button). skill flag routes the click to
    // performSkill, which opens the workbench popup (main.js hook).
    structure(496, 416, "Tinker's Workbench", 0xb8863a, 'Tinkering');

    // ---- THE WHARF (E gate ↔ water road): fish from Grublake to the east ----
    building(540, 448, 2, 1, 'Fishing Shack', 0x4f8fae, null, 'W');
    building(540, 462, 2, 1, 'Cooking Range', 0xd2691e, 'Cooking', 'W');
    building(548, 455, 1, 1, 'Fishmonger', 0x5a9ab0, null, 'W');
    building(531, 468, 1, 1, 'Bait & Tackle', 0x3f8fb5, null, 'N');

    // ---- GREENGATE (S gate ↔ farm road): crops from the southern farms ----
    building(486, 499, 2, 1, 'Farming Shed', 0x6a8a3a, null, 'N');
    building(472, 499, 2, 1, 'Grocer', 0x9a7a4a, null, 'N');
    building(514, 499, 1, 1, 'Herbalist', 0x7a9a5a, null, 'N');
    building(500, 501, 2, 1, 'General Store', 0x9a7a4a, null, 'N');

    // ---- TIMBER ROW (W gate ↔ lumber road): logs from Chopper's Hollow west ----
    building(460, 448, 2, 1, 'Sawmill', 0x8b6a3b, null, 'E');
    building(460, 462, 2, 1, 'Crafting Bench', 0x8b5a2b, 'Crafting', 'E');
    building(468, 455, 1, 1, 'Fletcher', 0xa98b5a, null, 'E');
    building(452, 468, 1, 1, 'Lumber Stall', 0x8b6a3b, null, 'N');

    // ---- MARKET SQUARE (the plaza ring): trade, rest, prayer ----
    building(482, 468, 2, 1, 'Crossroads Tavern', 0x8a6a4a, null, 'N');
    building(516, 468, 1, 1, 'Prayer Idol', 0xc0b070, null, 'N');
    for (const [x, y] of [[494, 449], [506, 449], [494, 461], [506, 461]]) structure(x, y, 'Market Stall', 0xbf9a5a);
    structure(490, 452, 'Grand Exchange', 0xe3c45a);

    // ---- THE WARREN (back alleys): cramped goblin housing fills the gaps ----
    const alley = (ax, ay, bx, by) => { const dx = Math.sign(bx - ax), dy = Math.sign(by - ay); let x = ax, y = ay; for (let i = 0; i < 40 && (x !== bx || y !== by); i++) { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); if (x !== bx) x += dx; if (y !== by) y += dy; } };
    for (const [x, y, d] of [[463, 428, 'S'], [537, 428, 'S'], [460, 483, 'N'], [468, 489, 'E'], [524, 483, 'N'], [532, 489, 'W']]) building(x, y, 1, 1, 'Goblin House', 0x6a5240, null, d);
    alley(456, 478, 472, 478); alley(464, 483, 464, 494); alley(524, 478, 540, 478);

    // ---- GREENERY: trees, shrubs, wells so it reads lived-in, not paved ----
    for (const [x, y] of [[458, 410], [542, 410], [458, 505], [542, 505], [470, 440], [530, 440], [476, 485], [524, 458]]) decor(x, y, 0x2f6b25, 6, 'circle');
    for (const [x, y] of [[464, 420], [536, 420], [464, 490], [536, 494], [485, 445], [515, 445]]) decor(x, y, 0x3a7a3a, 4, 'circle');
    for (const [x, y] of [[470, 458], [530, 448]]) { setT(x, y, T.WATER); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) decor(x + dx, y + dy, 0x8a8a7a, 3, 'rect'); }

    // ---- TRAINING YARD (SE corner, kept): dummies + starter rats ----
    const tx = 520, ty = 490;
    for (let y = ty - 5; y <= ty + 5; y++) for (let x = tx - 6; x <= tx + 6; x++) { if (!inB(x, y)) continue; if (x === tx - 6 || x === tx + 6 || y === ty - 5 || y === ty + 5) { if (!(x === tx && y === ty - 5)) setT(x, y, T.WALL); } else if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }
    structure(tx - 3, ty, 'Combat Dummy', 0x9a7a4a); structure(tx + 3, ty, 'Combat Dummy', 0x9a7a4a); structure(tx, ty + 3, 'Combat Dummy', 0x9a7a4a);
    enemySpawns.push({ type: 'rat', x: tx, y: ty - 3, name: 'Training Rat', _keep: true }, { type: 'rat', x: tx + 4, y: ty + 3, name: 'Training Rat', _keep: true });
  };
  if (GEO2) withOffset(townOff.dx, townOff.dy, buildTown); else buildTown();
  const spawn = { x: 500 + townOff.dx, y: 462 + townOff.dy };

  // ---- GEO2: the river flows THROUGH the ford-town. The authored layout paves
  // its box, so re-carve the macro river across open ground; where the avenues
  // cross it the road becomes a stone BRIDGE — the ford the town exists for.
  if (GEO2) {
    for (let y = TB.y0 + townOff.dy - 4; y <= TB.y1 + townOff.dy + 4; y++) for (let x = TB.x0 + townOff.dx - 4; x <= TB.x1 + townOff.dx + 4; x++) {
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (macro.water[i] !== 3) continue;                    // only the river course
      const t = terrain[i];
      if (t === T.ROAD) terrain[i] = T.BRIDGE;               // avenue crossing → bridge
      else if (t === T.GRASS || t === T.DIRT || t === T.SAND || t === T.FIELD) terrain[i] = T.WATER;
      else if (t === T.WALL) terrain[i] = T.WATER;           // water-gate gap in the palisade
    }
  }

  // ---- PASS 4: roads (exact polylines from roads.json) ----
  const carveRoad = (pts, w) => alongPath(pts, (cx, cy) => disc(cx, cy, w, (x, y) => { const t = getT(x, y); if (t === T.WATER) setT(x, y, T.BRIDGE); else if (t === T.WALL || t === T.FLOOR || t === T.ROAD || t === T.BRIDGE) return; else setT(x, y, T.ROAD); }));
  // A dirt footpath/trail. Crossing WATER lays a BRIDGE (plank/log over the
  // water, never dirt-in-the-river); leaves existing roads/buildings intact.
  const trail = (pts, hw = 0) => alongPath(pts, (cx, cy) => { for (let dy = -hw; dy <= hw; dy++) for (let dx = -hw; dx <= hw; dx++) { const x = Math.round(cx + dx), y = Math.round(cy + dy); const t = getT(x, y); if (t === T.WATER) setT(x, y, T.BRIDGE); else if (t === T.GRASS || t === T.SWAMP || t === T.SAND) setT(x, y, T.DIRT); } });
  if (!GEO2) { for (const r of ROADS) carveRoad(r.pts, r.w * 0.55); }
  else (function buildRoadsGeo2() {
    // Slope-aware roads: Dijkstra over a coarse grid where climbing is expensive,
    // water is crossable only at a price (→ bridges appear at the narrow points),
    // and rock is nearly impassable — so roads hug valleys like real roads do.
    // Each road starts at a town GATE so the network meets the walls honestly.
    const STEP = 3, CW = (WORLD_W / STEP) | 0, CH = (WORLD_H / STEP) | 0;
    const cost = new Float32Array(CW * CH);
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      const x = Math.min(WORLD_W - 2, cx * STEP + 1), y = Math.min(WORLD_H - 2, cy * STEP + 1), i = idx(x, y);
      const slope = Math.abs(macro.height[i] - macro.height[idx(Math.min(WORLD_W - 2, x + STEP), y)]) +
                    Math.abs(macro.height[i] - macro.height[idx(x, Math.min(WORLD_H - 2, y + STEP))]);
      let c = 1 + slope * 600;
      if (macro.water[i] === 1) c = 9000;                    // never road the open sea
      else if (macro.water[i]) c += 55;                      // river/lake crossing = bridge, costly
      if (macro.terrain[i] === T.ROCK) c += 420; else if (macro.terrain[i] === T.SWAMP) c += 12;
      cost[cy * CW + cx] = c;
    }
    const cOf = (x, y) => Math.max(0, Math.min(CH - 1, Math.round(y / STEP))) * CW + Math.max(0, Math.min(CW - 1, Math.round(x / STEP)));
    function route(from, to) {
      const src = cOf(from[0], from[1]), dst = cOf(to[0], to[1]);
      const D = new Float32Array(CW * CH).fill(Infinity), prev = new Int32Array(CW * CH).fill(-1), heap = new Heap();
      D[src] = 0; heap.push(0, src);
      while (heap.size) {
        const u = heap.pop(); if (u === dst) break;
        const ux = u % CW, uy = (u - ux) / CW;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const vx = ux + dx, vy = uy + dy;
          if (vx < 1 || vy < 1 || vx >= CW - 1 || vy >= CH - 1) continue;
          const v = vy * CW + vx, w = (cost[u] + cost[v]) * (dx && dy ? 0.71 : 0.5);
          if (D[u] + w < D[v]) { D[v] = D[u] + w; prev[v] = u; heap.push(D[v], v); }
        }
      }
      if (dst !== src && prev[dst] < 0) return null;
      const path = [];
      for (let c = dst; c >= 0; c = prev[c]) { const px = (c % CW) * STEP + 1, py = (((c - c % CW) / CW) | 0) * STEP + 1; path.push([px, py]); if (c === src) break; }
      return path.reverse();
    }
    const lay = (x, y, w) => disc(x, y, w, (ax, ay) => { const t = getT(ax, ay); if (t === T.WATER) setT(ax, ay, T.BRIDGE); else if (t === T.GRASS || t === T.SAND || t === T.SWAMP || t === T.DIRT) setT(ax, ay, T.ROAD); });
    const stamp = (path, w) => { if (!path) return; for (let k = 0; k < path.length; k++) { lay(path[k][0], path[k][1], w); if (k) lay((path[k][0] + path[k - 1][0]) / 2, (path[k][1] + path[k - 1][1]) / 2, w); } };
    // pass trails CARVE through rock (a cut switchback), not just decorate it
    const layCarve = (x, y, w) => disc(x, y, w, (ax, ay) => { const t = getT(ax, ay); if (t === T.WATER) setT(ax, ay, T.BRIDGE); else if (t === T.GRASS || t === T.SAND || t === T.SWAMP || t === T.DIRT || t === T.ROCK) setT(ax, ay, T.ROAD); });
    const stampCarve = (path, w) => { if (!path) return; for (let k = 0; k < path.length; k++) { layCarve(path[k][0], path[k][1], w); if (k) layCarve((path[k][0] + path[k - 1][0]) / 2, (path[k][1] + path[k - 1][1]) / 2, w); } };
    const g = TB.gates || {}; const gate = (k, fb) => { const p = g[k] || fb; return [p[0] + townOff.dx, p[1] + townOff.dy]; };
    const N_ = gate('N', [500, 404]), S_ = gate('S', [500, 511]), E_ = gate('E', [556, 455]), W_ = gate('W', [449, 455]);
    for (const [from, id, w] of [
      [N_, 'grubpit', 1.6], [N_, 'minehills', 1.3], [N_, 'troll', 1.1], [N_, 'ruins', 1.1],
      [E_, 'grublake', 1.6], [E_, 'oakwoods', 1.3],
      [S_, 'farmlands', 1.6], [S_, 'bog', 1.1], [S_, 'rival', 1.1],
      [W_, 'choppers', 1.6], [W_, 'willow', 1.3], [W_, 'mushroom', 1.1],
    ]) stamp(route(from, [A[id].x, A[id].y]), w);
    // Mountain-valley regions (the ruins) get a pass trail: rock is climbable at
    // trail prices here, so a switchback path cuts through instead of stranding it.
    for (let i = 0; i < cost.length; i++) if (cost[i] > 400 && cost[i] < 8000) cost[i] = 90;
    stampCarve(route([A.choppers.x, A.choppers.y], [A.ruins.x, A.ruins.y]), 1.0);
    const trollPath = route([A.minehills.x, A.minehills.y], [A.troll.x, A.troll.y]);
    stampCarve(trollPath, 1.0);

    // ---- THE TROLL GATE: the endgame region is EARNED. Wall the pass trail at
    // its deepest rock point; the shortcut marker opens it for materials.
    if (trollPath && trollPath.length > 6) {
      let gi = -1, best = -1;
      for (let k = 2; k < trollPath.length - 2; k++) {
        const [px, py] = trollPath[k]; const h = macro.height[idx(px, py)];
        if (h > best && macro.terrain[idx(px, py)] === T.ROCK) { best = h; gi = k; }
      }
      if (gi < 0) gi = (trollPath.length / 2) | 0;
      const [gx, gy] = trollPath[gi];
      const span = [];
      for (let k = Math.max(0, gi - 1); k <= Math.min(trollPath.length - 1, gi + 1); k++) {
        const [px, py] = trollPath[k];
        disc(px, py, 1.8, (x, y) => { const t = getT(x, y); if (t === T.ROAD || t === T.DIRT || t === T.GRASS || t === T.BRIDGE) { setT(x, y, T.WALL); span.push([x, y]); } });
      }
      if (span.length) {
        // marker on the approach side (toward the mine hills — the player's side)
        const [ax, ay] = trollPath[Math.max(0, gi - 3)];
        placeObj({ x: ax, y: ay, type: 'structure', label: 'Troll Ridge Gate (sealed)', color: 0x6a7a8a, skill: null, blocking: false, depleted: false,
          shortcut: { id: 'troll_gate', kind: 'gate', cost: [['iron_bar', 3], ['oak_plank', 2]], span,
            doneLabel: 'Troll Ridge Gate', hint: 'The trolls sealed the pass. With 3 iron bars and 2 oak planks you could force the mechanism.',
            doneMsg: 'The gate mechanism grinds open — Troll Ridge lies ahead. Tread carefully.', opened: false } });
      }
    }
  })();

  // ---- PASS 3b: build named locations at pack coords ----
  const ground = (cx, cy, rad, t) => disc(cx, cy, rad, (x, y) => { if (getT(x, y) !== T.WATER && getT(x, y) !== T.WALL) setT(x, y, t); });
  const snapLand = (x, y, rad = 60) => { if (landish(x, y)) return [x, y]; for (let r = 1; r <= rad; r++) for (let a = 0; a < 360; a += 15) { const nx = Math.round(x + r * Math.cos(a * Math.PI / 180)), ny = Math.round(y + r * Math.sin(a * Math.PI / 180)); if (landish(nx, ny)) return [nx, ny]; } return [x, y]; };
  const tents = (cx, cy, n, color) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; structure(Math.round(cx + 4 * Math.cos(a)), Math.round(cy + 4 * Math.sin(a)), 'Tent', color); } };
  const fenceRing = (cx, cy, rad) => { for (let a = 0; a < 360; a += 5) { const x = Math.round(cx + rad * Math.cos(a * Math.PI / 180)), y = Math.round(cy + rad * Math.sin(a * Math.PI / 180)); if (getT(x, y) !== T.WATER) setT(x, y, T.WALL); } };

  // ===== Grubpit Quarry — detailed starter mining bowl + cave-bug loop =====
  const grubpitLocal = () => {
    const qx = 455, qy = 285, R = 25;
    const keepRoad = (x, y) => getT(x, y) === T.ROAD || getT(x, y) === T.BRIDGE;
    // worked dirt bowl (preserve the cart road that runs through it)
    disc(qx, qy, R, (x, y) => { if (!keepRoad(x, y) && getT(x, y) !== T.WATER) setT(x, y, T.DIRT); });
    // irregular rock-cliff rim; the road punches ramp gaps through it
    for (let y = qy - R - 4; y <= qy + R + 4; y++) for (let x = qx - R - 4; x <= qx + R + 4; x++) { if (!inB(x, y)) continue; const d = Math.hypot(x - qx, y - qy); const wob = (vnoise(x / 5, y / 5, Sr) - 0.5) * 4; if (d >= R - 1 + wob && d <= R + 3 + wob && !keepRoad(x, y)) setT(x, y, T.ROCK); }
    // broken inner terrace — a mid tier for the quarry-bowl look
    for (let y = qy - 16; y <= qy + 16; y++) for (let x = qx - 16; x <= qx + 16; x++) { if (!inB(x, y)) continue; const d = Math.hypot(x - qx, y - qy); const wob = (vnoise(x / 6, y / 6, Sr + 1) - 0.5) * 3; if (d >= 12 + wob && d <= 13.5 + wob && !keepRoad(x, y) && vnoise(x / 4, y / 4, Sr + 3) > 0.35) setT(x, y, T.ROCK); }
    // ore veins along the walls: copper + tin common, iron teaser deep
    const vein = (radius, k, count) => { let placed = 0, tries = 0; while (placed < count && tries < count * 60) { tries++; const a = rng() * Math.PI * 2, rr = radius - rng() * 2.4; const x = Math.round(qx + rr * Math.cos(a)), y = Math.round(qy + rr * Math.sin(a)); if (getT(x, y) === T.DIRT && !occupied.has(okey(x, y)) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => keepRoad(x + dx, y + dy))) { resObj(x, y, k); placed++; } } };
    vein(R - 2, 'rock_copper', 12); vein(R - 2, 'rock_tin', 12); vein(13, 'rock_copper', 4); vein(13, 'rock_tin', 4); vein(9, 'rock_iron', 3);
    // clay piles + rubble on the pit floor (flavour)
    for (let i = 0; i < 6; i++) { const a = rng() * Math.PI * 2, rr = rng() * 10; const x = Math.round(qx + rr * Math.cos(a)), y = Math.round(qy + rr * Math.sin(a)); if (getT(x, y) === T.DIRT && !occupied.has(okey(x, y))) decor(x, y, 0xa89878, 5, 'rect'); }
    for (let i = 0; i < 16; i++) { const a = rng() * Math.PI * 2, rr = rng() * R; const x = Math.round(qx + rr * Math.cos(a)), y = Math.round(qy + rr * Math.sin(a)); if (getT(x, y) === T.DIRT && !occupied.has(okey(x, y))) decor(x, y, 0x7a7a7a, 4, 'rect'); }
    // rim structures
    building(qx - 20, qy + 6, 2, 1, 'Mine Hut', 0x6a5a3a, null, 'E');
    structure(qx - 16, qy + 3, 'Deposit Box', 0x9a8a4a); structure(qx - 18, qy + 9, 'Pickaxe Rack', 0x7a6a5a);
    structure(qx - 6, qy + 15, 'Ore Cart', 0x6a5a4a); structure(qx + 4, qy + 15, 'Ore Cart', 0x6a5a4a);
    structure(qx + 16, qy - 3, 'Rock Pile', 0x8a8a8a); structure(qx - 3, qy - 15, 'Rock Pile', 0x8a8a8a);
    // cart track spur running south from the pit toward the road
    for (let i = 0; i < 20; i++) { const y = qy + R + i; if (getT(qx, y) === T.GRASS) setT(qx, y, T.DIRT); if (getT(qx - 1, y) === T.GRASS) setT(qx - 1, y, T.DIRT); }
    // cave mouth on the north rim (label only — no interior)
    const cavX = qx, cavY = qy - R - 1; setT(cavX, cavY, T.DIRT);
    structure(cavX, cavY, 'Grubpit Cave', 0x141414); structure(qx - 3, qy - R + 2, 'Ladder Down', 0x5a4a3a);
    // friendly tutor
    friendlies.push({ name: 'Goblin Prospector', x: qx - 18, y: qy + 7, color: 0x8a7a4a, dialog: 'New here? Chip the copper and tin from the walls. The iron sits deeper in — you will need Mining 15 for it.' });
    // enemies: cave bugs by the cave mouth, cave bats around the pit
    for (let i = 0; i < 5; i++) { const a = rng() * Math.PI * 2, rr = 5 + rng() * 9; const x = Math.round(cavX + rr * Math.cos(a)), y = Math.round(cavY + 8 + rr * 0.6 * Math.sin(a)); if (landish(x, y) && !occupied.has(okey(x, y))) enemySpawns.push({ type: 'cave_bug', x, y, name: 'Cave Bug' }); }
    for (let i = 0; i < 4; i++) { const a = rng() * Math.PI * 2, rr = 6 + rng() * (R - 8); const x = Math.round(qx + rr * Math.cos(a)), y = Math.round(qy + rr * Math.sin(a)); if (landish(x, y) && !occupied.has(okey(x, y))) enemySpawns.push({ type: 'cave_bug', x, y, name: 'Cave Bat' }); }
  };
  // Northern Mine Hills camp (610,190) + deep mine (640,170) + mine cart (590,250)
  { const [x, y] = snapLand(610, 205, 80); ground(x, y, 10, T.DIRT); tents(x + 5, y, 4, 0x7a6a4a); building(x - 4, y, 2, 1, 'Miners Lodge', 0x6a5a3a, null, 'S'); structure(x + 6, y + 3, 'Deposit Box', 0x9a8a4a); structure(x - 7, y - 3, 'Ore Cart', 0x6a5a4a); structure(x + 4, y - 5, 'Coal Heap', 0x2a2a2a); for (let i = -6; i <= 6; i++) if (getT(x + i, y + 6) === T.GRASS || getT(x + i, y + 6) === T.DIRT) setT(x + i, y + 6, T.DIRT); friendlies.push({ name: 'Foreman Grint', x: x - 2, y: y + 1, color: 0x6a5a3a, dialog: 'Iron at 15, coal at 30, gold at 40 — all richer than the Grubpit. Cave goblins and rock crabs infest the deeper seams.' }); }
  { const [x, y] = snapLand(640, 170, 40); structure(x, y, 'Deep Mine Entrance', 0x222222); }
  { const [x, y] = snapLand(590, 250, 40); structure(x, y, 'Mine Cart Route', 0xc0a040); }
  // ===== Grublake Dock — fishing hub on the lake's west shore (96 chunk) =====
  // Stitches: piers extend into the REAL lake water; the Eastern Lake Road
  // reaches the shore here; a boat (locked) serves the Lake Island.
  const grublakeDock = () => {
    // find the west shore at y~440 (land tile whose east neighbour is lake water)
    let sy = 440, sx = 624;
    for (let x = 600; x < 690; x++) { if (getT(x, sy) !== T.WATER && getT(x + 1, sy) === T.WATER) { sx = x; break; } }
    // shore plaza (land only)
    disc(sx - 3, sy, 8, (x, y) => { if (getT(x, y) === T.GRASS || getT(x, y) === T.SAND) setT(x, y, T.DIRT); });
    // three plank piers reaching east into the water
    const pier = (py, len) => { let end = sx; for (let i = 1; i <= len; i++) { const x = sx + i; const t = getT(x, py); if (t === T.WATER || t === T.SAND || t === T.DIRT || t === T.GRASS) { setT(x, py, T.BRIDGE); end = x; } } return end; };
    const p1 = pier(sy - 4, 11), p2 = pier(sy, 14), p3 = pier(sy + 4, 11);
    // fishing spots: shrimp in the shallows, trout mid-water, pike off the pier ends
    const fspot = (x, y, k) => { if (getT(x, y) === T.WATER && !occupied.has(okey(x, y))) resObj(x, y, k); };
    for (const [dx, dy] of [[2, -6], [2, 6], [3, -2], [3, 2]]) fspot(sx + dx, sy + dy, 'fish_shrimp');
    for (const [dx, dy] of [[7, -6], [7, 6], [6, 2]]) fspot(sx + dx, sy + dy, 'fish_trout');
    fspot(p1 + 1, sy - 4, 'fish_pike'); fspot(p2 + 1, sy, 'fish_pike'); fspot(p3 + 1, sy + 4, 'fish_pike'); fspot(p2 + 2, sy - 1, 'fish_pike');
    // structures on the shore
    building(sx - 4, sy - 2, 2, 1, 'Fishing Shack', 0x4f8fae, null, 'W');
    structure(sx - 2, sy + 4, 'Bait Shack', 0x7a5a3a); structure(sx - 5, sy + 1, 'Fish-Drying Rack', 0x9a8a6a); structure(sx - 3, sy - 5, 'Crates', 0x8a6a3a);
    structure(p2, sy, 'Boat to Lake Island (locked)', 0xc0a040);
    decor(sx + 3, sy - 5, 0x6a5a3a, 5, 'rect'); decor(sx + 3, sy + 5, 0x6a5a3a, 5, 'rect'); // moored boats
    for (let i = 0; i < 14; i++) { const x = sx + 1 + Math.floor(rng() * 3), y = sy - 8 + Math.floor(rng() * 16); if (getT(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => landish(x + ax, y + ay)) && !occupied.has(okey(x, y))) decor(x, y, 0x6fae7a, 4, 'rect'); } // reeds
    trail([[sx - 9, sy], [sx - 3, sy]], 0); // shore path to the road
    friendlies.push({ name: 'Bait-Seller Gribble', x: sx - 4, y: sy + 3, color: 0x5a7a6a, dialog: 'Net shrimp by the bank, rod the trout, harpoon pike off the pier ends — Fishing 20 for those. Boat to the island is out of order.' });
    // enemies: crazed fisher goblins on the bank, lake snappers in the shallows
    for (let i = 0; i < 3; i++) { const x = sx - 6 + Math.floor(rng() * 9), y = sy - 9 + Math.floor(rng() * 18); if (landish(x, y) && !occupied.has(okey(x, y))) { enemySpawns.push({ type: 'bandit', x, y, name: 'Crazed Fisher Gob' }); occupied.add(okey(x, y)); } }
    for (let i = 0; i < 2; i++) { const x = sx - 5 + Math.floor(rng() * 8), y = sy + 6 + Math.floor(rng() * 6); if (landish(x, y) && !occupied.has(okey(x, y))) { enemySpawns.push({ type: 'mud_bug', x, y, name: 'Lake Snapper' }); occupied.add(okey(x, y)); } }
  };
  // Lake island POI (745,520)
  { structure(745, 520, 'Lake Island', 0x6a8f3a); }
  // Hunter camp (Eastern Oakwoods 820,330)
  { const [x, y] = snapLand(820, 330, 70); ground(x, y, 8, T.DIRT); tents(x + 6, y, 3, 0x6a5a3a); building(x, y, 2, 1, 'Hunter Lodge', 0x8a6a3a, null, 'S'); structure(x + 3, y + 4, 'Fire Pit', 0xd2691e); structure(x - 4, y - 3, 'Weapon Rack', 0x7a6a5a); structure(x + 4, y - 3, 'Skinning Rack', 0x9a8a6a); structure(x - 4, y + 4, 'Snare Trap', 0x6a5a3a); friendlies.push({ name: 'Huntsman Bracken', x: x - 2, y: y + 1, color: 0x6a5a3a, dialog: 'Oaks all around — level 10 to fell them. Boars and moss wolves roam east, and rival scouts push in from the far woods.' }); }
  // ===== Mushroom Forest — fungal grove + witch hut (160 chunk) =====
  const mushroomLocal = () => {
    const [x, y] = snapLand(250, 800, 70);
    disc(x, y, 8, (px, py) => { if (getT(px, py) === T.GRASS) setT(px, py, T.DIRT); }); // witch clearing
    building(x, y, 2, 1, 'Witch-Goblin Hut', 0x8a6fbf, null, 'S');
    structure(x + 5, y, 'Potion Station', 0x6abf9a); structure(x - 4, y + 3, 'Strange Garden', 0x9a6abf);
    structure(x + 5, y - 5, 'Hidden Cave', 0x222222); structure(x - 5, y - 4, 'Mushroom Ring', 0xc060c0);
    // big fungal mushroom clusters + fungal/dead trees around the grove
    for (let i = 0; i < 60; i++) { const px = 150 + Math.floor(rng() * 210), py = 720 + Math.floor(rng() * 200); if (getT(px, py) === T.GRASS && !occupied.has(okey(px, py))) { const r = rng(); if (r < 0.5) decor(px, py, [0xc44a6a, 0xd08040, 0x9a6abf][(rng() * 3) | 0], 5, 'circle'); else if (r < 0.62) resObj(px, py, 'tree_dead'); } }
    friendlies.push({ name: 'Witch-Goblin Vex', x: x - 2, y: y + 1, color: 0x8a6fbf, dialog: 'Strange spores, stranger brews. Fungal logs burn odd colours. The ring will carry you home, once you earn its favour.' });
    const put = (type, name, n) => { for (let i = 0; i < n; i++) { for (let t = 0; t < 40; t++) { const px = 150 + Math.floor(rng() * 210), py = 720 + Math.floor(rng() * 200); if (landish(px, py) && getT(px, py) !== T.DIRT && !occupied.has(okey(px, py))) { enemySpawns.push({ type, x: px, y: py, name }); occupied.add(okey(px, py)); break; } } } };
    put('cave_goblin', 'Fungal Goblin', 4); put('spider', 'Deep Cave Crawler', 3);
  };
  // ===== Bog of Grub — hostile boardwalk swamp (160 chunk) =====
  // Stitches: the Southern Bog Road causeways through; boardwalks are the only
  // safe footing over the slime pools. Feels hard to cross by design.
  const bogLocal = () => {
    const cx = 685, cy = 710;
    const board = (pts) => alongPath(pts, (ax, ay) => { const x = Math.round(ax), y = Math.round(ay); const t = getT(x, y); if (t === T.WATER || t === T.SWAMP) setT(x, y, T.BRIDGE); else if (t === T.GRASS) setT(x, y, T.DIRT); });
    const [sx, sy] = snapLand(725, 770, 60);
    disc(sx, sy, 5, (x, y) => { if (getT(x, y) === T.SWAMP || getT(x, y) === T.GRASS) setT(x, y, T.DIRT); });
    building(sx, sy, 2, 1, 'Herbalist Hut', 0x5a7a4a, null, 'S');
    structure(sx + 5, sy - 2, 'Swamp Shrine', 0x6ac0c0); structure(sx - 4, sy + 3, 'Deadwood Altar', 0x4a4030);
    // boardwalk network (broken planks over slime pools)
    board([[sx - 12, sy], [sx - 4, sy]]);
    board([[cx - 10, cy - 24], [cx, cy], [cx + 14, cy + 18], [sx - 8, sy - 6]]);
    board([[cx - 34, cy + 12], [cx, cy + 12], [cx + 34, cy + 12]]);
    // slime tufts + swamp-herb clumps on the mud
    for (let i = 0; i < 16; i++) { const x = cx - 72 + Math.floor(rng() * 150), y = cy - 82 + Math.floor(rng() * 168); if (getT(x, y) === T.SWAMP && !occupied.has(okey(x, y)) && rng() < 0.5) decor(x, y, rng() < 0.5 ? 0x6abf6a : 0x4a8a4a, 5, 'circle'); }
    friendlies.push({ name: 'Herbalist Mogg', x: sx - 2, y: sy + 1, color: 0x5a7a4a, dialog: 'Deadwood from the drowned trees, herbs from the mud, eels from the black water. Stay on the planks — the bog bites back.' });
    const put = (type, name, n) => { for (let i = 0; i < n; i++) { for (let t = 0; t < 40; t++) { const x = cx - 80 + Math.floor(rng() * 170), y = cy - 88 + Math.floor(rng() * 176); if (landish(x, y) && getT(x, y) !== T.DIRT && !occupied.has(okey(x, y))) { enemySpawns.push({ type, x, y, name }); occupied.add(okey(x, y)); break; } } } };
    put('slime', 'Bog Slime', 4); put('slime', 'Swamp Frog', 3); put('rat', 'Bog Rat', 3); put('cave_goblin', 'Swamp Shaman', 2);
  };
  // ===== Rival Goblin Territory — fortified hostile camp (160 chunk) =====
  // Stitches: the Southern Bog Road arrives at the main gate (north).
  const rivalLocal = () => {
    const [x, y] = snapLand(850, 825, 70);
    ground(x, y, 23, T.DIRT); fenceRing(x, y, 23);
    for (const g of [[0, -23], [-17, 17], [17, 17]]) { setT(x + g[0], y + g[1], T.ROAD); setT(x + g[0] + 1, y + g[1], T.ROAD); } // gates
    for (const [dx, dy] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) structure(x + dx, y + dy, 'Watchtower', 0x5a4a3a);
    // inner ring road (patrol path)
    for (let a = 0; a < 360; a += 3) { const px = Math.round(x + 15 * Math.cos(a * Math.PI / 180)), py = Math.round(y + 15 * Math.sin(a * Math.PI / 180)); if (getT(px, py) === T.DIRT) setT(px, py, T.ROAD); }
    tents(x - 8, y - 5, 5, 0x7a3a3a); tents(x + 8, y + 6, 4, 0x7a3a3a); tents(x - 9, y + 7, 3, 0x7a3a3a);
    structure(x + 6, y - 9, 'Fire Pit', 0xd2691e); structure(x - 9, y + 6, 'Storage Crates', 0x8a6a3a); structure(x + 9, y - 3, 'Storage Crates', 0x8a6a3a);
    structure(x - 6, y - 10, 'Weapon Rack', 0x7a6a5a); structure(x + 3, y + 10, 'Weapon Rack', 0x7a6a5a); structure(x, y + 14, 'War Banner', 0xb03030);
    // boss arena (north-interior) + the Captured Anvil
    ground(x, y - 13, 6, T.DIRT); structure(x, y - 13, 'Boss Arena', 0x6a2a2a);
    structure(840, 810, 'Captured Anvil', 0x3a3a3a, 'Smithing');
    // garrison + boss
    const put = (type, name, n, cx2, cy2, r) => { for (let i = 0; i < n; i++) { for (let t = 0; t < 40; t++) { const px = cx2 - r + Math.floor(rng() * r * 2), py = cy2 - r + Math.floor(rng() * r * 2); if (landish(px, py) && getT(px, py) !== T.WALL && !occupied.has(okey(px, py))) { enemySpawns.push({ type, x: px, y: py, name }); occupied.add(okey(px, py)); break; } } } };
    put('rival_warrior', 'Rival Goblin Warrior', 4, x, y, 18); put('rival_scout', 'Rival Goblin Archer', 3, x, y, 18); put('rival_warrior', 'Rival Goblin Brute', 2, x, y, 16);
    enemySpawns.push({ type: 'rival_warrior', x, y: y - 13, name: 'Red-Ear Captain' }); occupied.add(okey(x, y - 13));
  };
  // Troll gate (800,120) — dangerous, no friendlies; a fallen adventurer's cache
  { const [x, y] = snapLand(800, 120, 70); structure(x, y, 'Troll Ridge Gate', 0xe0c050); structure(x + 4, y + 3, 'Frozen Cave', 0x223344); structure(x - 4, y + 3, 'Mountain Pass', 0x9a9a9a); structure(x + 2, y + 5, 'Warning Sign', 0xb03030); structure(x - 5, y - 2, "Adventurer's Pack", 0xc9a24a); }
  // Old ruins chapel (245,150) — overgrown stone + hidden chests
  { const [x, y] = snapLand(245, 150, 70); for (let i = 0; i < 30; i++) { const rx = x + Math.round((rng() - rng()) * 26), ry = y + Math.round((rng() - rng()) * 26); if (getT(rx, ry) === T.GRASS) setT(rx, ry, T.WALL); } structure(x, y, 'Old Ruin Chapel', 0x8a8a7a); structure(x + 6, y - 4, 'Old Chest', 0xc9a24a); structure(x - 7, y + 5, 'Hidden Chest', 0xc9a24a); structure(x + 8, y + 6, 'Broken Statue', 0x8a8a7a); friendlies.push({ name: 'Explorer Nix', x: x - 2, y: y + 2, color: 0x7a6a5a, dialog: 'Old goblin stones, older than the settlement. Spiders and moss wolves nest in the walls — and fungal goblins wandered up from the south.' }); }
  // ===== Chopper's Hollow — woodcutting camp + forest (128 chunk) =====
  // Stitches: the West Woodcutters Road already enters from town on the east; a
  // footpath runs south to a log bridge over the Willow river (into Riverlands).
  const choppersLocal = () => {
    const cx = 335, cy = 372, R = 10;
    disc(cx, cy, R, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }); // clearing (trees don't grow on dirt)
    building(cx - 5, cy - 3, 2, 1, 'Woodcutting Hut', 0x6a5a3a, null, 'S');
    structure(cx + 5, cy - 3, 'Saw Pit', 0x7a6a4a); structure(cx + 6, cy + 2, 'Log Pile', 0x8a6a3a); structure(cx - 6, cy + 4, 'Log Pile', 0x8a6a3a);
    structure(cx + 2, cy + 5, 'Campfire', 0xd2691e);
    for (let i = 0; i < 12; i++) { const a = rng() * Math.PI * 2, rr = R - 1 + rng() * 6; const x = Math.round(cx + rr * Math.cos(a)), y = Math.round(cy + rr * Math.sin(a)); if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) decor(x, y, 0x5a4530, 5, 'rect'); } // stumps
    // training oak grove NW of camp (denser than the ambient forest)
    for (let i = 0; i < 28; i++) { const x = cx - 34 + Math.floor(rng() * 24), y = cy - 26 + Math.floor(rng() * 30); if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) resObj(x, y, 'tree_oak'); }
    // footpath south to a log bridge over the Willow river (stitch to Riverlands)
    trail([[cx, cy + R], [cx - 1, cy + 30], [cx - 3, cy + 64]], 0);
    friendlies.push({ name: 'Woodcutter Splinter', x: cx - 3, y: cy + 2, color: 0x6a5a3a, dialog: 'Start on the normal trees; oaks want level 10. Burn the logs on the campfire, or cook your fish back in town.' });
    // enemies from the region mob list (placed off the camp, in the woods)
    const put = (type, name, n) => { for (let i = 0; i < n; i++) { for (let t = 0; t < 40; t++) { const x = 258 + Math.floor(rng() * 168), y = 302 + Math.floor(rng() * 146); if (landish(x, y) && getT(x, y) !== T.DIRT && !occupied.has(okey(x, y)) && Math.hypot(x - cx, y - cy) > 14) { enemySpawns.push({ type, x, y, name }); occupied.add(okey(x, y)); break; } } } };
    put('rat', 'Forest Rat', 3); put('spider', 'Giant Spider', 3); put('cave_bug', 'Goblin Trainee', 3);
  };
  // ===== Willow Riverlands — willow banks + fishing (160 chunk) =====
  // Stitches: the Willow river flows through; docks reach the real channel; a
  // footbridge fords it; willows lean over the banks.
  const willowLocal = () => {
    const cx = 285, cy = 610;
    let cxW = cx; for (let x = cx - 30; x <= cx + 30; x++) { if (getT(x, cy) === T.WATER) { cxW = x; break; } } // river column
    let bW = cxW; while (getT(bW - 1, cy) === T.WATER) bW--; bW--; // west bank (land)
    let bE = cxW; while (getT(bE + 1, cy) === T.WATER) bE++; bE++; // east bank (land)
    disc(bW - 3, cy, 6, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }); // west landing
    disc(bE + 3, cy, 6, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }); // east landing
    for (let i = 1; i <= 4; i++) { if (getT(bW + i, cy - 3) === T.WATER) setT(bW + i, cy - 3, T.BRIDGE); } // west dock
    for (let i = 1; i <= 4; i++) { if (getT(bE - i, cy + 3) === T.WATER) setT(bE - i, cy + 3, T.BRIDGE); } // east dock
    building(bW - 4, cy - 1, 2, 1, 'Fishing Shack', 0x4f8fae, null, 'W');
    building(bE + 4, cy + 1, 2, 1, 'Riverside Hut', 0x6a7a5a, null, 'E');
    structure(bW - 2, cy + 3, 'Bait Barrel', 0x7a5a3a); structure(bE + 2, cy - 3, 'Net Rack', 0x8a7a5a);
    // willows leaning over both banks
    for (let i = 0; i < 44; i++) { const x = cx - 55 + Math.floor(rng() * 110), y = cy - 75 + Math.floor(rng() * 150); if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y)) && nearWater(x, y, 3)) resObj(x, y, 'tree_willow'); }
    // trout in the deep channel, mudfish (shrimp) in the shallows
    let ft = 0; for (let y = cy - 60; y <= cy + 60 && ft < 12; y++) { if (getT(cxW, y) === T.WATER && !occupied.has(okey(cxW, y)) && rng() < 0.28) { resObj(cxW, y, rng() < 0.6 ? 'fish_trout' : 'fish_shrimp'); ft++; } }
    // a footbridge/ford across the river
    trail([[bW - 7, cy - 9], [bW, cy - 9], [cxW, cy - 9], [bE, cy - 9], [bE + 7, cy - 9]], 0);
    // reeds + mud flats along the banks
    for (let i = 0; i < 22; i++) { const x = cx - 55 + Math.floor(rng() * 110), y = cy - 70 + Math.floor(rng() * 140); if (getT(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => landish(x + ax, y + ay)) && !occupied.has(okey(x, y))) decor(x, y, 0x6fae7a, 4, 'rect'); }
    friendlies.push({ name: 'River-Warden Sog', x: bW - 2, y: cy + 1, color: 0x5a7a6a, dialog: 'Willows grow best by the water — level 20 to cut them. Rod the trout in the deep channel, and mind the bandits in the reeds.' });
    const put = (type, name, n) => { for (let i = 0; i < n; i++) { for (let t = 0; t < 40; t++) { const x = cx - 80 + Math.floor(rng() * 160), y = cy - 90 + Math.floor(rng() * 180); if (landish(x, y) && getT(x, y) !== T.DIRT && !occupied.has(okey(x, y))) { enemySpawns.push({ type, x, y, name }); occupied.add(okey(x, y)); break; } } } };
    put('mud_bug', 'Mud Grub', 3); put('mud_bug', 'Mud Bug', 2); put('bandit', 'River Bandit', 3);
  };
  // ===== Main Farmlands — farm village (farming/cooking/herb loop) =====
  const farmlandsLocal = () => {
    const fx = 510, x0 = 470, y0 = 601, x1 = 560, y1 = 691, midY = 646;
    const gateT = (x, y) => (getT(x, y) === T.ROAD || getT(x, y) === T.BRIDGE) ? T.DIRT : T.WALL; // fence yields to roads = gates
    for (let x = x0; x <= x1; x++) { setT(x, y0, gateT(x, y0)); setT(x, y1, gateT(x, y1)); }
    for (let y = y0; y <= y1; y++) { setT(x0, y, gateT(x0, y)); setT(x1, y, gateT(x1, y)); }
    for (const g of [-1, 0, 1]) { setT(fx + g, y0, T.DIRT); setT(fx + g, y1, T.DIRT); } // pedestrian N/S gates
    for (let y = y0; y <= y1; y++) { setT(fx, y, T.DIRT); setT(fx - 1, y, T.DIRT); }
    for (let x = x0; x <= x1; x++) { setT(x, midY, T.DIRT); setT(x, midY - 1, T.DIRT); }
    const CROP = { potato: 0x8a9a4a, cabbage: 0x3a9a3a, onion: 0xb0bd86, herb: 0x2f8a4a };
    function plot(px, py, hw, hh, crop, label) {
      for (let y = py - hh - 1; y <= py + hh + 1; y++) { setT(px - hw - 1, y, T.WALL); setT(px + hw + 1, y, T.WALL); }
      for (let x = px - hw - 1; x <= px + hw + 1; x++) { setT(x, py - hh - 1, T.WALL); setT(x, py + hh + 1, T.WALL); }
      setT(px, py + hh + 1, T.DIRT); // gate
      for (let y = py - hh; y <= py + hh; y++) for (let x = px - hw; x <= px + hw; x++) setT(x, y, ((y - (py - hh)) % 2 === 0) ? T.FIELD : T.DIRT);
      for (let y = py - hh; y <= py + hh; y += 2) for (let x = px - hw + 1; x <= px + hw - 1; x += 2) if (getT(x, y) === T.FIELD && !occupied.has(okey(x, y))) decor(x, y, CROP[crop], 4, 'circle');
      decor(px, py - 1, 0xc9a24a, 6, 'rect'); // scarecrow post
      structure(px - hw + 1, py - hh + 1, label, 0x9a7a4a); // field marker
    }
    plot(487, 618, 8, 6, 'potato', 'Potato Field'); plot(533, 618, 8, 6, 'cabbage', 'Cabbage Field');
    plot(487, 674, 8, 6, 'onion', 'Onion Field'); plot(533, 674, 8, 6, 'herb', 'Herb Patch');
    // irrigation: a well-fed dug channel (contained, gently curved), with plank
    // bridges laid wherever a dirt path crosses the WATER (bridge over water).
    structure(fx + 6, 634, 'Well', 0x6a7a8a);
    const chan = (x, y) => { const t = getT(x, y); if (t === T.WALL || t === T.FIELD || t === T.FLOOR || t === T.ROAD) return; setT(x, y, T.WATER); };
    for (let y = 635; y <= 656; y++) chan(fx + 6, y);                                 // feeder from the well
    for (let x = 478; x <= 552; x++) chan(x, 656 + Math.round(Math.sin(x * 0.25)));   // gently curved cross-channel
    disc(479, 656, 1, (x, y) => chan(x, y));                                          // soak at the west end
    for (const px of [fx - 1, fx]) for (let y = 653; y <= 659; y++) if (getT(px, y) === T.WATER) setT(px, y, T.BRIDGE); // central path plank over the channel
    for (const py of [midY - 1, midY]) for (let x = fx + 4; x <= fx + 8; x++) if (getT(x, py) === T.WATER) setT(x, py, T.BRIDGE); // mid path plank over the feeder
    building(538, 605, 2, 1, 'Farmhouse', 0x8a6a4a, null, 'S');
    building(482, 605, 2, 1, 'Tool Shed', 0x7a6a4a, null, 'S');
    building(534, 686, 3, 1, 'Barn', 0x8a5a3a, null, 'N');
    structure(498, 638, 'Compost Bin', 0x5a4a2a); structure(522, 654, 'Compost Bin', 0x5a4a2a);
    structure(504, 636, 'Produce Cart', 0x9a7a4a); structure(516, 654, 'Water Trough', 0x6a7a8a);
    for (const [hx, hy] of [[476, 688], [520, 604], [500, 688]]) decor(hx, hy, 0xc9b26a, 6, 'rect'); // hay bales
    friendlies.push({ name: 'Farmer Grubfinger', x: 538, y: 608, color: 0x8a6a4a, dialog: 'Potatoes and cabbage up top, onions and herbs below. Take your catch to the town range to cook it up.' });
    friendlies.push({ name: 'Goblin Farmhand', x: 494, y: 648, color: 0x7a7a4a, dialog: 'Rats keep raiding the rows, and mud bugs crawl up from the ditch. Bash a few for me?' });
    for (let i = 0; i < 4; i++) { const x = x0 + 4 + Math.floor(rng() * (x1 - x0 - 8)), y = y0 + 4 + Math.floor(rng() * (y1 - y0 - 8)); if (landish(x, y) && !occupied.has(okey(x, y))) enemySpawns.push({ type: 'rat', x, y, name: rng() < 0.5 ? 'Field Rat' : 'Forest Rat' }); }
    for (let i = 0; i < 3; i++) { const x = x0 + 3 + Math.floor(rng() * (x1 - x0 - 6)), y = 659 + Math.floor(rng() * 3); if (landish(x, y) && !occupied.has(okey(x, y))) enemySpawns.push({ type: 'mud_bug', x, y, name: 'Mud Bug' }); }
  };

  // Run every authored hub at its geographically-chosen home (legacy coords under
  // the old map; withOffset-translated to the relocated region anchors under GEO2).
  const runHub = (fn, id, lx, ly, target) => { if (!GEO2) return fn(); const t = target || [A[id].x, A[id].y]; withOffset(t[0] - lx, t[1] - ly, fn); };
  runHub(grubpitLocal, 'grubpit', 455, 285);
  runHub(grublakeDock, 'grublake', 645, 440, GEO2 ? macro.sites.dock : null);
  runHub(mushroomLocal, 'mushroom', 250, 800);
  runHub(bogLocal, 'bog', 685, 710);
  runHub(rivalLocal, 'rival', 850, 825);
  runHub(choppersLocal, 'choppers', 335, 370);
  runHub(willowLocal, 'willow', 285, 610);
  runHub(farmlandsLocal, 'farmlands', 510, 640);

  // ---- Dungeon doorways (M2): one enterable interior per themed region ----
  // Each is a non-blocking doorway object flagged `interior:` — main.js swaps
  // Game.world for the generated sub-map (src/world/interiors.js) on click.
  (function placeInteriorEntrances() {
    const doors = [
      ['deep_mine', 'Deep Mine Entrance', 0x3a3a44, A.minehills],
      ['ruin_chapel', 'Old Ruin Chapel', 0x8a8a9a, A.ruins],
      ['witch_hut', 'Witch-Goblin Hut', 0x8a5a7a, A.mushroom],
      ['rival_camp', 'Rival War Camp', 0xb03030, A.rival],
    ];
    for (const [kind, label, color, a] of doors) {
      let done = false;
      for (let r = 3; r < 70 && !done; r += 2) for (let ang = 0; ang < 360; ang += 20) {
        const x = Math.round(a.x + r * Math.cos(ang * Math.PI / 180)), y = Math.round(a.y + r * Math.sin(ang * Math.PI / 180));
        if (getT(x, y) !== T.GRASS || occupied.has(okey(x, y)) || !landish(x, y + 1)) continue;
        placeObj({ x, y, type: 'structure', label, color, skill: null, blocking: false, depleted: false, interior: kind, examine: 'A dark way down…' });
        for (const dx of [-1, 1]) if (getT(x + dx, y) === T.GRASS) setT(x + dx, y, T.WALL); // door jambs
        done = true; break;
      }
    }
  })();


  // ---- forests (dense trees + clearings), tree density feathered at edges ----
  const clearing = (x, y) => vnoise(x / 30, y / 30, Sg + 4) > 0.66;
  if (!GEO2) for (const f of FORESTS) polyFeather(f.poly, 18, (x, y, depth) => {
    if (getT(x, y) !== T.GRASS || occupied.has(okey(x, y)) || clearing(x, y)) return;
    const p = f.density * ramp(depth, 12, 26); // full inside -> sparse fringe -> none ~12 past the edge
    const r = hash2(x, y, Sr + 7);
    if (r < p) resObj(x, y, f.kinds[(hash2(x, y, Sr + 11) * f.kinds.length) | 0]);
    else if (r < p + 0.02) decor(x, y, 0x4a3a28, 5, 'rect');
    else if (f.mushroom && depth > -4 && vnoise(x / 9, y / 9, Sg + 9) > 0.42 && r > 0.80) {
      // A mushroom forest should READ as mushrooms: dense, colour-varied caps clumped
      // into groves, with the odd giant toadstool towering over the rest.
      const h = hash2(x, y, Sr + 13);
      const col = [0xc44a6a, 0xd0603a, 0x9a6abf, 0xd0a040, 0xb0407a][(hash2(x, y, Sr + 17) * 5) | 0];
      if (h < 0.06 && getT(x, y) === T.GRASS) { // giant toadstool: a stem on this tile, a big cap overhanging its neighbours (drawn tree-style)
        placeObj({ x, y, type: 'decor', shape: 'circle', mush: 'giant', color: col, size: 17 + (hash2(x, y, Sr + 19) * 7 | 0), blocking: true }, false);
        occupied.add(okey(x, y));
      } else decor(x, y, col, 3 + (h * 4 | 0), 'circle'); // regular caps
    }
    else if (r > 0.97) decor(x, y, 0x2f5d24, 6, 'circle');
  });
  else (function forestsGeo2() {
    // Trees from the moisture-derived forest mask; species by (relocated) region.
    const kindFor = (x, y) => {
      const rn = regionAt(x, y);
      if (rn === A.mushroom.name) return hash2(x, y, Sr + 11) < 0.5 ? 'tree_dead' : 'tree';
      if (rn === A.willow.name) return 'tree_willow';
      if (rn === A.oakwoods.name) return hash2(x, y, Sr + 11) < 0.6 ? 'tree_oak' : 'tree';
      if (rn === A.choppers.name) return hash2(x, y, Sr + 11) < 0.3 ? 'tree_oak' : 'tree';
      return hash2(x, y, Sr + 11) < 0.12 ? 'tree_oak' : 'tree';
    };
    for (let y = 4; y < WORLD_H - 4; y++) for (let x = 4; x < WORLD_W - 4; x++) {
      const i = idx(x, y);
      if (!macro.forest[i] || terrain[i] !== T.GRASS || occupied.has(okey(x, y))) continue;
      if (vnoise(x / 30, y / 30, Sg + 4) > 0.66) continue; // clearings
      const r = hash2(x, y, Sr + 7);
      if (r < 0.13) { resObj(x, y, kindFor(x, y)); continue; }
      if (r < 0.145) { decor(x, y, 0x4a3a28, 5, 'rect'); continue; }
      if (regionAt(x, y) === A.mushroom.name && r > 0.80 && vnoise(x / 9, y / 9, Sg + 9) > 0.42) {
        const h = hash2(x, y, Sr + 13);
        const col = [0xc44a6a, 0xd0603a, 0x9a6abf, 0xd0a040, 0xb0407a][(hash2(x, y, Sr + 17) * 5) | 0];
        if (h < 0.06) { placeObj({ x, y, type: 'decor', shape: 'circle', mush: 'giant', color: col, size: 17 + (hash2(x, y, Sr + 19) * 7 | 0), blocking: true }, false); occupied.add(okey(x, y)); }
        else decor(x, y, col, 3 + (h * 4 | 0), 'circle');
      } else if (r > 0.97) decor(x, y, 0x2f5d24, 6, 'circle');
    }
  })();


  // ---- PASS 5: resource distribution (teaser / training / specialist) ----
  function scatter(cx, cy, rad, k, count, suit) { const d = RESOURCE_TYPES[k]; let placed = 0, tries = 0; while (placed < count && tries < count * 90) { tries++; const x = Math.round(cx + (rng() - rng()) * rad), y = Math.round(cy + (rng() - rng()) * rad); if (occupied.has(okey(x, y))) continue; if (d.blocking === false) { if (!waterShore(x, y)) continue; } else if (!suit(x, y)) continue; resObj(x, y, k); placed++; } }
if (!GEO2) {
  // teasers near town
  scatter(475, 435, 22, 'tree_oak', 4, openGround);
  scatter(500, 540, 55, 'tree', 20, openGround);
  scatter(430, 500, 60, 'tree', 14, openGround);
  scatter(360, 450, 40, 'tree_willow', 2, (x, y) => openGround(x, y) && nearWater(x, y, 3));      // willow teaser near river
  scatter(360, 460, 60, 'fish_shrimp', 3, null);                                                  // shrimp near town water (river)
  scatter(340, 470, 70, 'fish_trout', 2, null);
  // (Grubpit Quarry ore is placed by its detailed local build above.)
  // Northern Mine Hills (iron/coal/gold specialist)
  scatter(610, 190, 110, 'rock_iron', 16, (x, y) => openGround(x, y) && nearRock(x, y, 5)); scatter(620, 180, 115, 'rock_coal', 16, (x, y) => openGround(x, y) && nearRock(x, y, 5)); scatter(630, 160, 120, 'rock_gold', 10, (x, y) => openGround(x, y) && nearRock(x, y, 5));
  // Troll Ridge (coal/gold specialist)
  scatter(835, 80, 130, 'rock_coal', 10, (x, y) => openGround(x, y) && nearRock(x, y, 6)); scatter(835, 80, 130, 'rock_gold', 10, (x, y) => openGround(x, y) && nearRock(x, y, 6));
  // Grublake (pike + willow shoreline) and Willow Riverlands (willow/trout specialist)
  scatter(735, 495, 135, 'fish_pike', 9, null); scatter(700, 470, 120, 'fish_trout', 5, null); scatter(720, 500, 130, 'tree_willow', 8, (x, y) => openGround(x, y) && nearWater(x, y, 3));
  scatter(285, 610, 120, 'tree_willow', 16, (x, y) => openGround(x, y) && nearWater(x, y, 3)); scatter(285, 610, 120, 'fish_trout', 8, null); scatter(285, 620, 120, 'fish_shrimp', 5, null);
  // Bog of Grub (deadwood + eel) and Mushroom Forest (dead trees via forest)
  scatter(685, 710, 110, 'tree_dead', 14, (x, y) => getT(x, y) === T.SWAMP && !occupied.has(okey(x, y))); scatter(685, 710, 110, 'fish_eel', 8, null);
  } else {
    // ---- GEO2 resources, anchored to the RELOCATED regions ----
    scatter(A.settlement.x - 25, A.settlement.y - 20, 22, 'tree_oak', 4, openGround);
    scatter(A.settlement.x, A.settlement.y + 85, 55, 'tree', 20, openGround);
    scatter(A.settlement.x - 70, A.settlement.y + 45, 60, 'tree', 14, openGround);
    scatter(A.settlement.x - 60, A.settlement.y + 10, 70, 'fish_shrimp', 3, null); scatter(A.settlement.x - 80, A.settlement.y + 15, 80, 'fish_trout', 2, null);
    scatter(A.willow.x, A.willow.y, 120, 'tree_willow', 16, (x, y) => openGround(x, y) && nearWater(x, y, 3));
    scatter(A.willow.x, A.willow.y, 120, 'fish_trout', 8, null); scatter(A.willow.x, A.willow.y + 10, 120, 'fish_shrimp', 5, null);
    scatter(A.minehills.x, A.minehills.y, 110, 'rock_iron', 16, (x, y) => openGround(x, y) && nearRock(x, y, 5));
    scatter(A.minehills.x + 10, A.minehills.y - 10, 115, 'rock_coal', 16, (x, y) => openGround(x, y) && nearRock(x, y, 5));
    scatter(A.minehills.x + 20, A.minehills.y - 20, 120, 'rock_gold', 10, (x, y) => openGround(x, y) && nearRock(x, y, 5));
    scatter(A.troll.x, A.troll.y, 130, 'rock_coal', 10, (x, y) => openGround(x, y) && nearRock(x, y, 6));
    scatter(A.troll.x, A.troll.y, 130, 'rock_gold', 10, (x, y) => openGround(x, y) && nearRock(x, y, 6));
    scatter(A.grublake.x, A.grublake.y, 135, 'fish_pike', 9, null); scatter(A.grublake.x - 30, A.grublake.y - 20, 120, 'fish_trout', 5, null);
    scatter(A.grublake.x - 15, A.grublake.y + 5, 130, 'tree_willow', 8, (x, y) => openGround(x, y) && nearWater(x, y, 3));
    scatter(A.bog.x, A.bog.y, 110, 'tree_dead', 14, (x, y) => getT(x, y) === T.SWAMP && !occupied.has(okey(x, y))); scatter(A.bog.x, A.bog.y, 110, 'fish_eel', 8, null);
  }

  // ---- PASS 6: monsters (from region mob lists, mapped to stat blocks) ----
  function spawnNear(cx, cy, rad, base, count, name) { let placed = 0, tries = 0; while (placed < count && tries < count * 70) { tries++; const x = Math.round(cx + (rng() - rng()) * rad), y = Math.round(cy + (rng() - rng()) * rad); if (!landish(x, y) || occupied.has(okey(x, y))) continue; enemySpawns.push({ type: base, x, y, name }); placed++; } }
  const authoredRegions = new Set(['grubpit', 'farmlands', 'choppers', 'grublake', 'willow', 'bog', 'mushroom', 'rival']); // enemies placed by detailed local builds
  for (const a of REGION_ANCHORS) {
    if (!a.mobs || !a.mobs.length || authoredRegions.has(a.id)) continue;
    for (const mob of a.mobs) {
      const base = MOB_MAP[mob] || 'rat';
      const count = mob === 'red_ear_captain' ? 1 : (a.id === 'rival' || a.id === 'troll') ? 4 : 3;
      spawnNear(a.x, a.y, a.r * 0.8, base, count, prettify(mob));
    }
  }

  // ---- landmarks not built above: place remaining POI markers ----
  if (!GEO2) {
  const built = new Set(objects.map((o) => o.label));
  for (const lm of LANDMARKS) { if (built.has(lm.name)) continue; const skill = (lm.kind === 'furnace' || lm.kind === 'anvil') ? 'Smithing' : null; structure(lm.x, lm.y, lm.name, lm.kind === 'shortcut' || lm.kind === 'gate' ? 0xe0c050 : 0xcfc0a0, skill); }
  // West Bridge (repairable) at (340,435): break the willow-river crossing
  (function westBridge() { let bx = -1, by = -1; for (let r = 0; r < 60 && bx < 0; r++) for (let a = 0; a < 360; a += 12) { const x = Math.round(340 + r * Math.cos(a * Math.PI / 180)), y = Math.round(435 + r * Math.sin(a * Math.PI / 180)); if (getT(x, y) === T.WATER) { bx = x; by = y; break; } } if (bx < 0) return; let west = bx, east = bx; while (getT(west - 1, by) === T.WATER) west--; while (getT(east + 1, by) === T.WATER) east++; for (let x = west; x <= east; x++) setT(x, by, T.BRIDGE); const mid = (west + east) >> 1; setT(mid, by, T.WATER); structure(mid, by - 1, 'Repairable West Bridge', 0x7a5a3a); })();
  }

  // ---- ambient decor to fill space along routes/regions ----
  const ambient = (cx, cy, rad, n) => { for (let i = 0; i < n; i++) { const x = Math.round(cx + (rng() - rng()) * rad), y = Math.round(cy + (rng() - rng()) * rad); if (!isGrass(x, y) || occupied.has(okey(x, y))) continue; const r = rng(); if (r < 0.5) decor(x, y, 0x3f6e2c, 5, 'circle'); else if (r < 0.8) decor(x, y, [0xe6d24a, 0xd66a8a, 0xc0c0e0][(rng() * 3) | 0], 3, 'circle'); else decor(x, y, 0x6a6a6a, 6, 'rect'); } };
  if (!GEO2) for (const r of ROADS) alongPath(r.pts, (x, y) => { if (rng() < 0.22) ambient(x, y, 5, 2); }, 0.25);
  for (const a of REGION_ANCHORS) ambient(a.x, a.y, a.r * 0.9, Math.round(a.r * 1.5));

  // ---- POLISH PASS 1: fill empty grass chunks with context-aware micro-detail ----
  // In-place, additive: no chunk of open grass is left plain. Detail is
  // clustered (not noise) and reads its surroundings — reeds near water, stones
  // near mountains, mud near swamp, weeds near farms, debris near ruins.
  const chunksDetailed = (function fillEmptyGrass() {
    const CS = 64;
    const objCount = new Map();
    for (const o of objects) { const k = ((o.y / CS) | 0) + ',' + ((o.x / CS) | 0); objCount.set(k, (objCount.get(k) || 0) + 1); }
    const cols = Math.ceil(WORLD_W / CS), rows = Math.ceil(WORLD_H / CS);
    let detailed = 0;
    const put = (x, y, color, size, shape) => { if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) decor(x, y, color, size, shape); };
    for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
      const x0 = rx * CS, y0 = ry * CS, x1 = Math.min(WORLD_W, x0 + CS), y1 = Math.min(WORLD_H, y0 + CS);
      let grass = 0, total = 0, water = 0, rock = 0, swamp = 0, field = 0, wall = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { total++; const t = terrain[idx(x, y)]; if (t === T.GRASS) grass++; else if (t === T.WATER) water++; else if (t === T.ROCK) rock++; else if (t === T.SWAMP) swamp++; else if (t === T.FIELD) field++; else if (t === T.WALL) wall++; }
      const gf = grass / total, objs = objCount.get(ry + ',' + rx) || 0;
      if (gf < 0.72 || objs > 45) continue; // only open, sparse grass chunks
      detailed++;
      const detailAt = (x, y) => { const r = rng(); if (r < 0.42) put(x, y, 0x3f6e2c, 3, 'circle'); else if (r < 0.60) put(x, y, 0x557a34, 4, 'circle'); else if (r < 0.80) put(x, y, [0xe6d24a, 0xd66a8a, 0xc0c0e0][rng() * 3 | 0], 2, 'circle'); else put(x, y, 0x7a766a, 3, 'rect'); };
      // clustered thickets (tufts / bushes / flowers / stones)
      const clusters = 14 + (rng() * 10 | 0);
      for (let c = 0; c < clusters; c++) {
        const ccx = x0 + (rng() * (x1 - x0) | 0), ccy = y0 + (rng() * (y1 - y0) | 0);
        if (getT(ccx, ccy) !== T.GRASS) continue;
        for (let i = 0, n = 4 + (rng() * 6 | 0); i < n; i++) detailAt(ccx + Math.round((rng() - rng()) * 4), ccy + Math.round((rng() - rng()) * 4));
      }
      // light uniform sprinkle between clusters so nowhere is bare
      for (let i = 0, n = 30 + (rng() * 22 | 0); i < n; i++) detailAt(x0 + (rng() * (x1 - x0) | 0), y0 + (rng() * (y1 - y0) | 0));
      // isolated trees / saplings (also break the flat green on the world map)
      for (let i = 0, tn = 4 + (rng() * 6 | 0); i < tn; i++) { const x = x0 + (rng() * (x1 - x0) | 0), y = y0 + (rng() * (y1 - y0) | 0); if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) resObj(x, y, 'tree'); }
      // context-aware fringe detail
      const scatter2 = (color, size, shape, n, pred) => { for (let i = 0; i < n; i++) { const x = x0 + (rng() * (x1 - x0) | 0), y = y0 + (rng() * (y1 - y0) | 0); if (pred(x, y) && !occupied.has(okey(x, y))) decor(x, y, color, size, shape); } };
      if (water > 3) scatter2(0x6fae7a, 3, 'rect', 10, (x, y) => getT(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => getT(x + a, y + b) === T.GRASS)); // reeds
      if (rock > 3) scatter2(0x6a6a6a, 4, 'rect', 12, (x, y) => getT(x, y) === T.GRASS);  // scattered stones near mountains
      if (swamp > 3) scatter2(0x5a6a3a, 3, 'circle', 10, (x, y) => getT(x, y) === T.GRASS); // wet tufts near swamp
      if (field > 2) scatter2(0x8a8a3a, 3, 'circle', 8, (x, y) => getT(x, y) === T.GRASS);  // weeds near farms
      if (wall > 2) scatter2(0x8a8a7a, 3, 'rect', 8, (x, y) => getT(x, y) === T.GRASS);     // ruin debris
      // occasional worn footpath scuff
      if (rng() < 0.35) { const sxp = x0 + (rng() * (x1 - x0) | 0), syp = y0 + (rng() * (y1 - y0) | 0), len = 6 + (rng() * 12 | 0), ang = rng() * Math.PI * 2; for (let i = 0; i < len; i++) { const x = Math.round(sxp + Math.cos(ang) * i), y = Math.round(syp + Math.sin(ang) * i); if (getT(x, y) === T.GRASS) { setT(x, y, T.DIRT); if (rng() < 0.3 && getT(x + 1, y) === T.GRASS) setT(x + 1, y, T.DIRT); } } }
    }
    return detailed;
  })();

  // ---- POLISH PASS 2: feather biome edges into transition bands ----
  // In-place, additive: soften every hard biome border with a gradient of
  // intermediate detail so nothing looks like a pasted polygon.
  (function featherBiomeEdges() {
    // Forest fringes: sparse scattered trees + bushes fading OUT from each wood
    // (dense forest -> scattered trees -> bushes -> grass).
    for (const f of FORESTS) polyFeather(f.poly, 26, (x, y, depth) => {
      if (depth > 3 || getT(x, y) !== T.GRASS || occupied.has(okey(x, y))) return;
      const outside = -depth; // 0 at the tree-line .. 26 tiles out
      const p = 0.07 * Math.max(0, 1 - outside / 24);
      const r = hash2(x, y, Sr + 21);
      if (r < p) resObj(x, y, f.kinds[(hash2(x, y, Sr + 23) * f.kinds.length) | 0]);
      else if (r < p + 0.05) decor(x, y, 0x557a34, 4, 'circle');
      else if (r < p + 0.09) decor(x, y, 0x3f6e2c, 3, 'circle');
    });
    // Terrain edges (rock / water / swamp): spray a distance-graded band into
    // the adjacent grass. rock -> rocky hills -> stones -> rough grass; water ->
    // reeds/shore; swamp -> mud -> wet grass.
    const BAND = 5;
    for (let y = 3; y < WORLD_H - 3; y++) for (let x = 3; x < WORLD_W - 3; x++) {
      const t = terrain[idx(x, y)];
      if (t !== T.ROCK && t !== T.WATER && t !== T.SWAMP) continue;
      if (!([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => getT(x + a, y + b) === T.GRASS))) continue; // edge only
      if (t === T.WATER && rng() < 0.14 && !occupied.has(okey(x, y))) decor(x, y, 0x6fae7a, 3, 'rect'); // reeds on the waterline
      for (let s = 0; s < 3; s++) {
        const d = 1 + (rng() * BAND | 0), ang = rng() * Math.PI * 2;
        const gx = Math.round(x + Math.cos(ang) * d), gy = Math.round(y + Math.sin(ang) * d);
        if (getT(gx, gy) !== T.GRASS || occupied.has(okey(gx, gy))) continue;
        if (rng() > 1 - d / (BAND + 1)) continue; // density falls off with distance from the edge
        if (t === T.ROCK) { if (rng() < 0.20) decor(gx, gy, 0x6a6a6a, 4, 'rect'); } // occasional loose stones at the rock foot (not a stone on every fringe tile)
        else if (t === T.WATER) decor(gx, gy, 0x6fae7a, 4, 'rect');                                            // reeds on the shore
        else decor(gx, gy, rng() < 0.5 ? 0x5a6a3a : 0x6a5a3a, 3, 'circle');                                    // mud / wet grass
      }
    }
  })();

  // ---- POLISH PASS 3: break geometric silhouettes ----
  // In-place edge sculpting so nothing reads as a circle / polygon / blob.
  // Cores are preserved; only edges are carved and satellites added.
  (function breakGeometry() {
    const soft = (x, y) => { const c = getT(x, y); return c === T.GRASS || c === T.SAND || c === T.WATER || c === T.SWAMP; };
    // --- Grublake: peninsulas + coves + satellite ponds (kills the round look) ---
    const lc = { x: 735, y: 495 };
    const peninsula = (ang, startR, len, width) => { for (let d = 0; d < len; d++) { const r = startR - d; const jx = Math.round(lc.x + Math.cos(ang) * r + (vnoise(d * 0.4, ang * 9, Sr) - 0.5) * 4); const jy = Math.round(lc.y + Math.sin(ang) * r + (vnoise(d * 0.4 + 50, ang * 9, Sr) - 0.5) * 4); disc(jx, jy, Math.max(0, width * (1 - d / len)), (x, y) => { if (getT(x, y) === T.WATER) setT(x, y, d < len - 4 ? T.SAND : T.GRASS); }); } };
    peninsula(0.4, 90, 26, 2.4); peninsula(2.2, 84, 22, 2.2); peninsula(3.7, 92, 30, 2.6); peninsula(5.1, 80, 20, 2.0);
    const cove = (ang, startR, len, width) => { for (let d = 0; d < len; d++) { const r = startR + d; disc(Math.round(lc.x + Math.cos(ang) * r), Math.round(lc.y + Math.sin(ang) * r), width * (1 - d / len) + 0.6, (x, y) => { if (getT(x, y) === T.GRASS || getT(x, y) === T.SAND) setT(x, y, T.WATER); }); } };
    cove(1.2, 90, 9, 3); cove(4.3, 92, 10, 3); cove(5.7, 86, 8, 2.6);
    for (const [px, py] of [[792, 600], [640, 612], [815, 430]]) { disc(px, py, 3 + (rng() * 2 | 0), (x, y) => { if (soft(x, y) && getT(x, y) !== T.SWAMP) setT(x, y, T.WATER); }); disc(px, py, 5, (x, y) => { if (getT(x, y) === T.GRASS && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => getT(x + a, y + b) === T.WATER)) decor(x, y, 0x6fae7a, 4, 'rect'); }); }
    // --- Mountains: satellite outcrops (foothills) + carved passes ---
    for (const h of HIGHLANDS) polyFeather(h.poly, 30, (x, y, depth) => { if (depth > -4 || getT(x, y) !== T.GRASS) return; const outside = -depth; if (hash2(x, y, Sr + 31) < 0.05 * Math.max(0, 1 - outside / 28)) disc(x, y, 1 + (hash2(x, y, Sr + 33) * 2 | 0), (px, py) => { if (getT(px, py) === T.GRASS) setT(px, py, T.ROCK); }); });
    const pass = (pts) => alongPath(pts, (cx, cy) => disc(cx, cy, 1.4, (x, y) => { if (getT(x, y) === T.ROCK) setT(x, y, T.DIRT); }));
    pass([[860, 30], [882, 90], [902, 150]]); pass([[560, 150], [605, 120], [652, 98]]);
    // --- Bog: fingers + satellite pools out of the basin ---
    polyFeather(BOG, 22, (x, y, depth) => { if (depth > -2 || getT(x, y) !== T.GRASS) return; const outside = -depth; if (hash2(x, y, Sg + 9) < 0.06 * Math.max(0, 1 - outside / 20)) setT(x, y, T.SWAMP); });
    for (const [px, py] of [[600, 640], [905, 760], [720, 628]]) disc(px, py, 4, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, hash2(x, y, Sg + 12) < 0.4 ? T.WATER : T.SWAMP); });
    // --- Forests: small satellite copses so each wood isn't one blob ---
    for (const f of FORESTS) { const [x0, y0, x1, y1] = pbox(f.poly); for (let c = 0; c < 5; c++) { const cxp = x0 - 20 + (rng() * (x1 - x0 + 40) | 0), cyp = y0 - 20 + (rng() * (y1 - y0 + 40) | 0); if (pip(cxp + 0.5, cyp + 0.5, f.poly)) continue; disc(cxp, cyp, 3 + (rng() * 3 | 0), (x, y) => { if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y)) && hash2(x, y, Sr + 41) < 0.45) resObj(x, y, f.kinds[(hash2(x, y, Sr + 43) * f.kinds.length) | 0]); }); } }
  })();

  // ---- POLISH PASS 4: wayside landmarks, teasers & enemy pockets (connect the in-between) ----
  if (!GEO2) (function waysideLandmarks() {
    const placeNear = (x, y, label, color) => { for (let r = 1; r <= 6; r++) for (let a = 0; a < 360; a += 45) { const nx = Math.round(x + r * Math.cos(a * Math.PI / 180)), ny = Math.round(y + r * Math.sin(a * Math.PI / 180)); if (getT(nx, ny) === T.GRASS && !occupied.has(okey(nx, ny))) return structure(nx, ny, label, color); } return null; };
    // signposts beside the main road forks
    for (const [x, y, label] of [
      [495, 400, 'Signpost: Quarry and Mines'], [563, 451, 'Signpost: Grublake'], [515, 514, 'Signpost: Farmlands and Bog'],
      [446, 451, 'Signpost: Choppers Hollow'], [340, 378, 'Signpost: Willow and Mushroom'], [602, 684, 'Signpost: Bog of Grub'],
      [668, 290, 'Signpost: Troll Ridge'], [772, 414, 'Signpost: Eastern Oakwoods'],
    ]) placeNear(x, y, label, 0x9a7a3a);
    // wayside micro-landmarks (environmental storytelling in the in-between wild)
    for (const [x, y, label, color] of [
      [430, 360, 'Abandoned Campfire', 0xd2691e], [560, 360, 'Old Cairn', 0x8a8a7a], [598, 458, 'Broken Cart', 0x6a5a4a],
      [432, 542, 'Ruined Fence', 0x5a4a30], [560, 545, 'Old Well', 0x6a7a8a], [655, 605, 'Watch Post', 0x7a6a4a],
      [300, 470, 'Hunters Blind', 0x6a5a3a], [255, 720, 'Old Shrine', 0x8a8a7a], [905, 560, 'Abandoned Crates', 0x8a6a3a],
      [880, 300, 'Broken Wagon', 0x6a5a4a], [520, 762, 'Stone Marker', 0x8a8a7a], [700, 860, 'Skull Totem', 0xb03030],
      [380, 225, 'Fallen Pillar', 0x8a8a7a], [155, 400, 'Lonely Grave', 0x7a7a7a], [560, 195, 'Prospectors Tent', 0x7a6a4a],
    ]) placeNear(x, y, label, color);
    // old-road fragments (weathered, disconnected)
    const frag = (pts) => alongPath(pts, (cx, cy) => { const x = Math.round(cx), y = Math.round(cy); if (getT(x, y) === T.GRASS && rng() < 0.8) setT(x, y, T.DIRT); });
    frag([[470, 350], [500, 340], [540, 345]]); frag([[382, 560], [352, 590], [322, 612]]); frag([[720, 520], [760, 560], [790, 610]]); frag([[560, 720], [590, 740], [612, 770]]);
    // resource teasers between regions (low density, not optimal training)
    const teaser = (x, y, k) => { for (let r = 0; r <= 6; r++) for (let a = 0; a < 360; a += 60) { const nx = Math.round(x + r * Math.cos(a * Math.PI / 180)), ny = Math.round(y + r * Math.sin(a * Math.PI / 180)); if (getT(nx, ny) === T.GRASS && !occupied.has(okey(nx, ny))) { resObj(nx, ny, k); return; } } };
    for (const [x, y] of [[430, 420], [560, 412], [620, 472], [470, 540], [560, 562], [702, 560], [300, 500], [820, 470], [640, 360]]) teaser(x, y, 'tree');
    teaser(600, 342, 'rock_copper'); teaser(560, 532, 'rock_tin'); teaser(520, 205, 'rock_iron');
    // a teaser watering hole just outside town (near-town shrimp)
    disc(566, 532, 3, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.WATER); });
    disc(566, 532, 4, (x, y) => { if (getT(x, y) === T.GRASS && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => getT(x + a, y + b) === T.WATER)) decor(x, y, 0x6fae7a, 3, 'rect'); });
    for (const [dx, dy] of [[3, 0], [-3, 1], [0, 3]]) { const x = 566 + dx, y = 532 + dy; if (getT(x, y) === T.WATER && !occupied.has(okey(x, y))) resObj(x, y, 'fish_shrimp'); }
    // small enemy pockets in the wilderness
    const pocket = (x, y, type, name) => { for (let r = 0; r <= 8; r++) for (let a = 0; a < 360; a += 60) { const nx = Math.round(x + r * Math.cos(a * Math.PI / 180)), ny = Math.round(y + r * Math.sin(a * Math.PI / 180)); if (landish(nx, ny) && getT(nx, ny) !== T.DIRT && !occupied.has(okey(nx, ny))) { enemySpawns.push({ type, x: nx, y: ny, name, _keep: true }); occupied.add(okey(nx, ny)); return; } } };
    pocket(440, 385, 'rat', 'Wild Rat'); pocket(600, 400, 'spider', 'Roadside Spider'); pocket(542, 560, 'rat', 'Field Rat'); pocket(720, 585, 'mud_bug', 'Marsh Bug'); pocket(320, 305, 'spider', 'Forest Spider'); pocket(800, 500, 'wolf', 'Stray Wolf');
  })();

  // ---- POLISH PASS 5: road & path refinement ----
  // In-place: widen approaches near towns/camps, add worn shoulders + cart-ruts,
  // and add connecting forks/trails (water crossings become bridges via trail()).
  if (!GEO2) (function refineRoads() {
    const HUBS = [[502, 457], [455, 285], [624, 440], [510, 645], [610, 205], [850, 825], [820, 330], [725, 770], [285, 610], [250, 800], [335, 372]];
    const nearHub = (x, y) => HUBS.some(([hx, hy]) => Math.hypot(x - hx, y - hy) < 24);
    for (const road of ROADS) alongPath(road.pts, (cx, cy) => {
      const x = Math.round(cx), y = Math.round(cy);
      if (nearHub(x, y)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (getT(nx, ny) === T.GRASS) setT(nx, ny, T.ROAD); } // widen approach
      for (let s = 0; s < 2; s++) { const ang = rng() * Math.PI * 2, d = 2 + (rng() * 2 | 0); const gx = Math.round(x + Math.cos(ang) * d), gy = Math.round(y + Math.sin(ang) * d); if (getT(gx, gy) !== T.GRASS || occupied.has(okey(gx, gy))) continue; const r = rng(); if (r < 0.25) setT(gx, gy, T.DIRT); else if (r < 0.6) decor(gx, gy, 0x7a6a4a, 3, 'rect'); else decor(gx, gy, 0x8a8a7a, 2, 'rect'); } // worn shoulders / ruts / pebbles
    }, 0.06);
    trail([[500, 420], [530, 400], [558, 362]], 0);   // fork to the Old Cairn wilds
    trail([[560, 470], [560, 512], [560, 544]], 0);   // fork to the Old Well
    trail([[300, 470], [292, 540], [288, 600]], 0);   // riverbank trail: Choppers -> Willow
    trail([[705, 600], [740, 630], [760, 668]], 0);   // lakeside path toward the bog road
  })();

  // ---- POPULATE FROM DATABASE: the full monster roster, placed by region ----
  // Intentional, not random: every DB monster is dropped into the region it is
  // tagged for, with stats derived from its combat level and its monster_id
  // carried through for the drop-table lane. Node/degraded boot: DB is empty so
  // the hand-authored baseline stands.
  (function populateMonstersFromDb() {
    const dbMon = (GameData && GameData.monsters) || [];
    if (!dbMon.length) return; // Node/degraded: hand-authored baseline stands
    // DB is authoritative: drop baseline region-mobs, keep only the tagged
    // keepers (training yard + wilderness pockets) so nothing is doubled up.
    const kept = enemySpawns.filter((s) => s._keep);
    enemySpawns.length = 0; enemySpawns.push(...kept);
    // spacing grid seeded with the keepers so DB mobs don't stack on them
    const mobAt = new Set(kept.map((s) => s.x + ',' + s.y));
    const spaced = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (mobAt.has((x + dx) + ',' + (y + dy))) return false; return true; };
    const REGMAP = { grubpit_quarry: 'grubpit', choppers_hollow: 'choppers', willow_riverlands: 'willow', main_farmlands: 'farmlands', grublake: 'grublake', eastern_oakwoods: 'oakwoods', northern_mine_hills: 'minehills', bog_of_grub: 'bog', mushroom_forest: 'mushroom', rival_goblin_territory: 'rival', old_forest_ruins: 'ruins', troll_ridge: 'troll', deep_mines: 'minehills' };
    const REGCOLOR = { grubpit: 0x6a5a7a, choppers: 0x3a3a3a, willow: 0x5a6a4a, farmlands: 0x8a7a5a, grublake: 0x4a7a8a, oakwoods: 0x5a4a2a, minehills: 0x6a6a6a, bog: 0x5a7a4a, mushroom: 0x8a5a7a, rival: 0xb03030, ruins: 0x7a7a8a, troll: 0x6a7a8a };
    let placed = 0;
    for (const m of dbMon) {
      const anchorId = REGMAP[m.region]; if (!anchorId) continue; // skip 'spawn'/meta (town stays safe)
      const a = REGION_ANCHORS.find((x) => x.id === anchorId); if (!a) continue;
      const cl = m.combat_level || 5, L = Math.max(1, Math.round(cl / 1.14));
      // register a stat block keyed by monster_id so combatLevel(levels) ≈ its DB level
      ENEMY_TYPES[m.monster_id] = ENEMY_TYPES[m.monster_id] || {
        name: m.display_name, color: REGCOLOR[anchorId] || 0x7a6a5a,
        hp: Math.max(3, Math.round(L * 1.15)), att: L, str: L, def: Math.max(1, Math.round(L * 0.8)),
        speed: 3, loot: cl < 15 ? 'rat' : cl < 45 ? 'goblin_guard' : 'rival',
      };
      // bosses are lone; everything else comes as a pair — keeps starter regions
      // uncrowded and lets density track a region's roster size, not fixed counts.
      const count = cl >= 55 ? 1 : 2;
      for (let i = 0; i < count; i++) for (let t = 0; t < 60; t++) {
        const x = Math.round(a.x + (rng() - rng()) * a.r * 0.85), y = Math.round(a.y + (rng() - rng()) * a.r * 0.85);
        if (landish(x, y) && getT(x, y) !== T.DIRT && !occupied.has(okey(x, y)) && spaced(x, y)) { enemySpawns.push({ type: m.monster_id, x, y, name: m.display_name, monsterId: m.monster_id }); occupied.add(okey(x, y)); mobAt.add(x + ',' + y); placed++; break; }
      }
    }
    return placed;
  })();

  // ---- POPULATE FROM DATABASE: signature resource nodes as visible markers ----
  // The designed higher-tier / exotic nodes (Moonwillow, Silver, gem veins,
  // Sturgeon, Glowshroom, herb & crop patches) placed by region as LABELED,
  // level-tagged markers so every region reads resource-rich. Non-gatherable for
  // now (they carry node_id for the economy lane to wire once its item/farming
  // systems land); the baseline copper/oak/trout etc. remain the gatherables.
  (function populateNodesFromDb() {
    const dbNodes = (GameData && GameData.worldNodes) || [];
    if (!dbNodes.length) return;
    const REGMAP = { spawn_teaser: 'settlement', grubpit_quarry: 'grubpit', choppers_hollow: 'choppers', willow_riverlands: 'willow', main_farmlands: 'farmlands', grublake: 'grublake', eastern_oakwoods: 'oakwoods', northern_mine_hills: 'minehills', bog_of_grub: 'bog', mushroom_forest: 'mushroom', rival_goblin_territory: 'rival', old_forest_ruins: 'ruins', troll_ridge: 'troll', deep_mines: 'minehills' };
    const BASELINE = new Set(['normal_tree', 'oak_tree', 'willow_tree', 'deadwood_tree', 'copper_rock', 'tin_rock', 'iron_rock', 'coal_rock', 'gold_rock', 'shrimp_fishing_spot', 'trout_fishing_spot', 'pike_fishing_spot', 'bog_eel_fishing_spot']);
    const colorFor = (n) => { const s = n.related_skill; if (s === 'woodcutting') return 0x2f6b25; if (s === 'mining') return /gem|opal|agate|jade|pearl|amber|ruby|sapphire|diamond/i.test(n.node_id) ? 0x5ad0d0 : 0x8a7a5a; if (s === 'fishing') return 0x4fa3c7; if (s === 'farming') return /herb|sage|thistle|bloom|leaf|muck|cap|shroom|morel|spore|witch|glow/i.test(n.node_id) ? 0x4a8a4a : 0x8a9a4a; return 0x9a8a5a; };
    const seen = new Set();
    for (const n of dbNodes) {
      if (BASELINE.has(n.node_id)) continue;
      const blocking = n.related_skill === 'woodcutting' || n.related_skill === 'mining';
      const label = `${n.display_name} (Lv ${n.level_requirement})`;
      for (const dbReg of String(n.region).split(';')) {
        const anchorId = REGMAP[dbReg]; if (!anchorId) continue;
        const a = REGION_ANCHORS.find((x) => x.id === anchorId); if (!a) continue;
        if (seen.has(n.node_id + anchorId)) continue; seen.add(n.node_id + anchorId);
        const isFish = n.related_skill === 'fishing';
        const cnt = n.level_requirement < 20 ? 2 : 1;
        for (let i = 0; i < cnt; i++) for (let t = 0; t < 50; t++) {
          // uniform spread across the region (not clustered at the anchor)
          const x = Math.round(a.x + (rng() * 2 - 1) * a.r * 0.92), y = Math.round(a.y + (rng() * 2 - 1) * a.r * 0.92);
          if (occupied.has(okey(x, y))) continue;
          const gt = getT(x, y);
          if (isFish ? gt === T.WATER : (gt === T.GRASS || gt === T.SWAMP)) {
            placeObj({ x, y, type: 'structure', label, color: colorFor(n), skill: null, blocking: isFish ? false : blocking, depleted: false, nodeId: n.node_id });
            break;
          }
        }
      }
    }
  })();

  // ---- AUTHORED WONDERS: one-of-a-kind landmarks in the in-between wild ----
  // Hand-placed points of interest in the wilderness gaps and region edges, each
  // shaped from terrain + labeled objects/decor so exploring the space between
  // named regions is rewarding.
  if (!GEO2) (function authoredWonders() {
    const S = (x, y, label, color, blocking = true) => { if (inB(x, y) && !occupied.has(okey(x, y))) placeObj({ x, y, type: 'structure', label, color, skill: null, blocking, depleted: false }); };
    const ringWall = (cx, cy, r, step) => { for (let a = 0; a < 360; a += step) { const x = Math.round(cx + r * Math.cos(a * Math.PI / 180)), y = Math.round(cy + r * Math.sin(a * Math.PI / 180)); if (getT(x, y) === T.GRASS) setT(x, y, T.WALL); } };
    const ringDecor = (cx, cy, r, step, color, size, shape) => { for (let a = 0; a < 360; a += step) { const x = Math.round(cx + r * Math.cos(a * Math.PI / 180)), y = Math.round(cy + r * Math.sin(a * Math.PI / 180)); if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) decor(x, y, color, size, shape); } };
    const box = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (getT(x, y) !== T.GRASS) continue; setT(x, y, (x === x0 || x === x1 || y === y0 || y === y1) ? T.WALL : T.FLOOR); } };

    ringWall(205, 485, 4, 45); S(205, 485, 'Ancient Stone Circle', 0x9a9aa0);                                    // stone circle (W wilds)
    for (let i = -5; i <= 5; i++) if (getT(600 + i, 360) === T.GRASS) setT(600 + i, 360, T.WALL); setT(594, 359, T.WALL); setT(594, 361, T.WALL); S(600, 358, 'The Fallen Colossus', 0x8a8a7a); // toppled statue (N plains)
    disc(420, 560, 4, (x, y) => { if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y)) && rng() < 0.55) resObj(x, y, 'tree_oak'); }); S(420, 560, 'The Great Oak', 0x1f5c1f); // giant lone oak
    ringWall(725, 175, 6, 20); ringWall(725, 175, 5, 30); disc(725, 175, 4, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }); S(725, 175, 'Meteor Crater', 0x6a6a6a); S(723, 176, 'Meteor Shard', 0x5ad0d0); // crater (troll foothills)
    disc(648, 236, 3, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.WATER); }); disc(648, 236, 5, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.SAND); }); ringDecor(648, 236, 4, 40, 0xbfe0e0, 4, 'circle'); S(644, 236, 'Steaming Spring', 0x9ad0d0, false); // hot spring (mine hills)
    box(298, 502, 303, 508); S(300, 505, 'Abandoned Watermill', 0x7a6a4a); S(297, 505, 'Rotting Waterwheel', 0x6a5a3a); // watermill (willow river)
    for (let i = 0; i < 6; i++) { const x = 700 + i, y = 632 + (i % 2); if (getT(x, y) === T.GRASS || getT(x, y) === T.SAND) setT(x, y, T.WALL); } S(702, 631, 'Wrecked Fishing Boat', 0x6a5a4a); // shipwreck (lake shore)
    ringWall(620, 700, 3, 90); S(620, 700, 'Goblin War Memorial', 0x8a8a7a); ringDecor(620, 700, 5, 60, 0xe8e2cf, 3, 'rect'); // memorial + bones (bog edge)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) { const x = 300 + c * 2, y = 205 + r * 2; if (getT(x, y) === T.GRASS) setT(x, y, T.WALL); } S(304, 210, 'Old Graveyard', 0x7a7a7a); // graveyard (near ruins)
    setT(150, 344, T.WALL); setT(150, 346, T.WALL); setT(150, 348, T.WALL); setT(156, 344, T.WALL); setT(156, 348, T.WALL); S(153, 346, 'Weathered Stone Arch', 0x8a8a7a); // stone arch (far W)
    ringDecor(400, 762, 4, 40, 0xc44a6a, 5, 'circle'); ringDecor(400, 762, 4, 90, 0xd08040, 4, 'circle'); S(400, 762, 'Wild Fairy Ring', 0xc060c0, false); // fairy ring (SW)
    ringWall(478, 382, 4, 30); disc(478, 382, 3, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.DIRT); }); S(478, 382, 'Yawning Sinkhole', 0x2a2a2a); // sinkhole (town↔quarry wilds)
    box(148, 648, 152, 652); S(150, 650, 'Hermit Hut', 0x6a5a3a); friendlies.push({ name: 'Old Hermit', x: 150, y: 653, color: 0x7a6a5a, dialog: 'Few come this far. The wilds hide more than mobs — old stones, sunken things, and worse.' }); // hermit (far SW)
    // Waterfall where the north river spills off the hills into the lowlands
    for (let y = 314; y <= 322; y++) { for (const x of [684, 685, 686]) { const t = getT(x, y); if (t === T.GRASS || t === T.ROCK) setT(x, y, T.WATER); } }
    ringDecor(685, 324, 3, 40, 0xdfefff, 3, 'circle'); disc(685, 326, 2, (x, y) => { if (getT(x, y) === T.GRASS) setT(x, y, T.WATER); }); S(688, 318, 'Waterfall', 0x9ecfe0, false);
  })();

  // ---- Wilderness encounters: fill the empty gaps so travel always has something ----
  // A jittered ~22-tile lattice over the whole map. At each cell we drop ONE unique
  // encounter from the 150-entry catalog — but only where there isn't already content
  // nearby (a coarse presence grid of existing mobs/nodes/structures), so the dense
  // regions are left alone and only the empty wilds get topped up. Entries are matched
  // to the local biome + region tier so nothing lands out of place.
  (function populateWilderness() {
    const G = 8, gw = Math.ceil(WORLD_W / G), gh = Math.ceil(WORLD_H / G);
    const pres = new Uint8Array(gw * gh);
    const markP = (x, y) => { pres[((y / G) | 0) * gw + ((x / G) | 0)] = 1; };
    // Only real ENCOUNTERS count as "already covered" — mobs and POI structures.
    // Resource nodes (trees/ore/fish) don't; a forest is still an empty walk for
    // someone after something to explore or fight, so we fill through it too.
    for (const o of objects) if (o.type === 'structure') markP(o.x, o.y);
    for (const s of enemySpawns) markP(s.x, s.y);
    const nearContent = (x, y) => { const gx = (x / G) | 0, gy = (y / G) | 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const nx = gx + a, ny = gy + b; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && pres[ny * gw + nx]) return true; } return false; };
    const tierOf = {}; for (const a of REGION_ANCHORS) { const m = parseInt(String(a.level), 10) || 1; tierOf[a.name] = m >= 45 ? 'high' : m >= 20 ? 'mid' : 'low'; }
    const localBiome = (x, y) => {
      for (let r = 1; r <= 3; r++) for (const [a, b] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const t = getT(x + a, y + b); if (t === T.WATER) return 'water'; if (t === T.ROCK) return 'rock'; if (t === T.SWAMP) return 'swamp'; if (t === T.SAND) return 'sand'; }
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const o = objectAt.get(okey(x + a, y + b)); if (o && o.skill === 'Woodcutting') return 'forest'; }
      return 'grass';
    };
    const biomeOK = (e, b) => e.biome === 'any' || e.biome === b || (e.biome === 'forest' && b === 'grass') || (e.biome === 'grass' && b === 'forest');
    const tierOK = (e, t) => e.tier === 'any' || e.tier === t || (t === 'mid' && e.tier === 'low') || (t === 'high' && e.tier === 'mid');

    // ===== multi-tile scene kit — each POI is an authored, blended mini-scene =====
    const isGr = (x, y) => getT(x, y) === T.GRASS && !occupied.has(okey(x, y));
    const clearFoot = (x0, y0, x1, y1) => {
      if (!inB(x0 - 1, y0 - 1) || !inB(x1 + 1, y1 + 1)) return false;
      let g = 0, n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { n++; if (occupied.has(okey(x, y))) return false; if (getT(x, y) === T.GRASS) g++; }
      return g / n >= 0.85;
    };
    // coarse road-presence grid so scenes can grow a little trail out to the main roads
    const RG = 6, rgw = Math.ceil(WORLD_W / RG), rgh = Math.ceil(WORLD_H / RG);
    const roadG = new Uint8Array(rgw * rgh);
    for (let y = 0; y < WORLD_H; y += 2) for (let x = 0; x < WORLD_W; x += 2) { const t = terrain[idx(x, y)]; if (t === T.ROAD || t === T.BRIDGE) roadG[((y / RG) | 0) * rgw + ((x / RG) | 0)] = 1; }
    const nearestRoad = (x, y, R) => { const cx = (x / RG) | 0, cy = (y / RG) | 0, rr = (R / RG) | 0; let best = null, bd = 1e9; for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) { const nx = cx + a, ny = cy + b; if (nx < 0 || ny < 0 || nx >= rgw || ny >= rgh) continue; if (roadG[ny * rgw + nx]) { const d = a * a + b * b; if (d < bd) { bd = d; best = [nx * RG + 3, ny * RG + 3]; } } } return best; };
    const spur = (fx, fy) => { const tgt = nearestRoad(fx, fy, 44); if (!tgt) return; let x = fx, y = fy, guard = 0; while (guard++ < 60) { if (!inB(x, y)) break; const t = getT(x, y); if (t === T.ROAD || t === T.BRIDGE) break; if (t === T.WATER || t === T.WALL || t === T.FLOOR) break; if (t === T.GRASS) setT(x, y, T.DIRT); if (Math.abs(x - tgt[0]) + Math.abs(y - tgt[1]) <= 1) break; if (Math.abs(tgt[0] - x) > Math.abs(tgt[1] - y)) x += Math.sign(tgt[0] - x); else y += Math.sign(tgt[1] - y); } };
    const wmarker = (x, y, e, wildKind) => placeObj({ x, y, type: 'structure', label: e.name, color: e.color, skill: null, blocking: false, depleted: false, examine: e.blurb, loot: e.loot || null, wild: wildKind || e.kind });
    const sScatter = (cx, cy, rad, n, color, size, shape, pred) => { for (let i = 0; i < n; i++) { const x = Math.round(cx + (rng() * 2 - 1) * rad), y = Math.round(cy + (rng() * 2 - 1) * rad); if (pred ? pred(x, y) : isGr(x, y)) decor(x, y, color, size, shape); } };
    const garrison = (cx, cy, rad, base, n, name) => { for (let i = 0; i < n; i++) for (let t = 0; t < 12; t++) { const x = Math.round(cx + (rng() * 2 - 1) * rad), y = Math.round(cy + (rng() * 2 - 1) * rad); if (landish(x, y) && !occupied.has(okey(x, y))) { enemySpawns.push({ type: base, x, y, name }); occupied.add(okey(x, y)); break; } } };
    const patch = (cx, cy, rad, to, pred) => { for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) { if (!inB(x, y) || (x - cx) * (x - cx) + (y - cy) * (y - cy) > rad * rad) continue; if (pred ? pred(x, y) : getT(x, y) === T.GRASS) setT(x, y, to); } };

    function sBuilding(cx, cy, e, ruined) {
      const w = 2 + (rng() * 2 | 0), h = 2 + (rng() * 2 | 0), x0 = cx - w, y0 = cy - h, x1 = cx + w, y1 = cy + h;
      if (!clearFoot(x0, y0, x1, y1)) { wmarker(cx, cy, e); return; }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (getT(x, y) !== T.GRASS) continue;
        const border = x === x0 || x === x1 || y === y0 || y === y1;
        if (border) { if (ruined && rng() < 0.4) decor(x, y, 0x8a7a60, 5, 'rect'); else setT(x, y, T.WALL); } // ruins lose ~40% of their walls to rubble
        else setT(x, y, T.FLOOR);
      }
      // door faces the nearest road where the outside is walkable, so interiors always connect
      const rd = nearestRoad(cx, cy, 44), dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      if (rd) dirs.sort((A, B) => (Math.abs(cx + A[0] - rd[0]) + Math.abs(cy + A[1] - rd[1])) - (Math.abs(cx + B[0] - rd[0]) + Math.abs(cy + B[1] - rd[1])));
      let door = null;
      for (const [dx, dy] of dirs) { const bx = dx ? (dx > 0 ? x1 : x0) : cx, by = dy ? (dy > 0 ? y1 : y0) : cy, ox = bx + dx, oy = by + dy; if (inB(ox, oy)) { const ot = getT(ox, oy); if (ot === T.GRASS || ot === T.DIRT || ot === T.ROAD) { door = [bx, by, ox, oy, dx, dy]; break; } } }
      if (door) { setT(door[0], door[1], T.FLOOR); if (getT(door[2], door[3]) === T.GRASS) setT(door[2], door[3], T.DIRT); spur(door[2] + door[4], door[3] + door[5]); }
      else setT(cx, y1, T.FLOOR);
      wmarker(cx, cy, e);                                                                       // the searchable hearth/chest, inside
      sScatter(cx, cy, w - 1, 3, 0x6a5a3a, 3, 'rect', (x, y) => getT(x, y) === T.FLOOR && !occupied.has(okey(x, y))); // broken furniture
      sScatter(cx, cy, w + 3, 7, 0x8a7a60, 4, 'rect', (x, y) => isGr(x, y));                    // rubble outside
      sScatter(cx, cy, w + 4, 5, 0x3f6e2c, 4, 'circle', (x, y) => isGr(x, y));                  // weeds reclaiming it
      if (ruined) garrison(cx, cy, w, 'cave_bug', 1 + (rng() * 2 | 0), e.name);                 // something nests in the ruin
    }
    function sCamp(cx, cy, e) {
      patch(cx, cy, 2, T.DIRT);
      decor(cx, cy, 0x5a3a1a, 6, 'circle');                                                     // firepit
      for (let a = 0; a < 360; a += 60) { const x = Math.round(cx + 2 * Math.cos(a * Math.PI / 180)), y = Math.round(cy + 2 * Math.sin(a * Math.PI / 180)); if (isGr(x, y) || getT(x, y) === T.DIRT) decor(x, y, 0x6a6a6a, 3, 'rect'); }
      const tx = cx + 4, ty = cy - 1;                                                           // a tent off to one side
      if (clearFoot(tx - 1, ty - 1, tx + 1, ty + 1)) for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (getT(x, y) === T.GRASS) setT(x, y, (x === tx - 1 || x === tx + 1 || y === ty - 1) ? T.WALL : T.FLOOR);
      sScatter(cx, cy, 5, 4, 0x6a5a3a, 4, 'rect'); sScatter(cx, cy, 6, 3, 0x8a8a5a, 3, 'rect'); // crates & bedrolls
      spur(cx, cy + 3); wmarker(cx, cy, e);
      if (e.kind === 'fight') garrison(cx, cy, 3, e.base || 'bandit', e.n || 2, e.name);
    }
    function sShrine(cx, cy, e) {
      patch(cx, cy, 2, T.FLOOR);                                                                // raised stone platform (FLOOR reads as elevated)
      for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) if (inB(cx + dx, cy + dy) && (getT(cx + dx, cy + dy) === T.FLOOR)) setT(cx + dx, cy + dy, T.WALL); // corner posts
      sScatter(cx, cy, 3, 6, e.color, 4, 'circle', (x, y) => isGr(x, y)); sScatter(cx, cy, 4, 4, 0x3f6e2c, 4, 'circle');
      spur(cx, cy + 3); wmarker(cx, cy, e);
    }
    function sMonument(cx, cy, e) {
      const rad = 2 + (rng() * 2 | 0);                                                          // a ring of standing stones / headstones
      for (let a = 0; a < 360; a += 45) { const x = Math.round(cx + rad * Math.cos(a * Math.PI / 180)), y = Math.round(cy + rad * Math.sin(a * Math.PI / 180)); if (getT(x, y) === T.GRASS) setT(x, y, T.WALL); }
      sScatter(cx, cy, rad + 2, 5, 0x3f6e2c, 4, 'circle'); spur(cx, cy + rad + 1); wmarker(cx, cy, e);
    }
    function sNatural(cx, cy, e) {
      const id = e.id;
      if (/geyser|spring|pool|mirror/.test(id)) { patch(cx, cy, 2, T.WATER); patch(cx, cy, 3, T.SAND, (x, y) => getT(x, y) === T.GRASS); sScatter(cx, cy, 4, 6, 0xbfe0e0, 3, 'circle'); }
      else if (/tar|quicksand|sink/.test(id)) { patch(cx, cy, 2, T.SWAMP); sScatter(cx, cy, 3, 8, 0x2a2a2a, 4, 'circle'); }
      else if (/crystal|ember|sulfur|fossil|salt|meteor|balancing|boulder|petrified/.test(id)) { patch(cx, cy, 2, T.ROCK); sScatter(cx, cy, 3, 8, e.color, 4, 'rect', (x, y) => isGr(x, y) || getT(x, y) === T.ROCK); }
      else sScatter(cx, cy, 3, 10, e.color, 4, 'circle', (x, y) => isGr(x, y));
      sScatter(cx, cy, 5, 4, 0x3f6e2c, 4, 'circle'); wmarker(cx, cy, e, e.kind);
    }
    function sGrove(cx, cy, e) { sScatter(cx, cy, 3, 10, e.color, 4, 'circle', (x, y) => isGr(x, y)); sScatter(cx, cy, 4, 5, 0x3f6e2c, 3, 'circle'); wmarker(cx, cy, e); }
    function sCache(cx, cy, e) { patch(cx, cy, 1, T.DIRT); decor(cx, cy, 0x6a5a3a, 6, 'rect'); sScatter(cx, cy, 3, 3, 0x8a7a60, 3, 'rect'); wmarker(cx, cy, e); }
    function sDen(cx, cy, e) { patch(cx, cy, 1, T.DIRT); decor(cx, cy, 0x2a2018, 7, 'circle'); sScatter(cx, cy, 3, 4, 0x5a4a3a, 4, 'rect'); wmarker(cx, cy, e, 'explore'); garrison(cx, cy, 3, e.base || 'rat', e.n || 2, e.name); }
    function sBurrow(cx, cy, e) { patch(cx, cy, 1, T.DIRT); decor(cx, cy, 0x2a2018, 6, 'circle'); sScatter(cx, cy, 3, 5, 0x5a4a3a, 3, 'rect'); sScatter(cx, cy, 4, 4, 0x3f6e2c, 4, 'circle'); wmarker(cx, cy, e); } // wildlife den/burrow — a hole in the earth, tracks, no stone walls

    function buildScene(e, cx, cy) {
      const id = e.id, k = e.kind;
      if (k === 'oddity') return sNatural(cx, cy, e);
      if (k === 'gather') return sGrove(cx, cy, e);
      if (k === 'treasure') return sCache(cx, cy, e);
      if (k === 'shrine') return sShrine(cx, cy, e);
      if (k === 'fight') return /nest|den|warren|burrow|roost|sett|pit|hive|hollow/.test(id) ? sDen(cx, cy, e) : sCamp(cx, cy, e);
      if (k === 'lore') return /journal|locket|message|banner|mural|cave_mark|totem/.test(id) ? wmarker(cx, cy, e) : sMonument(cx, cy, e);
      // explore:
      if (/statue|idol|obelisk|arch|sarcoph|coffin|milestone|signpost|graveyard|colossus|memorial/.test(id)) return sMonument(cx, cy, e);
      if (/camp|tent|bedroll|cart|wagon|cookpot|firepit|snare|blind|deserted/.test(id)) return sCamp(cx, cy, e);
      if (/well/.test(id)) return sCache(cx, cy, e);
      if (/warren|burrow|sett|roost|nest|ledge|perch|wallow|rabbit|deer|owl|vulture|goat|badger|weasel|fox|toad|crow|hollow_stump/.test(id)) return sBurrow(cx, cy, e); // wildlife, not architecture
      const ruined = /ruin|collaps|derelict|charr|abandon|toppl|wreck|broken|sunk|weathered|old_|forgotten/.test(id);
      return sBuilding(cx, cy, e, ruined);
    }

    const S = 22;
    for (let gy0 = 60; gy0 < WORLD_H - 60; gy0 += S) for (let gx0 = 60; gx0 < WORLD_W - 60; gx0 += S) {
      const cx = Math.round(gx0 + (rng() * 2 - 1) * 7), cy = Math.round(gy0 + (rng() * 2 - 1) * 7);
      let tx = -1, ty = -1;
      for (let r = 0; r < 4 && tx < 0; r++) for (const [a, b] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const x = cx + a, y = cy + b; if (getT(x, y) === T.GRASS && !occupied.has(okey(x, y))) { tx = x; ty = y; break; } }
      if (tx < 0 || nearContent(tx, ty)) continue;
      const tier = tierOf[regionAt(tx, ty)] || 'low', biome = localBiome(tx, ty);
      let e = null;
      for (let k = 0; k < 10; k++) { const c = WILDERNESS[(rng() * WILDERNESS.length) | 0]; if (biomeOK(c, biome) && tierOK(c, tier)) { e = c; break; } }
      if (!e) continue;
      buildScene(e, tx, ty);
      markP(tx, ty);
    }
  })();

  // ---- Interactive shortcuts: repairable marker on the shore + the gap to span ----
  // Runs before the texture pass so the crossing is still raw T.WATER. Scans from
  // each shortcut's anchor across to the water gap, records the span tiles for the
  // interaction handler to bridge at open-time, and drops a reachable marker on the
  // near shore. Skips quietly if the generated terrain has no gap there.
  if (!GEO2) (function placeShortcuts() {
    for (const s of SHORTCUTS) {
      if (!s.anchor || !s.across || !s.cost) continue; // design stub, not yet wired
      const [ax, ay] = s.anchor, [dx, dy] = s.across;
      let x = ax, y = ay, guard = 0;
      while (guard++ < 40 && inB(x, y) && getT(x, y) !== T.WATER) { x += dx; y += dy; }
      const span = [];
      while (span.length < s.maxSpan && inB(x, y) && getT(x, y) === T.WATER) { span.push([x, y]); x += dx; y += dy; }
      if (!span.length) continue;
      const mx = span[0][0] - dx, my = span[0][1] - dy; // near-shore land tile
      if (!inB(mx, my) || occupied.has(okey(mx, my))) continue;
      placeObj({ x: mx, y: my, type: 'structure', label: s.label, color: s.color, skill: null, blocking: false, depleted: false,
        shortcut: { id: s.id, kind: s.kind, cost: s.cost, span, doneLabel: s.doneLabel, doneMsg: s.doneMsg, hint: s.hint, opened: false } });
    }
  })();

  // ---- POLISH (Phase D): ecotone transition content at biome edges ----
  // Reeds/cattails where grass meets water or swamp; scree/boulders where grass
  // meets mountain rock — so region borders blend through mixed content, not a
  // hard line. Decor only (non-blocking), so collision/pathing are untouched.
  (function ecotones() {
    for (let y = 5; y < WORLD_H - 5; y++) for (let x = 5; x < WORLD_W - 5; x++) {
      const i = idx(x, y); if (terrain[i] !== T.GRASS || occupied.has(okey(x, y))) continue;
      const l = terrain[i - 1], r = terrain[i + 1], u = terrain[i - WORLD_W], d = terrain[i + WORLD_W];
      const nearW = l === T.WATER || r === T.WATER || u === T.WATER || d === T.WATER || l === T.SWAMP || r === T.SWAMP || u === T.SWAMP || d === T.SWAMP;
      const nearR = l === T.ROCK || r === T.ROCK || u === T.ROCK || d === T.ROCK;
      // Reeds gather in BEDS along the shore and scree in TALUS patches at the cliff
      // foot — gated by a low-frequency noise mask so decor clumps into intentional
      // fields instead of an even per-tile sprinkle (which reads as random speckle).
      if (nearW) { if (vnoise(x / 7, y / 7, Sr + 51) > 0.60 && rng() < 0.32) decor(x, y, rng() < 0.5 ? 0x5f7d3c : 0x7bb489, 5, 'rect'); }            // cattail / reed beds
      else if (nearR && vnoise(x / 6, y / 6, Sr + 53) > 0.62 && rng() < 0.30) { decor(x, y, 0x6a6a6a, 5, 'rect'); if (rng() < 0.3) decor(x + (rng() < 0.5 ? 1 : -1), y, 0x7c7c7c, 4, 'rect'); } // talus / scree fields
    }
  })();

  // ---- POLISH (Phase E): ambient wildlife + environmental FX ----
  // Region-flavoured particles (fireflies, mist, pollen, dust) and a scatter of
  // resident critters, so the empty stretches feel alive. Decor only.
  (function ambientLife() {
    const spray = (cx, cy, rad, n, pick) => { for (let i = 0; i < n; i++) { const x = Math.round(cx + (rng() * 2 - 1) * rad), y = Math.round(cy + (rng() * 2 - 1) * rad); const t = getT(x, y); if ((t === T.GRASS || t === T.SWAMP) && !occupied.has(okey(x, y))) pick(x, y); } };
    spray(250, 800, 130, 150, (x, y) => decor(x, y, rng() < 0.5 ? 0xf2e85a : 0xcfe04a, 2, 'circle'));                 // fireflies / spores — mushroom forest
    spray(690, 712, 120, 130, (x, y) => decor(x, y, rng() < 0.5 ? 0xb4c4b4 : 0x9fb39f, 3, 'circle'));                 // mist wisps — bog
    spray(505, 640, 95, 90, (x, y) => decor(x, y, rng() < 0.5 ? 0xf0d85a : 0xf09ab8, 2, 'circle'));                   // pollen / butterflies — farmland
    spray(455, 285, 60, 45, (x, y) => decor(x, y, 0xa89a78, 2, 'rect'));                                              // dust motes — quarry
    spray(500, 555, 120, 16, (x, y) => decor(x, y, 0xb3a488, 4, 'circle'));                                          // rabbits — town commons
    spray(420, 560, 85, 9, (x, y) => decor(x, y, 0x8a6a4a, 5, 'circle'));                                            // deer — near the Great Oak
    spray(566, 520, 60, 12, (x, y) => decor(x, y, 0x4f7a3a, 3, 'circle'));                                           // frogs — lakeshore
  })();

  // ---- POLISH: terrain texture variants (FINAL, visual-only recolor) ----
  // Runs after ALL placement so no T.GRASS-based logic is affected. Variants
  // share their base tile's walkability, so collision/pathfinding is unchanged.
  (function texturePass() {
    const isWater = (t) => t === T.WATER || t === T.WATER_DEEP || t === T.WATER_SHALLOW;
    const grassy = (t) => t === T.GRASS || t === T.GRASS2 || t === T.GRASS3 || t === T.DIRT || t === T.SAND || t === T.WET_SAND;
    for (let y = 3; y < WORLD_H - 3; y++) for (let x = 3; x < WORLD_W - 3; x++) {
      const i = idx(x, y), t = terrain[i];
      if (t === T.WATER) { const land = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !isWater(getT(x + a, y + b))); terrain[i] = land ? T.WATER_SHALLOW : T.WATER_DEEP; }
      else if (t === T.ROCK) { const face = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => grassy(getT(x + a, y + b))); terrain[i] = face ? T.CLIFF : (vnoise(x / 6, y / 6, Sr + 63) > 0.52 ? T.ROCK2 : T.ROCK); }
      else if (t === T.SAND) { if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => isWater(getT(x + a, y + b)))) terrain[i] = T.WET_SAND; }
      else if (t === T.GRASS) { const n = vnoise(x / 7, y / 7, Sr + 61) * 0.6 + vnoise(x / 23, y / 23, Sr + 61) * 0.4; if (n > 0.60) terrain[i] = T.GRASS3; else if (n < 0.40) terrain[i] = T.GRASS2; }
      else if (t === T.SWAMP) { if (vnoise(x / 9, y / 9, Sg + 7) > 0.55) terrain[i] = T.MUD; }
    }
  })();

  // ---- POLISH (Phase G): coherent rule-based elevation model ----
  // A semantic heightfield with real-world rules: rivers/water sit lowest (valley
  // floors), mountains rise highest with foothills ramping up toward the peaks,
  // grassland gently rolls, and settlement ramparts/floors stand a little proud of
  // the plain. Seeded per-terrain targets are relaxed (blurred) into a continuous
  // field, with mountain peaks and water valleys re-pinned each pass so the ramps
  // form around them instead of averaging flat. Exported for the render lane's
  // height-shading, and drives the terrace + shadow relief below.
  const elevation = new Uint8Array(WORLD_W * WORLD_H);
  if (GEO2) {
    // Elevation IS the geo2 heightfield: rolling grassland, mountains that climb,
    // and river VALLEYS — water sits lowest and the banks dip toward it, so the
    // 2.5D renderer shows real riverbanks and hills with zero extra draw code.
    for (let i = 0; i < elevation.length; i++) {
      const w = macro.water[i];
      elevation[i] = w === 1 ? 8 : w === 2 ? 14 : w === 3 ? 34 : 28 + macro.height[i] * 190;
    }
    for (let y = 2; y < WORLD_H - 2; y++) for (let x = 2; x < WORLD_W - 2; x++) {
      const i = idx(x, y); if (macro.water[i]) continue;
      let near = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (macro.water[idx(x + dx, y + dy)] === 3) { near = 2; break; }
      if (!near) for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]]) if (macro.water[idx(x + dx, y + dy)] === 3) { near = 1; break; }
      if (near) elevation[i] = Math.max(22, elevation[i] - (near === 2 ? 14 : 7));
    }
  } else
  (function elevationModel() {
    const N = WORLD_W * WORLD_H;
    const roll = (x, y) => vnoise(x / 42, y / 42, Sr + 91) * 0.62 + vnoise(x / 13, y / 13, Sr + 92) * 0.38; // 0..1 rolling swell
    const target = (t, x, y) => {
      switch (t) {
        case T.WATER_DEEP: return 6;
        case T.WATER: return 12;
        case T.WATER_SHALLOW: return 20;
        case T.SWAMP: case T.MUD: return 30;
        case T.WET_SAND: return 46;
        case T.SAND: case T.SAND_SHADOW: return 52;
        case T.BRIDGE: return 60; case T.ROAD: return 66;
        case T.DIRT: case T.DIRT_SHADOW: case T.FIELD: return 68;
        case T.FLOOR: return 92; case T.WALL: return 98;              // settlement built up on a slight platform
        case T.CLIFF: return 132; case T.ROCK2: return 166; case T.ROCK: return 196;
        default: return 66 + roll(x, y) * 26;                          // grass variants: rolling 66..92
      }
    };
    let a = new Float32Array(N), b = new Float32Array(N);
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) { const i = idx(x, y); a[i] = target(terrain[i], x, y); }
    const hiPin = (t) => t === T.ROCK ? 190 : t === T.ROCK2 ? 158 : t === T.CLIFF ? 122 : -1;
    const loPin = (t) => t === T.WATER_DEEP ? 8 : (t === T.WATER || t === T.WATER_SHALLOW) ? 20 : -1;
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 1; y < WORLD_H - 1; y++) for (let x = 1; x < WORLD_W - 1; x++) { const i = idx(x, y); b[i] = (a[i] + a[i - 1] + a[i + 1] + a[i - WORLD_W] + a[i + WORLD_W]) * 0.2; }
      for (let x = 0; x < WORLD_W; x++) { b[idx(x, 0)] = a[idx(x, 0)]; b[idx(x, WORLD_H - 1)] = a[idx(x, WORLD_H - 1)]; }
      for (let y = 0; y < WORLD_H; y++) { b[idx(0, y)] = a[idx(0, y)]; b[idx(WORLD_W - 1, y)] = a[idx(WORLD_W - 1, y)]; }
      for (let i = 0; i < N; i++) { const hp = hiPin(terrain[i]); if (hp >= 0 && b[i] < hp) b[i] = hp; const lp = loPin(terrain[i]); if (lp >= 0 && b[i] > lp) b[i] = lp; }
      const tmp = a; a = b; b = tmp;
    }
    for (let i = 0; i < N; i++) elevation[i] = a[i] < 0 ? 0 : a[i] > 255 ? 255 : a[i];
  })();

  // ---- POLISH (Phase G): relief — terrace lips + elevation-driven drop shadows ----
  // Light reads from the south: ground sitting well below its northern neighbour
  // falls into shadow (a soft 2-tile band at real steps). On high rock, each drop
  // to a lower elevation band gets a cliff "lip", so mountains read as climbable
  // terraces stacking up to the peak rather than one smooth dome.
  (function reliefPass() {
    const shade = { [T.GRASS]: T.GRASS_SHADOW, [T.GRASS2]: T.GRASS_SHADOW, [T.GRASS3]: T.GRASS_SHADOW, [T.DIRT]: T.DIRT_SHADOW, [T.FIELD]: T.DIRT_SHADOW, [T.SAND]: T.SAND_SHADOW, [T.WET_SAND]: T.SAND_SHADOW };
    const BAND = 18;
    for (let y = 3; y < WORLD_H - 3; y++) for (let x = 3; x < WORLD_W - 3; x++) {
      const i = idx(x, y), t = terrain[i];
      if (t === T.ROCK || t === T.ROCK2 || t === T.CLIFF) {
        if ((elevation[i] / BAND | 0) > (elevation[i + WORLD_W] / BAND | 0)) terrain[i] = T.CLIFF; // terrace lip on the downhill (south) face
        continue;
      }
      const s = shade[t]; if (s === undefined) continue;
      const e = elevation[i];
      if (elevation[i - WORLD_W] - e >= 14 || elevation[i - 2 * WORLD_W] - e >= 22) terrain[i] = s;
    }
  })();

  // ---- collision + chunk buckets ----
  const collision = new Uint8Array(WORLD_W * WORLD_H);
  for (let i = 0; i < collision.length; i++) collision[i] = TERRAIN_DEFS[terrain[i]].walkable ? 0 : 1;
  for (const o of objects) if (o.blocking) collision[idx(o.x, o.y)] = 1;
  // safety: a later terrain pass (a wonder wall, waterfall/spring disc, etc.) can
  // seal a tile a mob was already standing on. Lift any such mob onto the nearest
  // walkable ground so nothing spawns trapped inside a wall or in open water.
  for (const s of enemySpawns) {
    if (!collision[idx(s.x, s.y)]) continue;
    for (let r = 1; r <= 5; r++) { let done = false; for (let a = 0; a < 360; a += 30) { const nx = Math.round(s.x + r * Math.cos(a * Math.PI / 180)), ny = Math.round(s.y + r * Math.sin(a * Math.PI / 180)); if (nx >= 0 && ny >= 0 && nx < WORLD_W && ny < WORLD_H && !collision[idx(nx, ny)]) { s.x = nx; s.y = ny; done = true; break; } } if (done) break; }
  }
  const objectsByChunk = new Map();
  for (const o of objects) { const k = chunkKey(o.x, o.y); if (!objectsByChunk.has(k)) objectsByChunk.set(k, []); objectsByChunk.get(k).push(o); }

  return { W: WORLD_W, H: WORLD_H, seed, terrain, collision, elevation, objects, objectAt, objectsByChunk, enemySpawns, friendlies, ENEMY_TYPES, spawn,
    geo2: GEO2, townOffset: townOff, sites: macro ? macro.sites : null };
}

// ============================================================ queries
export function isWalkable(world, x, y) { if (x < 0 || y < 0 || x >= world.W || y >= world.H) return false; return world.collision[y * world.W + x] === 0; }
export function regionAt(x, y) {
  for (const a of REGION_ANCHORS) { const b = a.bounds; if (b && x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]) return a.name; }
  let best = null, bs = Infinity; for (const a of REGION_ANCHORS) { const d = Math.hypot(x - a.x, y - a.y) / a.r; if (d < bs) { bs = d; best = a; } }
  return bs < 1.15 ? best.name : 'Goblin Wilds';
}
export function objectsInView(world, x0, y0, x1, y1) { const out = []; const c0x = (x0 / CHUNK) | 0, c1x = (x1 / CHUNK) | 0, c0y = (y0 / CHUNK) | 0, c1y = (y1 / CHUNK) | 0; for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) { const arr = world.objectsByChunk.get(cy + ',' + cx); if (arr) for (const o of arr) out.push(o); } return out; }

// Add an object to a LIVE world AFTER generateWorld(). The chunk index
// (objectsByChunk) that drawObjects/objectsInView read is built once at world
// gen, so anything pushed straight onto world.objects later is interactable but
// INVISIBLE. Post-generation placers (fast-travel transports, spawn activities,
// the altar) MUST route through this so the object is chunk-indexed (visible),
// looked up (interactable) and collision-marked, all consistently.
export function addWorldObject(world, o, interactive = true) {
  world.objects.push(o);
  if (interactive) world.objectAt.set(o.x + ',' + o.y, o);
  const k = chunkKey(o.x, o.y);
  let arr = world.objectsByChunk.get(k);
  if (!arr) { arr = []; world.objectsByChunk.set(k, arr); }
  arr.push(o);
  if (o.blocking) world.collision[o.y * world.W + o.x] = 1;
  return o;
}

// A* pathfinding over the tile grid. 8-directional (diagonals) with corner-cut
// prevention, an octile heuristic (admissible for 8-dir, so paths are optimal),
// and a node-expansion cap. If the goal can't be reached within the cap it
// returns the best partial path toward it (callers re-path each tick to finish
// long / far routes). Same signature as before — a drop-in for the old BFS.
const SQRT2 = Math.SQRT2;
const PATH_DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];
export function findPath(world, sx, sy, tx, ty, adjacent = false) {
  const W = world.W, H = world.H, col = world.collision;
  const goal = adjacent
    ? (x, y) => Math.abs(x - tx) + Math.abs(y - ty) === 1
    : (x, y) => x === tx && y === ty;
  if (goal(sx, sy)) return [];
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !col[y * W + x];
  // octile distance: cheapest 8-dir cost ignoring obstacles (admissible)
  const heur = (x, y) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  };

  const MAX = 14000;
  // binary min-heap of node keys, ordered by f = g + h (parallel arrays)
  const hk = [], hf = [];
  const push = (k, f) => {
    hk.push(k); hf.push(f);
    let i = hk.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; }
  };
  const pop = () => {
    const k = hk[0]; const lk = hk.pop(), lf = hf.pop();
    if (hk.length) {
      hk[0] = lk; hf[0] = lf; let i = 0;
      for (;;) { let s = i; const l = 2 * i + 1, r = 2 * i + 2; if (l < hk.length && hf[l] < hf[s]) s = l; if (r < hk.length && hf[r] < hf[s]) s = r; if (s === i) break; [hf[s], hf[i]] = [hf[i], hf[s]]; [hk[s], hk[i]] = [hk[i], hk[s]]; i = s; }
    }
    return k;
  };

  const startK = sy * W + sx;
  const gScore = new Map([[startK, 0]]);
  const came = new Map([[startK, -1]]);
  push(startK, heur(sx, sy));
  let best = startK, bestH = heur(sx, sy), expanded = 0;

  while (hk.length && expanded < MAX) {
    const cur = pop();
    const cx = cur % W, cy = (cur - cx) / W;
    if (goal(cx, cy)) return rebuild(came, cur, W);
    expanded++;
    const cg = gScore.get(cur);
    for (const [dx, dy, cost] of PATH_DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!walk(nx, ny)) continue;
      // no corner cutting: a diagonal step needs both shared orthogonals open
      if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
      const nk = ny * W + nx;
      const ng = cg + cost;
      if (gScore.has(nk) && ng >= gScore.get(nk)) continue;
      gScore.set(nk, ng); came.set(nk, cur);
      const nh = heur(nx, ny);
      if (nh < bestH) { bestH = nh; best = nk; }
      push(nk, ng + nh);
    }
  }
  return best !== startK ? rebuild(came, best, W) : [];
}
function rebuild(came, node, W) { const path = []; let c = node; while (c !== -1 && came.get(c) !== -1) { const x = c % W, y = (c - x) / W; path.unshift([x, y]); c = came.get(c); } return path; }
