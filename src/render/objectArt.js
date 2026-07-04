// src/render/objectArt.js
// Optional real-art layer for WORLD OBJECTS — trees, ore rocks, market stalls,
// barrels, chests, and the rest of the props that sit ON the ground. Same pattern
// as terrainArt.js: a manifest lists which object-keys have a PNG at
// assets/objects/<key>.png; drawObjects (main.js) blits that texture, bottom-
// anchored on the tile so tall things (trees) overhang upward, and falls back to
// the procedural prop when there's no art. See docs/OBJECT_ART_SPEC.md.
//
// Fully fallback-safe: empty manifest / offline => every object stays procedural,
// and merely importing this changes nothing on screen.

const ART = new Set();   // object-keys that have a PNG

// Object-key convention: the object's KIND, matching the file stem.
//   'tree' (woodcutting), 'ore' (mining), and the structure propKind vocabulary
//   (stall, barrel, crate, chest, anvil, well, banner, hut, tower, cart, …).
// Art lives at assets/objects/<key>.png (transparent, "128px = one tile", the
// object standing at the bottom-centre of the canvas).
export function hasObjectArt(key) { return ART.has(key); }
export function objectArtUrl(key) { return `assets/objects/${key}.png`; }
export function objectArtKeys() { return [...ART]; }
export function objectArtCount() { return ART.size; }

// Lazy-load the manifest. Resolves to the list of object-keys that have art (so
// the scene can preload those textures), or [] on any failure — the normal case
// until art is authored — leaving every object procedural.
export function loadObjectArt(manifestUrl = 'assets/objects/manifest.json') {
  if (typeof fetch === 'undefined') return Promise.resolve([]);
  return fetch(manifestUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const keys = Array.isArray(j) ? j : (j && Array.isArray(j.objects) ? j.objects : []);
      for (const k of keys) if (typeof k === 'string') ART.add(k);
      return [...ART];
    })
    .catch(() => []);
}
