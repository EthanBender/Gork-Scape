// src/items/equipment.js
// Item definitions, the 13 equipment slots, and stat-bonus helpers.
//
// Importing GameData here (which loads via top-level await) means the design
// database is fully loaded before the game boots, since state.js -> main.js
// depend on this module. See src/data/gameData.js and COORDINATION.md.

import { GameData } from '../data/gameData.js';

// The 13 wearable slots. "2h" is not a slot itself — a two-handed weapon
// occupies `weapon` and blocks `shield` (handled in state.equipItem).
export const EQUIP_SLOTS = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield',
  'legs', 'hands', 'feet', 'ring',
];

// Every stat key an item can contribute. Used to build zeroed totals.
export const STAT_KEYS = [
  'stab_atk', 'slash_atk', 'crush_atk', 'magic_atk', 'range_atk',
  'stab_def', 'slash_def', 'crush_def', 'magic_def', 'range_def',
  'melee_str', 'range_str', 'magic_dmg', 'prayer',
];

export function emptyBonuses() {
  const b = {};
  for (const k of STAT_KEYS) b[k] = 0;
  return b;
}

// Build a full bonus object from a sparse {key:value} partial.
function bonuses(partial) {
  return Object.assign(emptyBonuses(), partial);
}

// Item registry. Each item: { id, name, slot, twoHanded?, color, stackable?,
//   tool?, weaponType?, attackSpeed?, bonuses, cookInto?, cookLevel?, ... }
// `slot: null` items (logs, fish, ore, bars) are inventory-only resources.
export const ITEMS = {
  // ----- Equipment -----
  goblin_spear: {
    id: 'goblin_spear', name: 'Goblin Spear', slot: 'weapon',
    // A spear pokes one tile past normal melee — attackRange 2. (Melee weapons
    // that omit attackRange default to 1 tile; see combat.weaponRange.)
    weaponType: 'stab', attackSpeed: 2, attackRange: 2, color: 0x8a6d3b,
    bonuses: bonuses({ stab_atk: 10, melee_str: 8 }),
  },
  goblin_hide_armor: {
    id: 'goblin_hide_armor', name: 'Goblin Hide Armor', slot: 'body',
    color: 0x6b4f2a,
    bonuses: bonuses({ slash_def: 12, range_def: 6, magic_def: -5 }),
  },
  goblin_shortbow: {
    id: 'goblin_shortbow', name: 'Goblin Shortbow', slot: 'weapon',
    // Ranged weapon — attacks from up to 4 tiles away (weaponRange default for
    // ranged; overridable per-weapon, e.g. a longbow could set attackRange: 6).
    twoHanded: true, weaponType: 'ranged', attackSpeed: 2, attackRange: 4, color: 0x9c7a3c,
    bonuses: bonuses({ range_atk: 15, range_str: 10 }),
  },
  bronze_hatchet: {
    id: 'bronze_hatchet', name: 'Bronze Hatchet', slot: 'weapon',
    weaponType: 'slash', attackSpeed: 3, tool: 'woodcutting', color: 0xb87333,
    bonuses: bonuses({ slash_atk: 4, melee_str: 2 }),
  },
  bronze_pickaxe: {
    id: 'bronze_pickaxe', name: 'Bronze Pickaxe', slot: 'weapon',
    weaponType: 'stab', attackSpeed: 3, tool: 'mining', color: 0xa8a8a8,
    bonuses: bonuses({ stab_atk: 3, melee_str: 2 }),
  },

  // ----- Resources / consumables (inventory only) -----
  logs: {
    id: 'logs', name: 'Logs', slot: null, stackable: false, color: 0x8b5a2b,
    bonuses: emptyBonuses(),
  },
  raw_fish: {
    id: 'raw_fish', name: 'Raw Fish', slot: null, stackable: false,
    color: 0x5b8fb0, cookInto: 'cooked_fish', cookLevel: 1, color2: 0x9ecae1,
    bonuses: emptyBonuses(),
  },
  cooked_fish: {
    id: 'cooked_fish', name: 'Cooked Fish', slot: null, stackable: false,
    color: 0xe0a96d, bonuses: emptyBonuses(),
  },
  burnt_fish: {
    id: 'burnt_fish', name: 'Burnt Fish', slot: null, stackable: false,
    color: 0x2b2b2b, bonuses: emptyBonuses(),
  },
  ore: {
    id: 'ore', name: 'Copper Ore', slot: null, stackable: false,
    color: 0xb87333, smithInto: 'bronze_bar', smithCost: 2, bonuses: emptyBonuses(),
  },
  bronze_bar: {
    id: 'bronze_bar', name: 'Bronze Bar', slot: null, stackable: false,
    color: 0xcd7f32, bonuses: emptyBonuses(),
  },
  // ----- Woodcutting logs -----
  oak_logs:    { id: 'oak_logs', name: 'Oak Logs', slot: null, color: 0xa07b3a, bonuses: emptyBonuses() },
  willow_logs: { id: 'willow_logs', name: 'Willow Logs', slot: null, color: 0x7d8b3a, bonuses: emptyBonuses() },
  dead_logs:   { id: 'dead_logs', name: 'Dead Logs', slot: null, color: 0x5a4a3a, bonuses: emptyBonuses() },

  // ----- Mining ores -----
  tin_ore:  { id: 'tin_ore', name: 'Tin Ore', slot: null, color: 0x9a9a9a, smithInto: 'bronze_bar', bonuses: emptyBonuses() },
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', slot: null, color: 0x8a5a3a, smithInto: 'iron_bar', smithCost: 1, bonuses: emptyBonuses() },
  coal:     { id: 'coal', name: 'Coal', slot: null, color: 0x2a2a2a, bonuses: emptyBonuses() },
  gold_ore: { id: 'gold_ore', name: 'Gold Ore', slot: null, color: 0xe3c14a, bonuses: emptyBonuses() },
  gem:      { id: 'gem', name: 'Uncut Gem', slot: null, color: 0x5ad0d0, bonuses: emptyBonuses() },
  iron_bar: { id: 'iron_bar', name: 'Iron Bar', slot: null, color: 0x8a8a8a, bonuses: emptyBonuses() },

  // ----- Fishing catches (raw + cooked) -----
  raw_trout:  { id: 'raw_trout', name: 'Raw Trout', slot: null, color: 0x9ab0c0, cookInto: 'cooked_trout', cookLevel: 5, bonuses: emptyBonuses() },
  cooked_trout: { id: 'cooked_trout', name: 'Trout', slot: null, color: 0xd0a070, heal: 4, bonuses: emptyBonuses() },
  raw_pike:   { id: 'raw_pike', name: 'Raw Pike', slot: null, color: 0x8aa0b0, cookInto: 'cooked_pike', cookLevel: 12, bonuses: emptyBonuses() },
  cooked_pike: { id: 'cooked_pike', name: 'Pike', slot: null, color: 0xcaa060, heal: 6, bonuses: emptyBonuses() },
  raw_eel:    { id: 'raw_eel', name: 'Raw Eel', slot: null, color: 0x6a7a5a, cookInto: 'cooked_eel', cookLevel: 20, bonuses: emptyBonuses() },
  cooked_eel: { id: 'cooked_eel', name: 'Eel', slot: null, color: 0xb09050, heal: 8, bonuses: emptyBonuses() },

  // ----- Tools (gates for skilling) -----
  iron_pickaxe: {
    id: 'iron_pickaxe', name: 'Iron Pickaxe', slot: 'weapon', weaponType: 'stab',
    attackSpeed: 3, tool: 'mining', color: 0x9a9a9a,
    bonuses: bonuses({ stab_atk: 6, melee_str: 4 }),
  },
  iron_axe: {
    id: 'iron_axe', name: 'Iron Axe', slot: 'weapon', weaponType: 'slash',
    attackSpeed: 3, tool: 'woodcutting', color: 0x9a9a9a,
    bonuses: bonuses({ slash_atk: 7, melee_str: 4 }),
  },
  small_net:    { id: 'small_net', name: 'Small Fishing Net', slot: null, tool: 'net', color: 0xcfcfa0, bonuses: emptyBonuses() },
  fishing_rod:  { id: 'fishing_rod', name: 'Fishing Rod', slot: null, tool: 'rod', color: 0xa07840, bonuses: emptyBonuses() },
  harpoon:      { id: 'harpoon', name: 'Harpoon', slot: null, tool: 'harpoon', color: 0xb0b0b0, bonuses: emptyBonuses() },
  fishing_cage: { id: 'fishing_cage', name: 'Lobster/Eel Cage', slot: null, tool: 'cage', color: 0x8a6a3a, bonuses: emptyBonuses() },

  // ----- Ammunition (ranged) -----
  bronze_arrow: {
    id: 'bronze_arrow', name: 'Bronze Arrow', slot: 'ammo', stackable: true,
    color: 0x9a6a3a, bonuses: bonuses({ range_str: 2 }),
  },

  bones: {
    id: 'bones', name: 'Bones', slot: null, stackable: false,
    color: 0xe8e2cf, buryXp: 4.5, bonuses: emptyBonuses(),
  },
  big_bones: {
    id: 'big_bones', name: 'Big Bones', slot: null, stackable: false,
    color: 0xdad2b8, buryXp: 15, bonuses: emptyBonuses(),
  },
  coins: {
    id: 'coins', name: 'Coins', slot: null, stackable: true,
    color: 0xf2c84b, bonuses: emptyBonuses(),
  },
};

