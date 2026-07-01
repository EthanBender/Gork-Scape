// src/data/itemIcons.js
// Item icon resolver. Maps any of the 1063 items to an icon via keyword →
// subcategory → category rules. Two render paths share ONE classification:
//   - itemIcon(id)     -> emoji glyph (string; back-compat, canvas-friendly)
//   - itemIconSVG(id)  -> inline HTML: a hand-drawn <svg> for common keys,
//                         falling back to an emoji <span> for the long tail.
// This is the single visual seam: to upgrade art, add/replace entries in ICON_SVG
// (or swap to sprite PNGs) and every inventory/equipment/ground icon updates at
// once — call sites never change.

import { GameData } from './gameData.js';

// Keyword rules → canonical icon KEY (most specific first; first match wins).
const KEY_RULES = [
  [/coins?|gold_pieces/, 'coins'], [/\b(gem|diamond|ruby|sapphire|emerald|opal|jade)\b|uncut_|cut_/, 'gem'],
  [/dagger/, 'dagger'], [/sword|scimitar|blade|sabre/, 'sword'], [/longbow|shortbow|\bbow\b/, 'bow'],
  [/spear|halberd|trident|lance/, 'spear'], [/pickaxe/, 'pickaxe'], [/battle.?axe|war.?axe|\baxe\b|hatchet/, 'axe'],
  [/mace|maul|warhammer/, 'mace'], [/staff|wand|scepter|sceptre/, 'staff'], [/whip/, 'whip'], [/club/, 'mace'],
  [/shield|kiteshield|defender/, 'shield'], [/helm|helmet|coif|\bhat\b|hood|mask|crown/, 'helm'],
  [/platebody|chestplate|\bbody\b|chainbody|tunic|robe_top|shirt/, 'body'],
  [/platelegs|\blegs\b|greaves|trousers|skirt|robe_bottom/, 'legs'],
  [/boots|\bfeet\b|sandals/, 'boots'], [/gloves|gauntlet|vambrace|\bhands\b/, 'gloves'],
  [/cape|cloak/, 'cape'], [/amulet|necklace|pendant/, 'amulet'], [/\bring\b/, 'ring'],
  [/bracelet/, 'amulet'], [/charm|talisman|totem/, 'charm'],
  [/arrow|bolt|dart|throwing/, 'arrow'],
  [/burnt/, 'burnt'], [/stew|soup|curry|pie\b/, 'stew'], [/bread|dough|cake|bun/, 'bread'],
  [/shrimp|lobster|crab/, 'shrimp'], [/fish|trout|salmon|pike|eel|sardine|tuna|cod|shark|anchov/, 'fish'],
  [/meat|steak|beef|kebab/, 'meat'], [/fruit|berry|apple|banana/, 'fruit'], [/potion|vial|dose|brew|elixir/, 'potion'],
  [/logs?\b|timber|firewood/, 'log'], [/plank|board/, 'plank'], [/\bore\b|rock\b/, 'ore'],
  [/\bbar\b|ingot/, 'bar'], [/\bcoal\b|charcoal/, 'coal'], [/seed|sapling|spore/, 'seed'],
  [/herb|leaf|flower/, 'herb'], [/hide|leather|pelt|fur\b/, 'hide'], [/wool|cloth|thread|string|silk/, 'cloth'],
  [/bones?\b|skull/, 'bones'], [/tooth|fang|claw|talon/, 'tooth'], [/scale|shell/, 'scale'], [/feather/, 'feather'],
  [/fishing_rod|harpoon|\brod\b|\bnet\b|lobster_pot|cage/, 'rod'], [/tinderbox|flint/, 'tinderbox'],
  [/needle/, 'needle'], [/knife|chisel/, 'knife'], [/hammer/, 'hammer'], [/spade|shovel/, 'spade'],
  [/watering_can|bucket|jug|bowl/, 'bucket'], [/rune\b|essence/, 'rune'],
  [/manual|book|scroll|tome|guide|recipe|blueprint/, 'book'], [/\bkey\b/, 'key'], [/map\b/, 'map'],
  [/trophy|banner|statue|idol/, 'trophy'], [/junk|broken|scrap|rubble/, 'junk'],
];

