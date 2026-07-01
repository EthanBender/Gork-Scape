// src/data/itemIcons.js
// Item icon resolver. There is no per-item art for 1063 items, so we map each
// item to a recognizable GLYPH using keyword → subcategory → category rules. The
// item's own colour stays as the tinted chip behind the glyph.
//
// This is the single seam for item visuals: inventory/equipment (panels.js) and
// ground items (world-gen's canvas) both call `itemIcon(id)`. When real sprite
// art lands, change ONLY this function (return a sprite key / <img>) and every
// icon in the game upgrades at once — call sites don't change.

import { GameData } from './gameData.js';

// Keyword rules, most-specific first. First substring match on the id+name wins.
// Kept ahead of the category fallback so e.g. a "bronze_pickaxe" (category Tool)
// still reads as a pickaxe rather than a generic tool.
const KEYWORD_ICONS = [
  // currency / valuables
  [/coins?|gold_pieces/, '🪙'], [/\b(gem|diamond|ruby|sapphire|emerald|opal|jade)\b|uncut_|cut_/, '💎'],
  // weapons
  [/dagger/, '🗡️'], [/sword|scimitar|blade|sabre/, '⚔️'], [/longbow|shortbow|\bbow\b/, '🏹'],
  [/spear|halberd|trident|lance/, '🔱'], [/pickaxe/, '⛏️'], [/battle.?axe|war.?axe|\baxe\b|hatchet/, '🪓'],
  [/mace|maul|warhammer/, '🔨'], [/staff|wand|scepter|sceptre/, '🪄'], [/whip/, '🌀'], [/club/, '🏏'],
  // armour / wearables
  [/shield|kiteshield|defender/, '🛡️'], [/helm|helmet|coif|\bhat\b|hood|mask|crown/, '🪖'],
  [/platebody|chestplate|\bbody\b|chainbody|tunic|robe_top|shirt/, '👕'],
  [/platelegs|\blegs\b|greaves|trousers|skirt|robe_bottom/, '👖'],
  [/boots|\bfeet\b|sandals/, '🥾'], [/gloves|gauntlet|vambrace|\bhands\b/, '🧤'],
  [/cape|cloak|\bcape\b/, '🧣'], [/amulet|necklace|pendant/, '📿'], [/\bring\b/, '💍'],
  [/bracelet/, '📿'], [/charm|talisman|totem/, '🔮'],
  // ammo
  [/arrow|bolt|dart|throwing/, '🎯'],
  // food / cooking
  [/burnt/, '🟤'], [/stew|soup|curry|pie\b/, '🍲'], [/bread|dough|cake|bun/, '🍞'],
  [/shrimp|lobster|crab/, '🦐'], [/fish|trout|salmon|pike|eel|sardine|tuna|cod|shark|anchov/, '🐟'],
  [/meat|steak|beef|kebab/, '🍖'], [/fruit|berry|apple|banana/, '🍎'], [/potion|vial|dose|brew|elixir/, '🧪'],
  // gathering / processing
  [/logs?\b|timber|firewood/, '🪵'], [/plank|board/, '🟫'], [/\bore\b|rock\b/, '🪨'],
  [/\bbar\b|ingot/, '🧱'], [/\bcoal\b|charcoal/, '⚫'], [/seed|sapling|spore/, '🌱'],
  [/herb|leaf|flower/, '🌿'], [/hide|leather|pelt|fur\b/, '🟫'], [/wool|cloth|thread|string|silk/, '🧵'],
  [/bones?\b|skull/, '🦴'], [/tooth|fang|claw|talon/, '🦷'], [/scale|shell/, '🐚'], [/feather/, '🪶'],
  // tools
  [/fishing_rod|harpoon|\brod\b|\bnet\b|lobster_pot|cage/, '🎣'], [/tinderbox|flint/, '🔥'],
  [/needle/, '🪡'], [/knife|chisel/, '🔪'], [/hammer/, '🔨'], [/spade|shovel/, '🥄'],
  [/watering_can|bucket|jug|bowl/, '🪣'], [/rune\b|essence/, '🔷'],
  // knowledge / quest / cosmetic
  [/manual|book|scroll|tome|guide|recipe|blueprint/, '📖'], [/\bkey\b/, '🗝️'], [/map\b/, '🗺️'],
  [/trophy|\bhead\b_of|banner|statue|idol/, '🏆'], [/junk|broken|scrap|rubble/, '🗑️'],
];

// Fallbacks by subcategory (checked before the broad category map).
const SUBCATEGORY_ICONS = {
  Weapon: '⚔️', Armor: '🛡️', Jewelry: '💍', Potion: '🧪', 'Cooked Meal': '🍲',
  'Raw Fish': '🐟', Food: '🍖', 'Burnt Food': '🟤', 'Cooking Ingredient': '🧂',
  Logs: '🪵', Planks: '🟫', 'Bow Parts': '🏹', Handles: '🪵', Seed: '🌱',
  'Skill Manual': '📖', 'Station Upgrade': '🏗️', 'Quest Item': '📜', 'Trophy/Cosmetic': '🏆',
  'Monster Drop': '🦴', 'Monster Material': '🦴', 'Monster Unique': '💠', 'Sellable Junk': '🗑️',
};

const CATEGORY_ICONS = {
  Equipment: '⚔️', Resource: '🪨', Consumable: '🧪', Tool: '🔧', 'Processed Material': '🧱',
  Utility: '🧰', 'Drop Material': '🦴', 'Unique Drop': '💠', Junk: '🗑️', Ammo: '🎯',
  'Quest/Build Item': '📜',
};

const DEFAULT_ICON = '📦';

// Resolve an item (id string, or an object with { id, name }) to a glyph.
export function itemIcon(idOrItem) {
  const id = typeof idOrItem === 'string' ? idOrItem : (idOrItem && idOrItem.id) || '';
  const meta = GameData.item(id);
  const name = (typeof idOrItem === 'object' && idOrItem && idOrItem.name)
    || (meta && meta.display_name) || id;
  const hay = `${id} ${name}`.toLowerCase();

  for (const [re, glyph] of KEYWORD_ICONS) if (re.test(hay)) return glyph;
  if (meta) {
    if (meta.subcategory && SUBCATEGORY_ICONS[meta.subcategory]) return SUBCATEGORY_ICONS[meta.subcategory];
    if (meta.category && CATEGORY_ICONS[meta.category]) return CATEGORY_ICONS[meta.category];
  }
  return DEFAULT_ICON;
}
