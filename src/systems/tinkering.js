// src/systems/tinkering.js
// TINKERING — the goblin "sapper" third combat style. NOT magic: you build
// machines that explode. This module is the economy/items lane, self-contained
// like alchemy.js: it GENERATES its whole item catalogue (gadgets, ammo,
// components, raw materials) and injects them into the shared ITEMS registry at
// import time, holds its own cross-skill recipe web, does fabrication (spending
// materials sourced from Woodcutting / Mining / Smithing / Firemaking / Crafting),
// and provides the combat resolver for `weaponType: 'tinker'`.
//
// Design + the full cross-skill web: docs/TINKERING_DESIGN.md.
//
// Cross-pollination is the point: no gadget can be built without touching several
// other skills. Fabrication grants Tinkering XP; so does dealing gadget damage.

import { Game, addItem, grantXp, countItem, removeOneById } from '../engine/state.js';
import { ITEMS, emptyBonuses, STAT_KEYS } from '../items/equipment.js';
import { hasUnlock } from './quests.js';

const SKILL = 'Tinkering';

// ---------------------------------------------------------------- ladders
// Power tiers (index = power). `bar` is the existing Smithing bar this tier is
// built around — that's the Mining→Smithing spine of the recipe web.
export const TIERS = [
  { id: 'scrapwork',   name: 'Scrapwork',   level: 1,  color: 0x8a7f70, bar: null },
  { id: 'copperclock', name: 'Copperclock', level: 8,  color: 0xb87333, bar: 'bronze_bar' },
  { id: 'bronzegear',  name: 'Bronzegear',  level: 18, color: 0xcd7f32, bar: 'bronze_bar' },
  { id: 'ironpress',   name: 'Ironpress',   level: 30, color: 0x9a9a9a, bar: 'iron_bar' },
  { id: 'steelsteam',  name: 'Steelsteam',  level: 42, color: 0xc9c9d0, bar: 'steel_bar' },
  { id: 'blackpowder', name: 'Blackpowder', level: 55, color: 0x33333c, bar: 'black_iron_bar' },
  { id: 'voltaic',     name: 'Voltaic',     level: 70, color: 0x6a5acf, bar: 'meteor_bar' },
];

// Gadget archetypes. `effect` drives the combat resolver (see resolveTinker):
//   splash — fraction of the hit dealt to each foe adjacent to the target (AoE)
//   pierce — fraction of the target's armour ignored (anti-tank)
//   hits   — number of small hits (rapid)
//   burn   — damage-over-time ticks applied to the target
//   chain  — extra nearby targets the shot arcs to
//   snare  — briefly roots the target (area denial)
export const CLASSES = [
  { id: 'bombard', name: 'Bombard',       speed: 5, range: 5, ammo: 'bomb', atkB: 2, atkS: 3, strB: 5, strS: 6, effect: { splash: 0.5 },                  blurb: 'Lobs bombs — splash damage to everything around the target.' },
  { id: 'cannon',  name: 'Hand Cannon',   speed: 6, range: 6, ammo: 'slug', atkB: 3, atkS: 4, strB: 5, strS: 6, effect: { armorPierce: 0.5 },            blurb: 'A single armour-piercing slug. Wrecks heavy armour.' },
  { id: 'spitter', name: 'Dart Spitter',  speed: 2, range: 4, ammo: 'dart', atkB: 4, atkS: 4, strB: 1, strS: 3, effect: { hits: 2 },                      blurb: 'Rapid spring-fed darts. Out-DPS on lightly armoured foes.' },
  { id: 'bellows', name: 'Flame Bellows', speed: 4, range: 3, ammo: 'fuel', atkB: 2, atkS: 3, strB: 3, strS: 4, effect: { burn: 3 },                      blurb: 'A short cone of flame that keeps burning for several ticks.' },
  { id: 'trapper', name: 'Trap Launcher', speed: 6, range: 3, ammo: 'trap', atkB: 2, atkS: 3, strB: 4, strS: 5, effect: { snare: true, armorPierce: 0.2 }, blurb: 'Fires spring-traps that bite and briefly root the target.' },
  { id: 'tesla',   name: 'Tesla Coil',    speed: 4, range: 5, ammo: 'cell', atkB: 3, atkS: 4, strB: 3, strS: 4, effect: { chain: 1, armorPierce: 0.35 },  blurb: 'Arcs lightning to a second nearby foe, ignoring some armour.' },
];

