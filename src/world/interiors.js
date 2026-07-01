// src/world/interiors.js — hand-tuned INTERIOR sub-maps (caves, ruins, huts) that
// the player steps into through a door on the overworld. Each returns the SAME
// shape as generateWorld(), so the existing render / collision / pathing pipeline
// draws it unchanged — main.js just swaps Game.world to this and back.
//
// Enter/exit contract (for the main.js hook):
//   const inner = generateInterior('deep_mine', { from: {x,y} });  // from = overworld return tile
//   // save the overworld + player tile, then: Game.world = inner; respawn NPCs from
//   //   inner.enemySpawns; move player to inner.spawn.
//   // inner.exit = {x,y} carries an examine/portal object; stepping on it restores
//   //   the saved overworld world + player tile (inner.returnTo).

import { T, TERRAIN_DEFS, CHUNK } from './worldData.js';

// tiny deterministic rng so each interior id is stable
function rngFor(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// interior themes: wall/floor terrain, mob base, loot, size, boss
const THEMES = {
  deep_mine: { name: 'Deep Mine', W: 54, H: 40, wall: T.ROCK, floor: T.DIRT, mob: 'cave_bug', mobName: 'Cave Lurker', n: 14, boss: 'Rockjaw', ore: 'ore', chestLoot: 'iron_ore' },
  ruin_chapel: { name: 'Old Ruin Chapel', W: 46, H: 34, wall: T.WALL, floor: T.FLOOR, mob: 'cave_bug', mobName: 'Crypt Crawler', n: 12, boss: 'The Pale Priest', ore: null, chestLoot: 'coins' },
  witch_hut: { name: 'Witch-Goblin Hut', W: 34, H: 26, wall: T.WALL, floor: T.FLOOR, mob: 'rat', mobName: 'Familiar', n: 6, boss: null, ore: null, chestLoot: 'coins' },
  rival_camp: { name: 'Rival War Camp', W: 50, H: 38, wall: T.WALL, floor: T.DIRT, mob: 'bandit', mobName: 'Red-Ear Raider', n: 16, boss: 'Red-Ear Warlord', ore: null, chestLoot: 'bronze_bar' },
};

export function generateInterior(id, opts = {}) {
  const th = THEMES[id] || THEMES.deep_mine;
  const W = th.W, H = th.H, N = W * H;
  const rng = rngFor(id);
  const terrain = new Uint8Array(N).fill(th.wall);
  const idx = (x, y) => y * W + x;
  const carveRoom = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x > 0 && y > 0 && x < W - 1 && y < H - 1) terrain[idx(x, y)] = th.floor; };
  const corridor = (ax, ay, bx, by) => { let x = ax, y = ay; while (x !== bx) { terrain[idx(x, y)] = th.floor; terrain[idx(x, y + 1)] = th.floor; x += Math.sign(bx - x); } while (y !== by) { terrain[idx(x, y)] = th.floor; terrain[idx(x + 1, y)] = th.floor; y += Math.sign(by - y); } };

  // rooms: entry hall (bottom-centre) + 3-5 chambers + a boss chamber (top)
  const rooms = [];
  const entry = { cx: (W / 2) | 0, cy: H - 5, w: 4, h: 3 };
  carveRoom(entry.cx - entry.w, entry.cy - entry.h, entry.cx + entry.w, entry.cy + entry.h); rooms.push(entry);
  const roomCount = 3 + (rng() * 3 | 0);
  for (let i = 0; i < roomCount; i++) {
    const w = 3 + (rng() * 4 | 0), h = 3 + (rng() * 3 | 0);
    const cx = 4 + w + (rng() * (W - 8 - 2 * w) | 0), cy = 5 + h + (rng() * (H - 14 - 2 * h) | 0);
    carveRoom(cx - w, cy - h, cx + w, cy + h);
    corridor(rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, cx, cy);
    rooms.push({ cx, cy, w, h });
  }
  const boss = { cx: (W / 2) | 0, cy: 5, w: 5, h: 3 };
  carveRoom(boss.cx - boss.w, boss.cy - boss.h, boss.cx + boss.w, boss.cy + boss.h);
  corridor(rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy, boss.cx, boss.cy);

  // ---- objects + spawns ----
  const objects = [], enemySpawns = [], objectAt = new Map();
  const key = (x, y) => x + ',' + y;
  const isFloor = (x, y) => terrain[idx(x, y)] === th.floor && !objectAt.has(key(x, y));
  const place = (o) => { objects.push(o); objectAt.set(key(o.x, o.y), o); return o; };
  const randFloor = (room, pad = 1) => { for (let t = 0; t < 30; t++) { const x = room.cx - room.w + pad + (rng() * (2 * (room.w - pad)) | 0), y = room.cy - room.h + pad + (rng() * (2 * (room.h - pad)) | 0); if (isFloor(x, y)) return [x, y]; } return null; };

  // the exit portal, at the entry hall
  const spawn = { x: entry.cx, y: entry.cy + 2 };
  place({ x: entry.cx, y: entry.cy - 1, type: 'structure', color: 0xffe14d, label: `Exit — ${th.name}`, blocking: false, exit: true, examine: 'Leave, back to the daylight.' });

  // ore veins (mines) scattered along walls
  if (th.ore) for (let i = 0; i < 10; i++) { const [x, y] = randFloor(rooms[1 + (rng() * (rooms.length - 1) | 0)]) || []; if (x !== undefined) place({ x, y, type: 'resource', resKey: 'ore', skill: 'Mining', level: 15, tool: 'pickaxe', drop: th.chestLoot, xp: 35, low: 15, high: 40, label: 'Iron Vein', color: 0x9a7a5a, blocking: true, deplete: 0.3, respawn: 40, depleted: false, respawnAt: 0 }); }

  // loot chests in the deeper rooms
  for (let i = 2; i < rooms.length; i++) { const s = randFloor(rooms[i]); if (s) place({ x: s[0], y: s[1], type: 'structure', color: 0x8a6a3a, label: 'Chest', blocking: false, examine: 'A dusty chest — something rattles inside.', loot: th.chestLoot, wild: 'treasure' }); }

  // mobs through the chambers
  for (let i = 0; i < th.n; i++) { const r = rooms[1 + (rng() * (rooms.length - 1) | 0)]; const s = randFloor(r); if (s) enemySpawns.push({ type: th.mob, x: s[0], y: s[1], name: th.mobName }); }
  // the boss holds the top chamber
  if (th.boss) { const s = randFloor(boss) || [boss.cx, boss.cy]; enemySpawns.push({ type: th.mob, x: s[0], y: s[1], name: th.boss, boss: true }); place({ x: boss.cx, y: boss.cy - 2, type: 'structure', color: 0xd0c040, label: `${th.boss}'s Hoard`, blocking: false, examine: 'The prize, if you can take it.', loot: th.chestLoot, wild: 'treasure' }); }

  // torches / decor along the entry
  for (let i = 0; i < 12; i++) { const r = rooms[rng() * rooms.length | 0]; const x = r.cx + (rng() * 2 * r.w - r.w | 0), y = r.cy + (rng() * 2 * r.h - r.h | 0); if (isFloor(x, y)) place({ x, y, type: 'decor', color: th.floor === T.DIRT ? 0x5a4a3a : 0x6a6a6a, size: 3, shape: 'rect', blocking: false }); }

  // ---- collision + chunk buckets + flat elevation ----
  const collision = new Uint8Array(N);
  for (let i = 0; i < N; i++) collision[i] = TERRAIN_DEFS[terrain[i]].walkable ? 0 : 1;
  for (const o of objects) if (o.blocking) collision[idx(o.x, o.y)] = 1;
  const elevation = new Uint8Array(N).fill(80); // interiors are flat (no 2.5D lift)
  const objectsByChunk = new Map();
  for (const o of objects) { const k = ((o.y / CHUNK) | 0) + ',' + ((o.x / CHUNK) | 0); if (!objectsByChunk.has(k)) objectsByChunk.set(k, []); objectsByChunk.get(k).push(o); }

  return {
    W, H, seed: id, interior: true, name: th.name,
    terrain, collision, elevation, objects, objectAt, objectsByChunk,
    enemySpawns, friendlies: [], ENEMY_TYPES: {}, spawn,
    exit: { x: entry.cx, y: entry.cy - 1 }, returnTo: opts.from || null,
  };
}
