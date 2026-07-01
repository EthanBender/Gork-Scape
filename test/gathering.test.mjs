// test/gathering.test.mjs — data-driven gathering (src/systems/gathering.js).
// This is the world↔economy seam: a placed node id resolves against the player's
// skill + tool and yields an output. Node ids are discovered from the loaded DB
// (via run.mjs's fetch shim) so the test isn't brittle to specific content.
import { test, assert, eq } from './run.mjs';
import { GameData } from '../src/data/gameData.js';
import { resolveNode, gather } from '../src/systems/gathering.js';
import { engineSkill } from '../src/systems/crafting.js';
import { Game, initState } from '../src/engine/state.js';
import { ITEMS } from '../src/items/equipment.js';

// give the player every gathering tool so the tool-gate passes for any node
function grantAllTools() {
  let slot = 0;
  for (const d of Object.values(ITEMS)) {
    if (d.tool && slot < Game.inventory.length) Game.inventory[slot++] = d;
  }
}
function maxSkillFor(dbSkill) {
  const name = engineSkill(dbSkill);
  if (name && Game.skills[name]) { Game.skills[name].level = 99; Game.skills[name].xp = 14e6; }
  return name;
}

test('resolveNode returns null for an unknown node', () => {
  initState();
  eq(resolveNode('definitely_not_a_node'), null);
});

test('resolveNode: canGather is exactly haveLevel && haveTool', () => {
  initState();
  const node = GameData.worldNodes.find((n) => resolveNode(n.node_id));
  assert(node, 'at least one node resolves');
  const r = resolveNode(node.node_id);
  eq(r.canGather, r.haveLevel && r.haveTool, 'invariant holds');
  assert(typeof r.need === 'number' && r.need >= 1, 'a level requirement is reported');
});

test('the level gate blocks a low-level player, then opens', () => {
  initState();
  // a node whose requirement is above 1 and whose skill maps to an engine skill
  const node = GameData.worldNodes.find((n) => (n.level_requirement || 1) > 1 && engineSkill(n.related_skill));
  assert(node, 'found a level-gated node');
  grantAllTools();                                   // remove the tool variable from the equation
  assert(resolveNode(node.node_id).haveLevel === false, 'level 1 player is under the requirement');
  maxSkillFor(node.related_skill);
  assert(resolveNode(node.node_id).haveLevel === true, 'maxed player meets it');
});

test('gather() fails when under-level, succeeds fully equipped', () => {
  initState();
  const node = GameData.worldNodes.find((n) => (n.level_requirement || 1) > 1 && engineSkill(n.related_skill) && n.outputs);
  assert(node, 'found a gatherable level-gated node with output');

  const blocked = gather(node.node_id);
  eq(blocked.ok, false, 'blocked before meeting requirements');
  assert(/needs/.test(blocked.reason), 'reason explains what is missing');

  grantAllTools();
  const engine = maxSkillFor(node.related_skill);
  const xpBefore = engine ? Game.skills[engine].xp : 0;
  const res = gather(node.node_id);
  eq(res.ok, true, 'succeeds once level + tool are satisfied');
  assert(GameData.item(res.item), 'the output is a real item in the registry');
  assert(Game.inventory.some((s) => s && s.id === res.item), 'output landed in the inventory');
  if (engine) assert(Game.skills[engine].xp > xpBefore, 'gathering granted xp');
});