// Ammo families: id prefix, display noun, and the per-tier tinker_str it adds.
const AMMO_FAMILIES = [
  { fam: 'bomb', noun: 'Bomb',      strB: 3, strS: 3 },
  { fam: 'slug', noun: 'Slug',      strB: 3, strS: 3 },
  { fam: 'dart', noun: 'Dart',      strB: 2, strS: 2 },
  { fam: 'fuel', noun: 'Canister',  strB: 3, strS: 3 },
  { fam: 'trap', noun: 'Trap',      strB: 3, strS: 3 },
  { fam: 'cell', noun: 'Cell',      strB: 4, strS: 3 },
];
const AMMO_TIERS = [
  { id: 'crude',    name: 'Crude',    t: 0 },
  { id: 'standard', name: 'Standard', t: 2 },
  { id: 'refined',  name: 'Refined',  t: 4 },
  { id: 'volatile', name: 'Volatile', t: 6 },
];

// ---------------------------------------------------------------- registry
export const TINKER_ITEMS = {};
const RECIPES = {}; // id -> { output, outQty, level, xp, inputs:[{id|any, qty}], makes }

function reg(id, def) {
  TINKER_ITEMS[id] = { id, ...def };
  if (!ITEMS[id]) ITEMS[id] = { id, bonuses: emptyBonuses(), ...def };
}
function recipe(id, r) { RECIPES[id] = { id, skill: SKILL, ...r }; }

// bonus object with only the given keys set (validates against STAT_KEYS)
function bonusOf(partial) {
  const b = emptyBonuses();
  for (const k of Object.keys(partial)) if (STAT_KEYS.includes(k)) b[k] = partial[k];
  return b;
}

