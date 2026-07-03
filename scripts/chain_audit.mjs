#!/usr/bin/env node
// scripts/chain_audit.mjs — economy CHAIN audit: gather → process → consume.
//
// Fun leaks silently when an item can be gathered but has no use, or a recipe
// wants an item nothing provides. And a reference to an item id that doesn't
// exist at all is a live crash (see tree_resin). This gate:
//   HARD FAIL — any referenced item id that isn't defined in items.json
//   HARD FAIL — any recipe input that has NO source anywhere
//   WARN      — defined items with a source but no consumer (orphans = fun leaks)
//
// Run: node scripts/chain_audit.mjs   (wired for CI like the other gates)

import { readFileSync } from 'node:fs';
const load = (n) => JSON.parse(readFileSync(new URL(`../src/data/${n}.json`, import.meta.url), 'utf8'));

const items = load('items');
// The LIVE registry is items.json PLUS the code-generated gear variants in
// equipment.js — audit against what the game actually resolves at runtime.
const { ITEMS: LIVE } = await import('../src/items/equipment.js');
const recipes = load('recipes');
const nodes = load('world_nodes');
const drops = load('drop_tables');
const shops = load('shops');
let quests = []; try { quests = load('quests'); quests = quests.quests || quests; } catch { /* optional */ }

const defined = new Set([...items.map((i) => i.item_id), ...Object.keys(LIVE)]);
const refs = new Map();          // id -> [where it was referenced]
const ref = (id, where) => { if (!id || id === 'null' || id === 'coins') return; if (!refs.has(id)) refs.set(id, []); refs.get(id).push(where); };

const sources = new Map();       // id -> [how you get it]
const src = (id, how) => { if (!id) return; if (!sources.has(id)) sources.set(id, []); sources.get(id).push(how); };
const consumers = new Map();     // id -> [what uses it]
const use = (id, what) => { if (!id) return; if (!consumers.has(id)) consumers.set(id, []); consumers.get(id).push(what); };

// ---- sources (flat-row schemas: one row per node/drop/shop-item/recipe) ----
const parseInputs = (s) => String(s || '').split(';').map((t) => t.trim()).filter(Boolean).map((t) => t.split(':')[0].trim());
for (const n of nodes) for (const out of String(n.outputs || '').split(';')) { const id = out.trim(); if (id) { src(id, `node:${n.node_id}`); ref(id, `node:${n.node_id}`); } }
for (const d of drops) { if (d.item_id) { src(d.item_id, `drop:${d.drop_table_id}`); ref(d.item_id, 'drop-table'); } }
for (const s of shops) { if (s.item_id) { src(s.item_id, `shop:${s.shop_id}`); ref(s.item_id, 'shop-stock'); } }
for (const r of recipes) { if (r.output_item_id) { src(r.output_item_id, `recipe:${r.recipe_id}`); ref(r.output_item_id, 'recipe-output'); } }

// ---- consumers ----
for (const r of recipes) for (const id of parseInputs(r.inputs)) { use(id, `recipe:${r.recipe_id}`); ref(id, 'recipe-input'); }
for (const q of quests) {
  const walk = (o) => { if (!o || typeof o !== 'object') return;
    if (o.type === 'obtain' && o.target) { use(o.target, `quest:${q.id}`); ref(o.target, `quest:${q.id}`); }
    for (const k in o) walk(o[k]); };
  walk(q);
  for (const it of (q.rewards && q.rewards.items) || []) { const id = it.id || it.item_id; if (id) { src(id, `quest:${q.id}`); ref(id, 'quest-reward'); } }
}
// intrinsic consumers from item metadata: equipables, edibles, burnables etc.
for (const i of items) {
  const acts = String(i.inventory_actions || '');
  const cat = String(i.category || '');
  if (/equip|wield|wear/.test(acts) || /Weapon|Armour|Armor|Tool|Ammunition/i.test(cat)) use(i.item_id, 'equipable');
  if (/eat|drink/.test(acts) || /Food|Potion/i.test(cat)) use(i.item_id, 'consumable');
  if (/burn/.test(acts)) use(i.item_id, 'firemaking');
  if (/bury|offer/.test(acts) || /Bones/i.test(String(i.subcategory || ''))) use(i.item_id, 'prayer');
  if (String(i.used_in_recipes || '').trim()) use(i.item_id, 'recipes(meta)');
}

// ---- verdicts ----
// TEMPLATE wildcard classes ('any secondary', 'any planks'…) — see below.
const WILDCARDS = new Set(['secondary', 'planks', 'bars', 'monster_parts']);
const undefinedRefs = [...refs.entries()].filter(([id]) => !defined.has(id) && !WILDCARDS.has(id));
// Durable tools (knife, hammer…) are provided by the starter kit / code, not the
// data economy — a recipe requiring one isn't "unsourced" as long as it's defined.
const toolLike = new Set(items.filter((i) => /Tool/i.test(String(i.category || '') + String(i.subcategory || ''))).map((i) => i.item_id));
// TEMPLATE recipes: design-pack rows whose inputs are wildcard CLASSES the
// crafting engine doesn't implement yet ('any secondary', 'any planks'…). They
// are inert (never craftable), so they're a warning bucket, not a crash.
const templateRecipes = recipes.filter((r) => parseInputs(r.inputs).some((id) => WILDCARDS.has(id)));
const templateIds = new Set(templateRecipes.map((r) => r.recipe_id));
const unsourcedInputs = [];
for (const r of recipes) {
  if (templateIds.has(r.recipe_id)) continue;
  for (const id of parseInputs(r.inputs)) {
    if (id !== 'coins' && !sources.has(id) && !(defined.has(id) && toolLike.has(id))) unsourcedInputs.push(`${id}  (recipe ${r.recipe_id})`);
  }
}
const orphans = items.filter((i) => sources.has(i.item_id) && !consumers.has(i.item_id) && !/Currency|Key|Quest/i.test(String(i.category || '')));

const line = '─'.repeat(64);
console.log(`\n${line}\n  CHAIN AUDIT — gather → process → consume\n${line}`);
console.log(`  items defined ${defined.size} · sources ${sources.size} · consumers ${consumers.size}`);
if (undefinedRefs.length) { console.log(`\n  ❌ ${undefinedRefs.length} referenced item id(s) DO NOT EXIST (live crash risk):`); for (const [id, ws] of undefinedRefs.slice(0, 20)) console.log(`     - ${id}  ← ${[...new Set(ws)].slice(0, 3).join(', ')}`); }
if (unsourcedInputs.length) { console.log(`\n  ❌ ${unsourcedInputs.length} recipe input(s) with NO source anywhere:`); for (const s of [...new Set(unsourcedInputs)].slice(0, 20)) console.log(`     - ${s}`); }
if (orphans.length) { console.log(`\n  ⚠  ${orphans.length} obtainable item(s) with no consumer (fun leaks — give them a use):`); for (const o of orphans.slice(0, 25)) console.log(`     - ${o.item_id} (${o.category}/${o.subcategory})`); if (orphans.length > 25) console.log(`     … +${orphans.length - 25} more`); }
console.log(line);
if (undefinedRefs.length || unsourcedInputs.length) { console.log('  RESULT: FAIL\n'); process.exit(1); }
console.log(`  RESULT: PASS (${orphans.length} orphan warnings, ${templateRecipes.length} inert template recipes awaiting the wildcard-input system)\n`);
