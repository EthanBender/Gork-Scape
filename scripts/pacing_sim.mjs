// scripts/pacing_sim.mjs
// XP / PROGRESSION PACING validator — the leveling-balance counterpart to
// economy_sim.mjs. It turns "the game paces fairly" into executable assertions
// so a bad recipe-xp / equipment-req / monster change is caught before it ships.
// Checks four things the economy sim doesn't:
//   A. Equipment is wearable — every DB weapon/armor maps to a real slot, and
//      armour Defence requirements form a sane, starter-friendly ladder (bronze
//      wearable at Defence 1, monotonic non-decreasing by tier).
//   B. Gather↔process parity — a recipe that consumes RAW gathered materials
//      awards at least as much XP as those materials cost to gather, so a
//      processor skill never falls hopelessly behind its gatherer.
//   C. Ladder smoothness — no material tier is missing and no gap between
//      consecutive equipment tiers is too large (dead zones).
//   D. Combat scales — per-kill combat XP (≈5.33·hp, hp derived from combat
//      level exactly as map.js does) rises monotonically with combat level.
//
// Run: node scripts/pacing_sim.mjs   (add --verbose for per-check detail)
// Pure Node, ~0.1s, no browser. Reads src/data/*.json from disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const VERBOSE = process.argv.includes('--verbose');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  if (VERBOSE || !pass) console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const items = load('items');
const recipes = load('recipes');
const nodes = load('world_nodes');
const monsters = load('monsters');
const itemById = new Map(items.map((i) => [i.item_id, i]));

// ---- shared tier helpers (independent re-derivation of equipment.js) --------
const WEAPON_TIERS = ['crude', 'bronze', 'iron', 'steel', 'grubstone', 'black iron', 'bogbone', 'trollbone', 'meteor'];
const ARMOR_TIERS = ['cloth', 'leather', 'bronze', 'iron', 'shell', 'steel', 'sporehide', 'black iron', 'bog horror', 'trollhide', 'meteor'];
const WEAPON_CLASS = ['dagger', 'battle axe', 'sword', 'spear', 'mace', 'club', 'shortbow', 'longbow', 'axe'];
const ARMOR_PIECE = ['platebody', 'body', 'platelegs', 'legs', 'chaps', 'shield', 'helm', 'coif', 'hat', 'gauntlets', 'gloves', 'boots', 'cape'];
function matchTier(name, tiers) {
  const n = name.toLowerCase();
  // multiword tiers first so "iron" doesn't shadow "black iron"
  for (const t of tiers.filter((t) => t.includes(' '))) if (n.includes(t)) return t;
  for (const t of tiers.filter((t) => !t.includes(' '))) if (n.includes(t)) return t;
  return null;
}
const hasWord = (name, words) => words.some((w) => name.toLowerCase().includes(w));

// =============================================================================
// PART A — equipment is wearable + sane Defence-req ladder
// =============================================================================
function auditEquipment() {
  console.log('\n── Part A: equipment wearability + requirement ladder ──');
  const weapons = items.filter((i) => i.subcategory === 'Weapon');
  const armor = items.filter((i) => i.subcategory === 'Armor');

  // Every weapon/armor name must resolve to a class/piece (else it hydrates to
  // slot:null and is silently unequippable — the exact bug this validator exists
  // to prevent regressing).
  const unclassedW = weapons.filter((i) => !hasWord(i.display_name || i.item_id, WEAPON_CLASS));
  check('every weapon maps to a slot', unclassedW.length === 0,
    unclassedW.length ? `unmapped: ${unclassedW.slice(0, 4).map((i) => i.item_id).join(', ')}` : `${weapons.length} weapons`);
  const unpieced = armor.filter((i) => !hasWord(i.display_name || i.item_id, ARMOR_PIECE));
  check('every armor piece maps to a slot', unpieced.length === 0,
    unpieced.length ? `unmapped: ${unpieced.slice(0, 4).map((i) => i.item_id).join(', ')}` : `${armor.length} pieces`);

  // Starter armour (cloth/leather/bronze) must be wearable at Defence 1 — a
  // quest-reward bronze helm the player can't equip for hours is the reported bug.
  const starters = armor.filter((i) => ['cloth', 'leather', 'bronze'].includes(matchTier(i.display_name, ARMOR_TIERS)));
  const badStart = starters.filter((i) => (i.level_requirement || 1) > 1);
  check('starter armour wearable at Defence 1', badStart.length === 0,
    badStart.length ? `gated: ${badStart.slice(0, 4).map((i) => `${i.item_id}=D${i.level_requirement}`).join(', ')}` : `${starters.length} starter pieces`);

  // Armour Defence req must be monotonic non-decreasing across the tier order.
  const reqByTier = new Map();
  for (const i of armor) {
    const t = matchTier(i.display_name, ARMOR_TIERS); if (!t) continue;
    reqByTier.set(t, Math.max(reqByTier.get(t) || 0, i.level_requirement || 1));
  }
  let mono = true, prev = 0, badPair = '';
  for (const t of ARMOR_TIERS) {
    if (!reqByTier.has(t)) continue;
    const r = reqByTier.get(t);
    if (r < prev) { mono = false; badPair = `${t}=${r} < prev ${prev}`; break; }
    prev = r;
  }
  check('armour Defence reqs monotonic by tier', mono, mono ? [...reqByTier.values()].join('→') : badPair);
}