// ---- raw materials & processed intermediates (the cross-skill inputs) ----
// Obtainable now from existing skills; world-gen will later add saltpeter/
// sulfur/sparkstone nodes for a deeper raw tree (see design doc).
const MATERIALS = {
  charcoal:     { name: 'Charcoal',       color: 0x2a2a2a, value: 6 },
  blackpowder:  { name: 'Blackpowder',    color: 0x1c1c22, value: 30 },
  scrap_metal:  { name: 'Scrap Metal',    color: 0x777066, value: 8 },
  machine_oil:  { name: 'Machine Oil',    color: 0x6a5a2a, value: 12 },
  // raw gatherables (from the world nodes — the cross-skill sources)
  saltpeter:    { name: 'Saltpeter',      color: 0xd8d0b8, value: 10 },
  sulfur:       { name: 'Sulfur',         color: 0xd8c84a, value: 10 },
  tree_resin:   { name: 'Tree Resin',     color: 0xc98a3a, value: 8 },
  sparkstone:   { name: 'Sparkstone',     color: 0x6a8acf, value: 45 },
  // minerals
  quicksilver:  { name: 'Quicksilver',    color: 0xc0c4cc, value: 30 },
  flux_stone:   { name: 'Flux Stone',     color: 0xcabf8a, value: 14 },
  chalk:        { name: 'Chalk',          color: 0xe8e4d8, value: 6 },
  lodestone:    { name: 'Lodestone',      color: 0x4a4a5a, value: 26 },
  oilsand:      { name: 'Oilsand',        color: 0x6a5a3a, value: 12 },
  obsidian_shard: { name: 'Obsidian Shard', color: 0x1c1c22, value: 40 },
  ember_glass:  { name: 'Ember Glass',    color: 0xd05a2a, value: 55 },
  // botanical
  rubber_sap:   { name: 'Rubber Sap',     color: 0x8a6a4a, value: 12 },
  gall_nut:     { name: 'Gall Nut',       color: 0x7a5a3a, value: 14 },
  amber:        { name: 'Amber',          color: 0xd8a63a, value: 35 },
  cork_bark:    { name: 'Cork Bark',      color: 0xb08a5a, value: 9 },
  fungal_rubber:{ name: 'Fungal Rubber',  color: 0x9a7aaa, value: 18 },
  pitch:        { name: 'Pitch',          color: 0x2a221a, value: 10 },
  tar:          { name: 'Tar',            color: 0x201812, value: 10 },
  // monster-derived (drops)
  spark_gland:  { name: 'Spark Gland',    color: 0x8ac0e0, value: 40 },
  oil_sac:      { name: 'Oil Sac',        color: 0x6a5a2a, value: 22 },
  powder_gland: { name: 'Powder Gland',   color: 0x4a4a52, value: 45 },
  sinew:        { name: 'Sinew',          color: 0xc9a98a, value: 16 },
  chitin_plate: { name: 'Chitin Plate',   color: 0x7a6a4a, value: 30 },
  troll_grease: { name: 'Troll Grease',   color: 0x8a9a6a, value: 38 },
  bog_gas_bladder: { name: 'Bog-Gas Bladder', color: 0x7a9a5a, value: 34 },
  ember_heart:  { name: 'Ember Heart',    color: 0xe04a2a, value: 90 },
  // processed chemicals / precision components
  nitro_paste:  { name: 'Nitro Paste',    color: 0xc9b46a, value: 60 },
  incendiary_gel: { name: 'Incendiary Gel', color: 0xd8642a, value: 55 },
  acid_vial:    { name: 'Acid Vial',      color: 0x9ad04a, value: 50 },
  coolant:      { name: 'Coolant',        color: 0x5ac0d0, value: 34 },
  flux_paste:   { name: 'Flux Paste',     color: 0xcabf8a, value: 22 },
  conductive_gel: { name: 'Conductive Gel', color: 0x6acfaa, value: 44 },
  firing_pin:   { name: 'Firing Pin',     color: 0xb0b0b8, value: 30 },
  breech:       { name: 'Breech Block',   color: 0x8a8a94, value: 60 },
  flywheel:     { name: 'Flywheel',       color: 0xa0a0aa, value: 48 },
  capacitor:    { name: 'Capacitor',      color: 0x6a5acf, value: 70 },
  ignition_coil:{ name: 'Ignition Coil',  color: 0xc9a24a, value: 55 },
  pressure_valve: { name: 'Pressure Valve', color: 0x9aa0a8, value: 52 },
  // components
  metal_casing: { name: 'Metal Casing',   color: 0xa08050, value: 20 },
  iron_barrel:  { name: 'Iron Barrel',    color: 0x8a8a94, value: 40 },
  coil_spring:  { name: 'Coil Spring',    color: 0xc0c0c0, value: 18 },
  brass_cog:    { name: 'Brass Cog',      color: 0xc9a24a, value: 16 },
  steam_piston: { name: 'Steam Piston',   color: 0x9aa0a8, value: 55 },
  hardwood_stock: { name: 'Hardwood Stock', color: 0x7a5a2a, value: 22 },
  leather_grip: { name: 'Leather Grip',   color: 0x6a4a2a, value: 14 },
  fuse:         { name: 'Fuse',           color: 0xd0b070, value: 6 },
  trigger_assembly: { name: 'Trigger Assembly', color: 0xb0b0b0, value: 45 },
  detonator:    { name: 'Detonator',      color: 0xc94a3a, value: 60 },
  voltaic_cell: { name: 'Voltaic Cell',   color: 0x6a5acf, value: 120 },
};
for (const [id, d] of Object.entries(MATERIALS)) {
  reg(id, { slot: null, stackable: true, value: d.value, material: true, ...d });
}

// Kit tools (gather nodes require the matching `tool`) + powered out-tools that
// boost OTHER skills. Non-stackable; sit in the inventory. gathering.hasTool reads
// the `tool` property. Out-tools' effects are applied where those skills resolve.
const TOOL_ITEMS = {
  rusty_wrench:    { name: 'Rusty Wrench',       color: 0x8a7a5a, tool: 'scavenge', value: 20 },
  gum_tap:         { name: 'Gum Tap',            color: 0x9a7a4a, tool: 'tap',      value: 25 },
  chem_kit:        { name: 'Chemistry Kit',      color: 0x6aa06a, tool: 'chem_kit', value: 60 },
  heat_tongs:      { name: 'Heat Tongs',         color: 0xc25a3a, tool: 'heat_tongs', value: 70 },
  prospector_lens: { name: "Prospector's Lens",  color: 0xc9b45a, tool: 'prospect',    value: 240, boosts: 'mining' },
  clockwork_hatchet: { name: 'Clockwork Hatchet', color: 0xb0894a, tool: 'woodcutting', value: 260, boosts: 'woodcutting' },
  powered_pickaxe: { name: 'Powered Pickaxe',    color: 0x9a9aa8, tool: 'mining',       value: 280, boosts: 'mining' },
};
for (const [id, d] of Object.entries(TOOL_ITEMS)) {
  reg(id, { slot: null, stackable: false, value: d.value, tinkerTool: true, ...d });
}
export const OUT_TOOLS = TOOL_ITEMS;

