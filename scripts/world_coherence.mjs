// WORLD COHERENCE — turns docs/WORLD_BIBLE.md from prose into an enforced GATE.
// Checks the canon data (peoples.json, regions.json, + later npcs/lore/mysteries) and the
// content that references it (quests.json) against the bible's principles. Lenient today
// (foundation just scaffolded); the BUDGET/BANDS below only tighten — like map_defects,
// numbers may only go toward the bible's targets, never away. Run in the gate chain.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REGION_ANCHORS } from '../src/world/worldData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const arr = (j, k) => Array.isArray(j) ? j : (j[k] || Object.values(j).find(Array.isArray) || []);

// ---- ratcheting knobs (may only move TOWARD the bible; see map_defects for the pattern) ----
const TEACHES_UNTAGGED_BUDGET = 19;   // quests without a `teaches:[...]` link. Target 0. Ratchet DOWN as quests are tagged.
const IDENTITY_MIN_FIELDS = 2;         // non-empty identity fields every region must carry. Target ~5. Ratchet UP.
const THREAD_MAIN_BAND = [0.10, 0.50]; // share of quests on the main/mystery thread. Bible target 0.30. Tighten toward it.

const peoples = arr(load('src/data/peoples.json'), 'peoples');
const regions = arr(load('src/data/regions.json'), 'regions');
const quests = arr(load('src/data/quests.json'), 'quests');
const regionById = new Map(regions.map((r) => [r.id, r]));
const peopleById = new Map(peoples.map((p) => [p.id, p]));

const fails = [];
const warns = [];

// 1) cultures before races — every people leads with a worldview
const noWorldview = peoples.filter((p) => !p.id || !p.name || !(p.worldview && p.worldview.trim().length >= 12));
if (noWorldview.length) fails.push(`peoples missing a worldview: ${noWorldview.map((p) => p.id || '?').join(', ')}`);

// 2) every REGION_ANCHOR has a canon record (no region without an identity)
const missingRegions = REGION_ANCHORS.filter((a) => !regionById.has(a.id));
if (missingRegions.length) fails.push(`REGION_ANCHORS with no regions.json entry: ${missingRegions.map((a) => a.id).join(', ')}`);

// 3) region identity completeness — count non-empty identity fields
let weakest = { id: null, n: 99 };
for (const r of regions) {
  const id = r.identity || {};
  const n = Object.values(id).filter((v) => typeof v === 'string' && v.trim().length > 0).length;
  if (n < weakest.n) weakest = { id: r.id, n };
  if (n < IDENTITY_MIN_FIELDS) fails.push(`region '${r.id}' has ${n} identity fields (< ${IDENTITY_MIN_FIELDS})`);
}

// 4) no dangling references — people.homeRegion and region.peoples must resolve
for (const p of peoples) if (p.homeRegion && !regionById.has(p.homeRegion)) fails.push(`people '${p.id}' homeRegion '${p.homeRegion}' is not a region`);
for (const r of regions) for (const pid of (r.peoples || [])) if (!peopleById.has(pid)) fails.push(`region '${r.id}' lists unknown people '${pid}'`);

// 5) the 30/70 rule — derive thread, hold the ratio
const threadOf = (q) => q.thread || (q.mystery || (q.teaches || []).some((t) => String(t).startsWith('mystery:')) ? 'main' : (q.act >= 3 ? 'main' : 'local'));
const mainN = quests.filter((q) => threadOf(q) === 'main').length;
const mainShare = quests.length ? mainN / quests.length : 0;
if (mainShare < THREAD_MAIN_BAND[0] || mainShare > THREAD_MAIN_BAND[1]) fails.push(`main-thread share ${(mainShare * 100).toFixed(0)}% outside band ${THREAD_MAIN_BAND.map((x) => x * 100 + '%').join('–')} (bible target 30%)`);

// 6) every quest teaches something about the world (ratcheting budget)
const untaught = quests.filter((q) => !(Array.isArray(q.teaches) && q.teaches.length));
if (untaught.length > TEACHES_UNTAGGED_BUDGET) fails.push(`${untaught.length} quests without a 'teaches' link (> budget ${TEACHES_UNTAGGED_BUDGET})`);

// 7) any teaches/region references a quest DOES carry must resolve to canon
const canonIds = new Set([...peopleById.keys(), ...regionById.keys()]);
for (const q of quests) {
  if (q.region && !regionById.has(q.region)) fails.push(`quest '${q.id}' region '${q.region}' is not canon`);
  for (const t of (q.teaches || [])) { const id = String(t).includes(':') ? String(t).split(':')[1] : String(t); if (t && !canonIds.has(id) && !String(t).startsWith('mystery:') && !String(t).startsWith('lore:')) warns.push(`quest '${q.id}' teaches unknown '${t}'`); }
}

// 8) conditional canon (not yet scaffolded) — rule of wonder, recurring NPCs, lore truth-tags
const deferred = [];
if (existsSync(join(ROOT, 'src/data/mysteries.json'))) {
  const mys = arr(load('src/data/mysteries.json'), 'mysteries');
  const never = mys.filter((m) => m.answered === 'never').length;
  if (never < 3) fails.push(`Rule of Wonder: only ${never} mysteries answered 'never' (want >= 3)`);
} else deferred.push('mysteries.json (Rule of Wonder)');
if (!existsSync(join(ROOT, 'src/data/npcs.json'))) deferred.push('npcs.json (recurring characters)');
if (!existsSync(join(ROOT, 'src/data/lore.json'))) deferred.push('lore.json (campfire stories)');

// ---- report ----
console.log('WORLD COHERENCE — bible enforcement');
console.log('──────────────────────────────────────────────────');
console.log(`  peoples          ${peoples.length}   (worldviews ${peoples.length - noWorldview.length}/${peoples.length}, active: ${peoples.filter((p) => p.status === 'active').length})`);
console.log(`  regions          ${regions.length}/${REGION_ANCHORS.length} anchors covered   (weakest identity: ${weakest.id} @ ${weakest.n} fields, min ${IDENTITY_MIN_FIELDS})`);
console.log(`  30/70 thread     ${(mainShare * 100).toFixed(0)}% main / ${(100 - mainShare * 100).toFixed(0)}% local   (target 30/70)`);
console.log(`  quest-teaches    ${quests.length - untaught.length}/${quests.length} tagged   (untagged ${untaught.length} ≤ budget ${TEACHES_UNTAGGED_BUDGET})`);
if (deferred.length) console.log(`  deferred canon   ${deferred.join(' · ')}`);
if (warns.length) { console.log('  warnings:'); for (const w of warns.slice(0, 8)) console.log('   · ' + w); }
console.log('──────────────────────────────────────────────────');
if (fails.length) { console.log('RESULT: FAIL'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('RESULT: PASS (foundation green — ratchet the knobs toward the bible as content is authored)');