// =============================================================================
// PART B — gather↔process XP parity
// =============================================================================
const LIVE_GATHER = { copper_ore: 25, tin_ore: 25, iron_ore: 35, coal_ore: 50, gold_ore: 65, normal_logs: 25, oak_logs: 37, willow_logs: 52, dead_logs: 70, dense_oak_logs: 90, fungal_logs: 110, blackroot_logs: 135, ironbark_logs: 165, elder_rotwood_logs: 200, moonwillow_logs: 240, raw_shrimp: 10, raw_trout: 40, raw_pike: 55, raw_eel: 70 };
const NODE_XP = {};
for (const n of nodes) { const xp = (n.level_requirement || 1) * 5; for (const out of String(n.outputs || '').split(';').map((s) => s.trim()).filter(Boolean)) if (NODE_XP[out] == null || xp > NODE_XP[out]) NODE_XP[out] = xp; }
function rawGatherXp(id) {
  if (LIVE_GATHER[id] != null) return LIVE_GATHER[id];
  if (NODE_XP[id] != null) return NODE_XP[id];
  const it = itemById.get(id);
  return it && it.category === 'Resource' ? (it.level_requirement || 1) * 5 : 0;
}
const isRaw = (id) => LIVE_GATHER[id] != null || NODE_XP[id] != null || (itemById.get(id) || {}).category === 'Resource';
const parseInputs = (s) => String(s || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const [id, q] = p.split(':'); return { id, q: Number(q) || 1 }; });

function auditParity() {
  console.log('\n── Part B: gather↔process XP parity ──');
  const laggards = [];
  let checked = 0;
  for (const r of recipes) {
    const rawXp = parseInputs(r.inputs).reduce((s, i) => s + (isRaw(i.id) ? rawGatherXp(i.id) * i.q : 0), 0);
    if (rawXp <= 0) continue;
    checked++;
    // Processor must not award LESS than the gathering its raw inputs cost.
    if ((r.xp_reward || 0) < rawXp) laggards.push(`${r.output_item_id} xp${r.xp_reward}<gather${rawXp}`);
  }
  check('no processing recipe lags its raw-input gather XP', laggards.length === 0,
    laggards.length ? laggards.slice(0, 5).join('; ') : `${checked} raw-input recipes ≥ parity`);
}

