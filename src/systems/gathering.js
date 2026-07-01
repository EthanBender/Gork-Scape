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
// `tool: 'woodcutting'|'mining'|'net'|'rod'|'harpoon'|'cage'` on their item def.
// The database expresses required_tool as 'hatchet'/'pickaxe'/'net'/etc., so map
// the node's tool word onto the engine tool family.
const TOOL_FAMILY = {
  hatchet: 'woodcutting', axe: 'woodcutting', pickaxe: 'mining',
  net: 'net', rod: 'rod', fishing_rod: 'rod', harpoon: 'harpoon', cage: 'cage',
};

function hasTool(requiredTool) {
  if (!requiredTool) return true;
  const family = TOOL_FAMILY[requiredTool] || requiredTool;
  const wornOrHeld = [
    ...EQUIP_SLOTS.map((s) => Game.equipment[s]),
    ...Game.inventory,
  ].filter(Boolean);
  return wornOrHeld.some((it) => it.tool === family);
}

// Resolve a node id -> { node, skill, need, haveLevel, haveTool, canGather }.
export function resolveNode(nodeId) {
  const node = GameData.node(nodeId);
  if (!node) return null;
  const need = node.level_requirement || 1;
  const haveLevel = skillLevel(node.related_skill) >= need;
  const haveTool = hasTool(node.required_tool);
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
  Game.refresh();
  return { ok: true, item: out };
}
