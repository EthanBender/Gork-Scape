// src/engine/state.js
// The single source of truth for game state, plus the operations that mutate
// it (XP grants, inventory, equipment). UI modules read from `Game` and
// register render hooks; engine modules call these helpers.

import {
  SKILL_NAMES, levelForXp, levelProgress, xpForLevel,
} from './skills.js';
import {
  ITEMS, EQUIP_SLOTS, makeItem, sumBonuses, emptyBonuses,
} from '../items/equipment.js';
import { combatLevel, weaponRange } from './combat.js';
import { prayerById } from './prayer.js';

export const INVENTORY_SIZE = 28;

export const Game = {
  scene: null,
  world: null,
  player: null,
  npcs: [],
  ticker: null,

  skills: {},          // name -> { xp, level }
  hitpoints: { xp: xpForLevel(10), level: 10 }, // hidden skill, 10 HP start
  hp: 10,

  inventory: new Array(INVENTORY_SIZE).fill(null),
  equipment: {},       // slot -> item | undefined
  selectedInv: null,   // selected inventory index
  groundItems: [],     // [{ id, qty, x, y, despawnAt }]

  attackStyle: 'Aggressive',
  location: 'Goblin Settlement',

  // Prayer: points (spent by active prayers) cap at the Prayer level. See prayer.js.
  prayerPoints: 1,
  maxPrayer: 1,
  activePrayers: [],   // ids of currently-active prayers

  logLines: [],
  ui: {},              // render hooks installed by panels.js

  // ---- logging ----
  log(msg) {
    this.logLines.push(msg);
    if (this.logLines.length > 200) this.logLines.shift();
    if (this.ui.appendLog) this.ui.appendLog(msg);
  },

  refresh() {
    const u = this.ui;
    u.renderSkills && u.renderSkills();
    u.renderInventory && u.renderInventory();
    u.renderEquipment && u.renderEquipment();
    u.renderCombat && u.renderCombat();
    u.renderTopBar && u.renderTopBar();
    u.renderStations && u.renderStations();
    u.renderGrandExchange && u.renderGrandExchange();
    u.renderShop && u.renderShop();
  },
};

export function initState() {
  Game.skills = {};
  for (const name of SKILL_NAMES) {
    // Combat skills start at level 1 (xp 0). Everything starts at 1.
    Game.skills[name] = { xp: 0, level: 1 };
  }
  Game.hitpoints = { xp: xpForLevel(10), level: 10 };
  Game.maxHp = 10;
  Game.hp = 10;
  Game.maxPrayer = Game.skills.Prayer ? Game.skills.Prayer.level : 1;
  Game.prayerPoints = Game.maxPrayer;
  Game.activePrayers = [];
  Game.inventory = new Array(INVENTORY_SIZE).fill(null);
  Game.equipment = {};
  Game.selectedInv = null;
  Game.groundItems = [];
}

// ---- XP / levelling ----
export function grantXp(skillName, amount) {
  const sk = (skillName === 'Hitpoints') ? Game.hitpoints : Game.skills[skillName];
  if (!sk) return;
  const before = sk.level;
  sk.xp += amount;
  sk.level = levelForXp(sk.xp);
  const leveled = sk.level > before;
  if (leveled) {
    if (skillName === 'Hitpoints') {
      Game.maxHp = sk.level;
      Game.hp += (sk.level - before); // heal the gained hp
      Game.log(`Your Hitpoints level is now ${sk.level}.`);
    } else {
      if (skillName === 'Prayer') Game.maxPrayer = sk.level; // more prayer points
      Game.log(`Congratulations! Your ${skillName} level is now ${sk.level}.`);
    }
  }
  // UI flourish hook (xp drops + level-up banner); registered by panels.js.
  if (Game.ui.onXp && amount > 0) Game.ui.onXp(skillName, amount, leveled ? sk.level : 0);
}

// ---- inventory ----
export function firstFreeSlot() {
  return Game.inventory.findIndex((s) => s === null);
}