// =============================================================================
// PART C — ladder smoothness (no missing tiers / dead zones)
// =============================================================================
function auditLadder() {
  console.log('\n── Part C: equipment ladder smoothness ──');
  for (const [label, subcat, tiers, maxGap] of [['weapon', 'Weapon', WEAPON_TIERS, 15], ['armour', 'Armor', ARMOR_TIERS, 20]]) {
    const eq = items.filter((i) => i.subcategory === subcat);
    const minLvl = new Map();
    for (const i of eq) { const t = matchTier(i.display_name, tiers); if (!t) continue; const l = i.level_requirement || 1; if (!minLvl.has(t) || l < minLvl.get(t)) minLvl.set(t, l); }
    const missing = tiers.filter((t) => !minLvl.has(t));
    check(`${label}: all material tiers present`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${tiers.length} tiers`);
    const lvls = tiers.filter((t) => minLvl.has(t)).map((t) => minLvl.get(t)).sort((a, b) => a - b);
    let worst = 0; for (let k = 1; k < lvls.length; k++) worst = Math.max(worst, lvls[k] - lvls[k - 1]);
    check(`${label}: no tier gap > ${maxGap} levels`, worst <= maxGap, `largest gap ${worst}`);
  }
}

// =============================================================================
// PART D — combat XP scales with monster level
// =============================================================================
function auditCombat() {
  console.log('\n── Part D: combat XP scaling ──');
  // hp derived exactly as map.js: L = round(cl/1.14); hp = max(3, round(L*1.15)).
  const hpFor = (cl) => Math.max(3, Math.round(Math.round((cl || 5) / 1.14) * 1.15));
  const sorted = [...monsters].filter((m) => m.combat_level).sort((a, b) => a.combat_level - b.combat_level);
  // per-kill combat XP ≈ 4·hp (style) + 1.333·hp (hitpoints) = 5.333·hp.
  const xpKill = (m) => +(5.333 * hpFor(m.combat_level)).toFixed(0);
  const first = sorted[0], last = sorted[sorted.length - 1];
  check('lowest monster gives a floor of combat XP', xpKill(first) >= 10, `${first.monster_id} CL${first.combat_level} → ${xpKill(first)} xp/kill`);
  check('top monster XP scales well above starter', xpKill(last) >= xpKill(first) * 8, `${first.combat_level}→${xpKill(first)} vs ${last.combat_level}→${xpKill(last)}`);
  // HP (hence XP/kill) must be non-decreasing along the sorted ladder.
  let mono = true, bad = '';
  for (let k = 1; k < sorted.length; k++) if (hpFor(sorted[k].combat_level) < hpFor(sorted[k - 1].combat_level)) { mono = false; bad = `${sorted[k].monster_id}`; break; }
  check('per-kill combat XP monotonic up the ladder', mono, mono ? `${sorted.length} monsters CL${first.combat_level}–${last.combat_level}` : bad);
}

// ---- run --------------------------------------------------------------------
console.log('Goblin Empire — XP / pacing validator');
auditEquipment();
auditParity();
auditLadder();
auditCombat();

const passed = results.filter((r) => r.pass).length;
console.log('\n' + '─'.repeat(60));

// =============================================================================
// PART E — TIME-TO-LEVEL: hours of casual play to reach milestones, per skill.
// Deterministic expected-value simulation using the game's OWN formulas
// (success-roll interpolation, uniform combat rolls, the OSRS XP curve) and
// LIVE data (RESOURCE_TYPES methods, ENEMY_TYPES stat blocks). This is the
// check that answers "is the game actually paced like an RPG or a chore?"
// =============================================================================
const { XP_TABLE } = await import('../src/engine/skills.js');
const { RESOURCE_TYPES, ENEMY_TYPES } = await import('../src/world/worldData.js');
const { maxHit, maxAttackRoll, maxDefenceRoll, combatLevel } = await import('../src/engine/combat.js');

const TICKS_PER_HOUR = 3600 / 0.6;
const GATHER_UPTIME = 0.75;   // walking, banking, node-hopping
const COMBAT_UPTIME = 0.65;   // respawns, travel, eating
const succChance = (lvl, low, high) => Math.min(1, (1 + (high * (lvl - 1)) / 98 + (low * (99 - lvl)) / 98) / 256);
// P(a > d) for uniform ints a in [0,A], d in [0,D]
const pHit = (A, D) => { let hits = 0; for (let d = 0; d <= D; d++) hits += Math.max(0, A - d); return hits / ((A + 1) * (D + 1)); };

function gatherRate(skill, lvl) { // best available method's expected xp/hour
  let best = 0;
  for (const m of Object.values(RESOURCE_TYPES)) {
    if (m.skill !== skill || (m.level || 1) > lvl || !m.xp) continue;
    const rate = succChance(lvl, m.low ?? 15, m.high ?? 40) * m.xp * (TICKS_PER_HOUR / 3) * GATHER_UPTIME; // one roll per 3 ticks (the game's gather cadence)
    if (rate > best) best = rate;
  }
  return best;
}
function combatRate(lvl) { // expected style-xp/hour vs the best-fitting mob
  const gear = Math.min(45, 3 + lvl * 0.55); // rough gear ladder: bonuses grow with level
  const prof = { levels: { attack: lvl, strength: lvl, defence: lvl, ranged: 1, hitpoints: lvl + 3 },
    style: 'Aggressive', weaponType: 'slash',
    bonuses: { slash_atk: gear, melee_str: gear, stab_def: 0, slash_def: 0, crush_def: 0, magic_def: 0, range_def: 0, tinker_def: 0, stab_atk: 0, crush_atk: 0, magic_atk: 0, range_atk: 0, tinker_atk: 0, range_str: 0, tinker_str: 0, prayer: 0 } };
  const myCL = combatLevel(prof.levels);
  let bestMob = null, bd = Infinity;
  for (const [, m] of Object.entries(ENEMY_TYPES)) {
    const cl = combatLevel({ attack: m.att, strength: m.str, defence: m.def, ranged: 1, hitpoints: m.hp });
    const fit = Math.abs(cl - myCL * 0.8);
    if (cl <= myCL * 1.1 && fit < bd) { bd = fit; bestMob = m; }
  }
  if (!bestMob) { // nothing weak enough — train on the weakest thing alive
    let wc = Infinity;
    for (const [, m] of Object.entries(ENEMY_TYPES)) { const cl = combatLevel({ attack: m.att, strength: m.str, defence: m.def, ranged: 1, hitpoints: m.hp }); if (cl < wc) { wc = cl; bestMob = m; } }
  }
  if (!bestMob) return 0;
  const def = { levels: { attack: bestMob.att, strength: bestMob.str, defence: bestMob.def, ranged: 1, hitpoints: bestMob.hp },
    bonuses: { slash_def: bestMob.def, stab_def: bestMob.def, crush_def: bestMob.def, magic_def: 0, range_def: 0, tinker_def: 0 } };
  const p = pHit(maxAttackRoll(prof), maxDefenceRoll(def, 'slash'));
  const dmgPerSwing = p * maxHit(prof) / 2;
  const swingsPerHour = TICKS_PER_HOUR / 4 * COMBAT_UPTIME; // 4-tick weapons
  return dmgPerSwing * swingsPerHour * 4;                    // 4 xp per damage
}
function hoursTo(rateFn, target) {
  let hours = 0;
  for (let L = 1; L < target; L++) {
    const rate = rateFn(L);
    if (rate <= 0) return Infinity;
    hours += (XP_TABLE[L + 1] - XP_TABLE[L]) / rate;
  }
  return hours;
}

console.log('\n── Part E: time-to-level (casual hours, expected value) ──');
console.log('  skill          L20      L30      L50');
const gatherSkills = ['Woodcutting', 'Fishing', 'Mining'];
const t30 = {};
for (const sk of gatherSkills) {
  const h20 = hoursTo((l) => gatherRate(sk, l), 20), h30 = hoursTo((l) => gatherRate(sk, l), 30), h50 = hoursTo((l) => gatherRate(sk, l), 50);
  t30[sk] = h30;
  console.log(`  ${sk.padEnd(12)} ${h20.toFixed(1).padStart(5)}h  ${h30.toFixed(1).padStart(6)}h  ${h50.toFixed(1).padStart(6)}h`);
}
const c20 = hoursTo(combatRate, 20), c30 = hoursTo(combatRate, 30), c50 = hoursTo(combatRate, 50);
console.log(`  ${'Combat/style'.padEnd(12)} ${c20.toFixed(1).padStart(5)}h  ${c30.toFixed(1).padStart(6)}h  ${c50.toFixed(1).padStart(6)}h`);

for (const sk of gatherSkills) {
  check(`${sk} L20 in a casual evening or two (0.3–8h)`, t30[sk] !== Infinity && hoursTo((l) => gatherRate(sk, l), 20) >= 0.3 && hoursTo((l) => gatherRate(sk, l), 20) <= 8,
    `${hoursTo((l) => gatherRate(sk, l), 20).toFixed(1)}h`);
}
const spread = Math.max(...Object.values(t30)) / Math.min(...Object.values(t30));
check('gatherer pacing spread ≤ 3.5× at L30', spread <= 3.5, `spread ${spread.toFixed(2)}×`);
check('combat style L20 reachable in 0.3–8h', c20 >= 0.3 && c20 <= 8, `${c20.toFixed(1)}h`);
check('L50 is a real journey everywhere (≥ 2.5h — deliberately ~4× faster than OSRS)', [...Object.keys(t30)].every((k) => hoursTo((l) => gatherRate(k, l), 50) >= 2.5) && c50 >= 2.5,
  `combat ${c50.toFixed(1)}h`);
let peak = 0;
for (let L = 1; L <= 50; L++) { for (const sk of gatherSkills) peak = Math.max(peak, gatherRate(sk, L)); peak = Math.max(peak, combatRate(L)); }
check('no sub-50 method exceeds 60k xp/hr (exploit ceiling)', peak <= 60000, `peak ${Math.round(peak).toLocaleString()} xp/hr`);

const passedFinal = results.filter((r) => r.pass).length;
console.log(`${passedFinal}/${results.length} pacing checks passed.`);
if (passedFinal !== results.length) {
  console.log('❌ Pacing/balance drift detected.');
  process.exit(1);
}
console.log('✅ Progression paces fairly within all asserted bands.');
