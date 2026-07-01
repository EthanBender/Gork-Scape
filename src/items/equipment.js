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
  'stab_atk', 'slash_atk', 'crush_atk', 'magic_atk', 'range_atk', 'tinker_atk',
  'stab_def', 'slash_def', 'crush_def', 'magic_def', 'range_def', 'tinker_def',
  'melee_str', 'range_str', 'tinker_str', 'magic_dmg', 'prayer',
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

  // ----- Boss-forged weapons (Tier 9 — strict best-in-slot, above Meteor) -----
  // Forged from a rare boss component + Meteor Bars at high Smithing. Each has a
  // SPECIAL ATTACK powered by the shared spec-energy bar. See state.weaponSpec /
  // combat.resolveSpecial. Components drop from the named boss (drop_tables.json).
  grubmaw_maul: {
    id: 'grubmaw_maul', name: 'Grubmaw Maul', slot: 'weapon', twoHanded: true,
    weaponType: 'crush', attackSpeed: 4, color: 0x5a7a4a,
    reqSkill: 'Strength', reqLevel: 90, tier: 9, boss: 'Bog King',
    bonuses: bonuses({ crush_atk: 52, melee_str: 64, prayer: 4 }),
    spec: { name: 'Swamp Crush', cost: 50, damageMult: 1.5, accuracyMult: 1.3 },
  },
  starfall_longbow: {
    id: 'starfall_longbow', name: 'Starfall Longbow', slot: 'weapon', twoHanded: true,
    weaponType: 'ranged', attackSpeed: 3, attackRange: 8, color: 0x7a5acf,
    reqSkill: 'Ranged', reqLevel: 90, tier: 9, boss: 'Meteor Sprite',
    bonuses: bonuses({ range_atk: 58, range_str: 50 }),
    spec: { name: 'Meteor Shower', cost: 55, hits: 3 },
  },
  // Boss components (forge ingredients) — rare drops; not equippable themselves.
  bog_king_heart: {
    id: 'bog_king_heart', name: "Bog King's Heart", slot: null, stackable: false, color: 0x7a3a5a,
    forge: { into: 'grubmaw_maul', bar: 'meteor_bar', barQty: 3, smithing: 90, xp: 600 },
    bonuses: emptyBonuses(),
  },
  meteor_core: {
    id: 'meteor_core', name: 'Meteor Core', slot: null, stackable: false, color: 0x7a5acf,
    forge: { into: 'starfall_longbow', bar: 'meteor_bar', barQty: 3, smithing: 85, xp: 550 },
    bonuses: emptyBonuses(),
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

// ----- Weapon ladder hydration -----
// The 64 database weapons (Equipment/Weapon) ship as names + level reqs but no
// combat stats. Rather than hand-author 64 blocks, derive stats from the two
// axes their names encode: MATERIAL tier (Crude→Meteor) sets raw power, and
// WEAPON CLASS (dagger/sword/spear/club/mace/battle axe/shortbow/longbow) sets
// the damage type, speed, reach, and the attack-vs-strength split. Boss-forged
// weapons (a future tier) are hand-authored above this ladder. See COORDINATION.md.
const TIER_COLOR = {
  crude: 0x9a9186, bronze: 0xcd7f32, iron: 0x9a9a9a, steel: 0xc9c9d0,
  grubstone: 0x6f7a55, 'black iron': 0x33333c, bogbone: 0x8a8f6a,
  trollbone: 0xc9c1ad, meteor: 0x7a5acf,
};
// Raw power (the `t` in the stat formula) per material tier. Grubstone slots at
// 3.5 — a real mid-game step between Steel (3) and Black Iron (4) that fills the
// old L36–49 weapon dead zone — WITHOUT shifting any existing tier's stats,
// since every other tier keeps its original integer power.
const TIER_POWER = {
  crude: 0, bronze: 1, iron: 2, steel: 3, grubstone: 3.5,
  'black iron': 4, bogbone: 5, trollbone: 6, meteor: 7,
};
// Match a weapon's material tier by whole-name substring. "black iron" and
// "grubstone" are checked before the shorter names ("iron", the rest) they'd
// otherwise be shadowed by.
function tierKey(name) {
  const n = name.toLowerCase();
  if (n.includes('black iron')) return 'black iron';
  if (n.includes('grubstone')) return 'grubstone';
  for (const t of ['meteor', 'trollbone', 'bogbone', 'steel', 'iron', 'bronze', 'crude']) {
    if (n.includes(t)) return t;
  }
  return 'crude';
}
function tierIndex(name) { return TIER_POWER[tierKey(name)]; }

// class key must be matched as a whole word within the name; "battle axe" has no
// bare "axe" sibling in the ladder, and bows use their full "shortbow"/"longbow".
const WEAPON_CLASSES = [
  { key: 'dagger',     type: 'stab',   speed: 2, atkBase: 3, atkStep: 4, strBase: 1, strStep: 3 },
  { key: 'battle axe', type: 'slash',  speed: 4, atkBase: 3, atkStep: 5, strBase: 5, strStep: 6 },
  { key: 'sword',      type: 'slash',  speed: 3, atkBase: 4, atkStep: 5, strBase: 3, strStep: 4 },
  { key: 'spear',      type: 'stab',   speed: 3, range: 2, atkBase: 4, atkStep: 4, strBase: 3, strStep: 4 },
  { key: 'mace',       type: 'crush',  speed: 3, atkBase: 3, atkStep: 4, strBase: 4, strStep: 5, prayer: true },
  { key: 'club',       type: 'crush',  speed: 3, atkBase: 2, atkStep: 4, strBase: 4, strStep: 5 },
  { key: 'shortbow',   type: 'ranged', speed: 2, range: 4, twoHanded: true, ratkBase: 4, ratkStep: 5, rstrBase: 3, rstrStep: 4 },
  { key: 'longbow',    type: 'ranged', speed: 4, range: 7, twoHanded: true, ratkBase: 5, ratkStep: 6, rstrBase: 4, rstrStep: 5 },
];
const REQ_SKILL = { attack: 'Attack', strength: 'Strength', ranged: 'Ranged' };

export function weaponStatsFromRecord(rec) {
  if (rec.category !== 'Equipment' || rec.subcategory !== 'Weapon') return null;
  const name = rec.display_name || rec.item_id;
  const cls = WEAPON_CLASSES.find((c) => name.toLowerCase().includes(c.key));
  if (!cls) return null;
  const t = tierIndex(name);
  const b = emptyBonuses();
  const fields = {
    slot: 'weapon', weaponType: cls.type, attackSpeed: cls.speed,
    color: TIER_COLOR[tierKey(name)] || 0x8a8a8a, tier: t,
  };
  if (cls.twoHanded) fields.twoHanded = true;
  if (cls.range) fields.attackRange = cls.range;
  if (cls.type === 'ranged') {
    b.range_atk = Math.round(cls.ratkBase + t * cls.ratkStep);
    b.range_str = Math.round(cls.rstrBase + t * cls.rstrStep);
  } else {
    const atkKey = { stab: 'stab_atk', slash: 'slash_atk', crush: 'crush_atk' }[cls.type];
    b[atkKey] = Math.round(cls.atkBase + t * cls.atkStep);
    b.melee_str = Math.round(cls.strBase + t * cls.strStep);
    if (cls.prayer) b.prayer = 1 + Math.floor(t / 2); // maces carry a small prayer bonus
  }
  fields.bonuses = b;
  if (rec.related_skill && (rec.level_requirement || 0) > 1) {
    fields.reqSkill = REQ_SKILL[rec.related_skill] || null;
    fields.reqLevel = rec.level_requirement;
  }
  return fields;
}

function hydrateFromDatabase() {
  if (!GameData || !GameData.items) return;
  for (const rec of GameData.items) {
    const id = rec.item_id;
    if (ITEMS[id]) continue; // don't clobber hand-authored render/combat data
    const wpn = weaponStatsFromRecord(rec);
    if (wpn) {
      ITEMS[id] = { id, name: rec.display_name || id, stackable: false, fromDatabase: true, ...wpn };
      continue;
    }
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
