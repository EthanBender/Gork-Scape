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
  bank: [],            // [{ id, qty }] — each distinct item is one slot; everything stacks
  bankMax: 120,        // slot capacity; grows via buyBankSpace() (GP) or grantBankSpace() (quests)

  attackStyle: 'Aggressive',
  location: 'Goblin Settlement',

  // Prayer: points (spent by active prayers) cap at the Prayer level. See prayer.js.
  prayerPoints: 1,
  maxPrayer: 1,
  activePrayers: [],   // ids of currently-active prayers

  // Special-attack energy (0–100). Boss-forged weapons spend it for a special.
  specEnergy: 100,
  specArmed: false,    // when true, the next attack is a special

  // Feature unlocks granted by quests (e.g. 'tinkering'). A Set, re-derived from
  // completed quests on load (see quests.recomputeUnlocks) — not saved separately.
  unlocks: null,

  // Tinker gadget mods installed on the rig (ids). They merge into the equipped
  // gadget's effect in combat. Capped (see tinkering.MOD_SLOTS).
  gadgetMods: [],

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
    u.renderQuests && u.renderQuests();
    u.renderInventory && u.renderInventory();
    u.renderEquipment && u.renderEquipment();
    u.renderCombat && u.renderCombat();
    u.renderTopBar && u.renderTopBar();
    u.renderStations && u.renderStations();
    u.renderAlchemy && u.renderAlchemy();
    u.renderGrandExchange && u.renderGrandExchange();
    u.renderShop && u.renderShop();
    u.renderBank && u.renderBank(); // [economy lane] was missing -> Bank panel never rendered
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
  Game.specEnergy = 100;
  Game.specArmed = false;
  Game.unlocks = new Set();
  Game.gadgetMods = [];
  Game.inventory = new Array(INVENTORY_SIZE).fill(null);
  Game.equipment = {};
  Game.selectedInv = null;
  Game.groundItems = [];
  Game.bank = [];
  Game.bankMax = BANK_BASE_CAP;
}

// ---- bank capacity ----
// The bank starts at 120 slots (one per distinct item). Expand it two ways:
//   - buyBankSpace(): pay escalating GP at the Banker (a strong late-game coin SINK)
//   - grantBankSpace(n): a quest / reward hands out slots for free
export const BANK_BASE_CAP = 120;
export const BANK_SPACE_CHUNK = 20;          // slots per GP purchase
export const BANK_SPACE_BASE_COST = 20000;   // first upgrade cost; doubles each time

export function bankSlotsUsed() { return Game.bank.length; }
export function bankUpgradesBought() {
  return Math.max(0, Math.round(((Game.bankMax || BANK_BASE_CAP) - BANK_BASE_CAP) / BANK_SPACE_CHUNK));
}
// Cost of the NEXT +20 slots: 20k, 40k, 80k, … (doubles per purchase).
export function nextBankSpaceCost() {
  return BANK_SPACE_BASE_COST * Math.pow(2, bankUpgradesBought());
}

function invCoins() {
  return Game.inventory.reduce((n, s) => n + (s && s.id === 'coins' ? (s.qty || 1) : 0), 0);
}
function spendInvCoins(n) {
  let left = n;
  for (let i = 0; i < Game.inventory.length && left > 0; i++) {
    const s = Game.inventory[i];
    if (s && s.id === 'coins') {
      const take = Math.min(s.qty || 1, left); s.qty -= take; left -= take;
      if (s.qty <= 0) Game.inventory[i] = null;
    }
  }
  return left === 0;
}

// Buy +BANK_SPACE_CHUNK slots with coins from the inventory. Returns true on buy.
export function buyBankSpace() {
  const cost = nextBankSpaceCost();
  if (invCoins() < cost) {
    Game.log(`You need ${cost.toLocaleString()} coins (in your inventory) to buy more bank space.`);
    return false;
  }
  spendInvCoins(cost);
  Game.bankMax = (Game.bankMax || BANK_BASE_CAP) + BANK_SPACE_CHUNK;
  Game.log(`The Banker extends your vault by ${BANK_SPACE_CHUNK} slots — now ${Game.bankMax}.`);
  Game.refresh();
  return true;
}

// Grant bank slots for free (quests, achievements, event rewards).
export function grantBankSpace(n) {
  Game.bankMax = (Game.bankMax || BANK_BASE_CAP) + n;
  Game.log(`Your bank has grown by ${n} slots — now ${Game.bankMax}.`);
  return Game.bankMax;
}

