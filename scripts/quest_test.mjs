// scripts/quest_test.mjs
// Headless end-to-end test of the quest engine (src/systems/quests.js). The game
// can't be click-tested past the login gate in this environment, so this drives
// the REAL engine against the REAL data + game state to prove the whole loop:
// auto-start → objective tracking (kill / obtain / level) → reward payout →
// prerequisite unlock → save/load roundtrip.
//
// Uses the repo's standard file:// fetch polyfill so gameData.js and quests.js
// load their JSON in Node (they fetch over HTTP in the browser). Run:
//   node scripts/quest_test.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// --- polyfill fetch for file:// URLs (must be set before importing the graph) --
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = url instanceof URL ? url : new URL(url);
  if (u.protocol === 'file:') {
    const body = fs.readFileSync(fileURLToPath(u), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  }
  return realFetch(url, opts);
};

// Import AFTER the polyfill so top-level-await data loads succeed.
const { Game, initState, addItem, grantXp } = await import('../src/engine/state.js');
const q = await import('../src/systems/quests.js');

// --- tiny assert harness -----------------------------------------------------
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const statusOf = (id) => Game.questState[id] && Game.questState[id].status;
const board = () => q.questBoard();

// --- boot --------------------------------------------------------------------
console.log('Quest engine — headless end-to-end test\n');
initState();          // fresh skills/inventory/hitpoints
Game.ui = {};
q.initQuests();       // build slate + auto-start tutorial

ok('quests loaded from quests.json', q.allQuests().length >= 6, `${q.allQuests().length} quests`);
ok('tutorial auto-started (active)', statusOf('tutorial_first_scrap') === 'active');
ok('follow-up quests locked behind the tutorial',
  statusOf('goblin_pointy_stick') === 'locked' && statusOf('first_pickaxe') === 'locked');

// --- complete the tutorial: kill a rat + obtain bones ------------------------
q.onKill('training_rat');
ok('tutorial not complete on kill alone (bones objective outstanding)',
  statusOf('tutorial_first_scrap') === 'active');
addItem('bones', 1);
q.evaluate();
ok('tutorial completes when both objectives met', statusOf('tutorial_first_scrap') === 'complete');
ok('tutorial paid its XP reward (+60 Attack)', Game.skills.Attack.xp >= 60,
  `Attack xp=${Game.skills.Attack.xp}`);
ok('tutorial paid its coin reward', q.questBoard() && Game.inventory.some((s) => s && s.id === 'coins'));

// --- prerequisite unlock -----------------------------------------------------
ok('completing the tutorial unlocks its dependants',
  statusOf('first_pickaxe') === 'available' && statusOf('fish_for_chief') === 'available');
ok('level-gated quest still locked (Attack < 3)',
  statusOf('rats_in_the_storehouse') === 'locked', `Attack lvl ${Game.skills.Attack.level}`);

// --- obtain objective: mine 5 copper ore -------------------------------------
q.startQuest('first_pickaxe');
ok('starting an available quest activates it', statusOf('first_pickaxe') === 'active');
for (let i = 0; i < 4; i++) addItem('copper_ore', 1);
q.evaluate();
ok('obtain objective not met at 4/5', statusOf('first_pickaxe') === 'active');
const beforeMining = Game.skills.Mining.xp;
addItem('copper_ore', 1);
q.evaluate();
ok('obtain objective completes at 5/5', statusOf('first_pickaxe') === 'complete');
ok('obtain quest paid Mining xp', Game.skills.Mining.xp >= beforeMining + 180);

// --- level objective/gate: reach Attack 3 unlocks the rat cull ---------------
grantXp('Attack', 500); // push Attack past level 3
q.refreshAvailability();
ok('reaching the level requirement unlocks the gated quest',
  Game.skills.Attack.level >= 3 && statusOf('rats_in_the_storehouse') === 'available',
  `Attack lvl ${Game.skills.Attack.level}`);

// --- kill-count objective: cull 5 rats ---------------------------------------
q.startQuest('rats_in_the_storehouse');
for (let i = 0; i < 4; i++) q.onKill('training_rat');
ok('kill objective tracks partial progress (4/5 not complete)',
  statusOf('rats_in_the_storehouse') === 'active');
q.onKill('training_rat');
ok('kill objective completes at 5/5', statusOf('rats_in_the_storehouse') === 'complete');

// --- progress view sanity ----------------------------------------------------
const b = board();
ok('board reports the right completed count', b.completedCount === 3, `${b.completedCount}/3`);

// --- persistence roundtrip ---------------------------------------------------
const saved = q.serializeQuests();
const json = JSON.parse(JSON.stringify(saved)); // simulate localStorage stringify
// Wipe live state, then restore from the "save".
Game.questState = {};
q.applyQuests(json);
ok('save/load preserves completed quests', statusOf('first_pickaxe') === 'complete');
ok('save/load preserves the kill tally', (Game.questState['rats_in_the_storehouse'].kills.training_rat || 0) === 5);
ok('save/load re-derives availability for unstarted quests',
  statusOf('cabbage_for_cowards') === 'available');

// --- summary -----------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}\n${pass}/${pass + fail} quest checks passed.`);
if (fail) { console.log(`❌ ${fail} FAILED`); process.exit(1); }
console.log('✅ Quest engine works end-to-end.');