// ---- gadget mods / attachments ----
// Installed into the rig (Game.gadgetMods, capped at MOD_SLOTS); each merges its
// `effectMod` into whatever tinker gadget you wield (see effectiveGadgetEffect).
export const MOD_SLOTS = 3;
const MODS = {
  mod_scope:        { name: 'Precision Scope',    value: 120, effectMod: { accuracyMult: 1.15 }, blurb: '+15% accuracy' },
  mod_ap_core:      { name: 'AP Core',            value: 160, effectMod: { armorPierce: 0.25 },  blurb: '+25% armour pierce' },
  mod_overclock:    { name: 'Overclock Chip',     value: 200, effectMod: { damageMult: 1.2 },    blurb: '+20% damage' },
  mod_incendiary:   { name: 'Incendiary Rounds',  value: 140, effectMod: { burn: 2 },            blurb: 'adds a 2-tick burn' },
  mod_blast_funnel: { name: 'Blast Funnel',       value: 150, effectMod: { splash: 0.2 },        blurb: '+20% splash' },
  mod_shock_cap:    { name: 'Shock Capacitor',    value: 220, effectMod: { chain: 1 },           blurb: 'arcs to +1 target' },
  mod_extended_mag: { name: 'Extended Magazine',  value: 130, effectMod: { hits: 1 },            blurb: '+1 hit per attack' },
  mod_recoil_damper:{ name: 'Recoil Damper',      value: 110, effectMod: { accuracyMult: 1.1 },  blurb: '+10% accuracy' },
  mod_snare_barbs:  { name: 'Snare Barbs',        value: 120, effectMod: { snare: true },        blurb: 'roots the target' },
  mod_cryo_tip:     { name: 'Cryo Tip',           value: 170, effectMod: { armorPierce: 0.15, damageMult: 1.1 }, blurb: '+15% pierce, +10% dmg' },
};
for (const [id, d] of Object.entries(MODS)) {
  reg(id, { slot: null, stackable: false, value: d.value, gadgetMod: true, ...d });
}
export function modInfo(id) { return MODS[id] || null; }
export const MOD_IDS = Object.keys(MODS);

// Merge an equipped gadget's base effect with every installed mod's effectMod.
export function effectiveGadgetEffect(weapon) {
  if (!weapon || weapon.weaponType !== 'tinker') return null;
  const eff = { ...(weapon.effect || {}) };
  for (const id of (Game.gadgetMods || [])) {
    const m = MODS[id]; if (!m) continue;
    const em = m.effectMod;
    if (em.accuracyMult) eff.accuracyMult = (eff.accuracyMult || 1) * em.accuracyMult;
    if (em.damageMult) eff.damageMult = (eff.damageMult || 1) * em.damageMult;
    if (em.armorPierce) eff.armorPierce = Math.min(0.9, (eff.armorPierce || 0) + em.armorPierce);
    if (em.splash) eff.splash = Math.min(1, (eff.splash || 0) + em.splash);
    if (em.burn) eff.burn = (eff.burn || 0) + em.burn;
    if (em.chain) eff.chain = (eff.chain || 0) + em.chain;
    if (em.hits) eff.hits = (eff.hits || 1) + em.hits;
    if (em.snare) eff.snare = true;
  }
  return eff;
}