// ---- banking (used at the Bank; everything stacks, storage is unlimited) ----
// Deposit from an inventory slot into the bank. Stackables move the whole stack
// (or `qty`); non-stackables move one. Coins deposit like any other item.
export function bankDeposit(invIndex, qty = Infinity) {
  const it = Game.inventory[invIndex];
  if (!it) return false;
  const amount = it.stackable ? Math.min(qty, it.qty || 1) : 1;
  let slot = Game.bank.find((b) => b.id === it.id);
  if (!slot) {
    // A new distinct item needs a free slot; existing items always stack.
    if (Game.bank.length >= (Game.bankMax || BANK_BASE_CAP)) {
      Game.log('Your bank is full. Buy more space from the Banker.');
      return false;
    }
    slot = { id: it.id, qty: 0 }; Game.bank.push(slot);
  }
  slot.qty += amount;
  if (it.stackable) { it.qty -= amount; if (it.qty <= 0) Game.inventory[invIndex] = null; }
  else Game.inventory[invIndex] = null;
  if (Game.selectedInv === invIndex && !Game.inventory[invIndex]) Game.selectedInv = null;
  return true;
}

// Deposit every inventory slot (worn equipment is untouched). QoL "bank all".
export function bankDepositAll() {
  let moved = 0;
  for (let i = 0; i < Game.inventory.length; i++) if (Game.inventory[i]) { bankDeposit(i); moved++; }
  return moved;
}

// Total units of an item currently in the inventory (stack qty for stackables,
// one per slot for non-stackables).
function heldQty(id) {
  return Game.inventory.reduce((n, s) => n + (s && s.id === id ? (s.qty || 1) : 0), 0);
}

// Withdraw up to `qty` of an item from the bank into the inventory. Only debits
// the bank by however many actually fit (addItem handles placement + "too full").
export function bankWithdraw(id, qty = 1) {
  const slot = Game.bank.find((b) => b.id === id);
  if (!slot) return false;
  const want = Math.min(qty, slot.qty);
  const before = heldQty(id);
  addItem(id, want);
  const took = heldQty(id) - before;         // how many actually landed
  slot.qty -= took;
  if (slot.qty <= 0) Game.bank = Game.bank.filter((b) => b !== slot);
  return took > 0;
}

