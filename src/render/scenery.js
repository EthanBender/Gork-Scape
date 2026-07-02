// src/render/scenery.js
// [character-render lane] World decoration pass. For every structure it dresses
// the surrounding tiles with themed, thinning, blended scenery (barrels, crates,
// lanterns, flower beds, hay, bushes, tall grass, pebbles…) so a place reads as
// lived-in rather than an object on empty grass — and the edges blend into the
// adjacent terrain. Purely ADDITIVE: it only pushes non-blocking `decor` objects
// through map.js's public `addWorldObject`; it never edits terrain, collision, or
// World-Gen's own authored placement. Deterministic (seeded), so a re-login
// rebuilds the exact same scenery. Rendering lives in props.js `drawScenery`.
//
//   decorateWorld(world)   // call once, after the world + structures exist

import { addWorldObject, T } from '../world/map.js';
import { SCENERY_KINDS } from './props.js';

const TAU = Math.PI * 2;

// tiny deterministic PRNG so placement is stable across reloads
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// structure label -> decoration theme
function themeFor(label = '') {
  const n = label.toLowerCase();
  if (/market|stall|exchange|grocer|general|fletcher|fishmonger|tackle|bait|shack|store|shop|tavern|inn/.test(n)) return 'market';
  if (/bank|hall|chief|war table|board|throne|quest/.test(n)) return 'civic';
  if (/farm|shed|compost|grain|barn|field/.test(n)) return 'farm';
  if (/anvil|smith|forge|sawmill|craft|bench|workshop|mill/.test(n)) return 'craft';
  if (/camp|tent|watchtower|lodge|hunter|barracks/.test(n)) return 'camp';
  if (/shrine|idol|chapel|altar|well|prayer|sacred/.test(n)) return 'sacred';
  if (/house|hut|home|cottage/.test(n)) return 'home';
  return 'wild';
}
const THEME_KINDS = {
  market: ['barrel', 'crate', 'sack', 'lantern', 'flowerbed', 'bench', 'planter', 'bush'],
  civic:  ['lantern', 'bench', 'flowerbed', 'bush', 'pebbles', 'crate'],
  farm:   ['hay', 'sack', 'crops', 'planter', 'fence', 'bush'],
  craft:  ['firewood', 'crate', 'barrel', 'stump', 'pebbles'],
  camp:   ['firewood', 'crate', 'stump', 'pebbles', 'bush', 'tallgrass'],
  sacred: ['flowerbed', 'bush', 'pebbles', 'lantern', 'mushrooms'],
  home:   ['barrel', 'crate', 'flowerbed', 'planter', 'bush', 'firewood'],
  wild:   ['bush', 'flowerbed', 'tallgrass', 'pebbles', 'stump', 'mushrooms'],
};
const BLEND_KINDS = ['tallgrass', 'bush', 'pebbles', 'flowerbed'];
// accent palette per kind so flower beds / bushes vary; others ignore it
const ACCENTS = [0xd94f6a, 0xe0983f, 0x8a6fd0, 0x4f8f3a, 0xe07fb0, 0x3f7a3a];

const RADIUS = 12;        // how far out we dress each structure (tiles)
const MAX_TOTAL = 4000;   // safety cap on scenery objects added

export function decorateWorld(world) {
  if (!world || !world.objects || world._decorated) return 0;
  const rand = mulberry32((world.W * 73856093) ^ 0x51ede);
  const W = world.W, H = world.H, ter = world.terrain, col = world.collision;
  const taken = new Set();
  let added = 0;

  const okTile = (x, y) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
    const k = x + ',' + y;
    if (taken.has(k) || world.objectAt.has(k)) return false;
    if (col[y * W + x]) return false;                 // never on a blocked tile
    const t = ter[y * W + x];
    return t !== T.WATER && t !== T.WALL;             // keep off water + walls
  };
  const place = (x, y, kind) => {
    if (added >= MAX_TOTAL || !okTile(x, y)) return;
    taken.add(x + ',' + y);
    addWorldObject(world, {
      x, y, type: 'decor', scenery: kind,
      color: ACCENTS[(rand() * ACCENTS.length) | 0],
      size: 6, shape: 'circle', blocking: false,
    }, false);                                        // non-interactive: no click target
    added++;
  };

  // decorate around every structure, themed + thinning with distance
  const structures = world.objects.filter((o) => o.type === 'structure');
  for (const s of structures) {
    const kinds = THEME_KINDS[themeFor(s.label)] || THEME_KINDS.wild;
    const count = 8 + ((rand() * 6) | 0);
    for (let i = 0; i < count; i++) {
      const ang = rand() * TAU;
      const dist = 2 + Math.pow(rand(), 1.7) * RADIUS;  // biased toward the structure
      place(Math.round(s.x + Math.cos(ang) * dist), Math.round(s.y + Math.sin(ang) * dist),
        kinds[(rand() * kinds.length) | 0]);
    }
    // outer blend ring: soft nature that fades the place into adjacent terrain
    for (let i = 0; i < 6; i++) {
      const ang = rand() * TAU, dist = RADIUS + rand() * 6;
      place(Math.round(s.x + Math.cos(ang) * dist), Math.round(s.y + Math.sin(ang) * dist),
        BLEND_KINDS[(rand() * BLEND_KINDS.length) | 0]);
    }
  }

  world._decorated = true;
  return added;
}

export { themeFor, SCENERY_KINDS };