// A legible placeholder color per database category, so the ~1000 hydrated
// items still read as distinct colored squares until real art lands.
const CATEGORY_COLORS = {
  Resource: 0x6a8f4a, 'Processed Material': 0xa98b5a, Consumable: 0xd08a4a,
  Junk: 0x555046, Tool: 0x9a8a6a, Equipment: 0x8a8a9a, Ammo: 0xb0a060,
  'Quest/Build Item': 0x7a6cae, 'Unique Drop': 0xc9a227, Utility: 0x5a9aa0,
  'Drop Material': 0x9c6b5a,
};

// Hydrate ITEMS with a render/inventory stub for every database item that isn't
// hand-authored, so makeItem()/addItem() work for the whole 1072-item catalog
// (recipes, drops, shops all reference these). Hand-authored entries win — they
// carry combat stats / cook data the database doesn't. Runs once at load; the
// GameData import above guarantees the database is ready. See COORDINATION.md.
// Food heals when eaten. items.json has no heal field, but the design curve
// tracks cooking level (progression pack: shrimp@1→3, trout@10→7, up to
// grubshark@70→25). Derive heal from the food's level_requirement so every
// cooked meal / food is edible and scales by tier. Non-food -> 0.
const FOOD_SUBCATS = new Set(['Cooked Meal', 'Food']);
export function foodHealFromRecord(rec) {
  if (rec.category !== 'Consumable' || !FOOD_SUBCATS.has(rec.subcategory)) return 0;
  return Math.max(3, Math.round(2 + (rec.level_requirement || 1) * 0.34));
}

