// src/systems/townDecor.js
// Decorative props for the Goblin Settlement — the "it's actually a lived-in town"
// layer. Fixed to the hand-authored settlement layout (plaza fountain, market
// stalls, the keep/bank, the four trade wards). Rendered on its own graphics layer
// (between structures and entities) so it dresses up the plain structure tiles
// without touching drawObjects. Purely visual: no collision, no state.
//
// Self-contained (economy/items lane): main.js creates a `decorGfx` layer and calls
// drawTownDecor(decorGfx) each frame after drawObjects().

import { Game } from '../engine/state.js';
import { TILE_SIZE } from '../world/map.js';

// mirror main.js's elevation constants so props sit at the right height on the
// slightly-raised town platform.
const ELEV_BASE = 80, ELEV_K = 0.34;
function lift(x, y) {
  const e = Game.world && Game.world.elevation;
  return e ? (e[y * Game.world.W + x] - ELEV_BASE) * ELEV_K : 0;
}
const sh = (c, f) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return ((Math.min(255, r * f) | 0) << 16) | ((Math.min(255, g * f) | 0) << 8) | (Math.min(255, b * f) | 0);
};

// Props, positioned in the fixed settlement (plaza centre 500,455; keep 489–511 ×
// 419–434 with the Bank counter at 493,431; four wards around the gates).
export const TOWN_DECOR = [
  // ---- plaza heart ----
  { x: 504, y: 452, kind: 'fountain' },
  { x: 498, y: 452, kind: 'flowers', c: 0xd23b6b },
  { x: 502, y: 458, kind: 'flowers', c: 0xe0c050 },
  { x: 497, y: 458, kind: 'crate' },
  { x: 503, y: 458, kind: 'barrel' },
  // market stalls — striped awnings + goods
  { x: 492, y: 461, kind: 'awning', c: 0xb23b3b },
  { x: 496, y: 461, kind: 'awning', c: 0x3b6bb2 },
  { x: 504, y: 461, kind: 'awning', c: 0x3b9b52 },
  { x: 508, y: 461, kind: 'awning', c: 0xb2843b },
  { x: 488, y: 461, kind: 'awning', c: 0xe3c45a }, // Grand Exchange stall
  // lamp posts down the two avenues + plaza corners
  { x: 496, y: 452, kind: 'lamp' }, { x: 504, y: 458, kind: 'lamp' },
  { x: 499, y: 441, kind: 'lamp' }, { x: 501, y: 470, kind: 'lamp' },
  { x: 485, y: 454, kind: 'lamp' }, { x: 515, y: 456, kind: 'lamp' },
  // ---- the keep + bank vault ----
  { x: 497, y: 418, kind: 'banner', c: 0x8a6fbf }, { x: 503, y: 418, kind: 'banner', c: 0x8a6fbf },
  // banking mat: a 2-tile runner in front of the Bank counter (493,431) marking
  // the clear approach — the buffer tile (493,432) and the Banker's stand (493,433).
  { x: 493, y: 432, kind: 'rug', c: 0x6a3b6a }, { x: 493, y: 433, kind: 'rug', c: 0x6a3b6a },
  { x: 494, y: 430, kind: 'coins' },
  { x: 490, y: 428, kind: 'torch' }, { x: 496, y: 425, kind: 'torch' },
  // ---- forge ward (N) ----
  { x: 481, y: 411, kind: 'crate' }, { x: 519, y: 411, kind: 'barrel' },
  // ---- wharf (E): nets + fish barrels ----
  { x: 545, y: 451, kind: 'nets' }, { x: 537, y: 465, kind: 'barrel' },
  // ---- greengate (S): sacks + hay ----
  { x: 490, y: 502, kind: 'sacks' }, { x: 483, y: 502, kind: 'hay' }, { x: 517, y: 502, kind: 'hay' },
  // ---- timber row (W): logs + sawdust ----
  { x: 456, y: 452, kind: 'logs' }, { x: 456, y: 466, kind: 'crate' },
];

