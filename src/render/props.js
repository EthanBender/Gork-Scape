// src/render/props.js
// [character-render lane] World structure "props" — turns the flat coloured
// squares (Market Stall, Anvil, Deposit Box, Weapon Rack, …) into small
// recognisable objects that hint at what the building/spot is FOR. These are the
// "thing you'd find inside" — a later art pass builds the actual walls around
// them. Pure drawing onto a Phaser Graphics `g`; classification is keyword-based
// off the object's `label` (like gear.js/bodyTypeFor), with a crate fallback so
// nothing is worse than the old square.
//
//   drawProp(g, cx, cy, o)   cx,cy = tile top-left in screen px (32px tile)

const T = 32;
const shade = (c, f) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return ((Math.min(255, r * f) & 255) << 16) | ((Math.min(255, g * f) & 255) << 8) | (Math.min(255, b * f) & 255);
};

// label -> prop kind. Order matters (first match wins).
export function propKind(label = '') {
  const n = label.toLowerCase();
  if (/grand exchange|\bexchange\b/.test(n)) return 'exchange';
  if (/anvil|smith|forge/.test(n)) return 'anvil';
  if (/deposit|\bbank\b|coffer|lockbox|hidden chest|\bchest\b|storage|vault/.test(n)) return 'chest';
  if (/tavern|\binn\b|\bpub\b|alehouse|brewery/.test(n)) return 'barrel';
  if (/barrel|keg|cask/.test(n)) return 'barrel';
  if (/stall|market|shack|bait|tackle|produce|grocer|fishmonger|fletcher|lumber stall|shop|store/.test(n)) return 'stall';
  if (/weapon rack|armou?r|\brack\b/.test(n)) return 'weaponrack';
  if (/dummy/.test(n)) return 'dummy';
  if (/throne|high seat|\bdais\b/.test(n)) return 'throne';
  if (/banner|\bflag\b/.test(n)) return 'banner';
  if (/tower|watchtower/.test(n)) return 'tower';
  if (/\bwell\b/.test(n)) return 'well';
  if (/shrine|chapel|altar|statue|totem|idol/.test(n)) return 'shrine';
  if (/potion|cauldron|witch|brew|alchemy|herb/.test(n)) return 'cauldron';
  if (/fire|campfire|hearth|range/.test(n)) return 'fire';
  if (/coal/.test(n)) return 'coalheap';
  if (/log|lumber|saw/.test(n)) return 'logpile';
  if (/ore cart|cart|wagon/.test(n)) return 'cart';
  if (/rock|rubble|heap|pile/.test(n)) return 'rockpile';
  if (/war table|workbench|\btable\b|\bbench\b|potion station/.test(n)) return 'table';
  if (/skinning|butcher|tan/.test(n)) return 'hiderack';
  if (/compost|\bbin\b|trough/.test(n)) return 'bin';
  if (/gate|pass|entrance|\bcave\b|\bmine\b|tunnel|deep/.test(n)) return 'entrance';
  if (/bridge|boat|route|dock|pier/.test(n)) return 'sign';
  if (/arena|hall|chief|throne/.test(n)) return 'banner';
  if (/house|hut|home|cottage|shed|barn|lodge|\btent\b/.test(n)) return 'hut';
  if (/board|notice/.test(n)) return 'sign';
  return 'crate';
}

// ---- individual props (drawn centred in the tile, bottom near cy+28) --------
const WOOD = 0x7a5230, WOOD_D = 0x5a3a20, METAL = 0x9aa0a6, METAL_D = 0x5a6068;