export function addItem(id, qty = 1) {
  const def = makeItem(id);
  if (def.stackable) {
    const slot = Game.inventory.find((s) => s && s.id === id);
    if (slot) { slot.qty += qty; return true; }
    const idx = firstFreeSlot();
    if (idx === -1) { Game.log("Your inventory is too full to hold any more."); return false; }
    Game.inventory[idx] = Object.assign({}, def, { qty });
    return true;
  }
  // Non-stackable: one slot per unit.
  let placed = 0;
  for (let k = 0; k < qty; k++) {
    const idx = firstFreeSlot();
    if (idx === -1) {
      if (placed === 0) Game.log("Your inventory is too full to hold any more.");
      return placed > 0;
    }
    Game.inventory[idx] = def;
    placed++;
  }
  return true;
}

// Drop an item stack onto the ground at a tile.
export function spawnGroundItem(id, qty, x, y, tick, despawn = 300) {
  Game.groundItems.push({ id, qty, x, y, despawnAt: tick + despawn });
}

// Pick up the ground stacks on a tile into the inventory. Items that don't fit
// stay on the ground (addItem logs the "too full" message). Returns count taken.
export function pickupGroundAt(x, y) {
  const here = Game.groundItems.filter((g) => g.x === x && g.y === y);
  if (here.length === 0) return 0;
  let taken = 0;
  const stayed = [];
  for (const g of here) {
    const def = ITEMS[g.id];
    if (addItem(g.id, g.qty)) {
      Game.log(`You pick up ${g.qty > 1 ? g.qty + ' ' : ''}${def.name}.`);
      taken++;
    } else {
      stayed.push(g); // didn't fit — leave it where it is
    }
  }
  Game.groundItems = Game.groundItems
    .filter((g) => !(g.x === x && g.y === y))
    .concat(stayed);
  return taken;
}

export function countItem(id) {
  return Game.inventory.reduce((n, s) => n + (s && s.id === id ? 1 : 0), 0);
}

export function removeOneById(id) {
  const idx = Game.inventory.findIndex((s) => s && s.id === id);
  if (idx === -1) return false;
  Game.inventory[idx] = null;
  if (Game.selectedInv === idx) Game.selectedInv = null;
  return true;
}

export function removeAt(idx) {
  Game.inventory[idx] = null;
  if (Game.selectedInv === idx) Game.selectedInv = null;
}

// ---- equipment ----
export function equipItem(index) {
  const item = Game.inventory[index];
  if (!item || !item.slot) return;
  const slot = item.slot;

  // Pull the item out of the inventory slot first.
  Game.inventory[index] = null;
  Game.selectedInv = null;

  const toReturn = [];
  if (item.twoHanded) {
    // 2h weapon takes `weapon` and frees `shield`.
    if (Game.equipment.weapon) toReturn.push(Game.equipment.weapon);
    if (Game.equipment.shield) toReturn.push(Game.equipment.shield);
    Game.equipment.weapon = item;
    Game.equipment.shield = undefined;
  } else {
    if (slot === 'shield' && Game.equipment.weapon && Game.equipment.weapon.twoHanded) {
      // Equipping a shield removes the 2h weapon.
      toReturn.push(Game.equipment.weapon);
      Game.equipment.weapon = undefined;
    }
    if (Game.equipment[slot]) toReturn.push(Game.equipment[slot]);
    Game.equipment[slot] = item;
  }

  // Return displaced items to the inventory (the freed `index` is available).
  for (const it of toReturn) {
    const free = firstFreeSlot();
    if (free !== -1) Game.inventory[free] = it;
  }
  Game.log(`You equip the ${item.name}.`);
}

export function unequipItem(slot) {
  const item = Game.equipment[slot];
  if (!item) return;
  const free = firstFreeSlot();
  if (free === -1) {
    Game.log("Your inventory is too full to unequip that.");
    return;
  }
  Game.inventory[free] = item;
  Game.equipment[slot] = undefined;
  Game.log(`You remove the ${item.name}.`);
}

export function totalBonuses() {
  return sumBonuses(Game.equipment);
}

// Player's raw (un-prayer-boosted) combat levels — used for combat-level display.
function rawCombatLevels() {
  return {
    attack: Game.skills.Attack.level,
    strength: Game.skills.Strength.level,
    defence: Game.skills.Defence.level,
    ranged: Game.skills.Ranged.level,
    hitpoints: Game.hitpoints.level,
  };
}

