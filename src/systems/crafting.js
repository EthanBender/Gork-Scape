// src/systems/crafting.js
// Data-driven crafting: resolves recipes.json against the player's skill level,
// station, and inventory, then executes them (consume inputs, add outputs, grant
// XP). Replaces the hardcoded smelt/cook/craft branches with the design data as
// source of truth. See COORDINATION.md (economy lane).

import { GameData, parseInputs } from '../data/gameData.js';
import {
  canonicalId, ITEM_ALIASES, TOOL_TOKENS, CATEGORY_TOKENS,
} from '../data/idAliases.js';
import {
  Game, addItem, grantXp, countItem, removeOneById, firstFreeSlot,
} from '../engine/state.js';
import { EQUIP_SLOTS } from '../items/equipment.js';

// The database uses lowercase skill ids (woodcutting); the engine uses
// Capitalized names (Woodcutting). Map DB -> engine, and flag skills the current
// game doesn't train yet (farming/herblore/prayer/construction) so recipes that
// need them show as unavailable rather than crashing.
const SKILL_MAP = {
  woodcutting: 'Woodcutting', fishing: 'Fishing', mining: 'Mining',
  cooking: 'Cooking', smithing: 'Smithing', crafting: 'Crafting',
  farming: 'Farming', firemaking: 'Firemaking', alchemy: 'Alchemy', tinkering: 'Tinkering',
  attack: 'Attack', strength: 'Strength', defence: 'Defence', ranged: 'Ranged',
  hitpoints: 'Hitpoints',
};
export function engineSkill(dbSkill) { return SKILL_MAP[dbSkill] || null; }

function skillLevel(dbSkill) {
  const name = engineSkill(dbSkill);
  if (!name) return 0;                     // untrained skill -> effectively locked
  if (name === 'Hitpoints') return Game.hitpoints.level;
  return Game.skills[name] ? Game.skills[name].level : 0;
}

// Every item the player holds or wears (for tool/possession checks).
function carried() {
  return [...EQUIP_SLOTS.map((s) => Game.equipment[s]), ...Game.inventory].filter(Boolean);
}

// How many of an item id the player holds, counting its legacy alias too
// (a recipe asks for `copper_ore`; the player may carry legacy `ore`).
function heldCount(canonicalItemId) {
  let n = countItem(canonicalItemId);
  for (const [legacy, canon] of Object.entries(ITEM_ALIASES)) {
    if (canon === canonicalItemId) n += countItem(legacy);
  }
  return n;
}

// Item ids the player holds that belong to a database category/subcategory.
function categoryMembersHeld(spec) {
  const held = [];
  for (const it of Game.inventory) {
    if (!it) continue;
    const def = GameData.item(it.id);
    if (!def) continue;
    if (spec.category && def.category !== spec.category) continue;
    if (spec.subcategory && def.subcategory !== spec.subcategory) continue;
    held.push(it.id);
  }
  return held;
}

// Does the player possess a tool matching a TOOL_TOKENS value (a subcategory
// like 'Knife', or a specific id fragment like 'clay_bowl')?
function hasToolToken(spec) {
  return carried().some((it) => {
    if (it.id === spec || it.id.endsWith('_' + spec) || it.id.includes(spec)) return true;
    const def = GameData.item(it.id);
    return def && def.subcategory === spec;
  });
}

// Classify one recipe input token into how it must be satisfied.
//   kind 'item'     -> consume qty of a specific item (id, alias-resolved)
//   kind 'tool'     -> possess a tool of a family; NOT consumed
//   kind 'category' -> consume qty of ANY item of a class
function classifyInput({ id, qty }) {
  if (TOOL_TOKENS[id]) {
    return { kind: 'tool', token: id, spec: TOOL_TOKENS[id], qty, have: hasToolToken(TOOL_TOKENS[id]) ? qty : 0 };
  }
  if (CATEGORY_TOKENS[id]) {
    const members = categoryMembersHeld(CATEGORY_TOKENS[id]);
    return { kind: 'category', token: id, spec: CATEGORY_TOKENS[id], qty, have: members.length, members };
  }
  const cid = canonicalId(id);
  return { kind: 'item', token: id, id: cid, qty, have: heldCount(cid) };
}

