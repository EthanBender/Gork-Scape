// scripts/quest_test.mjs
// Headless end-to-end test of the quest engine v2 (src/systems/quests.js). Drives
// the REAL engine against REAL data + game state to prove the full story flow:
// talk-to-giver → ORDERED steps (goto / kill / obtain / talk) → dialogue → reward
// → prerequisite unlock → map markers → save/load roundtrip.
//
// Uses the repo's file:// fetch polyfill so gameData.js + quests.json load in Node.
// Run: node scripts/quest_test.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = url instanceof URL ? url : new URL(url);
  if (u.protocol === 'file:') {
    const body = fs.readFileSync(fileURLToPath(u), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  }
  return realFetch(url, opts);
};

const { Game, initState, addItem, grantXp } = await import('../src/engine/state.js');
const q = await import('../src/systems/quests.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const statusOf = (id) => Game.questState[id] && Game.questState[id].status;
const stepOf = (id) => Game.questState[id] && Game.questState[id].step;

console.log('Quest engine v2 — headless end-to-end test\n');
initState();
Game.ui = {};
q.initQuests();

// --- boot state --------------------------------------------------------------
ok('quests loaded (Act 1 + Act 2)', q.allQuests().length >= 11, `${q.allQuests().length} quests`);
ok('tutorial is AVAILABLE at spawn (not auto-started)', statusOf('tutorial_first_scrap') === 'available');
ok('follow-ups locked behind the tutorial', statusOf('first_pickaxe') === 'locked');
ok('an available quest exposes a giver marker',
  q.questMarkers().some((m) => m.kind === 'available' && m.npc === 'elder'));

// --- start by talking to the giver -------------------------------------------
const handled = q.onTalk('elder');
ok('talking to the giver starts the quest', handled && statusOf('tutorial_first_scrap') === 'active');
ok('quest begins on step 0 (goto Training Yard)', stepOf('tutorial_first_scrap') === 0);

// --- ORDERED steps: later objectives do nothing until their step is active ----
addItem('bones', 1);            // step 2's item — but we're on step 0
q.evaluate();
ok('out-of-order progress is ignored (still on goto step)', stepOf('tutorial_first_scrap') === 0);

// step 0: goto Training Yard (515,485)
q.onArrive('settlement', 515, 485);
ok('arriving at the target advances the goto step', stepOf('tutorial_first_scrap') === 1);

// step 1: kill a training rat
q.onKill('training_rat');
ok('killing the target advances the kill step', stepOf('tutorial_first_scrap') === 2);

// step 2: obtain bones (already in inventory from earlier) → auto-advances on tick
q.evaluate();
ok('obtain step clears from live inventory', stepOf('tutorial_first_scrap') === 3);

// step 3: talk back to the Elder (turn-in) → completes
const before = Game.skills.Attack.xp;
q.onTalk('elder');
ok('talking to the giver again turns in + completes', statusOf('tutorial_first_scrap') === 'complete');
ok('completion paid the XP reward', Game.skills.Attack.xp >= before + 70);
ok('completion paid coins', Game.inventory.some((s) => s && s.id === 'coins'));

// --- prerequisite unlock -----------------------------------------------------
ok('completing the tutorial unlocks its dependants',
  statusOf('first_pickaxe') === 'available' && statusOf('goblin_pointy_stick') === 'available');

// --- a goto + obtain quest: First Pickaxe -------------------------------------
q.onTalk('shopkeeper_general_store'); // starts first_pickaxe (its giver)
ok('First Pickaxe starts from its own giver', statusOf('first_pickaxe') === 'active');
for (let i = 0; i < 5; i++) addItem('copper_ore', 1); // mined BEFORE arriving
q.evaluate();
ok('obtain is gated behind the earlier goto step', stepOf('first_pickaxe') === 0);
q.onArrive('grubpit', 455, 285);
q.evaluate();
ok('after arriving, the already-held ore satisfies the obtain step', stepOf('first_pickaxe') === 2);
q.onTalk('shopkeeper_general_store');
ok('First Pickaxe completes on turn-in', statusOf('first_pickaxe') === 'complete');

// --- level gate + kill quest: Rats in the Storehouse -------------------------
ok('level-gated quest locked below the requirement',
  statusOf('rats_in_the_storehouse') === 'locked', `Attack ${Game.skills.Attack.level}`);
grantXp('Attack', 600);
q.refreshAvailability();
ok('reaching the level requirement unlocks it',
  statusOf('rats_in_the_storehouse') === 'available');
q.onTalk('shopkeeper_general_store');
for (let i = 0; i < 4; i++) q.onKill('training_rat');
ok('kill step tracks partial progress (4/5)', statusOf('rats_in_the_storehouse') === 'active');
q.onKill('training_rat');
q.onTalk('shopkeeper_general_store');
ok('kill quest completes + turns in', statusOf('rats_in_the_storehouse') === 'complete');

// --- reward payoffs: gear + bank space (from Rats in the Storehouse) ----------
ok('quest reward grew bank space (bankMax += 10)', Game.bankMax >= 130, `bankMax=${Game.bankMax}`);
ok('quest reward granted gear into the inventory',
  Game.inventory.some((s) => s && s.id === 'bronze_body'));

// --- reward payoff: openShortcut calls the world hook -------------------------
// The Bridge quest grants openShortcut:'west_bridge'. Mock the world hook main.js
// would install, then drive the quest to completion and assert it fired.
Game.grantShortcut = (id) => { Game.__sc = id; return true; };
Game.inventory = new Array(Game.inventory.length).fill(null); // room for materials
grantXp('Woodcutting', 2000);           // reach the Woodcutting 10 prereq
q.refreshAvailability();
q.onTalk('shopkeeper_lumber_stall');    // start Bridge Over Dumb Water
for (let i = 0; i < 10; i++) addItem('normal_logs', 1);
for (let i = 0; i < 5; i++) addItem('oak_logs', 1);
for (let i = 0; i < 3; i++) addItem('bronze_nails', 1);
for (let i = 0; i < 3; i++) q.evaluate();   // advance the 3 ordered obtain steps
q.onArrive('willow', 340, 435);             // goto the West Bridge
q.onKill('bridge_bandit');                  // drive off the bandit
q.onTalk('shopkeeper_lumber_stall');        // turn in
ok('multi-step Bridge quest completes end to end', statusOf('bridge_over_dumb_water') === 'complete');
ok('openShortcut reward fired the world hook', Game.__sc === 'west_bridge', `sc=${Game.__sc}`);

// --- Act 2 chains off Act 1 --------------------------------------------------
ok('Act 2 quest unlocks when its Act 1 prereq is done',
  statusOf('the_grubpit_problem') === 'available');
ok('Act 2 quest still locked behind an unfinished Act 1 quest',
  statusOf('grublake_fish_thieves') === 'locked');

// --- active quest exposes a directional marker for its current step ----------
q.onTalk('shopkeeper_miner_camp'); // start the_grubpit_problem
ok('an active quest exposes a marker for its current step',
  q.questMarkers().some((m) => m.kind === 'active'));

// --- persistence roundtrip ---------------------------------------------------
const saved = JSON.parse(JSON.stringify(q.serializeQuests()));
Game.questState = {};
q.applyQuests(saved);
ok('save/load preserves completed quests', statusOf('first_pickaxe') === 'complete');
ok('save/load preserves an in-progress quest + its step',
  statusOf('the_grubpit_problem') === 'active' && typeof stepOf('the_grubpit_problem') === 'number');
ok('save/load re-derives availability for unstarted quests',
  statusOf('cabbage_for_cowards') === 'available');

console.log(`\n${'─'.repeat(52)}\n${pass}/${pass + fail} quest checks passed.`);
if (fail) { console.log(`❌ ${fail} FAILED`); process.exit(1); }
console.log('✅ Quest engine v2 works end-to-end.');