function hydrateFromDatabase() {
  if (!GameData || !GameData.items) return;
  for (const rec of GameData.items) {
    const id = rec.item_id;
    if (ITEMS[id]) continue; // don't clobber hand-authored render/combat data
    const heal = foodHealFromRecord(rec);
    ITEMS[id] = {
      id,
      name: rec.display_name || id,
      slot: null,                         // stubs aren't equippable (no stat data)
      stackable: !!rec.stackable,
      color: CATEGORY_COLORS[rec.category] || 0x8a8a8a,
      bonuses: emptyBonuses(),
      ...(heal > 0 ? { heal, eatable: true } : {}),
      fromDatabase: true,
    };
  }
}
hydrateFromDatabase();

export function makeItem(id) {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item id: ${id}`);
  // Items are simple value objects; share the definition by reference.
  return def;
}

// Merged item view: the hand-authored render/combat overlay (slot, bonuses,
// color, weaponType, tool, cookInto, heal) plus the economy metadata from
// items.json (category, gp value, sources, uses, requirements, stackable).
// Used by tooltips so every item explains *why it matters*. Falls back
// gracefully when an id exists in only one source. See COORDINATION.md for the
// known legacy-id vs database-id gap (e.g. `logs` vs `normal_logs`).
export function itemView(id) {
  const overlay = ITEMS[id] || null;
  const meta = GameData.item(id) || null;
  if (!overlay && !meta) return null;
  return {
    id,
    name: (overlay && overlay.name) || (meta && meta.display_name) || id,
    overlay,          // render/combat fields (may be null for pure-data items)
    meta,             // economy metadata (may be null for legacy-only items)
  };
}

// Sum the bonus objects of a slot->item map into a single totals object.
export function sumBonuses(equipMap) {
  const total = emptyBonuses();
  for (const slot of Object.keys(equipMap)) {
    const item = equipMap[slot];
    if (!item || !item.bonuses) continue;
    for (const k of STAT_KEYS) total[k] += item.bonuses[k] || 0;
  }
  return total;
}