// Install a mod from the inventory into a free rig slot (consumes the item).
export function installMod(id) {
  if (!MODS[id]) return false;
  if ((Game.gadgetMods || []).length >= MOD_SLOTS) { Game.log(`Your rig is full (${MOD_SLOTS} mod slots). Remove one first.`); return false; }
  if (Game.gadgetMods.includes(id)) { Game.log('That mod is already installed.'); return false; }
  if (!countItem(id)) { Game.log(`You have no ${MODS[id].name} to install.`); return false; }
  removeOneById(id);
  Game.gadgetMods.push(id);
  Game.log(`You install the ${MODS[id].name} onto your rig.`);
  return true;
}
// Remove an installed mod back to the inventory.
export function uninstallMod(id) {
  const i = (Game.gadgetMods || []).indexOf(id);
  if (i < 0) return false;
  Game.gadgetMods.splice(i, 1);
  addItem(id);
  Game.log(`You remove the ${MODS[id].name} from your rig.`);
  return true;
}

// Flexible material matcher: {any:'log'} matches any log id, etc. Keeps the recipe
// web robust against the legacy-vs-canonical id split (logs, coal_ore, …).
function matchInput(inp, id) {
  if (inp.id) return inp.id === id;
  if (inp.any === 'log') return /(^|_)logs?$/.test(id);
  if (inp.any === 'bar') return /_bar$/.test(id);
  if (inp.any === 'coal') return id === 'coal' || id === 'coal_ore'; // NOT "charcoal"
  return false;
}
// Total UNITS held (sums stack quantities — not slots) matching a recipe input.
export function countMaterial(inp) {
  return Game.inventory.reduce((n, s) => n + (s && matchInput(inp, s.id) ? (s.qty || 1) : 0), 0);
}
function spendMaterial(inp, qty) {
  let need = qty;
  for (let i = 0; i < Game.inventory.length && need > 0; i++) {
    const s = Game.inventory[i];
    if (!s || !matchInput(inp, s.id)) continue;
    if (s.stackable) {
      const take = Math.min(need, s.qty || 1); s.qty -= take; need -= take;
      if (s.qty <= 0) Game.inventory[i] = null;
    } else { Game.inventory[i] = null; need -= 1; }
  }
  return need === 0;
}

