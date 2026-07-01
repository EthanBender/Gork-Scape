// src/systems/spawnActivities.js
// Guarantees money-making activities are within a short walk of the spawn hub and
// each fast-travel destination. The hand-authored world (map.js) leaves the Goblin
// Settlement itself resource-bare, so a fresh player has nothing to gather/sell
// nearby. This scatters a compact "starter yard" of low-level nodes around spawn
// (trees + copper/tin ore) and tops up each hub with theme-appropriate nodes, so
// arriving anywhere gives you something to do for coin.
//
// Self-contained (economy/items lane): main.js calls placeStarterActivities(world)
// in buildWorld() after the world is generated. Nodes are plain resource objects
// built from RESOURCE_TYPES, so the existing gather + render + respawn systems
// handle them with no other changes.

import { isWalkable, TERRAIN_DEFS, WORLD_W, WORLD_H, addWorldObject } from '../world/map.js';
import { RESOURCE_TYPES } from '../world/worldData.js';

function isWater(world, x, y) {
  if (x < 0 || y < 0 || x >= world.W || y >= world.H) return false;
  const def = TERRAIN_DEFS[world.terrain[y * world.W + x]];
  return !!def && /water/.test(def.id);
}
function hasWalkableNeighbor(world, x, y) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWalkable(world, x + dx, y + dy));
}

// Place one resource node, mirroring map.js's resObj shape so gather/draw/respawn
// all work. Blocking nodes (trees/rocks) also mark the tile impassable so the
// player routes around them and skills from an adjacent tile.
function placeNode(world, x, y, resKey) {
  const d = RESOURCE_TYPES[resKey];
  const o = {
    x, y, type: 'resource', resKey,
    skill: d.skill, level: d.level, tool: d.tool, drop: d.drop, xp: d.xp,
    low: d.low, high: d.high, label: d.label, color: d.color,
    deplete: d.deplete, respawn: d.respawn, blocking: d.blocking !== false,
    depleted: false, respawnAt: 0,
  };
  // chunk-index it (else invisible) + objectAt + collision, all consistent.
  return addWorldObject(world, o);
}

// Scatter `count` nodes of resKey in an annulus [min,max] around (cx,cy).
// Fishing spots (blocking:false) need a shore-adjacent water tile; everything
// else needs an open walkable tile that isn't already occupied.
function scatter(world, cx, cy, resKey, count, min, max) {
  const water = RESOURCE_TYPES[resKey].blocking === false;
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 120) {
    // random point in the annulus
    const ang = Math.random() * Math.PI * 2;
    const rad = min + Math.random() * (max - min);
    const x = Math.round(cx + Math.cos(ang) * rad);
    const y = Math.round(cy + Math.sin(ang) * rad);
    if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) continue;
    if (world.objectAt.has(x + ',' + y)) continue;
    if (water) {
      if (!isWater(world, x, y) || !hasWalkableNeighbor(world, x, y)) continue;
    } else if (!isWalkable(world, x, y)) {
      continue;
    }
    placeNode(world, x, y, resKey);
    placed++;
  }
  return placed;
}

// (cx, cy) = spawn / hub centres; items = [resKey, count] pairs.
const CLUSTERS = [
  // Starter yard right around the Goblin Settlement — the big gap.
  { cx: 500, cy: 462, min: 6, max: 17, items: [['tree', 5], ['tree_oak', 2], ['rock_copper', 3], ['rock_tin', 3]] },
  // Fast-travel hubs — a guaranteed, theme-appropriate cluster near where the
  // cart/portal drops you, on top of whatever the hand-authored region already has.
  { cx: 610, cy: 190, min: 3, max: 16, items: [['rock_copper', 3], ['rock_tin', 3], ['rock_iron', 3]] },      // Northern Mine Hills
  { cx: 335, cy: 370, min: 3, max: 16, items: [['tree', 5], ['tree_oak', 3]] },                                // Chopper's Hollow
  { cx: 250, cy: 800, min: 3, max: 16, items: [['tree', 4], ['tree_dead', 3]] },                               // Mushroom Forest
  { cx: 735, cy: 495, min: 3, max: 22, items: [['fish_shrimp', 4], ['fish_trout', 4]] },                       // Grublake (fishing)
];

export function placeStarterActivities(world) {
  for (const c of CLUSTERS) {
    for (const [resKey, n] of c.items) scatter(world, c.cx, c.cy, resKey, n, c.min, c.max);
  }
}