const SUBCATEGORY_KEY = {
  Weapon: 'sword', Armor: 'shield', Jewelry: 'ring', Potion: 'potion', 'Cooked Meal': 'stew',
  'Raw Fish': 'fish', Food: 'meat', 'Burnt Food': 'burnt', 'Cooking Ingredient': 'herb',
  Logs: 'log', Planks: 'plank', 'Bow Parts': 'bow', Handles: 'log', Seed: 'seed',
  'Skill Manual': 'book', 'Station Upgrade': 'station', 'Quest Item': 'book', 'Trophy/Cosmetic': 'trophy',
  'Monster Drop': 'bones', 'Monster Material': 'bones', 'Monster Unique': 'gem', 'Sellable Junk': 'junk',
};
const CATEGORY_KEY = {
  Equipment: 'sword', Resource: 'ore', Consumable: 'potion', Tool: 'hammer', 'Processed Material': 'bar',
  Utility: 'box', 'Drop Material': 'bones', 'Unique Drop': 'gem', Junk: 'junk', Ammo: 'arrow',
  'Quest/Build Item': 'book',
};

// Emoji fallback per key (also what itemIcon() returns).
const EMOJI = {
  coins: '🪙', gem: '💎', dagger: '🗡️', sword: '⚔️', bow: '🏹', spear: '🔱', pickaxe: '⛏️', axe: '🪓',
  mace: '🔨', staff: '🪄', whip: '🌀', shield: '🛡️', helm: '🪖', body: '👕', legs: '👖', boots: '🥾',
  gloves: '🧤', cape: '🧣', amulet: '📿', ring: '💍', charm: '🔮', arrow: '🎯', burnt: '🟤', stew: '🍲',
  bread: '🍞', shrimp: '🦐', fish: '🐟', meat: '🍖', fruit: '🍎', potion: '🧪', log: '🪵', plank: '🟫',
  ore: '🪨', bar: '🧱', coal: '⚫', seed: '🌱', herb: '🌿', hide: '🟫', cloth: '🧵', bones: '🦴',
  tooth: '🦷', scale: '🐚', feather: '🪶', rod: '🎣', tinderbox: '🔥', needle: '🪡', knife: '🔪',
  hammer: '🔨', spade: '🥄', bucket: '🪣', rune: '🔷', book: '📖', key: '🗝️', map: '🗺️', trophy: '🏆',
  junk: '🗑️', station: '🏗️', box: '📦',
};

