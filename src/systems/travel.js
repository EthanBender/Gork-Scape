// src/systems/travel.js
// Fast travel via IN-WORLD objects you click on: cart & mine-cart stations (pay a
// coin fare) and a blood portal (costs half your HP to step through). Carts and
// portals are placed as world objects near the hub, with a return transport at
// each destination. Clicking one walks the player to it; on arrival it charges the
// cost and teleports.
//
// TESTING CONVENIENCE for now (short hops, cheap) — the owner plans to tune these:
// fares/cooldowns/unlocks, and richer boarding animations later. Self-contained
// (economy/items lane): main.js calls placeTransports(world) in buildWorld and
// boardTransport(obj) from performSkill when the player reaches one.

import { Game } from '../engine/state.js';
import { isWalkable, regionAt, TILE_SIZE, WORLD_W, WORLD_H, addWorldObject } from '../world/map.js';
import { placeStarterActivities } from './spawnActivities.js';

const tilePx = (t) => t * TILE_SIZE + TILE_SIZE / 2;
const SPAWN = { x: 500, y: 462 };

// Destinations (x/y = region centre from worldData REGION_ANCHORS).
export const DESTINATIONS = [
  { id: 'hub',       name: 'Goblin Settlement',   x: 500, y: 462 },
  { id: 'minehills', name: 'Northern Mine Hills',  x: 610, y: 190 },
  { id: 'choppers',  name: "Chopper's Hollow",     x: 335, y: 370 },
  { id: 'grublake',  name: 'Grublake',             x: 735, y: 495 },
  { id: 'mushroom',  name: 'Mushroom Forest',      x: 250, y: 800 },
];
const DEST = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));

// Transport kinds: their look, fare, and flavour.
const KINDS = {
  cart:     { label: 'Cart',        color: 0x8a6d3b, cost: { coins: 15 }, verb: 'ride the cart' },
  minecart: { label: 'Mine Cart',   color: 0x6d6d6d, cost: { coins: 20 }, verb: 'ride the mine cart' },
  portal:   { label: 'Blood Portal', color: 0xaa2233, cost: { hpFrac: 0.5 }, verb: 'step through the blood portal' },
};

// Where each transport sits and where it goes. Outbound cluster near the hub;
// one return transport at each destination back to the hub.
const PLACEMENTS = [
  { at: [SPAWN.x - 6, SPAWN.y - 5], destId: 'minehills', kind: 'minecart' },
  { at: [SPAWN.x - 6, SPAWN.y + 5], destId: 'choppers',  kind: 'cart' },
  { at: [SPAWN.x + 7, SPAWN.y + 5], destId: 'grublake',  kind: 'cart' },
  { at: [SPAWN.x + 7, SPAWN.y - 5], destId: 'mushroom',  kind: 'portal' },
  { at: [DEST.minehills.x, DEST.minehills.y], destId: 'hub', kind: 'minecart' },
  { at: [DEST.choppers.x,  DEST.choppers.y],  destId: 'hub', kind: 'cart' },
  { at: [DEST.grublake.x,  DEST.grublake.y],  destId: 'hub', kind: 'cart' },
  { at: [DEST.mushroom.x,  DEST.mushroom.y],  destId: 'hub', kind: 'portal' },
];

// Nearest walkable, unoccupied tile to (cx,cy) (region centres can be on terrain).
function findOpen(world, cx, cy, radius) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H
            && isWalkable(world, x, y) && !world.objectAt.has(x + ',' + y)) return { x, y };
      }
    }
  }
  return null;
}

// Place all transport objects into the world. Called from main.js buildWorld().
// Also seeds the starter money-making nodes near spawn + hubs (piggybacked here so
// it runs from the same single buildWorld hook without another main.js edit).
export function placeTransports(world) {
  placeStarterActivities(world);
  for (const pl of PLACEMENTS) {
    const spot = findOpen(world, pl.at[0], pl.at[1], 14);
    if (!spot) continue;
    const k = KINDS[pl.kind];
    const dest = DEST[pl.destId];
    const obj = {
      x: spot.x, y: spot.y, type: 'transport', transport: true,
      destId: pl.destId, kind: pl.kind, cost: k.cost,
      label: `${k.label} → ${dest.name}`, color: k.color,
      blocking: false, depleted: false, respawnAt: 0,
    };
    // Route through addWorldObject so it's chunk-indexed (drawObjects can SEE it),
    // not just interactable — a plain push renders the portal/cart invisible.
    addWorldObject(world, obj);
  }
}

// ---- coins ----
function invCoins() {
  return Game.inventory.reduce((n, s) => n + (s && s.id === 'coins' ? (s.qty || 1) : 0), 0);
}
function spendCoins(n) {
  let left = n;
  for (let i = 0; i < Game.inventory.length && left > 0; i++) {
    const s = Game.inventory[i];
    if (s && s.id === 'coins') {
      const take = Math.min(s.qty || 1, left);
      s.qty -= take; left -= take;
      if (s.qty <= 0) { Game.inventory[i] = null; if (Game.selectedInv === i) Game.selectedInv = null; }
    }
  }
  return left === 0;
}

// Charge the fare and teleport. Called when the player reaches a transport object.
export function boardTransport(obj) {
  const p = Game.player;
  if (!p || !obj || !obj.transport) return false;
  const dest = DEST[obj.destId];
  const k = KINDS[obj.kind];
  p.interactTarget = null;
  if (obj.cost.coins) {
    if (invCoins() < obj.cost.coins) {
      Game.log(`You can't afford the fare — it costs ${obj.cost.coins} coins.`);
      if (Game.refresh) Game.refresh();
      return false;
    }
    spendCoins(obj.cost.coins);
    Game.log(`You pay ${obj.cost.coins} coins and ${k.verb} to ${dest.name}.`);
  } else if (obj.cost.hpFrac) {
    const lost = Math.floor(Game.hp * obj.cost.hpFrac);
    Game.hp = Math.max(1, Game.hp - lost); // never lethal — leaves you at ≥1 HP
    Game.log(`🩸 The blood portal drains ${lost} HP as you ${k.verb} to ${dest.name}.`);
  }
  travelTo(obj.destId, { silent: true });
  return true;
}

// Region centres can land on a tree/rock/water tile — spiral out to walkable.
function nearestWalkable(tx, ty) {
  if (!Game.world) return { x: tx, y: ty };
  for (let r = 0; r <= 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && isWalkable(Game.world, x, y)) return { x, y };
      }
    }
  }
  return { x: tx, y: ty };
}

// Teleport the player to a destination (used by boardTransport; also callable
// directly for testing). `opts.silent` skips the arrival log (caller logs instead).
export function travelTo(id, opts = {}) {
  const d = DEST[id];
  const p = Game.player;
  if (!d || !p) return false;
  const { x, y } = nearestWalkable(d.x, d.y);
  p.tileX = x; p.tileY = y; p.px = tilePx(x); p.py = tilePx(y);
  p.path = []; p.combatTarget = null; p.interactTarget = null; p.pickupTarget = null; p.travelTarget = null;
  if (Game.scene && Game.scene.cameras && Game.scene.cameras.main) Game.scene.cameras.main.centerOn(p.px, p.py);
  Game.location = regionAt(x, y);
  if (!opts.silent) Game.log(`You arrive at ${d.name}.`);
  if (Game.refresh) Game.refresh();
  return true;
}
