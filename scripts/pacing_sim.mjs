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
console.log(`${passed}/${results.length} pacing checks passed.`);
if (passed !== results.length) {
  console.log('❌ Pacing/balance drift detected.');
  process.exit(1);
}
console.log('✅ Progression paces fairly within all asserted bands.');