function drawItem(g, d, t, ox = 0, oy = 0) {
  const dx = d.x + ox, dy = d.y + oy;
  const bx = dx * TILE_SIZE, by = dy * TILE_SIZE - lift(dx, dy);
  const cx = bx + 16, cy = by + 16;
  switch (d.kind) {
    case 'lamp': {
      g.fillStyle(0x2a2620, 1); g.fillRect(cx - 2, by + 6, 4, 24);            // post
      g.fillStyle(0x3a352c, 1); g.fillRect(cx - 5, by + 28, 10, 3);           // base
      const fl = 0.6 + 0.4 * Math.sin(t * 2 + d.x);
      g.fillStyle(0xffd66a, 0.22 * fl); g.fillCircle(cx, by + 6, 9);          // glow
      g.fillStyle(0x6a5a2a, 1); g.fillRect(cx - 3, by + 1, 6, 7);             // lantern housing
      g.fillStyle(sh(0xffcf5a, 0.8 + 0.4 * fl), 1); g.fillRect(cx - 2, by + 2, 4, 5); // flame
      break;
    }
    case 'fountain': {
      g.fillStyle(0x6f6a5a, 1); g.fillCircle(cx, cy, 12);                     // stone basin
      g.fillStyle(0x3f77a6, 1); g.fillCircle(cx, cy, 9);                      // water
      g.fillStyle(0x8a8578, 1); g.fillRect(cx - 2, cy - 8, 4, 12);            // central plinth
      const s = 3 + 2 * Math.sin(t * 1.5);
      g.fillStyle(0xbfe0f0, 0.85); g.fillCircle(cx, cy - 9, 3);               // spout
      g.fillStyle(0xbfe0f0, 0.5); g.fillCircle(cx - 5, cy - 3 - s * 0.5, 1.6); g.fillCircle(cx + 5, cy - 3 - s * 0.5, 1.6); // droplets
      break;
    }
    case 'awning': {
      const c = d.c || 0xb23b3b;
      // canopy: stripes above the stall counter + two support posts
      for (let i = 0; i < 6; i++) { g.fillStyle((i & 1) ? c : 0xe8e0cf, 1); g.fillRect(bx + 1 + i * 5, by - 2, 5, 7); }
      g.fillStyle(sh(c, 0.6), 1); g.fillRect(bx, by + 5, TILE_SIZE, 2);       // valance shadow
      g.fillStyle(0x4a3f30, 1); g.fillRect(bx + 1, by + 6, 2, 12); g.fillRect(bx + TILE_SIZE - 3, by + 6, 2, 12); // posts
      // goods on the counter
      g.fillStyle(0xcf7a3a, 1); g.fillCircle(bx + 9, by + 22, 2.4);
      g.fillStyle(0x8fbf4a, 1); g.fillCircle(bx + 15, by + 23, 2.2);
      g.fillStyle(0xc94a4a, 1); g.fillCircle(bx + 21, by + 22, 2.4);
      break;
    }
    case 'barrel': {
      g.fillStyle(0x6a4a2a, 1); g.fillRect(cx - 6, cy - 8, 12, 16);
      g.fillStyle(0x8a6a3a, 1); g.fillRect(cx - 6, cy - 8, 12, 3); g.fillRect(cx - 6, cy + 5, 12, 3);
      g.fillStyle(0x3a2a18, 1); g.fillRect(cx - 6, cy - 1, 12, 2);            // hoop
      break;
    }
    case 'crate': {
      g.fillStyle(0x9a7a44, 1); g.fillRect(cx - 7, cy - 7, 14, 14);
      g.fillStyle(0x6a5230, 1); g.fillRect(cx - 7, cy - 1, 14, 2); g.fillRect(cx - 1, cy - 7, 2, 14);
      g.lineStyle(1, 0x6a5230, 1); g.strokeRect(cx - 7, cy - 7, 14, 14);
      break;
    }
    case 'sacks': {
      g.fillStyle(0xcabf92, 1); g.fillCircle(cx - 4, cy + 2, 5); g.fillCircle(cx + 4, cy + 2, 5); g.fillCircle(cx, cy - 3, 5);
      g.fillStyle(0xa89a6a, 1); g.fillCircle(cx, cy - 3, 1.5);
      break;
    }
    case 'hay': {
      g.fillStyle(0xc9a94a, 1); g.fillRect(cx - 8, cy - 5, 16, 11);
      g.fillStyle(0xa88a34, 1); for (let i = -6; i < 8; i += 4) g.fillRect(cx + i, cy - 5, 1, 11);
      g.fillStyle(0x8a6a24, 1); g.fillRect(cx - 8, cy - 1, 16, 1.5);
      break;
    }
    case 'logs': {
      g.fillStyle(0x7a5a34, 1); g.fillRect(cx - 8, cy - 4, 16, 9);
      g.fillStyle(0xc9a86a, 1); g.fillCircle(cx - 8, cy, 3); g.fillCircle(cx - 8, cy - 4, 3); g.fillCircle(cx + 8, cy, 3);
      break;
    }
    case 'nets': {
      g.fillStyle(0x2a2620, 0.9); g.fillRect(cx - 8, cy - 8, 16, 16);
      g.lineStyle(1, 0x8a8570, 0.8);
      for (let i = -8; i <= 8; i += 4) { g.beginPath(); g.moveTo(cx + i, cy - 8); g.lineTo(cx + i, cy + 8); g.strokePath(); g.beginPath(); g.moveTo(cx - 8, cy + i); g.lineTo(cx + 8, cy + i); g.strokePath(); }
      break;
    }
    case 'flowers': {
      const c = d.c || 0xd23b6b;
      g.fillStyle(0x4a3f30, 1); g.fillRect(cx - 7, cy + 2, 14, 6);           // planter box
      g.fillStyle(0x3a6b2a, 1); g.fillRect(cx - 7, cy, 14, 3);               // greenery
      for (const [dx, dy] of [[-4, -2], [0, -4], [4, -2], [-2, -1], [3, 0]]) { g.fillStyle(c, 1); g.fillCircle(cx + dx, cy + dy, 1.8); }
      break;
    }
    case 'rug': {
      const c = d.c || 0x6a3b6a;
      g.fillStyle(c, 0.9); g.fillRect(bx + 3, by + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      g.lineStyle(2, sh(c, 1.4), 0.9); g.strokeRect(bx + 5, by + 5, TILE_SIZE - 10, TILE_SIZE - 10);
      break;
    }
    case 'coins': {
      g.fillStyle(0xe3c45a, 1); g.fillCircle(cx - 4, cy + 4, 4); g.fillCircle(cx + 4, cy + 3, 4); g.fillCircle(cx, cy, 4);
      g.fillStyle(0xf5e08a, 1); g.fillCircle(cx - 4, cy + 3, 1.5); g.fillCircle(cx, cy - 1, 1.5);
      break;
    }
    case 'banner': {
      const c = d.c || 0x8a6fbf;
      g.fillStyle(0x2a2620, 1); g.fillRect(cx - 1, by - 4, 2, 6);            // pole
      g.fillStyle(c, 1); g.fillRect(cx - 5, by + 1, 10, 16);                 // cloth
      g.fillStyle(sh(c, 0.6), 1); g.fillRect(cx - 5, by + 1, 10, 2);
      g.fillStyle(0xe8c65a, 1); g.fillCircle(cx, by + 8, 2.5);               // crest
      g.fillStyle(c, 1); g.fillTriangle(cx - 5, by + 17, cx, by + 21, cx + 5, by + 17); // swallowtail
      break;
    }
    case 'torch': {
      g.fillStyle(0x2a2018, 1); g.fillRect(cx - 1, cy - 4, 2, 10);
      const fl = 0.6 + 0.4 * Math.sin(t * 3 + d.y);
      g.fillStyle(0xff9a3a, 0.3 * fl); g.fillCircle(cx, cy - 6, 6);
      g.fillStyle(sh(0xffca4a, 0.8 + 0.3 * fl), 1); g.fillCircle(cx, cy - 6, 2.6);
      break;
    }
    default: break;
  }
}

export function drawTownDecor(g) {
  g.clear();
  const t = Date.now() * 0.004;
  // GEO2 relocates the authored town to the chosen river ford; these props are
  // authored in the fixed 500,455 layout, so shift them by the same offset.
  const off = (Game.world && Game.world.townOffset) || { dx: 0, dy: 0 };
  for (const d of TOWN_DECOR) drawItem(g, d, t, off.dx, off.dy);
}