// ---- foundational processing recipes (each pulls from another skill) ----
recipe('char_log',   { output: 'charcoal',    outQty: 2, level: 1,  xp: 8,  inputs: [{ any: 'log', qty: 1 }] });                       // Woodcutting/Firemaking
recipe('mill_scrap', { output: 'scrap_metal', outQty: 3, level: 3,  xp: 10, inputs: [{ any: 'bar', qty: 1 }] });                        // Mining/Smithing
// Real gunpowder = saltpeter + sulfur + charcoal (mine the first two, char the
// third). This ties blackpowder — the keystone consumable — to Mining + Firemaking.
recipe('blackpowder',{ output: 'blackpowder', outQty: 3, level: 3, xp: 24, unlock: 'tinkering_powder', inputs: [{ id: 'saltpeter', qty: 1 }, { id: 'sulfur', qty: 1 }, { id: 'charcoal', qty: 1 }] });
// Kit tools (unlock gathering) + powered out-tools (boost other skills).
recipe('rusty_wrench',    { output: 'rusty_wrench',    outQty: 1, level: 1,  xp: 15, inputs: [{ any: 'bar', qty: 1 }, { id: 'scrap_metal', qty: 2 }] });
recipe('gum_tap',         { output: 'gum_tap',         outQty: 1, level: 6,  xp: 20, inputs: [{ any: 'bar', qty: 1 }, { any: 'log', qty: 1 }] });
recipe('chem_kit',        { output: 'chem_kit',        outQty: 1, level: 18, xp: 45, inputs: [{ id: 'metal_casing', qty: 2 }, { id: 'brass_cog', qty: 1 }, { id: 'machine_oil', qty: 1 }] });
recipe('heat_tongs',      { output: 'heat_tongs',      outQty: 1, level: 30, xp: 55, inputs: [{ id: 'steel_bar', qty: 1 }, { id: 'leather_grip', qty: 1 }] });
recipe('prospector_lens', { output: 'prospector_lens', outQty: 1, level: 35, xp: 130, unlock: 'tinkering_tools', inputs: [{ id: 'sparkstone', qty: 1 }, { id: 'brass_cog', qty: 2 }, { any: 'bar', qty: 2 }] });
recipe('clockwork_hatchet', { output: 'clockwork_hatchet', outQty: 1, level: 40, xp: 160, unlock: 'tinkering_tools', inputs: [{ id: 'steam_piston', qty: 1 }, { id: 'coil_spring', qty: 2 }, { any: 'log', qty: 3 }] });
recipe('powered_pickaxe', { output: 'powered_pickaxe', outQty: 1, level: 45, xp: 180, unlock: 'tinkering_tools', inputs: [{ id: 'steam_piston', qty: 1 }, { id: 'metal_casing', qty: 2 }, { id: 'sparkstone', qty: 1 }] });
// Processed chemicals + precision components (deepen the crafting web off the new raws).
recipe('nitro_paste',    { output: 'nitro_paste',    outQty: 2, level: 22, xp: 40, unlock: 'tinkering_powder', inputs: [{ id: 'saltpeter', qty: 2 }, { id: 'machine_oil', qty: 1 }, { id: 'sulfur', qty: 1 }] });
recipe('incendiary_gel', { output: 'incendiary_gel', outQty: 2, level: 18, xp: 32, inputs: [{ id: 'pitch', qty: 1 }, { id: 'sulfur', qty: 1 }, { id: 'machine_oil', qty: 1 }] });
recipe('acid_vial',      { output: 'acid_vial',      outQty: 2, level: 16, xp: 28, inputs: [{ id: 'gall_nut', qty: 2 }, { id: 'sulfur', qty: 1 }] });
recipe('coolant',        { output: 'coolant',        outQty: 2, level: 24, xp: 30, inputs: [{ id: 'quicksilver', qty: 1 }, { id: 'machine_oil', qty: 1 }] });
recipe('flux_paste',     { output: 'flux_paste',     outQty: 3, level: 10, xp: 16, inputs: [{ id: 'flux_stone', qty: 2 }, { id: 'chalk', qty: 1 }] });
recipe('conductive_gel', { output: 'conductive_gel', outQty: 2, level: 40, xp: 60, inputs: [{ id: 'sparkstone', qty: 1 }, { id: 'quicksilver', qty: 1 }] });
recipe('firing_pin',     { output: 'firing_pin',     outQty: 2, level: 14, xp: 20, inputs: [{ any: 'bar', qty: 1 }, { id: 'brass_cog', qty: 1 }] });
recipe('breech',         { output: 'breech',         outQty: 1, level: 34, xp: 48, inputs: [{ id: 'steel_bar', qty: 2 }, { id: 'coil_spring', qty: 1 }] });
recipe('flywheel',       { output: 'flywheel',       outQty: 1, level: 26, xp: 34, inputs: [{ any: 'bar', qty: 2 }, { id: 'brass_cog', qty: 2 }] });
recipe('capacitor',      { output: 'capacitor',      outQty: 1, level: 52, xp: 80, unlock: 'tinkering_voltaic', inputs: [{ id: 'sparkstone', qty: 1 }, { id: 'conductive_gel', qty: 1 }, { id: 'metal_casing', qty: 1 }] });
recipe('ignition_coil',  { output: 'ignition_coil',  outQty: 1, level: 44, xp: 62, inputs: [{ id: 'lodestone', qty: 1 }, { id: 'conductive_gel', qty: 1 }] });
recipe('pressure_valve', { output: 'pressure_valve', outQty: 1, level: 36, xp: 50, inputs: [{ id: 'steel_bar', qty: 1 }, { id: 'coolant', qty: 1 }, { id: 'coil_spring', qty: 1 }] });
recipe('metal_casing', { output: 'metal_casing', outQty: 2, level: 6,  xp: 14, inputs: [{ any: 'bar', qty: 1 }] });
recipe('iron_barrel',  { output: 'iron_barrel',  outQty: 1, level: 15, xp: 30, inputs: [{ id: 'iron_bar', qty: 2 }] });
recipe('coil_spring',  { output: 'coil_spring',  outQty: 2, level: 10, xp: 16, inputs: [{ any: 'bar', qty: 1 }, { id: 'scrap_metal', qty: 1 }] });
recipe('brass_cog',    { output: 'brass_cog',    outQty: 3, level: 8,  xp: 12, inputs: [{ id: 'bronze_bar', qty: 1 }] });
recipe('steam_piston', { output: 'steam_piston', outQty: 1, level: 32, xp: 44, inputs: [{ id: 'steel_bar', qty: 1 }, { id: 'coil_spring', qty: 1 }, { id: 'machine_oil', qty: 1 }] });
recipe('hardwood_stock', { output: 'hardwood_stock', outQty: 1, level: 5,  xp: 12, inputs: [{ any: 'log', qty: 2 }] });                 // Woodcutting
recipe('leather_grip', { output: 'leather_grip', outQty: 1, level: 4,  xp: 8,  inputs: [{ id: 'torn_hide', qty: 1 }] });               // Crafting/combat drop
recipe('fuse',         { output: 'fuse',         outQty: 4, level: 4,  xp: 6,  inputs: [{ any: 'log', qty: 1 }, { id: 'blackpowder', qty: 1 }] });
recipe('machine_oil',  { output: 'machine_oil',  outQty: 2, level: 7,  xp: 10, inputs: [{ id: 'scrap_metal', qty: 1 }] });
recipe('trigger_assembly', { output: 'trigger_assembly', outQty: 1, level: 20, xp: 34, inputs: [{ id: 'brass_cog', qty: 2 }, { id: 'coil_spring', qty: 1 }] });
recipe('detonator',    { output: 'detonator',    outQty: 1, level: 28, xp: 40, unlock: 'tinkering_powder', inputs: [{ id: 'fuse', qty: 2 }, { id: 'blackpowder', qty: 2 }, { id: 'brass_cog', qty: 1 }] });
recipe('voltaic_cell', { output: 'voltaic_cell', outQty: 1, level: 60, xp: 90, unlock: 'tinkering_voltaic', inputs: [{ id: 'meteor_bar', qty: 1 }, { id: 'coil_spring', qty: 2 }, { id: 'machine_oil', qty: 2 }] });

