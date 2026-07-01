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

import { Game, addItem, grantXp, countItem } from '../engine/state.js';
import { ITEMS, emptyBonuses, STAT_KEYS } from '../items/equipment.js';

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

// Flexible material matcher: {any:'log'} matches any log id, etc. Keeps the recipe
// web robust against the legacy-vs-canonical id split (logs, coal_ore, …).
function matchInput(inp, id) {
  if (inp.id) return inp.id === id;
  if (inp.any === 'log') return /log/.test(id);
  if (inp.any === 'bar') return /_bar$/.test(id);
  if (inp.any === 'coal') return /coal/.test(id);
  return false;
}
export function countMaterial(inp) {
  if (inp.id) return countItem(inp.id);
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
recipe('blackpowder',{ output: 'blackpowder', outQty: 3, level: 12, xp: 24, inputs: [{ id: 'charcoal', qty: 2 }, { any: 'coal', qty: 1 }] });
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
recipe('detonator',    { output: 'detonator',    outQty: 1, level: 28, xp: 40, inputs: [{ id: 'fuse', qty: 2 }, { id: 'blackpowder', qty: 2 }, { id: 'brass_cog', qty: 1 }] });
recipe('voltaic_cell', { output: 'voltaic_cell', outQty: 1, level: 60, xp: 90, inputs: [{ id: 'meteor_bar', qty: 1 }, { id: 'coil_spring', qty: 2 }, { id: 'machine_oil', qty: 2 }] });

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
    recipe(`make_${id}`, { output: id, outQty: 1, level: tier.level, xp: 60 + p * 40, inputs, makes: 'gadget' });
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
    recipe(`make_${id}`, { output: id, outQty: 5 + at.t, level: 1 + at.t * 8, xp: 10 + at.t * 12, inputs, makes: 'ammo' });
  }
}

// ---------------------------------------------------------------- fabrication
export function canAssemble(recipeId) {
  const r = RECIPES[recipeId];
  if (!r) return { ok: false, why: 'Unknown recipe.' };
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
