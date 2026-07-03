// src/render/avatarArt.js
// Optional real-art layer for the avatar rig — the "slot" AI-generated PNGs drop
// into. Same pattern as src/data/itemIcons.js: a manifest lists which part-keys
// have a PNG at assets/avatar/<key>.png, and pivots.json gives each part's joint
// anchor in the rig's local space (see docs/AVATAR_ART_SPEC.md).
//
// IMPORTANT: importing or loading this changes NOTHING on screen by itself. Until
// the render integration reads it (and until PNGs are listed in the manifest),
// avatar.js keeps drawing the procedural rig. This module is just the lookup seam:
//   hasAvatarArt(key) -> is there a PNG for this part?
//   avatarArtUrl(key) -> where it lives
//   pivotFor(part)    -> the joint anchor to pin/rotate it by
//
// Fully fallback-safe: no manifest / no server / offline => everything stays
// procedural. Loaded lazily; call loadAvatarArt() once at boot.

const ART = new Set();     // part-keys that have a PNG
let PIVOTS = null;         // { torso, head, arm, leg, helm, weapon }

// Part-key convention: `<group>_<part>[_<variant>]_<facing>`, facing in s|n|e
// (w reuses e, mirrored). e.g. body_torso_s, body_head_s, gear_helm_bronze_s,
// weapon_bronze_scimitar. Art lives at assets/avatar/<key>.png.
export function hasAvatarArt(key) { return ART.has(key); }
export function avatarArtUrl(key) { return `assets/avatar/${key}.png`; }

// Joint anchor for a logical part ('torso'|'head'|'arm'|'leg'|'helm'|'weapon'),
// or null before pivots load / for an unknown part.
export function pivotFor(part) { return PIVOTS ? (PIVOTS[part] || null) : null; }
export function avatarArtReady() { return PIVOTS != null; }
export function avatarArtCount() { return ART.size; }

// Lazy-load the manifest + pivots. Resolves quietly on any failure (the normal
// case until art is authored), leaving the rig fully procedural.
export function loadAvatarArt(
  manifestUrl = 'assets/avatar/manifest.json',
  pivotUrl = 'assets/avatar/pivots.json',
) {
  if (typeof fetch === 'undefined') return Promise.resolve();
  const m = fetch(manifestUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const keys = Array.isArray(j) ? j : (j && Array.isArray(j.parts) ? j.parts : []);
      for (const k of keys) if (typeof k === 'string') ART.add(k);
    })
    .catch(() => {});
  const p = fetch(pivotUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && typeof j === 'object') PIVOTS = j.pivots || j; })
    .catch(() => {});
  return Promise.all([m, p]).then(() => {});
}
