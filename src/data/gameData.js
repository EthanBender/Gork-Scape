// src/data/gameData.js
// Central game-data registry. Loads the design database (items, recipes,
// world nodes, monsters, drop tables, shops, level unlocks) from the staged
// JSON and exposes indexed lookup helpers. This is the SOURCE OF TRUTH the
// rest of the game consumes — do not hardcode progression values elsewhere.
//
// See COORDINATION.md: the economy/items lane owns this file. World-gen calls
// GameData.node(id) / GameData.monster(id) to resolve the instances it places.
//
// Loading uses top-level await + fetch, so any module that imports GameData is
// guaranteed to see fully-populated data before its own body runs. (Requires
// serving over HTTP — see README; file:// won't fetch.)

const FILES = [
  'items', 'recipes', 'world_nodes', 'monsters',
  'drop_tables', 'shops', 'level_unlocks', 'firemaking',
];

// Resilient loader: a missing/broken data file degrades tooltips etc. but must
// never brick the game's boot (top-level await would otherwise reject fatally,
// which matters while another agent is developing against the same folder).
async function fetchJson(name) {
  const url = new URL(`./${name}.json`, import.meta.url);
  try {
    // Node (the world server + audit/sim gates): fetch() can't read file:// URLs,
    // which used to silently leave the SERVER running on empty tables. Read from
    // disk so Node sees the exact same data the browser does.
    if (typeof window === 'undefined') {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
    }
    // `no-store`: with no build step and several agents editing these JSON packs
    // live, the browser's HTTP cache otherwise serves a stale table after an edit
    // (a real "I changed the JSON but the game didn't" trap). Always re-fetch.
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`gameData: could not load ${name}.json (${e.message}); using empty table`);
    return [];
  }
}

// Index an array of records by a key field into a Map.
function indexBy(list, key) {
  const m = new Map();
  for (const rec of list) m.set(rec[key], rec);
  return m;
}

// Group records into Map<key, record[]>.
function groupBy(list, key) {
  const m = new Map();
  for (const rec of list) {
    const k = rec[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(rec);
  }
  return m;
}

// Some fields are semicolon-delimited lists packed in a string
// (e.g. "planks;bow_staves;arrow_shafts"). Normalise to an array.
import { canonicalId } from './idAliases.js';

export function splitList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(';').map((s) => s.trim()).filter(Boolean);
}

// Recipe inputs come as "normal_logs:1;iron_bar:2" -> [{id, qty}].
export function parseInputs(v) {
  return splitList(v).map((tok) => {
    const [id, qty] = tok.split(':');
    return { id, qty: Number(qty) || 1 };
  });
}

const [
  items, recipes, worldNodes, monsters, dropTables, shops, levelUnlocks, firemaking,
] = await Promise.all(FILES.map(fetchJson));

const itemsById = indexBy(items, 'item_id');
const nodesById = indexBy(worldNodes, 'node_id');
const monstersById = indexBy(monsters, 'monster_id');
const recipesById = indexBy(recipes, 'recipe_id');
const recipesByStation = groupBy(recipes, 'station');
const dropsByTable = groupBy(dropTables, 'drop_table_id');
const shopsById = groupBy(shops, 'shop_id');
// Firemaking: a burnable log id (canonical) -> its light-a-fire definition.
const firemakingByLog = indexBy(firemaking, 'log_id');

export const GameData = {
  // raw tables (read-only use)
  items, recipes, worldNodes, monsters, dropTables, shops, levelUnlocks, firemaking,

  // --- ID resolvers (the handshake API used across lanes) ---
  // item() resolves legacy short ids (logs, ore, raw_fish) through the alias
  // map so live-game inventory items find their database metadata.
  item(id) { return itemsById.get(id) || itemsById.get(canonicalId(id)); },
  node(id) { return nodesById.get(id); },
  monster(id) { return monstersById.get(id); },
  recipe(id) { return recipesById.get(id); },

  // Recipes exposed by a station type: 'furnace' | 'anvil' | 'range' | 'fire'
  // | 'crafting_bench' | 'sawmill' | ...
  recipesForStation(station) { return recipesByStation.get(station) || []; },

  // Drop-table rows for a monster's drop_table_id.
  dropTable(tableId) { return dropsByTable.get(tableId) || []; },

  // Shop stock rows for a shop_id.
  shop(shopId) { return shopsById.get(shopId) || []; },

  // Firemaking: resolve a held log (legacy or canonical) to its burn def, or
  // list every burnable log tier. `station` on the def is the temp fire's type.
  firemaking(logId) {
    return firemakingByLog.get(logId) || firemakingByLog.get(canonicalId(logId));
  },
  firemakingList() { return firemaking; },

  // Next unlock strictly above a level for a skill (drives skill-panel "next").
  // level_unlocks rows: { unlock_id, display_name, skill, level, unlock_type }.
  nextSkillUnlock(skillId, currentLevel) {
    let best = null;
    for (const u of levelUnlocks) {
      if (u.skill !== skillId) continue;
      if (u.level > currentLevel && (!best || u.level < best.level)) best = u;
    }
    return best;
  },
};

// Handy for console debugging.
if (typeof window !== 'undefined') window.__GameData = GameData;
