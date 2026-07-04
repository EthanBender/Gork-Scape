// WORLD COHERENCE — turns docs/WORLD_BIBLE.md from prose into an enforced GATE.
// Checks the canon data (peoples/regions/npcs/lore/mysteries) and the content that
// references it (quests.json) against the bible's principles. Knobs below only tighten —
// like map_defects, numbers may only move TOWARD the bible's targets, never away.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REGION_ANCHORS } from '../src/world/worldData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const has = (p) => existsSync(join(ROOT, p));
const arr = (j, k) => Array.isArray(j) ? j : (j[k] || Object.values(j).find(Array.isArray) || []);
const opt = (p, k) => has(p) ? arr(load(p), k) : null;

// ---- ratcheting knobs (may only move TOWARD the bible; see map_defects for the pattern) ----
const TEACHES_UNTAGGED_BUDGET = 0;    // quests without a `teaches:[...]` link. All 19 tagged 2026-07-04 → budget 0 (every new quest must teach).
const IDENTITY_MIN_FIELDS = 2;         // non-empty identity fields every region must carry. Target ~5. Ratchet UP.
const THREAD_MAIN_BAND = [0.15, 0.45]; // share of quests on the main/mystery thread. Bible target 0.30 (now at 0.21). Tighten toward it.
const WONDER_MIN_NEVER = 3;            // mysteries that stay 'never' answered. The Rule of Wonder. Ratchet UP.

const peoples = arr(load('src/data/peoples.json'), 'peoples');
const regions = arr(load('src/data/regions.json'), 'regions');
const quests = arr(load('src/data/quests.json'), 'quests');
const npcs = opt('src/data/npcs.json', 'npcs');
const lore = opt('src/data/lore.json', 'lore');
const mysteries = opt('src/data/mysteries.json', 'mysteries');

const regionById = new Map(regions.map((r) => [r.id, r]));
const peopleById = new Map(peoples.map((p) => [p.id, p]));
const npcById = new Map((npcs || []).map((n) => [n.id, n]));
const questById = new Map(quests.map((q) => [q.id, q]));
const canonIds = new Set([...peopleById.keys(), ...regionById.keys()]);

const fails = [];
const warns = [];

// 1) cultures before races — every people leads with a worldview
const noWorldview = peoples.filter((p) => !p.id || !p.name || !(p.worldview && p.worldview.trim().length >= 12));
if (noWorldview.length) fails.push(`peoples missing a worldview: ${noWorldview.map((p) => p.id || '?').join(', ')}`);

// 2) every REGION_ANCHOR has a canon record
const missingRegions = REGION_ANCHORS.filter((a) => !regionById.has(a.id));
if (missingRegions.length) fails.push(`REGION_ANCHORS with no regions.json entry: ${missingRegions.map((a) => a.id).join(', ')}`);

// 3) region identity completeness
let weakest = { id: null, n: 99 };
for (const r of regions) {
  const n = Object.values(r.identity || {}).filter((v) => typeof v === 'string' && v.trim().length > 0).length;
  if (n < weakest.n) weakest = { id: r.id, n };
  if (n < IDENTITY_MIN_FIELDS) fails.push(`region '${r.id}' has ${n} identity fields (< ${IDENTITY_MIN_FIELDS})`);
}

// 4) no dangling references — homeRegion / region.peoples
for (const p of peoples) if (p.homeRegion && !regionById.has(p.homeRegion)) fails.push(`people '${p.id}' homeRegion '${p.homeRegion}' is not a region`);
for (const r of regions) for (const pid of (r.peoples || [])) if (!peopleById.has(pid)) fails.push(`region '${r.id}' lists unknown people '${pid}'`);

// 5) the 30/70 rule
const threadOf = (q) => q.thread || ((q.mystery || (q.teaches || []).some((t) => String(t).startsWith('mystery:'))) ? 'main' : (q.act >= 3 ? 'main' : 'local'));
const mainN = quests.filter((q) => threadOf(q) === 'main').length;
const mainShare = quests.length ? mainN / quests.length : 0;
if (mainShare < THREAD_MAIN_BAND[0] || mainShare > THREAD_MAIN_BAND[1]) fails.push(`main-thread share ${(mainShare * 100).toFixed(0)}% outside band ${THREAD_MAIN_BAND.map((x) => x * 100 + '%').join('–')} (bible target 30%)`);

// 6) every quest teaches something (ratcheting budget)
const untaught = quests.filter((q) => !(Array.isArray(q.teaches) && q.teaches.length));
if (untaught.length > TEACHES_UNTAGGED_BUDGET) fails.push(`${untaught.length} quests without a 'teaches' link (> budget ${TEACHES_UNTAGGED_BUDGET})`);