function anvil(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 5, Y + 6, 10, 6);              // stump
  g.fillStyle(0x3a3f45, 1); g.fillRect(X - 8, Y - 2, 16, 5);           // face/body
  g.fillStyle(0x4c525a, 1); g.fillRect(X - 5, Y + 2, 10, 5);           // waist
  g.fillStyle(0x3a3f45, 1); g.fillTriangle(X + 7, Y - 3, X + 12, Y - 1, X + 7, Y + 1); // horn
  g.fillStyle(0xbfc4cb, 0.6); g.fillRect(X - 7, Y - 2, 14, 1.4);        // top highlight
}
function chest(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 8, Y - 1, 16, 11);
  g.fillStyle(shade(WOOD, 1.25), 1); g.fillRect(X - 8, Y - 6, 16, 6);   // rounded lid
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 8, Y - 1, 16, 1.6);            // lid seam
  g.fillStyle(0xd9b24a, 1); g.fillRect(X - 1.6, Y - 5, 3.2, 9);         // strap
  g.fillStyle(0xf0d878, 1); g.fillRect(X - 1.2, Y - 0.5, 2.4, 2.4);     // lock
}
function barrel(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 6, Y - 6, 12, 16);
  g.fillStyle(shade(WOOD, 1.2), 1); g.fillRect(X - 6.5, Y - 6, 13, 3);  // top rim
  g.fillStyle(0x3a2a18, 1); g.fillRect(X - 6.5, Y - 2, 13, 1.6); g.fillRect(X - 6.5, Y + 5, 13, 1.6); // hoops
}
function stall(g, X, Y, accent) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 9, Y + 2, 2, 10); g.fillRect(X + 7, Y + 2, 2, 10); // posts
  g.fillStyle(WOOD, 1); g.fillRect(X - 9, Y + 3, 18, 6);                // counter
  // striped awning
  for (let i = -9; i < 9; i += 4) {
    g.fillStyle(((i / 4) & 1) ? 0xc94b3a : 0xf0efe6, 1);
    g.fillTriangle(X + i, Y - 6, X + i + 4, Y - 6, X + i + 2, Y - 1);
  }
  g.fillStyle(0x7a1e12, 1); g.fillRect(X - 9, Y - 7, 18, 2);            // awning bar
  g.fillStyle(accent || 0xd9b24a, 1); g.fillCircle(X - 3, Y + 5, 1.6); g.fillCircle(X + 2, Y + 5, 1.6); // goods
}
function exchange(g, X, Y) {
  stall(g, X, Y, 0xffd23f);
  g.fillStyle(0x2a2a1e, 1); g.fillRect(X - 6, Y - 5, 12, 3);            // price board
  g.fillStyle(0x8be04a, 1); g.fillRect(X - 5, Y - 4.4, 3, 1.6); g.fillStyle(0xff6b5b, 1); g.fillRect(X + 1, Y - 4.4, 3, 1.6);
}
function weaponrack(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 8, Y + 8, 16, 2);              // base
  g.fillStyle(WOOD, 1); g.fillRect(X - 8, Y - 6, 2, 15); g.fillRect(X + 6, Y - 6, 2, 15); g.fillRect(X - 8, Y - 6, 16, 2);
  g.lineStyle(1.6, METAL, 1);                                          // weapons leaning
  g.beginPath(); g.moveTo(X - 4, Y + 8); g.lineTo(X - 2, Y - 5); g.moveTo(X + 1, Y + 8); g.lineTo(X + 3, Y - 5); g.strokePath();
  g.fillStyle(0xbfc4cb, 1); g.fillTriangle(X - 3, Y - 5, X - 1, Y - 5, X - 2, Y - 8); // spearhead
}
function dummy(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 1.5, Y - 2, 3, 14);           // post
  g.fillStyle(0xcbb48a, 1); g.fillCircle(X, Y - 4, 5);                 // straw head
  g.fillStyle(0xb59a6a, 1); g.fillRect(X - 7, Y - 1, 14, 6);           // straw body
  g.lineStyle(1, 0x7a5230, 1); g.strokeRect(X - 7, Y - 1, 14, 6);
  g.fillStyle(0x8a2a1a, 0.8); g.fillCircle(X, Y + 2, 1.4);             // target
}
function banner(g, X, Y, accent) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 1, Y - 8, 2, 20);             // pole
  g.fillStyle(accent || 0x8c2f2a, 1); g.fillRect(X + 1, Y - 8, 9, 11); // flag
  g.fillStyle(shade(accent || 0x8c2f2a, 0.75), 1); g.fillTriangle(X + 10, Y - 8, X + 10, Y + 3, X + 6, Y - 2.5);
  g.fillStyle(0xe0c050, 1); g.fillCircle(X + 5, Y - 3, 1.6);           // emblem
}
function tower(g, X, Y) {
  const STONE = 0x8f8a82, STONE_D = 0x6a655e, STONE_H = 0xa8a39a;
  // tall stone shaft
  g.fillStyle(STONE_D, 1); g.fillRect(X - 7, Y - 18, 14, 30);
  g.fillStyle(STONE, 1); g.fillRect(X - 6, Y - 18, 12, 30);
  g.fillStyle(STONE_H, 0.55); g.fillRect(X - 6, Y - 18, 2.4, 30);      // lit edge
  g.lineStyle(0.8, STONE_D, 0.8);                                       // stone courses
  for (let yy = -13; yy < 12; yy += 5) { g.beginPath(); g.moveTo(X - 6, Y + yy); g.lineTo(X + 6, Y + yy); g.strokePath(); }
  g.fillStyle(0x141018, 1); g.fillRect(X - 1, Y - 9, 2, 7);            // arrow slit
  // corbelled battlement + crenellations
  g.fillStyle(STONE_D, 1); g.fillRect(X - 9, Y - 21, 18, 5);
  g.fillStyle(STONE, 1); g.fillRect(X - 9, Y - 22, 18, 2);
  for (const mx of [-9, -3.5, 2, 7.5]) { g.fillStyle(STONE, 1); g.fillRect(X + mx, Y - 26, 3.5, 5); g.fillStyle(STONE_H, 0.5); g.fillRect(X + mx, Y - 26, 3.5, 1.2); }
  // pennant
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 0.6, Y - 33, 1.2, 8);
  g.fillStyle(0x8c2f2a, 1); g.fillTriangle(X + 0.6, Y - 33, X + 0.6, Y - 28, X + 6, Y - 30.5);
}
function throne(g, X, Y, accent) {
  const gold = accent || 0xcaa63a, IRON = 0x3a3540, IRON_D = 0x24212a, IRON_H = 0x585262;
  g.fillStyle(0x5c5450, 1); g.fillRect(X - 10, Y + 8, 20, 5);          // stone dais step
  g.fillStyle(0x6c6460, 1); g.fillRect(X - 10, Y + 8, 20, 1.6);
  g.fillStyle(IRON_D, 1); g.fillRect(X - 7, Y - 16, 14, 24);           // tall back slab
  g.fillStyle(IRON, 1); g.fillRect(X - 6, Y - 15, 12, 22);
  g.fillStyle(IRON_H, 0.7); g.fillRect(X - 6, Y - 15, 12, 1.4);
  g.fillStyle(IRON_D, 1); g.fillRect(X - 9, Y - 2, 3, 10); g.fillRect(X + 6, Y - 2, 3, 10); // arm rests
  g.fillStyle(IRON_H, 0.6); g.fillRect(X - 9, Y - 2, 3, 1.4); g.fillRect(X + 6, Y - 2, 3, 1.4);
  g.fillStyle(gold, 0.9); g.fillRect(X - 3, Y - 13, 6, 10);            // gold back inlay
  g.fillStyle(shade(gold, 0.7), 1); g.fillRect(X - 3, Y - 13, 6, 1.2);
  g.fillStyle(gold, 1); g.fillRect(X - 6, Y + 1, 12, 5);               // gold cushion / seat
  g.fillStyle(shade(gold, 1.25), 1); g.fillRect(X - 6, Y + 1, 12, 1.4);
  g.fillStyle(IRON_D, 1);                                               // spiked crest
  g.fillTriangle(X - 7, Y - 16, X - 3, Y - 22, X + 1, Y - 16);
  g.fillTriangle(X - 1, Y - 16, X + 3, Y - 23, X + 7, Y - 16);
  g.fillStyle(0xd8d2c0, 1); g.fillCircle(X, Y - 17, 2.6);              // pale goblin skull
  g.fillStyle(0x1a1a1e, 1); g.fillCircle(X - 1, Y - 17.5, 0.7); g.fillCircle(X + 1, Y - 17.5, 0.7);
}
function well(g, X, Y) {
  g.fillStyle(0x6a6a6a, 1); g.fillRect(X - 7, Y + 2, 14, 9);           // stone ring
  g.fillStyle(0x2a3a4a, 1); g.fillEllipse(X, Y + 3, 12, 4);            // water
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 7, Y - 6, 1.6, 9); g.fillRect(X + 5.4, Y - 6, 1.6, 9); // posts
  g.fillStyle(0x8c2f2a, 1); g.fillTriangle(X - 8, Y - 6, X + 8, Y - 6, X, Y - 11); // roof
}
function shrine(g, X, Y) {
  g.fillStyle(0x8a8a7a, 1); g.fillRect(X - 6, Y + 4, 12, 7);           // base
  g.fillStyle(0x9a9a88, 1); g.fillRect(X - 4, Y - 6, 8, 11);           // pillar/idol
  g.fillStyle(0x6a6a5a, 1); g.fillRect(X - 6, Y + 2, 12, 2);
  g.fillStyle(0x7fd0e0, 0.8); g.fillCircle(X, Y - 2, 2.2);             // glow
}
function cauldron(g, X, Y) {
  g.fillStyle(0x2e2e34, 1); g.fillCircle(X, Y + 3, 7);                 // pot
  g.fillStyle(0x1a1a1e, 1); g.fillRect(X - 7, Y - 1, 14, 3);
  g.fillStyle(0x6be07a, 0.9); g.fillEllipse(X, Y - 1, 11, 4);          // brew
  g.fillStyle(0x9cf0a8, 0.7); g.fillCircle(X - 2, Y - 3, 1.4); g.fillCircle(X + 2, Y - 4, 1.1); // bubbles
  g.fillStyle(0xff6a1a, 0.85); g.fillTriangle(X - 4, Y + 9, X + 4, Y + 9, X, Y + 4); // fire under
}
function fire(g, X, Y) {
  g.fillStyle(0x3b2a1a, 1); g.lineStyle(2.4, 0x3b2a1a, 1);
  g.beginPath(); g.moveTo(X - 7, Y + 7); g.lineTo(X + 7, Y + 4); g.moveTo(X - 7, Y + 4); g.lineTo(X + 7, Y + 7); g.strokePath(); // logs
  g.fillStyle(0xff6a1a, 0.95); g.fillTriangle(X - 6, Y + 4, X + 6, Y + 4, X, Y - 9);
  g.fillStyle(0xffd24d, 0.95); g.fillTriangle(X - 3, Y + 4, X + 3, Y + 4, X, Y - 4);
}
function coalheap(g, X, Y) { pile(g, X, Y, 0x2a2a2a, 0x111111); }
function rockpile(g, X, Y) { pile(g, X, Y, 0x8a8a82, 0x66665e); }
function pile(g, X, Y, c, cd) {
  g.fillStyle(cd, 1); g.fillCircle(X - 4, Y + 6, 4); g.fillCircle(X + 4, Y + 6, 4);
  g.fillStyle(c, 1); g.fillCircle(X, Y + 3, 5); g.fillCircle(X - 5, Y + 5, 3); g.fillCircle(X + 5, Y + 5, 3);
  g.fillStyle(shade(c, 1.35), 1); g.fillCircle(X - 1, Y + 1, 1.6);
}
function logpile(g, X, Y) {
  for (const [dx, dy] of [[-5, 6], [0, 6], [5, 6], [-2.5, 1.5], [2.5, 1.5]]) {
    g.fillStyle(WOOD, 1); g.fillCircle(X + dx, Y + dy, 3.2);
    g.fillStyle(0xcaa46a, 1); g.fillCircle(X + dx, Y + dy, 1.5);       // cut end rings
    g.lineStyle(0.8, WOOD_D, 1); g.strokeCircle(X + dx, Y + dy, 3.2);
  }
}
function cart(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 8, Y - 2, 16, 8);
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 8, Y - 2, 16, 2);
  g.fillStyle(0x2a2a2a, 1); g.fillCircle(X, Y + 1, 2.6);               // heaped load (coal-ish)
  g.fillStyle(0x141414, 1); g.fillCircle(X - 4.5, Y + 7, 2.4); g.fillCircle(X + 4.5, Y + 7, 2.4); // wheels
  g.fillStyle(METAL_D, 1); g.fillCircle(X - 4.5, Y + 7, 0.9); g.fillCircle(X + 4.5, Y + 7, 0.9);
}
function table(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 8, Y - 1, 16, 4);               // top
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 7, Y + 3, 2, 8); g.fillRect(X + 5, Y + 3, 2, 8); // legs
  g.fillStyle(0xd8cfa8, 1); g.fillRect(X - 5, Y - 3, 5, 2.4);          // parchment/tools on top
  g.fillStyle(METAL, 1); g.fillRect(X + 1, Y - 3, 4, 1.6);
}
function hiderack(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 8, Y - 6, 2, 17); g.fillRect(X + 6, Y - 6, 2, 17); g.fillRect(X - 8, Y - 6, 16, 2);
  g.fillStyle(0xb08a5a, 1); g.fillRect(X - 5, Y - 4, 4, 9); g.fillRect(X + 1, Y - 4, 4, 7); // stretched hides
}
function bin(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 7, Y - 2, 14, 13);
  g.fillStyle(WOOD, 1); for (let i = -7; i < 7; i += 4) g.fillRect(X + i, Y - 2, 1.4, 13);
  g.fillStyle(0x5a7a3a, 1); g.fillEllipse(X, Y - 2, 13, 4);            // contents
}
function entrance(g, X, Y) {
  g.fillStyle(0x4a4a44, 1); g.fillRect(X - 9, Y - 4, 18, 15);          // rock face
  g.fillStyle(0x66665e, 1); g.fillRect(X - 9, Y - 6, 18, 3);
  g.fillStyle(0x08080a, 1); g.fillRect(X - 5, Y + 1, 10, 10);          // dark opening
  g.fillTriangle(X - 5, Y + 1, X + 5, Y + 1, X, Y - 4);                // arch top
}
function sign(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 1, Y - 2, 2, 13);             // post
  g.fillStyle(WOOD, 1); g.fillRect(X - 7, Y - 7, 14, 7);               // board
  g.fillStyle(shade(WOOD, 1.2), 1); g.fillRect(X - 7, Y - 7, 14, 1.4);
  g.lineStyle(1, WOOD_D, 1); g.beginPath(); g.moveTo(X - 5, Y - 4); g.lineTo(X + 5, Y - 4); g.moveTo(X - 5, Y - 2); g.lineTo(X + 3, Y - 2); g.strokePath();
}
function crate(g, X, Y, accent) {
  const c = accent || WOOD;
  g.fillStyle(c, 1); g.fillRect(X - 7, Y - 3, 14, 14);                 // generic crate (fallback)
  g.lineStyle(1.4, shade(c, 0.65), 1);
  g.strokeRect(X - 7, Y - 3, 14, 14);
  g.beginPath(); g.moveTo(X - 7, Y - 3); g.lineTo(X + 7, Y + 11);      // corner braces
  g.moveTo(X + 7, Y - 3); g.lineTo(X - 7, Y + 11); g.strokePath();
}

