// server/mobs.mjs
// Server-authoritative MOBS — Stage 1 of the shared world.
//
// The whole reason players "don't see the same mobs" is that today every browser
// runs its OWN copy of the monster simulation. This module moves the monsters in
// the shared central zone onto the server: it generates them from the SAME
// deterministic world seed the clients use (so positions match the map exactly),
// simulates their wander + respawn on the world loop, and hands each client the
// mobs near them. That makes the environment shared — one set of goblins everyone
// sees in the same spots.
//
// Stage 1 = ownership + movement + respawn + per-client broadcast. It's ADDITIVE:
// the server just starts publishing mob state; clients keep rendering their local
// mobs until Stage 2 switches them over, and combat authority (players damaging
// these mobs) is Stage 3.
//
// Reuses the pure client modules verbatim in Node — proof the DOM-free discipline
// paid off: generateWorld()/isWalkable() (seeded, grid-based) and ENEMY_TYPES +
// combatLevel() for stats/labels.

import { generateWorld, isWalkable } from '../src/world/map.js';
import { ENEMY_TYPES, DEFAULT_SEED } from '../src/world/worldData.js';
import { combatLevel } from '../src/engine/combat.js';

const CENTER = { x: 500, y: 500 };  // the settlement everyone spawns at
const OWN_RADIUS = 240;             // Stage 1: own mobs within this radius of it
const RESPAWN_TICKS = 16;           // matches the client's revive delay (~9.6s)
const WANDER_CHANCE = 0.18;         // per tick, chance a living mob ambles a tile

const FALLBACK = { name: 'Creature', color: 0x8a7a5a, hp: 5, att: 1, str: 1, def: 1, speed: 3, loot: 'rat' };
const rnd = () => Math.random();
const step1 = () => (Math.random() * 3 | 0) - 1; // -1, 0, or 1

export class Mobs {
  constructor(seed = DEFAULT_SEED) {
    this.list = [];
    this.byId = new Map();
    this.world = null;
    this._generate(seed);
  }

  _generate(seed) {
    try { this.world = generateWorld(seed); }
    catch (e) { console.error('[mobs] world-gen failed:', e.message); return; }
    let i = 0;
    for (const s of this.world.enemySpawns || []) {
      const dx = s.x - CENTER.x, dy = s.y - CENTER.y;
      if (dx * dx + dy * dy > OWN_RADIUS * OWN_RADIUS) continue; // Stage 1: central zone only
      const def = ENEMY_TYPES[s.type] || FALLBACK;
      const levels = { attack: def.att, strength: def.str, defence: def.def, ranged: 1, hitpoints: def.hp };
      const mob = {
        id: 'm' + (i++),
        name: s.name || def.name || s.type,
        etype: s.type,
        tileX: s.x, tileY: s.y, homeX: s.x, homeY: s.y,
        hp: def.hp, maxHp: def.hp,
        levels, combat: combatLevel(levels),
        weaponType: 'crush', attackSpeed: def.speed || 3,
        wanderRadius: 4, color: def.color, loot: def.loot || s.type,
        keep: !!s._keep, dead: false, respawnAt: 0,
      };
      this.list.push(mob);
      this.byId.set(mob.id, mob);
    }
    console.log(`[mobs] owning ${this.list.length} shared mobs within ${OWN_RADIUS}t of the settlement`);
  }

  // One world-loop step: dead mobs revive on schedule; living mobs amble a little,
  // staying on walkable ground within their wander radius of home.
  step(loop) {
    for (const m of this.list) {
      if (m.dead) {
        if (loop >= m.respawnAt) this._revive(m);
        continue;
      }
      if (rnd() < WANDER_CHANCE) {
        const nx = m.tileX + step1(), ny = m.tileY + step1();
        if (Math.abs(nx - m.homeX) <= m.wanderRadius && Math.abs(ny - m.homeY) <= m.wanderRadius
            && this.world && isWalkable(this.world, nx, ny)) {
          m.tileX = nx; m.tileY = ny;
        }
      }
    }
  }

  _revive(m) { m.dead = false; m.hp = m.maxHp; m.tileX = m.homeX; m.tileY = m.homeY; }

  // The mobs near a point — interest management so a client only receives what's
  // on (or near) its screen. Small wire shape.
  snapshotNear(cx, cy, radius) {
    const out = [];
    for (const m of this.list) {
      if (Math.abs(m.tileX - cx) > radius || Math.abs(m.tileY - cy) > radius) continue;
      out.push({
        id: m.id, name: m.name, etype: m.etype,
        x: m.tileX, y: m.tileY, hp: m.hp, maxHp: m.maxHp,
        dead: m.dead, combat: m.combat, color: m.color,
      });
    }
    return out;
  }
}

export const MOBS_RESPAWN_TICKS = RESPAWN_TICKS;
