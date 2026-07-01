// src/data/idAliases.js
// Bridges the live game's short/legacy item ids to the canonical ids used by
// the design database (items.json et al.). Approved approach: alias now,
// migrate the game to canonical ids later (see COORDINATION.md). GameData.item()
// resolves through this map so tooltips/systems work without renaming live code.
//
// Only CONFIDENT 1:1 mappings go in ITEM_ALIASES. Ambiguous or game-only ids are
// documented below and intentionally left unmapped (their tooltips fall back to
// the hand-authored overlay in equipment.js).

export const ITEM_ALIASES = {
  // resources — starter tier
  logs:        'normal_logs',
  ore:         'copper_ore',
  dead_logs:   'deadwood_logs',

  // fishing — the game's generic "fish" is the shrimp starter chain
  raw_fish:    'raw_shrimp',
  cooked_fish: 'cooked_shrimp',
  burnt_fish:  'burnt_shrimp',

  // eels — the world's single "eel" fishing spot sits in the bog; the DB splits
  // eels into river vs bog, so the game's eel is the bog variant.
  raw_eel:     'raw_bog_eel',
  cooked_eel:  'cooked_bog_eel',

  // fuel — the game mines `coal`; the DB's canonical mined coal row is coal_ore.
  // (Design call: coal is the fuel model; the charcoal-from-logs flow was removed
  // in favour of the Firemaking skill.)
  coal:        'coal_ore',

  // tools — game carries the tier-0 variant
  small_net:    'crude_fishing_net',
  harpoon:      'crude_harpoon',
  fishing_cage: 'crude_fishing_cage',

  // weapon — closest DB equivalent of the goblin starter spear
  goblin_spear: 'crude_spear',

  // recipe-input placeholders that map cleanly to a real item
  vial:        'empty_vial',   // herblore potions
  amulet_cord: 'bowstring',    // jewelry stringing (closest cord item)
};

// Recipe input tokens that are actually TOOLS/containers — the player must
// POSSESS one (any tier), it is NOT consumed. Resolves e.g. `knife:1` in
// fletching recipes and `clay_bowl:1` in oil-pressing recipes. Value = the
// engine tool family / subcategory to look for.
export const TOOL_TOKENS = {
  knife: 'Knife', clay_bowl: 'clay_bowl', chisel: 'Chisel',
  hammer: 'Hammer', needle: 'Needle',
};

// Recipe input tokens that are GENERIC categories — consume any one item of the
// class. Keeps the designer's intent ("any plank / any bar") instead of forcing
// a specific id. Most sit behind the not-yet-trainable construction/herblore
// skills, but the endpoint now resolves meaningfully.
export const CATEGORY_TOKENS = {
  planks:        { subcategory: 'Planks' },
  bars:          { subcategory: 'Metal Bar' },
  monster_parts: { category: 'Resource', subcategory: 'Monster Material' },
  secondary:     { category: 'Resource', subcategory: 'Monster Material' },
};

// UNMAPPED — needs a design decision before aliasing, do NOT guess:
//   goblin_hide_armor → no direct DB armour equivalent (closest: sporehide_body).
//   goblin_shortbow   → DB has bow *staves/parts*, no assembled starter shortbow.
//   coins             → currency, intentionally game-only (not an items.json row).
// (Resolved 2026-06-30: `coal`→`coal_ore`, `raw_eel`→`raw_bog_eel`,
//  `cooked_eel`→`cooked_bog_eel` — see ITEM_ALIASES above.)
export const UNMAPPED_LEGACY = [
  'goblin_hide_armor', 'goblin_shortbow', 'coins',
];

// Resolve any id to its canonical DB id (identity if already canonical/unmapped).
export function canonicalId(id) {
  return ITEM_ALIASES[id] || id;
}