// Build the combat profile used by combat.js for the player. Active prayers
// raise the *effective* levels (exactly like OSRS boost prayers), so accuracy,
// max hit and defence all scale with what you have switched on.
export function playerProfile() {
  const weapon = Game.equipment.weapon;
  const lv = rawCombatLevels();
  return {
    levels: {
      attack: Math.floor(lv.attack * prayerBoost('attack')),
      strength: Math.floor(lv.strength * prayerBoost('strength')),
      defence: Math.floor(lv.defence * prayerBoost('defence')),
      ranged: Math.floor(lv.ranged * prayerBoost('ranged')),
      hitpoints: lv.hitpoints,
    },
    bonuses: totalBonuses(),
    weaponType: weapon ? weapon.weaponType : 'crush',
    style: Game.attackStyle,
  };
}

export function playerCombatLevel() {
  return combatLevel(rawCombatLevels());
}

// ---- prayer ----
export function prayerLevel() {
  return Game.skills.Prayer ? Game.skills.Prayer.level : 1;
}

// Toggle a prayer on/off, honouring the level requirement and available points.
export function togglePrayer(id) {
  const pr = prayerById(id);
  if (!pr) return;
  const i = Game.activePrayers.indexOf(id);
  if (i >= 0) { Game.activePrayers.splice(i, 1); return; }
  if (prayerLevel() < pr.level) { Game.log(`You need Prayer level ${pr.level} for ${pr.name}.`); return; }
  if (Game.prayerPoints <= 0) { Game.log('You have run out of prayer points.'); return; }
  Game.activePrayers.push(id);
}

// Best active multiplier for a given combat stat (prayers of a type don't stack).
export function prayerBoost(stat) {
  let m = 1;
  for (const id of Game.activePrayers) {
    const pr = prayerById(id);
    if (pr && pr.boost && pr.boost[stat]) m = Math.max(m, pr.boost[stat]);
  }
  return m;
}

// Is a protection prayer for `style` ('melee' | 'ranged' | 'magic') active?
export function isProtecting(style) {
  return Game.activePrayers.some((id) => {
    const pr = prayerById(id);
    return pr && pr.protect === style;
  });
}

// Spend prayer points for one tick of every active prayer; drop them all if we
// run dry. Called once per game tick from main.js.
export function drainPrayer() {
  if (!Game.activePrayers.length) return;
  let d = 0;
  for (const id of Game.activePrayers) { const pr = prayerById(id); if (pr) d += pr.drain || 0; }
  Game.prayerPoints -= d;
  if (Game.prayerPoints <= 0) {
    Game.prayerPoints = 0;
    Game.activePrayers = [];
    Game.log('You have run out of prayer points.');
  }
}

// Recharge to full (altars, death).
export function restorePrayer() {
  Game.prayerPoints = Game.maxPrayer;
}

// How many tiles away the player can currently attack from — driven by the
// equipped weapon (melee 1, ranged 4, or the weapon's own attackRange).
export function playerAttackRange() {
  return weaponRange(Game.equipment.weapon);
}

// ---- ammunition (ranged only) ----
// Melee never needs ammo. A ranged weapon needs a non-empty stack in the `ammo`
// slot; running dry stops the attack (see main.js tick).
export function needsAmmo() {
  const w = Game.equipment.weapon;
  return !!(w && w.weaponType === 'ranged');
}

export function ammoCount() {
  const a = Game.equipment.ammo;
  if (!a) return 0;
  return a.qty === undefined ? 1 : a.qty;
}

export function hasAmmoForRanged() {
  return !needsAmmo() || ammoCount() > 0;
}

// Spend one unit of equipped ammo; clears the slot when the stack empties.
export function consumeAmmo() {
  const a = Game.equipment.ammo;
  if (!a) return;
  if (a.qty === undefined) { Game.equipment.ammo = undefined; return; }
  a.qty -= 1;
  if (a.qty <= 0) Game.equipment.ammo = undefined;
}

// Chance a fired arrow lands recoverable on the ground (rather than breaking or
// being lost), scaling with Ranged level: ~55% at level 1 → ~90% at level 99.
// A higher-level archer recovers a larger portion of their shots.
export function ammoRecoveryChance() {
  const lvl = Game.skills.Ranged ? Game.skills.Ranged.level : 1;
  const clamped = Math.min(99, Math.max(1, lvl));
  return 0.55 + 0.35 * ((clamped - 1) / 98);
}

export { EQUIP_SLOTS, ITEMS, emptyBonuses, levelProgress };