// Which quest-line unlock gates a gadget / ammo recipe (progression gating).
function gadgetUnlock(clsId, tierIdx) {
  if (tierIdx >= 6) return 'tinkering_voltaic';
  if (clsId === 'cannon') return 'tinkering_cannons';
  if (clsId === 'tesla') return 'tinkering_voltaic';
  if (clsId === 'bombard' || clsId === 'bellows') return 'tinkering_powder';
  return 'tinkering';
}
function ammoUnlock(fam) {
  if (fam === 'cell') return 'tinkering_voltaic';
  if (fam === 'bomb' || fam === 'slug') return 'tinkering_powder';
  return 'tinkering';
}

// ---------------------------------------------------------------- gadgets
// 6 classes × 7 tiers = 42 gadget weapons, generated with a recipe each.
for (const cls of CLASSES) {
  for (let p = 0; p < TIERS.length; p++) {
    const tier = TIERS[p];
    const id = `${tier.id}_${cls.id}`;
    const b = bonusOf({
      tinker_atk: Math.round(cls.atkB + p * cls.atkS),
      tinker_str: Math.round(cls.strB + p * cls.strS),
    });
    reg(id, {
      name: `${tier.name} ${cls.name}`, slot: 'weapon', twoHanded: true,
      weaponType: 'tinker', attackSpeed: cls.speed, attackRange: cls.range,
      reqSkill: SKILL, reqLevel: tier.level, tier: p, color: tier.color,
      ammo: cls.ammo, effect: { ...cls.effect }, blurb: cls.blurb, bonuses: b,
    });
    // Recipe: casing + a spine part (stock/barrel) + a mechanism + grip (+ tier bar).
    const inputs = [
      { id: 'metal_casing', qty: 1 + Math.floor(p / 2) },
      { id: 'leather_grip', qty: 1 },
    ];
    if (tier.bar) inputs.push({ id: tier.bar, qty: 1 + Math.floor(p / 3) });
    if (cls.id === 'cannon' || cls.id === 'bombard') inputs.push({ id: 'iron_barrel', qty: 1 });
    else inputs.push({ id: 'hardwood_stock', qty: 1 });
    inputs.push({ id: p >= 4 ? 'steam_piston' : 'trigger_assembly', qty: 1 });
    if (cls.id === 'tesla' || tier.id === 'voltaic') inputs.push({ id: 'voltaic_cell', qty: 1 });
    if (cls.id === 'bombard' || cls.id === 'bellows') inputs.push({ id: 'detonator', qty: 1 });
    recipe(`make_${id}`, { output: id, outQty: 1, level: tier.level, xp: 60 + p * 40, unlock: gadgetUnlock(cls.id, p), inputs, makes: 'gadget' });
  }
}

