// src/ui/icons.js — the game's crafted SVG icon set. Replaces every emoji in
// the UI chrome (tabs, skills, HUD buttons, banners) with flat-shaded, faceted
// vector icons that match the low-poly art direction. No asset files, no build
// step — each icon is a handful of polygons with a light facet and a dark
// facet, which is what makes them read "low poly" at 16–40px.
//
// Usage: icon('mining') → '<svg …>…</svg>'  (24×24 viewBox, scales via CSS).
// Item art is NOT here — items resolve through data/itemIcons.js (real art →
// crafted svg → emoji fallback) until the asset lane lands.

const wrap = (inner, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;

// Shared palette — matches the CSS custom properties in index.html.
const STEEL = '#c7cfd8', STEEL_D = '#8d99a6', STEEL_DD = '#5c6874';
const WOOD = '#8a5a2e', WOOD_D = '#5f3c1c';
const GOLD = '#f2d774', GOLD_D = '#c49b3a', GOLD_DD = '#8a6a1e';
const GREEN = '#8fd05c', GREEN_D = '#5a8f3d', GREEN_DD = '#3c6428';
const RED = '#e0655c', RED_D = '#a03028';
const BLUE = '#6fa3d8', BLUE_D = '#3c608e';
const PURPLE = '#b07ad0', PURPLE_D = '#7a4a9e';
const BONE = '#efe8d4', SHADOW = 'rgba(0,0,0,.35)';

const ICONS = {
  // ---------------------------------------------------------------- skills
  woodcutting: wrap(
    `<polygon points="6,20 8.5,17.5 17,5 19,7" fill="${WOOD}"/>
     <polygon points="6,20 7.2,18.8 18,7.8 19,7" fill="${WOOD_D}"/>
     <polygon points="13,3 20,3 21,10 16,9 12,6" fill="${STEEL}"/>
     <polygon points="13,3 16,9 21,10 20,3" fill="${STEEL_D}"/>`),
  fishing: wrap(
    `<polygon points="3,12 10,7 15,9 19,7 21,12 19,17 15,15 10,17" fill="${BLUE}"/>
     <polygon points="15,9 19,7 21,12 15,12" fill="${BLUE_D}"/>
     <polygon points="19,7 23,4 23,20 19,17 21,12" fill="${BLUE_D}"/>
     <circle cx="7.6" cy="11.4" r="1.2" fill="#10131a"/>`),
  mining: wrap(
    `<polygon points="7,21 9,18 16,7 18,9" fill="${WOOD}"/>
     <polygon points="7,21 8,20 17,8 18,9" fill="${WOOD_D}"/>
     <polygon points="4,8 10,3 17,4 12,7 8,10" fill="${STEEL}"/>
     <polygon points="10,3 17,4 20,9 15,7" fill="${STEEL_D}"/>`),
  cooking: wrap(
    `<polygon points="3,10 21,10 19,20 5,20" fill="${STEEL_DD}"/>
     <polygon points="3,10 21,10 20,14 4,14" fill="${STEEL_D}"/>
     <rect x="9" y="7" width="6" height="2.4" rx="1" fill="${STEEL_D}"/>
     <polygon points="7,6 9,2 10.5,4 12,1.5 13.5,4 15,2 17,6" fill="${GOLD}" opacity=".85"/>`),
  firemaking: wrap(
    `<polygon points="12,2 17,9 19,15 15,21 9,21 5,15 8,8" fill="#e88a3a"/>
     <polygon points="12,2 8,8 5,15 9,21 10,16 9,11" fill="#c25a20"/>
     <polygon points="12,9 15,14 13.5,19 10.5,19 9,14" fill="${GOLD}"/>`),
  smithing: wrap(
    `<polygon points="3,7 21,7 21,10 16,10 17,15 13,17 12,12 8,11 8,10 3,10" fill="${STEEL_D}"/>
     <polygon points="3,7 21,7 21,8.5 3,8.5" fill="${STEEL}"/>
     <polygon points="9,17 15,17 17,21 7,21" fill="${STEEL_DD}"/>`),
  crafting: wrap(
    `<polygon points="4,8 9,5 9,19 4,16" fill="${WOOD}"/>
     <polygon points="4,8 9,5 9,8 4,11" fill="${WOOD_D}"/>
     <rect x="9" y="7.5" width="7" height="9" fill="${PURPLE}"/>
     <rect x="9" y="7.5" width="7" height="3" fill="${PURPLE_D}"/>
     <polygon points="16,5 21,8 21,16 16,19" fill="${WOOD}"/>
     <line x1="12" y1="4" x2="21" y2="20" stroke="${BONE}" stroke-width="1.2"/>`),
  attack: wrap(
    `<polygon points="4,3 7,3 18,15 16,18" fill="${STEEL}"/>
     <polygon points="4,3 4,6 15,17 16,18" fill="${STEEL_D}"/>
     <polygon points="20,3 17,3 6,15 8,18" fill="${STEEL}"/>
     <polygon points="20,3 20,6 9,17 8,18" fill="${STEEL_D}"/>
     <rect x="14.4" y="15.2" width="5" height="2.4" rx="1" transform="rotate(45 17 16.5)" fill="${GOLD_D}"/>
     <rect x="4.6" y="15.2" width="5" height="2.4" rx="1" transform="rotate(-45 7 16.5)" fill="${GOLD_D}"/>`),
  strength: wrap(
    `<polygon points="5,13 8,7 13,5 18,7 19,12 17,18 9,19 5,17" fill="#d8a06a"/>
     <polygon points="5,13 8,7 10,8 8,14 7,16 5,17" fill="#b57e4a"/>
     <rect x="9.5" y="4" width="2.2" height="6" rx="1" fill="#d8a06a"/>
     <rect x="12.5" y="3.4" width="2.2" height="6.6" rx="1" fill="#c98f5a"/>
     <rect x="15.4" y="4.2" width="2.1" height="6" rx="1" fill="#b57e4a"/>`),
  defence: wrap(
    `<polygon points="12,2 21,5 20,14 12,22" fill="${STEEL_D}"/>
     <polygon points="12,2 3,5 4,14 12,22" fill="${STEEL}"/>
     <polygon points="12,6 17,7.6 16.4,13 12,17.6 7.6,13 7,7.6" fill="${GREEN_D}" opacity=".9"/>
     <circle cx="12" cy="10.6" r="1.8" fill="${GOLD}"/>`),
  ranged: wrap(
    `<path d="M6 3 Q19 12 6 21" fill="none" stroke="${WOOD}" stroke-width="2.4"/>
     <line x1="6" y1="3" x2="6" y2="21" stroke="${BONE}" stroke-width="1.1"/>
     <line x1="6" y1="12" x2="20" y2="12" stroke="${WOOD_D}" stroke-width="1.6"/>
     <polygon points="20,12 15.5,9.6 15.5,14.4" fill="${STEEL}"/>`),
  prayer: wrap(
    `<polygon points="12,1 14.4,9.6 23,12 14.4,14.4 12,23 9.6,14.4 1,12 9.6,9.6" fill="${GOLD}"/>
     <polygon points="12,1 14.4,9.6 12,12 9.6,9.6" fill="#fbeeb8"/>
     <polygon points="12,23 9.6,14.4 12,12 14.4,14.4" fill="${GOLD_D}"/>`),
  alchemy: wrap(
    `<polygon points="10,3 14,3 14,9 20,19 18,21 6,21 4,19 10,9" fill="#dfe8f2" opacity=".5"/>
     <polygon points="7.2,14 16.8,14 20,19 18,21 6,21 4,19" fill="${GREEN}"/>
     <polygon points="7.2,14 12,14 8.5,21 6,21 4,19" fill="${GREEN_D}"/>
     <rect x="9.2" y="1.6" width="5.6" height="2.2" rx="1" fill="${STEEL_D}"/>
     <circle cx="13.4" cy="17.6" r="1.1" fill="#e2f7c8"/>`),
  tinkering: wrap(
    `<polygon points="9,2 15,2 15,5.2 17.6,6.8 20.4,5.4 23,10 20.4,11.8 20.4,12.2 23,14 20.4,18.6 17.6,17.2 15,18.8 15,22 9,22 9,18.8 6.4,17.2 3.6,18.6 1,14 3.6,12.2 3.6,11.8 1,10 3.6,5.4 6.4,6.8 9,5.2"
       fill="${GOLD_D}" transform="scale(.92) translate(1 1)"/>
     <circle cx="12" cy="12" r="6.2" fill="${GOLD_D}"/>
     <circle cx="12" cy="12" r="5" fill="${GOLD}"/>
     <circle cx="12" cy="12" r="2.4" fill="#3a2f14"/>`),
  farming: wrap(
    `<polygon points="8,21 16,21 15,14 9,14" fill="#a3652f"/>
     <polygon points="8,21 12,21 11.5,14 9,14" fill="#7c4a20"/>
     <line x1="12" y1="14" x2="12" y2="8" stroke="${GREEN_D}" stroke-width="1.8"/>
     <polygon points="12,9 5,7 6,3 12,5.5" fill="${GREEN}"/>
     <polygon points="12,9 19,7 18,3 12,5.5" fill="${GREEN_D}"/>`),
  hitpoints: wrap(
    `<polygon points="12,21 3,11 3,6.5 7,3.5 12,7 17,3.5 21,6.5 21,11" fill="${RED}"/>
     <polygon points="12,21 3,11 3,6.5 7,3.5 9,5.5 8,10 12,15" fill="${RED_D}"/>
     <polygon points="8.5,6 11,8 9.5,10.5 7,8.5" fill="#f2a49e" opacity=".8"/>`),

  // -------------------------------------------------------- tabs & panels
  skills: wrap(
    `<rect x="3" y="13" width="4" height="8" rx="1" fill="${GREEN_D}"/>
     <rect x="10" y="8" width="4" height="13" rx="1" fill="${GREEN}"/>
     <rect x="17" y="3" width="4" height="18" rx="1" fill="${GOLD}"/>
     <rect x="17" y="3" width="4" height="6" rx="1" fill="#fbeeb8"/>`),
  quests: wrap(
    `<polygon points="5,4 19,4 19,20 5,20" fill="#e8dcb8"/>
     <polygon points="5,4 8,4 8,20 5,20" fill="#cdbf96"/>
     <rect x="3.4" y="2.6" width="4.6" height="4.6" rx="2.3" fill="#b5a67e"/>
     <rect x="3.4" y="17" width="4.6" height="4.6" rx="2.3" fill="#b5a67e"/>
     <line x1="10.5" y1="8.5" x2="16.5" y2="8.5" stroke="#7a6c4a" stroke-width="1.4"/>
     <line x1="10.5" y1="12" x2="16.5" y2="12" stroke="#7a6c4a" stroke-width="1.4"/>
     <line x1="10.5" y1="15.5" x2="14.5" y2="15.5" stroke="#7a6c4a" stroke-width="1.4"/>`),
  inventory: wrap(
    `<polygon points="4,9 20,9 19,21 5,21" fill="${WOOD}"/>
     <polygon points="4,9 12,9 11.5,21 5,21" fill="${WOOD_D}"/>
     <polygon points="6,9 8,4 16,4 18,9 15.5,9 14.5,6.5 9.5,6.5 8.5,9" fill="${WOOD_D}"/>
     <rect x="10" y="12" width="4" height="3.4" rx="1" fill="${GOLD_D}"/>
     <rect x="10" y="12" width="4" height="1.6" rx=".8" fill="${GOLD}"/>`),
  equipment: wrap(
    `<polygon points="12,2 19,6 19,13 12,15 5,13 5,6" fill="${STEEL_D}"/>
     <polygon points="12,2 5,6 5,13 12,15" fill="${STEEL}"/>
     <rect x="7" y="9" width="10" height="2.2" fill="#1c2128"/>
     <polygon points="9,15 15,15 16,21 12,22.5 8,21" fill="${GREEN_D}"/>
     <polygon points="9,15 12,15 12,22.5 8,21" fill="${GREEN_DD}"/>`),
  combat: wrap(
    `<polygon points="4,3 7,3 18,15 16,18" fill="${STEEL}"/>
     <polygon points="4,3 4,6 15,17 16,18" fill="${STEEL_D}"/>
     <polygon points="20,3 17,3 6,15 8,18" fill="${STEEL}"/>
     <polygon points="20,3 20,6 9,17 8,18" fill="${STEEL_D}"/>
     <rect x="14.4" y="15.2" width="5" height="2.4" rx="1" transform="rotate(45 17 16.5)" fill="${GOLD_D}"/>
     <rect x="4.6" y="15.2" width="5" height="2.4" rx="1" transform="rotate(-45 7 16.5)" fill="${GOLD_D}"/>`),
  exchange: wrap(
    `<rect x="11" y="3" width="2" height="15" fill="${GOLD_D}"/>
     <rect x="4" y="4.4" width="16" height="1.8" rx=".9" fill="${GOLD}"/>
     <polygon points="5,7 9,7 8.4,12 5.6,12" fill="${GOLD_D}"/>
     <path d="M4.6 12 a2.5 2.2 0 0 0 4.8 0 Z" fill="${GOLD}"/>
     <polygon points="15,7 19,7 18.4,12 15.6,12" fill="${GOLD_D}"/>
     <path d="M14.6 12 a2.5 2.2 0 0 0 4.8 0 Z" fill="${GOLD}"/>
     <polygon points="7,18 17,18 18.5,21 5.5,21" fill="${WOOD}"/>`),
  shop: wrap(
    `<polygon points="3,4 21,4 22,10 2,10" fill="${RED_D}"/>
     <polygon points="3,4 6.8,4 6.4,10 2,10" fill="${BONE}"/>
     <polygon points="10.6,4 14.4,4 14.2,10 9.8,10" fill="${BONE}"/>
     <polygon points="18.2,4 21,4 22,10 17.6,10" fill="${BONE}"/>
     <rect x="4" y="10" width="16" height="11" fill="${WOOD}"/>
     <rect x="4" y="10" width="16" height="2" fill="${WOOD_D}"/>
     <rect x="13" y="13" width="4.6" height="8" fill="${WOOD_D}"/>
     <rect x="6" y="13" width="4.6" height="4.6" fill="#f4e9c8"/>`),
  bank: wrap(
    `<polygon points="4,8 20,8 20,20 4,20" fill="${WOOD}"/>
     <polygon points="4,8 12,8 12,20 4,20" fill="${WOOD_D}"/>
     <polygon points="4,8 6,3.6 18,3.6 20,8" fill="${WOOD}"/>
     <polygon points="4,8 6,3.6 12,3.6 12,8" fill="#9a693a"/>
     <rect x="3" y="7.4" width="18" height="1.8" fill="${GOLD_DD}"/>
     <rect x="10" y="10.4" width="4" height="4.6" rx="1" fill="${GOLD}"/>
     <rect x="10" y="10.4" width="4" height="2" rx="1" fill="#fbeeb8"/>
     <rect x="11.2" y="12.6" width="1.6" height="1.8" fill="#3a2f14"/>`),
  stations: wrap(
    `<polygon points="3,7 21,7 21,10 16,10 17,15 13,17 12,12 8,11 8,10 3,10" fill="${STEEL_D}"/>
     <polygon points="3,7 21,7 21,8.5 3,8.5" fill="${STEEL}"/>
     <polygon points="9,17 15,17 17,21 7,21" fill="${STEEL_DD}"/>`),

  // ------------------------------------------------------------ HUD chrome
  map: wrap(
    `<polygon points="3,5 9,3 9,19 3,21" fill="#d8ecc0"/>
     <polygon points="9,3 15,5 15,21 9,19" fill="#c2dba6"/>
     <polygon points="15,5 21,3 21,19 15,21" fill="#d8ecc0"/>
     <path d="M5.5 16 Q9 12 12 12 T18.5 7" fill="none" stroke="${RED_D}" stroke-width="1.4" stroke-dasharray="2.2 1.6"/>
     <circle cx="18.5" cy="7" r="1.5" fill="${RED}"/>`),
  run: wrap(
    `<polygon points="7,3 12,3 12,13 18,15 18,19 12,19 7,17" fill="${WOOD}"/>
     <polygon points="7,3 9.5,3 9.5,17 7,17" fill="${WOOD_D}"/>
     <rect x="6" y="18" width="13" height="3" rx="1.4" fill="${WOOD_D}"/>
     <line x1="2" y1="8" x2="5.4" y2="8" stroke="${BONE}" stroke-width="1.6"/>
     <line x1="1" y1="11.5" x2="4.6" y2="11.5" stroke="${BONE}" stroke-width="1.6"/>
     <line x1="2" y1="15" x2="4.4" y2="15" stroke="${BONE}" stroke-width="1.6"/>`),
  home: wrap(
    `<polygon points="12,2 22,11 19,11 19,21 5,21 5,11 2,11" fill="${WOOD}"/>
     <polygon points="12,2 2,11 5,11 12,4.8" fill="${WOOD_D}"/>
     <polygon points="12,2 22,11 19,11 12,4.8" fill="#9a693a"/>
     <rect x="9.6" y="13" width="4.8" height="8" rx="1" fill="${WOOD_D}"/>
     <circle cx="13.2" cy="17" r=".9" fill="${GOLD}"/>`),
  pin: wrap(
    `<path d="M12 2 C7.5 2 4.5 5.4 4.5 9.4 C4.5 14.4 12 22 12 22 S19.5 14.4 19.5 9.4 C19.5 5.4 16.5 2 12 2 Z" fill="${RED}"/>
     <path d="M12 2 C7.5 2 4.5 5.4 4.5 9.4 C4.5 14.4 12 22 12 22 L12 2 Z" fill="${RED_D}"/>
     <circle cx="12" cy="9.2" r="3" fill="${BONE}"/>`),
  coin: wrap(
    `<circle cx="12" cy="12" r="9.5" fill="${GOLD_D}"/>
     <circle cx="12" cy="12" r="7.6" fill="${GOLD}"/>
     <polygon points="7,9 12,5.4 13.8,7.8 8.6,11.4" fill="#fbeeb8" opacity=".9"/>
     <text x="12" y="16.2" text-anchor="middle" font-size="10.5" font-weight="800" fill="${GOLD_DD}" font-family="inherit">g</text>`),
  star: wrap(
    `<polygon points="12,1.5 15,8.6 22.5,9.3 17,14.4 18.7,22 12,18 5.3,22 7,14.4 1.5,9.3 9,8.6" fill="${GOLD}"/>
     <polygon points="12,1.5 15,8.6 12,12 12,18 5.3,22 7,14.4 1.5,9.3 9,8.6" fill="${GOLD_D}"/>`),
  scroll: wrap(
    `<polygon points="5,4 19,4 19,20 5,20" fill="#e8dcb8"/>
     <polygon points="5,4 8,4 8,20 5,20" fill="#cdbf96"/>
     <rect x="3.4" y="2.6" width="4.6" height="4.6" rx="2.3" fill="#b5a67e"/>
     <rect x="3.4" y="17" width="4.6" height="4.6" rx="2.3" fill="#b5a67e"/>
     <path d="M10.5 13.5 l2 2.4 4-5.4" fill="none" stroke="${GREEN_D}" stroke-width="1.8"/>`),
  dragon: wrap(
    `<polygon points="3,14 9,9 15,8 21,10 19,13 14,12 10,14 8,18 4,18" fill="${GREEN_D}"/>
     <polygon points="9,9 12,3 13.5,8.4" fill="${GREEN_DD}"/>
     <polygon points="15,8 21,10 19,13 15.5,11.6" fill="${GREEN_DD}"/>
     <circle cx="16.6" cy="10.2" r=".9" fill="${GOLD}"/>
     <polygon points="19,11.8 23,12.6 20,13.6" fill="#e88a3a"/>`),
  lock: wrap(
    `<rect x="5" y="10" width="14" height="11" rx="2" fill="${GOLD_D}"/>
     <rect x="5" y="10" width="14" height="4" rx="2" fill="${GOLD}"/>
     <path d="M8 10 V7.5 a4 4 0 0 1 8 0 V10" fill="none" stroke="${STEEL_D}" stroke-width="2.2"/>
     <rect x="10.8" y="13.5" width="2.4" height="4" rx="1.1" fill="#3a2f14"/>`),
  logout: wrap(
    `<polygon points="4,3 13,3 13,6 7,6 7,18 13,18 13,21 4,21" fill="${STEEL_D}"/>
     <line x1="10" y1="12" x2="19" y2="12" stroke="${GOLD}" stroke-width="2.2"/>
     <polygon points="22,12 17,8.6 17,15.4" fill="${GOLD}"/>`),

  // ---------------------------------------------------- the goblin crest
  // The login-screen logo: a cute low-poly goblin face. 64×64 viewBox.
  goblin: wrap(
    `<!-- ears -->
     <polygon points="2,20 16,26 14,36 4,32" fill="#5a8f3d"/>
     <polygon points="2,20 10,26.5 6,30" fill="#7bbf4a"/>
     <polygon points="62,20 48,26 50,36 60,32" fill="#5a8f3d"/>
     <polygon points="62,20 54,26.5 58,30" fill="#7bbf4a"/>
     <!-- head facets -->
     <polygon points="32,6 48,16 50,34 40,50 24,50 14,34 16,16" fill="#7bbf4a"/>
     <polygon points="32,6 16,16 14,34 24,50 26,38 22,24" fill="#69a83f"/>
     <polygon points="32,6 48,16 44,22 32,18" fill="#8fd05c"/>
     <!-- brow ridge -->
     <polygon points="18,24 30,22 30,27 19,29" fill="#4d7a2f"/>
     <polygon points="46,24 34,22 34,27 45,29" fill="#4d7a2f"/>
     <!-- eyes -->
     <polygon points="21,29 29,28 28.5,35 21.5,34" fill="#f6efd8"/>
     <polygon points="43,29 35,28 35.5,35 42.5,34" fill="#f6efd8"/>
     <circle cx="25.4" cy="31.6" r="2.3" fill="#1c2412"/>
     <circle cx="38.6" cy="31.6" r="2.3" fill="#1c2412"/>
     <circle cx="26.2" cy="30.8" r=".8" fill="#fff"/>
     <circle cx="39.4" cy="30.8" r=".8" fill="#fff"/>
     <!-- snout + grin + tusks -->
     <polygon points="30,34 34,34 33,40 31,40" fill="#69a83f"/>
     <path d="M24 42 Q32 47 40 42" fill="none" stroke="#3c5a26" stroke-width="2.4" stroke-linecap="round"/>
     <polygon points="24.5,41.5 27.5,42.8 25,46.5" fill="#f6efd8"/>
     <polygon points="39.5,41.5 36.5,42.8 39,46.5" fill="#f6efd8"/>`,
    '0 0 64 64'),

  // ---------------------------------------------------------------- a11y
  // Speaker + sound waves — the "read this aloud" control on quest cards.
  speaker: wrap(
    `<polygon points="3.5,9.5 8,9.5 13,5 13,19 8,14.5 3.5,14.5" fill="${STEEL}"/>
     <polygon points="3.5,9.5 8,9.5 8,14.5 3.5,14.5" fill="${STEEL_D}"/>
     <polygon points="8,9.5 8,14.5 13,19 13,5" fill="${STEEL_DD}"/>
     <path d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8" fill="none" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round"/>
     <path d="M15.2 11a2.1 2.1 0 0 1 0 2" fill="none" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round"/>`),
};

// Public: get an icon's SVG markup. Unknown names return an empty span so a
// bad key can never crash a render.
export function icon(name) { return ICONS[name] || '<span></span>'; }
export function hasIcon(name) { return !!ICONS[name]; }

// Skill-name → icon-name (skills are capitalized in game state).
const SKILL_KEY = {
  Woodcutting: 'woodcutting', Fishing: 'fishing', Mining: 'mining',
  Cooking: 'cooking', Firemaking: 'firemaking', Smithing: 'smithing',
  Crafting: 'crafting', Attack: 'attack', Strength: 'strength',
  Defence: 'defence', Ranged: 'ranged', Prayer: 'prayer',
  Alchemy: 'alchemy', Tinkering: 'tinkering', Hitpoints: 'hitpoints',
  Farming: 'farming',
};
export function skillIcon(skillName) { return icon(SKILL_KEY[skillName] || 'star'); }