// Hand-drawn SVG for the common keys (24×24 viewBox). Long tail uses EMOJI.
const P = { // palette
  steel: '#c2cad2', steelD: '#7b8894', gold: '#e8c65a', goldD: '#a8842a',
  wood: '#9a6a3a', woodD: '#5f3d1f', green: '#6bb04a', greenD: '#3f7a2f',
  leaf: '#5a8f3d', red: '#c1554b', bone: '#ece3c8', stone: '#8a7f70', stoneD: '#5d554a',
  glass: '#bfe0ea', black: '#2b2b2b', leather: '#8a5a34', coal: '#33333a',
};
const ICON_SVG = {
  sword: `<rect x="11" y="3" width="2" height="12" fill="${P.steel}"/><polygon points="11,3 13,3 12,1.5" fill="${P.steel}"/><rect x="8" y="15" width="8" height="2" rx="1" fill="${P.gold}"/><rect x="11" y="17" width="2" height="4" fill="${P.woodD}"/><circle cx="12" cy="22" r="1.3" fill="${P.gold}"/>`,
  dagger: `<polygon points="12,4 13.5,7 13.5,14 10.5,14 10.5,7" fill="${P.steel}"/><rect x="9" y="14" width="6" height="1.7" rx=".8" fill="${P.gold}"/><rect x="11.2" y="15.6" width="1.6" height="3.6" fill="${P.woodD}"/>`,
  bow: `<path d="M8 3 Q18 12 8 21" fill="none" stroke="${P.wood}" stroke-width="2"/><line x1="8" y1="3" x2="8" y2="21" stroke="#e8e2d0" stroke-width=".7"/>`,
  axe: `<rect x="11" y="4" width="1.9" height="16" rx=".8" fill="${P.wood}"/><path d="M12 5 Q19 5.5 18 11 Q14.5 9.5 12 9.5 Z" fill="${P.steel}" stroke="${P.steelD}" stroke-width=".5"/>`,
  pickaxe: `<rect x="11" y="7" width="1.9" height="13" fill="${P.wood}"/><path d="M4 9 Q12 4 20 9 Q12 6.5 4 9 Z" fill="${P.steel}" stroke="${P.steelD}" stroke-width=".5"/>`,
  spear: `<rect x="11" y="8" width="1.6" height="13" rx=".8" fill="${P.wood}"/><polygon points="11.8,2 14,8 9.6,8" fill="${P.steel}" stroke="${P.steelD}" stroke-width=".5"/>`,
  mace: `<rect x="11" y="10" width="1.8" height="11" rx=".8" fill="${P.wood}"/><circle cx="11.9" cy="7" r="4" fill="${P.steelD}"/><circle cx="11.9" cy="7" r="2.3" fill="${P.steel}"/>`,
  staff: `<rect x="11" y="6" width="1.8" height="15" rx=".9" fill="${P.wood}"/><circle cx="11.9" cy="5" r="3.2" fill="${P.glass}" stroke="${P.gold}" stroke-width="1"/>`,
  shield: `<path d="M12 3 L19 5 V12 Q19 18 12 21 Q5 18 5 12 V5 Z" fill="${P.steel}" stroke="${P.steelD}"/><path d="M12 6 L16 7 V12 Q16 15 12 17 Q8 15 8 12 V7 Z" fill="${P.gold}" opacity=".55"/>`,
  helm: `<path d="M6 13 Q6 5 12 5 Q18 5 18 13 Z" fill="${P.steel}" stroke="${P.steelD}"/><rect x="10.5" y="8" width="3" height="5" fill="${P.black}"/><rect x="5.5" y="13" width="13" height="2" rx="1" fill="${P.steelD}"/>`,
  body: `<path d="M7 6 L10 5 Q12 7.5 14 5 L17 6 L15.7 16 Q12 18 8.3 16 Z" fill="${P.steel}" stroke="${P.steelD}"/>`,
  legs: `<path d="M7.5 4 H16.5 L15.6 20 H12.7 L12 10 L11.3 20 H8.4 Z" fill="${P.steel}" stroke="${P.steelD}"/>`,
  boots: `<path d="M9 4 H12 V13 H16 V18 H9 Z" fill="${P.leather}" stroke="${P.woodD}"/><rect x="9" y="18" width="8" height="2" fill="${P.woodD}"/>`,
  gloves: `<path d="M8.5 9 H14 V6.5 H15.5 V9 H15.5 Q16 9 16 11 V17 Q12 18.5 8.5 17 Z" fill="${P.leather}" stroke="${P.woodD}"/>`,
  cape: `<path d="M8 5 Q12 3 16 5 L18 20 Q12 17 6 20 Z" fill="#7a3b5a" stroke="#4a2338"/>`,
  ring: `<circle cx="12" cy="14.5" r="5" fill="none" stroke="${P.gold}" stroke-width="2.4"/><polygon points="12,4 14.5,8 9.5,8" fill="${P.glass}" stroke="#3aa0c8" stroke-width=".5"/>`,
  amulet: `<path d="M6 5 Q12 12 18 5" fill="none" stroke="${P.gold}" stroke-width="1.4"/><polygon points="12,10 15,14.5 12,19 9,14.5" fill="${P.red}" stroke="${P.gold}" stroke-width=".7"/>`,
  gem: `<polygon points="12,4 18,10 12,20 6,10" fill="${P.glass}" stroke="#3aa0c8"/><polygon points="6,10 18,10 12,4" fill="#a8ecff" opacity=".7"/>`,
  potion: `<rect x="10.3" y="3" width="3.4" height="2" fill="${P.wood}"/><path d="M10.5 5 H13.5 V8 L16.3 13 A4.8 4.8 0 0 1 7.7 13 L10.5 8 Z" fill="${P.glass}" stroke="${P.steelD}"/><path d="M7.9 12 A4.8 4.8 0 0 0 16.1 12 Z" fill="${P.red}"/>`,
  fish: `<path d="M3 12 Q10 6.5 16 12 Q10 17.5 3 12 Z" fill="#6fa8c8" stroke="#3f7590"/><polygon points="16,12 20.5,8.5 20.5,15.5" fill="#6fa8c8"/><circle cx="6.5" cy="11" r=".9" fill="#123"/>`,
  meat: `<circle cx="9" cy="10" r="5" fill="${P.red}"/><rect x="11.5" y="12" width="8.5" height="3" rx="1.5" transform="rotate(22 11.5 12)" fill="${P.red}"/><rect x="17.5" y="15" width="4" height="2.6" rx="1.3" transform="rotate(22 17.5 15)" fill="${P.bone}"/>`,
  bread: `<path d="M4 15 Q4 8 12 8 Q20 8 20 15 Z" fill="#d59a4e" stroke="#9a6a2e"/><rect x="4" y="15" width="16" height="3" rx="1" fill="#c98a3e"/>`,
  stew: `<path d="M4 12 H20 A8 8 0 0 1 4 12 Z" fill="${P.steelD}"/><ellipse cx="12" cy="12" rx="8" ry="2.4" fill="#b9702e"/><rect x="2.5" y="10.6" width="19" height="2" rx="1" fill="${P.steel}"/>`,
  log: `<rect x="4" y="9" width="16" height="6" rx="3" fill="${P.wood}"/><ellipse cx="6.5" cy="12" rx="1.7" ry="3" fill="${P.woodD}"/><ellipse cx="6.5" cy="12" rx=".8" ry="1.5" fill="#c98a52"/>`,
  plank: `<rect x="4" y="8" width="16" height="3.4" rx=".6" fill="#c9975a" stroke="#9a6a2e" stroke-width=".4"/><rect x="4" y="12.4" width="16" height="3.4" rx=".6" fill="#b9863f" stroke="#9a6a2e" stroke-width=".4"/>`,
  ore: `<path d="M6 15 L9 8 L15 7 L18 13 L14 18 L8 17 Z" fill="${P.stone}" stroke="${P.stoneD}"/><circle cx="11" cy="12" r="1.5" fill="${P.gold}"/><circle cx="14.2" cy="14" r="1" fill="${P.gold}"/>`,
  bar: `<path d="M5 15 L8 11 H18 L21 15 Z" fill="${P.steel}" stroke="${P.steelD}"/><rect x="5" y="15" width="16" height="2.4" fill="${P.steelD}"/>`,
  coal: `<circle cx="9" cy="13" r="4.2" fill="${P.coal}"/><circle cx="15" cy="14" r="3.4" fill="#43434c"/><circle cx="8" cy="11" r="1" fill="#5c5c66"/>`,
  coins: `<ellipse cx="12" cy="16.5" rx="7" ry="2.6" fill="${P.goldD}"/><ellipse cx="12" cy="13.5" rx="7" ry="2.6" fill="${P.gold}"/><ellipse cx="12" cy="10.5" rx="7" ry="2.6" fill="${P.gold}" stroke="${P.goldD}"/>`,
  bones: `<g stroke="${P.bone}" stroke-width="2.6" stroke-linecap="round"><line x1="7" y1="8" x2="17" y2="16"/></g><circle cx="6.5" cy="7.2" r="1.7" fill="${P.bone}"/><circle cx="8.2" cy="8.6" r="1.5" fill="${P.bone}"/><circle cx="17.5" cy="16.8" r="1.7" fill="${P.bone}"/><circle cx="15.8" cy="15.4" r="1.5" fill="${P.bone}"/>`,
  seed: `<line x1="12" y1="21" x2="12" y2="12" stroke="${P.greenD}" stroke-width="1.6"/><path d="M12 13 Q7 11 7 6.5 Q12 8 12 13 Z" fill="${P.green}"/><path d="M12 15 Q17 13 17 8.5 Q12 10 12 15 Z" fill="${P.greenD}"/>`,
  herb: `<line x1="12" y1="21" x2="12" y2="7" stroke="${P.greenD}" stroke-width="1.4"/><path d="M12 11 Q8 10 8 6 Q12 7 12 11Z" fill="${P.leaf}"/><path d="M12 14 Q16 13 16 9 Q12 10 12 14Z" fill="${P.leaf}"/><path d="M12 8 Q9 6 9.5 3 Q12 5 12 8Z" fill="${P.green}"/>`,
  book: `<rect x="5" y="5" width="14" height="14" rx="1.5" fill="#7a3b3b" stroke="#4a2020"/><rect x="11.2" y="5" width="1.6" height="14" fill="#4a2020"/><rect x="7" y="8" width="3" height="1" fill="${P.gold}"/><rect x="14" y="8" width="3" height="1" fill="${P.gold}"/>`,
  key: `<circle cx="8" cy="9" r="4" fill="none" stroke="${P.gold}" stroke-width="2.4"/><rect x="10.5" y="10.6" width="9" height="2.2" fill="${P.gold}"/><rect x="17" y="12.8" width="2" height="3" fill="${P.gold}"/>`,
  arrow: `<line x1="4" y1="20" x2="18.5" y2="5.5" stroke="${P.wood}" stroke-width="1.7"/><polygon points="19,5 14.8,6 18,9.2" fill="${P.steel}"/><path d="M4 20 L7.2 19 L5 22.2 Z" fill="#e8e2d0"/>`,
  trophy: `<path d="M8 4 H16 V7 A4 4 0 0 1 8 7 Z" fill="${P.gold}"/><path d="M8 5 H5.5 V7 Q5.5 9 8 9" fill="none" stroke="${P.gold}" stroke-width="1.2"/><path d="M16 5 H18.5 V7 Q18.5 9 16 9" fill="none" stroke="${P.gold}" stroke-width="1.2"/><rect x="11" y="11" width="2" height="4" fill="${P.goldD}"/><rect x="8" y="15" width="8" height="2.4" rx="1" fill="${P.goldD}"/>`,
  potionfallback: '',
  box: `<rect x="5" y="8" width="14" height="11" fill="${P.wood}" stroke="${P.woodD}"/><path d="M5 8 L12 5 L19 8 Z" fill="#b98a52"/><line x1="12" y1="5" x2="12" y2="19" stroke="${P.woodD}"/>`,
};