// ---------------------------------------------------------------- ammo
// 6 families × 4 tiers = 24 charges, each with its own recipe.
for (const fam of AMMO_FAMILIES) {
  for (const at of AMMO_TIERS) {
    const id = `${at.id}_${fam.fam}`;
    reg(id, {
      name: `${at.name} ${fam.noun}`, slot: 'ammo', stackable: true, ammoFamily: fam.fam,
      color: 0x9a7a4a, tinkerAmmo: true,
      bonuses: bonusOf({ tinker_str: Math.round(fam.strB + at.t * fam.strS / 2) }),
    });
    // Ammo recipes cross-reference blackpowder (bombs/slugs/traps), wood (darts),
    // oil (fuel), voltaic cells (tesla). Higher tiers cost more.
    const q = 1 + Math.floor(at.t / 2);
    let inputs;
    if (fam.fam === 'dart') inputs = [{ any: 'log', qty: 1 }, { id: 'metal_casing', qty: q }];
    else if (fam.fam === 'fuel') inputs = [{ id: 'machine_oil', qty: q }, { id: 'metal_casing', qty: 1 }];
    else if (fam.fam === 'cell') inputs = [{ id: 'voltaic_cell', qty: 1 }, { id: 'blackpowder', qty: q }];
    else inputs = [{ id: 'blackpowder', qty: q }, { id: 'metal_casing', qty: 1 }, { id: 'fuse', qty: 1 }];
    recipe(`make_${id}`, { output: id, outQty: 5 + at.t, level: 1 + at.t * 8, xp: 10 + at.t * 12, unlock: ammoUnlock(fam.fam), inputs, makes: 'ammo' });
  }
}

// ---------------------------------------------------------------- fabrication
export function canAssemble(recipeId) {
  const r = RECIPES[recipeId];
  if (!r) return { ok: false, why: 'Unknown recipe.' };
  const need = r.unlock || 'tinkering';
  if (!hasUnlock(need)) return { ok: false, why: 'Locked — advance the Tinkerer quest line.' };
  if (Game.skills[SKILL] && Game.skills[SKILL].level < r.level) return { ok: false, why: `Needs ${SKILL} ${r.level}.` };
  for (const inp of r.inputs) {
    if (countMaterial(inp) < inp.qty) {
      const nm = inp.id ? (ITEMS[inp.id] ? ITEMS[inp.id].name : inp.id) : `${inp.any}`;
      return { ok: false, why: `Need ${inp.qty}× ${nm}.` };
    }
  }
  return { ok: true };
}

// Build one batch of a recipe: spend inputs, add outputs, grant Tinkering XP.
export function assemble(recipeId) {
  const r = RECIPES[recipeId];
  const chk = canAssemble(recipeId);
  if (!chk.ok) { Game.log(chk.why); return false; }
  for (const inp of r.inputs) spendMaterial(inp, inp.qty);
  addItem(r.output, r.outQty);
  grantXp(SKILL, r.xp);
  const out = ITEMS[r.output] || { name: r.output };
  Game.log(`You assemble ${r.outQty > 1 ? r.outQty + '× ' : ''}${out.name}. (+${r.xp} ${SKILL} xp)`);
  return true;
}

// Recipes grouped for the workbench UI: components, ammo, gadgets.
export function recipeGroups() {
  const groups = { Components: [], Ammo: [], Gadgets: [] };
  for (const r of Object.values(RECIPES)) {
    const g = r.makes === 'gadget' ? 'Gadgets' : r.makes === 'ammo' ? 'Ammo' : 'Components';
    groups[g].push(r);
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.level - b.level);
  return groups;
}
export { RECIPES };

// ---------------------------------------------------------------- combat
// A tinker weapon's `effect` behaves like an always-on special (no energy). The
// pure hit resolution (pierce / rapid hits) is done by combat.resolveSpecial via
// the caller; splash/burn/chain need the world (neighbour NPCs) and are applied
// in main.js. This helper just exposes the effect + whether a shot needs ammo.
export function tinkerEffect(weapon) {
  return weapon && weapon.weaponType === 'tinker' ? (weapon.effect || {}) : null;
}
export function isTinkerWeapon(weapon) {
  return !!(weapon && weapon.weaponType === 'tinker');
}