// 7) references a quest carries must resolve to canon
for (const q of quests) {
  if (q.region && !regionById.has(q.region)) fails.push(`quest '${q.id}' region '${q.region}' is not canon`);
  for (const t of (q.teaches || [])) { const s = String(t); const id = s.includes(':') ? s.split(':')[1] : s;
    const okPrefix = s.startsWith('mystery:') ? (mysteries || []).some((m) => m.id === id) : s.startsWith('npc:') ? npcById.has(id) : s.startsWith('lore:') ? (lore || []).some((l) => l.id === id) : canonIds.has(id);
    if (t && !okPrefix) warns.push(`quest '${q.id}' teaches unknown '${t}'`); }
}

// 8) NPCs — quest givers resolve; homes/appearances are canon
if (npcs) {
  for (const n of npcs) { if (!n.id || !n.name) fails.push('an npc is missing id/name');
    if (n.home && !regionById.has(n.home)) fails.push(`npc '${n.id}' home '${n.home}' is not a region`);
    for (const r of (n.appearsIn || [])) if (!regionById.has(r)) fails.push(`npc '${n.id}' appearsIn unknown region '${r}'`); }
  for (const q of quests) { const g = q.giver && q.giver.npc; if (g && !npcById.has(g)) fails.push(`quest '${q.id}' giver npc '${g}' not in npcs.json`); }
}

// 9) lore — valid truth tag + resolvable region
if (lore) { const TAGS = new Set(['true', 'exaggerated', 'nonsense']);
  for (const l of lore) { if (!TAGS.has(l.truth)) fails.push(`lore '${l.id}' bad truth tag '${l.truth}'`); if (l.region && !regionById.has(l.region)) fails.push(`lore '${l.id}' region '${l.region}' is not canon`); } }

// 10) mysteries — Rule of Wonder + valid resolution
if (mysteries) {
  for (const m of mysteries) { if (m.region && !regionById.has(m.region)) fails.push(`mystery '${m.id}' region '${m.region}' is not canon`);
    const a = m.answered || ''; const ok = a === 'never' || a === 'eventually' || (a.startsWith('quest:') && questById.has(a.split(':')[1]));
    if (!ok) fails.push(`mystery '${m.id}' answered '${a}' is invalid or points at a missing quest`); }
  const never = mysteries.filter((m) => m.answered === 'never').length;
  if (never < WONDER_MIN_NEVER) fails.push(`Rule of Wonder: only ${never} mysteries answered 'never' (want >= ${WONDER_MIN_NEVER})`);
}

const deferred = ['npcs.json', 'lore.json', 'mysteries.json'].filter((f) => !has('src/data/' + f));
const recurring = (npcs || []).filter((n) => n.recurring || (n.appearsIn || []).length >= 2).length;

// ---- report ----
console.log('WORLD COHERENCE — bible enforcement');
console.log('──────────────────────────────────────────────────');
console.log(`  peoples          ${peoples.length}   (worldviews ${peoples.length - noWorldview.length}/${peoples.length}, active ${peoples.filter((p) => p.status === 'active').length})`);
console.log(`  regions          ${regions.length}/${REGION_ANCHORS.length} anchors   (weakest identity: ${weakest.id} @ ${weakest.n}, min ${IDENTITY_MIN_FIELDS})`);
if (npcs) console.log(`  npcs             ${npcs.length}   (recurring ${recurring}; all quest-givers resolve)`);
if (lore) console.log(`  lore             ${lore.length} rumors   (${lore.filter((l) => l.truth === 'true').length} true · ${lore.filter((l) => l.truth === 'exaggerated').length} exaggerated · ${lore.filter((l) => l.truth === 'nonsense').length} nonsense)`);
if (mysteries) console.log(`  mysteries        ${mysteries.length}   (${mysteries.filter((m) => m.answered === 'never').length} 'never' — Rule of Wonder, min ${WONDER_MIN_NEVER})`);
console.log(`  30/70 thread     ${(mainShare * 100).toFixed(0)}% main / ${(100 - mainShare * 100).toFixed(0)}% local   (target 30/70)`);
console.log(`  quest-teaches    ${quests.length - untaught.length}/${quests.length} tagged   (untagged ${untaught.length} ≤ budget ${TEACHES_UNTAGGED_BUDGET})`);
if (deferred.length) console.log(`  deferred canon   ${deferred.join(' · ')}`);
if (warns.length) { console.log('  warnings:'); for (const w of warns.slice(0, 8)) console.log('   · ' + w); }
console.log('──────────────────────────────────────────────────');
if (fails.length) { console.log('RESULT: FAIL'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('RESULT: PASS (canon complete — ratchet the knobs toward the bible as content is authored)');
