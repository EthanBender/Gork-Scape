// src/world/entities.js
// Player and NPC data. Entities track both a tile position (the simulation
// truth, updated on ticks) and a pixel position (interpolated each frame for
// smooth movement).

import { TILE_SIZE } from './map.js';

function tileToPx(t) {
  return t * TILE_SIZE + TILE_SIZE / 2;
}

export class Player {
  constructor(tileX, tileY) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.px = tileToPx(tileX);
    this.py = tileToPx(tileY);
    this.path = [];           // queued [x,y] tiles to walk
    this.interactTarget = null; // a world object to skill on arrival
    this.combatTarget = null;   // an NPC to attack
    this.pickupTarget = null;   // a ground tile {x,y} to walk onto and loot
    this.travelTarget = null;   // a far destination to re-path toward each tick
    this.lastAttackTick = -99;
  }
}

export class NPC {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.type = opts.type;        // 'guard' | 'elder'
    this.tileX = opts.tileX;
    this.tileY = opts.tileY;
    this.homeX = opts.tileX;
    this.homeY = opts.tileY;
    this.px = tileToPx(opts.tileX);
    this.py = tileToPx(opts.tileY);
    this.color = opts.color;
    this.wanderRadius = opts.wanderRadius ?? 5;
    this.leashRadius = opts.leashRadius ?? (this.wanderRadius + 3);
    this.aggressive = !!opts.aggressive;   // attack on sight (off for now)
    this.aggroRange = opts.aggroRange ?? 4;
    this.combatLevel = opts.combatLevel ?? null;
    this.lootTable = opts.lootTable || null;
    this.monsterId = opts.monsterId || null; // [economy lane] database monster_id for drop tables (ID contract)
    this.dialog = opts.dialog || null;

    this.levels = opts.levels || { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 };
    this.bonuses = opts.bonuses;  // full bonus object
    this.weaponType = opts.weaponType || 'crush';
    // Optional per-enemy attack reach in tiles. Omitted -> combat.weaponRange
    // derives it from weaponType (melee 1, ranged 4).
    this.attackRange = opts.attackRange;
    this.style = 'Aggressive';
    this.attackSpeed = opts.attackSpeed ?? 3;
    this.maxHp = this.levels.hitpoints;
    this.hp = this.maxHp;
    this.dead = false;
    this.respawnAt = 0;
    this.lastAttackTick = -99;
    this.path = [];
    this.target = null;           // the player, when engaged
  }
}
