// src/systems/gathering.js
// Data-driven gathering: resolves a world_nodes.json node against the player's
// skill level and equipped tool, and produces its output + XP on success. The
// engine owns tick timing / depletion; this owns the "can I, and what do I get".

import { GameData } from '../data/gameData.js';
import { engineSkill } from './crafting.js';
import { Game, addItem, grantXp } from '../engine/state.js';
import { EQUIP_SLOTS } from '../items/equipment.js';

// XP fallback when a node/skill row doesn't carry an explicit reward:
// gathering XP ≈ node level * 5 (design brief).
function nodeXp(node) { return (node.level_requirement || 1) * 5; }

function skillLevel(dbSkill) {
  const name = engineSkill(dbSkill);
  if (!name) return 0;
  return Game.skills[name] ? Game.skills[name].level : 0;
}

// Does the player hold/wear a tool of the required family? Tools carry
// `tool: 'woodcutting'|'mining'|'net'|…` on their item def (hand-authored, or
// hydrated from the database Tool ladder — see equipment.toolStatsFromRecord).
// The database expresses required_tool in several spellings ('hatchet',
// 'small_net', 'cave_rod', …), so map each node word onto the engine family.
// Specialised fishing gear the database never defined as items (cave_rod,
// heavy_harpoon, moon_net) falls back to its base family — the node's level
// requirement is the real gate there.
const TOOL_FAMILY = {
  hatchet: 'woodcutting', axe: 'woodcutting', pickaxe: 'mining',
  net: 'net', small_net: 'net', fishing_net: 'net', moon_net: 'net',
  rod: 'rod', fishing_rod: 'rod', cave_rod: 'rod',
  harpoon: 'harpoon', heavy_harpoon: 'harpoon',
  cage: 'cage', fishing_cage: 'cage',
};

// required_tool may list several tools separated by ';' (gem nodes want
// 'pickaxe;chisel'); the player must satisfy every entry. Exported so the
// legacy resource-object gate (main.hasTool) runs the exact same check.
export function hasRequiredTool(requiredTool) {
  if (!requiredTool) return true;
  const wornOrHeld = [
    ...EQUIP_SLOTS.map((s) => Game.equipment[s]),
    ...Game.inventory,
  ].filter(Boolean);
  return String(requiredTool).split(';').every((word) => {
    const family = TOOL_FAMILY[word.trim()] || word.trim();
    return wornOrHeld.some((it) => it.tool === family);
  });
}

// Resolve a node id -> { node, skill, need, haveLevel, haveTool, canGather }.
export function resolveNode(nodeId) {
  const node = GameData.node(nodeId);
  if (!node) return null;
  const need = node.level_requirement || 1;
  const haveLevel = skillLevel(node.related_skill) >= need;
  const haveTool = hasRequiredTool(node.required_tool);
  return { node, skill: node.related_skill, need, haveLevel, haveTool, canGather: haveLevel && haveTool };
}

// Perform one successful gather of a node (caller has already rolled success).
// Returns { ok, item } or { ok:false, reason }.
export function gather(nodeId) {
  const r = resolveNode(nodeId);
  if (!r) return { ok: false, reason: 'unknown node' };
  if (!r.haveLevel) return { ok: false, reason: `needs ${r.skill} ${r.need}` };
  if (!r.haveTool) return { ok: false, reason: `needs ${r.node.required_tool}` };

  const outputs = String(r.node.outputs || '').split(';').map((s) => s.trim()).filter(Boolean);
  const out = outputs[0];
  if (!out) return { ok: false, reason: 'node has no output' };
  if (!addItem(out)) return { ok: false, reason: 'inventory full' };

  const engine = engineSkill(r.node.related_skill);
  const xp = nodeXp(r.node);
  if (engine) grantXp(engine, xp);
  const def = GameData.item(out);
  Game.log(`You get ${(def && def.display_name) || out}. (+${xp} ${r.node.related_skill} xp)`);
  rollGatherByproduct(engine);
  Game.refresh();
  return { ok: true, item: out };
}

// [economy lane] Cross-pollination: gathering ANY node has a small chance to also
// yield a Tinkering raw material + a little Tinkering XP. A held tool that
// `boosts` the skill (e.g. the Prospector's Lens boosts mining) doubles the odds.
// Called from gather() (data nodes) and main.js performSkill (baseline nodes).
const TINKER_BYPRODUCT = {
  Mining: ['saltpeter', 'sulfur'], Woodcutting: ['tree_resin'], Fishing: ['scrap_metal'],
};
export function rollGatherByproduct(engineSkillName) {
  const pool = TINKER_BYPRODUCT[engineSkillName];
  if (!pool) return;
  const boosted = [...EQUIP_SLOTS.map((s) => Game.equipment[s]), ...Game.inventory]
    .some((it) => it && it.boosts && it.boosts.toLowerCase() === engineSkillName.toLowerCase());
  if (Math.random() >= 0.06 * (boosted ? 2 : 1)) return;
  const id = pool[Math.floor(Math.random() * pool.length)];
  if (!addItem(id)) return;
  grantXp('Tinkering', 6);
  const def = GameData.item(id);
  Game.log(`You salvage a bit of ${(def && def.display_name) || id}! (+6 Tinkering xp)`);
}