function hut(g, X, Y) {
  g.fillStyle(0x8a6a44, 1); g.fillRect(X - 8, Y - 1, 16, 12);           // wattle wall
  g.fillStyle(shade(0x8a6a44, 0.8), 1); g.fillRect(X - 8, Y - 1, 16, 1.6);
  g.fillStyle(0x6a4a2a, 1); g.fillTriangle(X - 10, Y - 1, X + 10, Y - 1, X, Y - 10); // thatch roof
  g.fillStyle(shade(0x6a4a2a, 1.2), 1); g.fillTriangle(X - 10, Y - 1, X - 2, Y - 1, X, Y - 10);
  g.fillStyle(0x2a1c10, 1); g.fillRect(X - 2.5, Y + 3, 5, 8);           // doorway
  g.fillStyle(0xd8b25a, 0.85); g.fillRect(X + 3.5, Y + 1.5, 3, 3);      // lit window
}

const DRAW = {
  anvil, chest, barrel, stall, exchange, weaponrack, dummy, banner, tower, throne, well,
  shrine, cauldron, fire, coalheap, rockpile, logpile, cart, table, hiderack, bin,
  entrance, sign, crate, hut,
};

// Entry point: draw the prop for object `o` at tile top-left (cx,cy).
export function drawProp(g, cx, cy, o) {
  const X = cx + 16, Y = cy + 14;                 // centre-ish, sitting on the tile
  if (o.depleted) { crate(g, X, Y, 0x555555); return; }
  const fn = DRAW[propKind(o.label)] || crate;
  // soft ground shadow so props sit on the tile
  g.fillStyle(0x000000, 0.22); g.fillEllipse(X, cy + 27, 22, 6);
  fn(g, X, Y, o.color);
}

