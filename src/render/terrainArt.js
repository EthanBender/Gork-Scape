// src/render/terrainArt.js
// Optional real-art layer for TERRAIN tiles — the "slot" AI-generated ground
// textures drop into. Same pattern as src/render/avatarArt.js and the item-art
// path in itemIcons.js: a manifest lists which tile-keys have a PNG at
// assets/terrain/<key>.png; the render loop (main.js drawTerrain) blits that
// texture on tiles of that family and falls back to the procedural tile when
// there's no art. See docs/TERRAIN_ART_SPEC.md.
//
// Fully fallback-safe: empty manifest / offline => every tile stays procedural,
// and merely importing this changes nothing on screen.

const ART = new Set();   // tile-keys that have a PNG
const GRID = new Map();  // tile-key -> N for an NxN super-tile set (slices at <key>_<idx>.png)

// Tile-key convention: the ground family name, matching the file stem.
//   grass, grass2, water, dirt, road, sand, rock, cliff, wall, floor, field, swamp
// Art lives at assets/terrain/<key>.png (seamless, opaque, square).
export function hasTerrainArt(key) { return ART.has(key); }
// N (>1) if this tile-key uses an NxN super-tile set — art at <key>_<idx>.png,
// idx = (x%N)*N + (y%N), placed by tile position so facets span tiles and mask the
// single-tile grid. Returns 0 for a plain single tile (art at <key>.png).
export function terrainGrid(key) { return GRID.get(key) || 0; }
export function terrainArtUrl(key) { return `assets/terrain/${key}.png`; }
export function terrainArtKeys() { return [...ART]; }
export function terrainArtCount() { return ART.size; }

// Lazy-load the manifest. Resolves to the list of tile-keys that have art (so the
// scene can preload those textures). Resolves to [] on any failure — the normal
// case until art is authored — leaving terrain fully procedural.
export function loadTerrainArt(manifestUrl = 'assets/terrain/manifest.json') {
  if (typeof fetch === 'undefined') return Promise.resolve([]);
  return fetch(manifestUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const keys = Array.isArray(j) ? j : (j && Array.isArray(j.tiles) ? j.tiles : []);
      for (const k of keys) if (typeof k === 'string') ART.add(k);
      const grids = (j && !Array.isArray(j) && j.grids) || null; // { key: N } super-tile sets
      if (grids) for (const gk of Object.keys(grids)) { const n = grids[gk] | 0; if (n > 1) GRID.set(gk, n); }
      return [...ART];
    })
    .catch(() => []);
}