// Resolve an item (id string, or { id, name }) to a canonical icon key.
function iconKey(idOrItem) {
  const id = typeof idOrItem === 'string' ? idOrItem : (idOrItem && idOrItem.id) || '';
  const meta = GameData.item(id);
  const name = (typeof idOrItem === 'object' && idOrItem && idOrItem.name)
    || (meta && meta.display_name) || id;
  const hay = `${id} ${name}`.toLowerCase();
  for (const [re, key] of KEY_RULES) if (re.test(hay)) return key;
  if (meta) {
    if (meta.subcategory && SUBCATEGORY_KEY[meta.subcategory]) return SUBCATEGORY_KEY[meta.subcategory];
    if (meta.category && CATEGORY_KEY[meta.category]) return CATEGORY_KEY[meta.category];
  }
  return 'box';
}

// Emoji glyph (string) — canvas-friendly, back-compat.
export function itemIcon(idOrItem) {
  return EMOJI[iconKey(idOrItem)] || '📦';
}

// Inline HTML: a crafted <svg> when we have one, else an emoji <span>.
export function itemIconSVG(idOrItem) {
  const key = iconKey(idOrItem);
  const inner = ICON_SVG[key];
  if (inner) {
    return `<svg class="item-svg" viewBox="0 0 24 24" width="100%" height="100%" `
      + `xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }
  return `<span class="item-emoji">${EMOJI[key] || '📦'}</span>`;
}

// --- Real-art layer (Kenney / AI-generated sprites) -------------------------
// A manifest lists item_ids that have a rendered PNG at assets/items/<id>.png.
// Drop art in + list it in the manifest and it replaces the SVG automatically —
// the whole game upgrades with zero call-site changes. Loaded lazily; until it
// arrives (or if there's no manifest), everything falls back to the SVG/emoji.
const ART = new Set();
export function hasItemArt(id) { return ART.has(id); }
export function loadItemArtManifest(url = 'assets/items/manifest.json') {
  if (typeof fetch === 'undefined') return Promise.resolve();
  return fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .then((ids) => { if (Array.isArray(ids)) for (const id of ids) ART.add(id); })
    .catch(() => {}); // no manifest yet is the normal case
}

// Preferred entry point for DOM surfaces: real art → crafted SVG → emoji.
export function itemIconHTML(idOrItem) {
  const id = typeof idOrItem === 'string' ? idOrItem : (idOrItem && idOrItem.id) || '';
  if (id && ART.has(id)) {
    return `<img class="item-art" src="assets/items/${id}.png" alt="" loading="lazy" `
      + `onerror="this.remove()">`;
  }
  return itemIconSVG(idOrItem);
}

// Auto-load the manifest on import; renders pick up real art on the next refresh.
loadItemArtManifest();