// ============================================================================
// SCENERY — small ambient decorations that dress the ~20 tiles around a
// structure so the world reads as a lived-in place, not a square on grass.
// Placed by src/render/scenery.js as { type:'decor', scenery:<kind>, … } and
// routed here from drawObjects. Each draws centred at the tile (cx+16, cy+16).
// ============================================================================
const FLOWER_COLS = [0xd94f6a, 0xe0983f, 0x8a6fd0, 0xe8d84a, 0xe07fb0];

function sLantern(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 0.8, Y - 2, 1.6, 12);         // post
  g.fillStyle(0x2a2a1e, 1); g.fillRect(X - 3, Y - 8, 6, 6);            // frame
  g.fillStyle(0xffd66a, 0.95); g.fillRect(X - 2, Y - 7, 4, 4);         // glow
  g.fillStyle(0xffef9e, 0.5); g.fillCircle(X, Y - 5, 4);
}
function sBarrel(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 4, Y - 3, 8, 11);
  g.fillStyle(shade(WOOD, 1.2), 1); g.fillEllipse(X, Y - 3, 8, 3);
  g.fillStyle(0x3a2a18, 1); g.fillRect(X - 4, Y, 8, 1.2); g.fillRect(X - 4, Y + 5, 8, 1.2);
}
function sCrate(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 5, Y - 3, 10, 10);
  g.lineStyle(1, shade(WOOD, 0.65), 1); g.strokeRect(X - 5, Y - 3, 10, 10);
  g.beginPath(); g.moveTo(X - 5, Y - 3); g.lineTo(X + 5, Y + 7); g.moveTo(X + 5, Y - 3); g.lineTo(X - 5, Y + 7); g.strokePath();
}
function sFlowerbed(g, X, Y, accent) {
  g.fillStyle(0x3f5a2f, 1); g.fillEllipse(X, Y + 4, 18, 8);            // leafy bed
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, r = 5;
    g.fillStyle(accent && i === 0 ? accent : FLOWER_COLS[i % FLOWER_COLS.length], 1);
    g.fillCircle(X + Math.cos(a) * r, Y + 2 + Math.sin(a) * r * 0.5, 1.7);
  }
}
function sBush(g, X, Y, accent) {
  const c = accent || 0x3f7a3a;
  g.fillStyle(shade(c, 0.8), 1); g.fillCircle(X - 3, Y + 3, 5); g.fillCircle(X + 3, Y + 3, 5);
  g.fillStyle(c, 1); g.fillCircle(X, Y, 6);
  g.fillStyle(shade(c, 1.2), 1); g.fillCircle(X - 1.5, Y - 1.5, 2);
}
function sBench(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 7, Y - 1, 14, 3);              // seat
  g.fillStyle(shade(WOOD, 1.15), 1); g.fillRect(X - 7, Y - 4, 14, 2); // back
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 6, Y + 2, 2, 5); g.fillRect(X + 4, Y + 2, 2, 5); // legs
}
function sFence(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 7, Y - 4, 1.6, 12); g.fillRect(X + 5.4, Y - 4, 1.6, 12); // posts
  g.fillStyle(WOOD, 1); g.fillRect(X - 7, Y - 3, 14, 1.8); g.fillRect(X - 7, Y + 2, 14, 1.8);     // rails
}
function sSack(g, X, Y) {
  g.fillStyle(0xcdb98a, 1); g.fillEllipse(X, Y + 3, 10, 12);
  g.fillStyle(shade(0xcdb98a, 0.8), 1); g.fillEllipse(X, Y + 6, 10, 4);
  g.fillStyle(0x9a8a5a, 1); g.fillRect(X - 2, Y - 4, 4, 2);           // tied top
}
function sHay(g, X, Y) {
  g.fillStyle(0xd9c168, 1); g.fillRect(X - 7, Y - 3, 14, 10);
  g.lineStyle(1, 0xb59a3a, 1); g.strokeRect(X - 7, Y - 3, 14, 10);
  g.fillStyle(0xb59a3a, 1); g.fillRect(X - 4, Y - 3, 1.4, 10); g.fillRect(X + 3, Y - 3, 1.4, 10);
}
function sPlanter(g, X, Y) {
  g.fillStyle(WOOD, 1); g.fillRect(X - 7, Y + 1, 14, 6);
  for (let i = -5; i <= 5; i += 3) { g.fillStyle(0x4a8a3a, 1); g.fillCircle(X + i, Y, 2.4); g.fillStyle(0x7fd06a, 1); g.fillCircle(X + i, Y - 1, 1); }
}
function sStump(g, X, Y) {
  g.fillStyle(WOOD_D, 1); g.fillRect(X - 4, Y + 1, 8, 6);
  g.fillStyle(WOOD, 1); g.fillEllipse(X, Y, 9, 5);
  g.fillStyle(0xcaa46a, 1); g.fillEllipse(X, Y, 5, 2.6);              // rings
}
function sMushrooms(g, X, Y, accent) {
  const c = accent || 0xc44a4a;
  for (const [dx, dy, s] of [[-3, 3, 1], [2, 4, 0.8], [0, 0, 1.2]]) {
    g.fillStyle(0xe8e0cf, 1); g.fillRect(X + dx - 0.8 * s, Y + dy, 1.6 * s, 3 * s);
    g.fillStyle(c, 1); g.fillCircle(X + dx, Y + dy, 2.4 * s);
    g.fillStyle(0xffffff, 0.7); g.fillCircle(X + dx - 0.8, Y + dy - 0.6, 0.6 * s);
  }
}
function sTallgrass(g, X, Y) {
  g.lineStyle(1.4, 0x5a8a3a, 0.9);
  for (const dx of [-4, -1.5, 1, 3.5]) { g.beginPath(); g.moveTo(X + dx, Y + 6); g.lineTo(X + dx + (dx < 0 ? -2 : 2), Y - 3); g.strokePath(); }
}
function sPebbles(g, X, Y) {
  for (const [dx, dy, r] of [[-3, 2, 2], [2, 3, 2.4], [0, -1, 1.6], [4, -1, 1.4]]) {
    g.fillStyle(0x8a857a, 1); g.fillCircle(X + dx, Y + dy, r);
    g.fillStyle(0xa8a498, 0.7); g.fillCircle(X + dx - 0.5, Y + dy - 0.5, r * 0.5);
  }
}
function sFirewood(g, X, Y) {
  for (const [dx, dy] of [[-3, 4], [3, 4], [0, 0]]) { g.fillStyle(WOOD, 1); g.fillCircle(X + dx, Y + dy, 3); g.fillStyle(0xcaa46a, 1); g.fillCircle(X + dx, Y + dy, 1.4); }
}
function sCrops(g, X, Y, accent) {
  const c = accent || 0x6aae3a;
  for (let i = -5; i <= 5; i += 2.5) { g.fillStyle(c, 1); g.fillCircle(X + i, Y + 3, 2); g.fillStyle(shade(c, 1.25), 1); g.fillCircle(X + i, Y + 2, 0.9); }
}

const SCENERY = {
  lantern: sLantern, barrel: sBarrel, crate: sCrate, flowerbed: sFlowerbed, bush: sBush,
  bench: sBench, fence: sFence, sack: sSack, hay: sHay, planter: sPlanter, stump: sStump,
  mushrooms: sMushrooms, tallgrass: sTallgrass, pebbles: sPebbles, firewood: sFirewood, crops: sCrops,
};
export const SCENERY_KINDS = Object.keys(SCENERY);

// Route a decor object that carries a `scenery` kind. Falls back to a bush.
export function drawScenery(g, cx, cy, o) {
  (SCENERY[o.scenery] || sBush)(g, cx + 16, cy + 16, o.color);
}