// Consume a classified input from the inventory. Tools are never consumed.
function consumeInput(inp) {
  if (inp.kind === 'tool') return inp.have >= inp.qty; // possession only
  let left = inp.qty;
  if (inp.kind === 'category') {
    for (const memberId of categoryMembersHeld(inp.spec)) {
      while (left > 0 && countItem(memberId) > 0) { removeOneById(memberId); left--; }
      if (left === 0) break;
    }
    return left === 0;
  }
  // item: spend the canonical id, then any legacy-aliased stacks
  while (left > 0 && countItem(inp.id) > 0) { removeOneById(inp.id); left--; }
  if (left > 0) {
    for (const [legacy, canon] of Object.entries(ITEM_ALIASES)) {
      if (canon !== inp.id) continue;
      while (left > 0 && countItem(legacy) > 0) { removeOneById(legacy); left--; }
    }
  }
  return left === 0;
}

// Recipes a station exposes, each tagged with why it's (un)available.
export function recipesForStation(station) {
  return GameData.recipesForStation(station).map((r) => resolve(r));
}

// Resolve one recipe against current state -> { recipe, need, skill, haveLevel,
// inputs[], missing[], haveInputs, available }.
export function resolve(recipe) {
  const need = recipe.level_requirement || 1;
  const haveLevel = skillLevel(recipe.related_skill) >= need;
  const inputs = parseInputs(recipe.inputs).map(classifyInput);
  const missing = inputs.filter((i) => i.have < i.qty);
  return {
    recipe, need, skill: recipe.related_skill,
    haveLevel, inputs, missing, haveInputs: missing.length === 0,
    available: haveLevel && missing.length === 0,
  };
}

// Attempt to craft. Returns { ok, reason }.
export function craft(recipeId) {
  const recipe = GameData.recipe(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown recipe' };
  const r = resolve(recipe);
  if (!r.haveLevel) return { ok: false, reason: `needs ${r.skill} ${r.need}` };
  if (!r.haveInputs) {
    const m = r.missing.map((i) => `${i.qty - i.have}× ${i.token}`).join(', ');
    return { ok: false, reason: `missing ${m}` };
  }
  if (firstFreeSlot() === -1 && !ITEM_STACKS_INTO_EXISTING(recipe)) {
    return { ok: false, reason: 'inventory full' };
  }

  // Consume inputs (tools are checked, not consumed).
  for (const i of r.inputs) {
    if (!consumeInput(i)) return { ok: false, reason: `consume failed: ${i.token}` };
  }

  // Cooking recipes can burn; burn chance falls with level. Burnt output is the
  // matching Junk item if the DB has one, else nothing.
  const outQty = recipe.output_qty || 1;
  const engine = engineSkill(recipe.related_skill);
  if (recipe.burn_chance != null) {
    const lvl = skillLevel(recipe.related_skill);
    const burn = Math.max(0.02, (recipe.burn_chance / 100) - lvl * 0.004);
    if (Math.random() < burn) {
      const burnt = burntVersion(recipe.output_item_id);
      if (burnt) addItem(burnt, outQty);
      Game.log(`You burn the ${itemName(recipe.output_item_id)}.`);
      Game.refresh();
      return { ok: true, burned: true };
    }
  }

  addItem(recipe.output_item_id, outQty);
  if (engine && recipe.xp_reward) grantXp(engine, recipe.xp_reward);
  Game.log(`You make ${outQty > 1 ? outQty + '× ' : ''}${itemName(recipe.output_item_id)}.`
    + (recipe.xp_reward ? ` (+${recipe.xp_reward} ${recipe.related_skill} xp)` : ''));
  Game.refresh();
  return { ok: true };
}

function itemName(id) { const it = GameData.item(id); return (it && it.display_name) || id; }

// A cooked item id (cooked_shrimp) -> its burnt counterpart (burnt_shrimp) if the
// database defines one; otherwise null.
function burntVersion(cookedId) {
  const guess = cookedId.replace(/^cooked_/, 'burnt_');
  return GameData.item(guess) ? guess : null;
}

// Non-stackable single output always needs a slot; stackable output that the
// player already holds can merge. Small helper so a full-but-mergeable inv
// doesn't block cooking.
function ITEM_STACKS_INTO_EXISTING(recipe) {
  const def = GameData.item(recipe.output_item_id);
  return def && def.stackable && countItem(recipe.output_item_id) > 0;
}

// Distinct station types the database defines (for UI / world-gen reference).
export function stationTypes() {
  return [...new Set(GameData.recipes.map((r) => r.station))].filter(Boolean).sort();
}