// ---- XP / levelling ----
export function grantXp(skillName, amount) {
  const sk = (skillName === 'Hitpoints') ? Game.hitpoints : Game.skills[skillName];
  if (!sk) return;
  // [world-continuity] A live world event (e.g. 🎉 Goblin Festival) can boost XP
  // gain. Reads the runtime-exposed calendar defensively; no-op when calm or
  // before the world clock is wired.
  const ev = Game.worldEvents && Game.worldEvents.activeEvent && Game.worldEvents.activeEvent();
  const xpMult = ev && ev.effect && ev.effect.xpBonus;
  if (xpMult && xpMult > 1 && amount > 0) amount = Math.round(amount * xpMult);
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

// Ground items despawn after this many ticks. At 600ms/tick that's ~120s.
export const GROUND_DESPAWN_TICKS = 200;

// Drop an item stack onto the ground at a tile.
export function spawnGroundItem(id, qty, x, y, tick, despawn = GROUND_DESPAWN_TICKS) {
  Game.groundItems.push({ id, qty, x, y, despawnAt: tick + despawn });
}

// Pick up ONE item stack from a tile (the most-recently-dropped that fits, or a
// specific id if given). Returns true if something was taken. This is the
// "one item at a time" pickup — the player repeats to grab more, or right-clicks
// to target a specific item on a crowded tile.
export function pickupOneAt(x, y, id = null) {
  // Search newest-first so the top of the pile comes up first.
  for (let i = Game.groundItems.length - 1; i >= 0; i--) {
    const g = Game.groundItems[i];
    if (g.x !== x || g.y !== y) continue;
    if (id != null && g.id !== id) continue;
    const def = ITEMS[g.id] || { name: g.id };
    if (!addItem(g.id, g.qty)) return false; // inventory full (addItem logs it)
    Game.groundItems.splice(i, 1);
    Game.log(`You pick up ${g.qty > 1 ? g.qty + ' ' : ''}${def.name}.`);
    return true;
  }
  return false;
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
  // Level-gate: tiered weapons carry a reqSkill/reqLevel from the database.
  if (item.reqSkill && item.reqLevel) {
    const sk = Game.skills[item.reqSkill];
    if (sk && sk.level < item.reqLevel) {
      Game.log(`You need ${item.reqSkill} level ${item.reqLevel} to wield the ${item.name}.`);
      return;
    }
  }
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
    tinkering: Game.skills.Tinkering ? Game.skills.Tinkering.level : 1,
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
      tinkering: lv.tinkering,
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

// ---- special attack ----
export const SPEC_MAX = 100;
export const SPEC_REGEN = 2; // energy per tick (~full in 50 ticks / 30s)

// The equipped weapon's special-attack definition, or null.
export function weaponSpec() {
  const w = Game.equipment.weapon;
  return w && w.spec ? w.spec : null;
}

// Regenerate spec energy one tick's worth. Called from the game tick.
export function regenSpec() {
  if (Game.specEnergy < SPEC_MAX) Game.specEnergy = Math.min(SPEC_MAX, Game.specEnergy + SPEC_REGEN);
}

// Toggle "arm the special for the next attack". Validates weapon + energy.
export function toggleSpec() {
  const spec = weaponSpec();
  if (!spec) { Game.log('Your weapon has no special attack.'); Game.specArmed = false; return; }
  if (Game.specArmed) { Game.specArmed = false; return; }
  if (Game.specEnergy < spec.cost) { Game.log(`Not enough special energy (need ${spec.cost}%).`); return; }
  Game.specArmed = true;
}

// Spend energy for a special that just fired.
export function consumeSpec(cost) {
  Game.specEnergy = Math.max(0, Game.specEnergy - cost);
  Game.specArmed = false;
}

// ---- boss-weapon forging ----
// Combine a boss component (item with a `forge` descriptor) + the required bars
// at the required Smithing level into a named boss weapon. See equipment.js.
export function forgeBossWeapon(componentId) {
  const def = ITEMS[componentId];
  if (!def || !def.forge) return false;
  const f = def.forge;
  const out = ITEMS[f.into];
  if (Game.skills.Smithing.level < f.smithing) {
    Game.log(`You need Smithing ${f.smithing} to forge the ${out.name}.`); return false;
  }
  // Count total bars held (bars are stackable, so count quantities not slots).
  const bars = Game.inventory.reduce((n, s) => n + (s && s.id === f.bar ? (s.qty || 1) : 0), 0);
  if (bars < f.barQty) {
    Game.log(`You need ${f.barQty} ${ITEMS[f.bar].name} to forge the ${out.name}.`); return false;
  }
  removeOneById(componentId);
  // Consume barQty bars, decrementing stacks (works for stackable or not).
  let need = f.barQty;
  for (let i = 0; i < Game.inventory.length && need > 0; i++) {
    const s = Game.inventory[i];
    if (!s || s.id !== f.bar) continue;
    if (s.stackable) {
      const take = Math.min(need, s.qty || 1);
      s.qty -= take; need -= take;
      if (s.qty <= 0) Game.inventory[i] = null;
    } else {
      Game.inventory[i] = null; need -= 1;
    }
  }
  addItem(f.into);
  grantXp('Smithing', f.xp || 500);
  Game.log(`You forge the ${out.name}! A weapon of legend.`);
  return true;
}

// How many tiles away the player can currently attack from — driven by the
// equipped weapon (melee 1, ranged 4, or the weapon's own attackRange).
export function playerAttackRange() {
  return weaponRange(Game.equipment.weapon);
}

// ---- ammunition (ranged only) ----
// Melee never needs ammo. Ranged and tinker gadgets need a non-empty `ammo` slot;
// running dry stops the attack (see main.js tick). Tinker gadgets additionally
// require the ammo's family to match the gadget (a Bombard needs Bombs, etc.).
export function needsAmmo() {
  const w = Game.equipment.weapon;
  return !!(w && (w.weaponType === 'ranged' || w.weaponType === 'tinker'));
}

export function ammoCount() {
  const a = Game.equipment.ammo;
  if (!a) return 0;
  return a.qty === undefined ? 1 : a.qty;
}

// Does the equipped ammo fit the equipped weapon? Ranged takes any arrow-type
// ammo; a tinker gadget requires its declared `ammo` family.
export function ammoFits() {
  const w = Game.equipment.weapon;
  const a = Game.equipment.ammo;
  if (!w || !a) return false;
  if (w.weaponType === 'tinker' && w.ammo) return a.ammoFamily === w.ammo;
  return true;
}

export function hasAmmoForRanged() {
  if (!needsAmmo()) return true;
  return ammoCount() > 0 && ammoFits();
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
