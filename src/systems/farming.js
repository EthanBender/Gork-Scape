// src/systems/farming.js
// Crop growth over world time. Like the market and shops, a planted crop is
// WORLD state: it grows on the world clock whether or not the player is online,
// because a crop's stage is a pure function of (now − plantedAt). Plant a seed
// in an allotment patch, come back later — real time passed, so it's grown or
// ripe. Persisted globally so plantings survive logout and keep maturing.
//
// This module is the GROWTH ENGINE only. The plant/harvest *interaction* (using a
// seed on a `crop_patch` node, the Farming skill + XP, and the patch's on-screen
// state) is the remaining wiring — the economy lane owns it (world_nodes.json
// already stages `crop_patch` nodes; map.js places them as non-interactive labels
// today). Callers reach this via `Game.farming` (exposed in main.js), mirroring
// `Game.worldClock` / `Game.worldEvents`.

import { DAY_MS } from '../engine/worldClock.js';

const STAGES = 4;                          // planted → sprouting → growing → ripe
const WORLD_HOUR_MS = DAY_MS / 24;
const DEFAULT_GROW_MS = 4 * WORLD_HOUR_MS; // 4 world-hours to fully ripe

// Per-crop grow times (world-hours). Unknown crops fall back to the default, so
// this stays correct even as new seeds/crops are added to the data.
const CROP_GROW_HOURS = {
  potato: 3, cabbage: 4, onion: 5, tomato: 5, sweetcorn: 6,
  strawberry: 7, watermelon: 8, herb: 8, mushroom: 6,
};
const STAGE_LABELS = ['just planted', 'sprouting', 'growing'];

// key -> { key, cropId, seedId, patchId, plantedMs }
const plots = new Map();

function growMs(cropId) {
  const h = CROP_GROW_HOURS[cropId];
  return h ? h * WORLD_HOUR_MS : DEFAULT_GROW_MS;
}

// ---- planting / growth --------------------------------------------------------
// `key` uniquely identifies the patch (e.g. `${tileX},${tileY}` or a patch id).
// Planting over an existing plot replaces it.
export function plant(key, { cropId, seedId = null, patchId = null }, nowMs = Date.now()) {
  const rec = { key, cropId, seedId, patchId, plantedMs: nowMs };
  plots.set(key, rec);
  return rec;
}

export function cropAt(key) { return plots.get(key) || null; }
export function clear(key) { return plots.delete(key); }
export function allPlots() { return [...plots.values()]; }

// Current growth of a plot: { cropId, stage, stages, ready, fraction, label } or null.
export function growth(key, nowMs = Date.now()) {
  const rec = plots.get(key);
  if (!rec) return null;
  const total = growMs(rec.cropId);
  const elapsed = Math.max(0, nowMs - rec.plantedMs);
  const fraction = total > 0 ? Math.min(1, elapsed / total) : 1;
  const ready = fraction >= 1;
  const stage = ready ? STAGES - 1 : Math.min(STAGES - 2, Math.floor(fraction * STAGES));
  return {
    cropId: rec.cropId,
    stage, stages: STAGES, ready, fraction,
    label: ready ? 'ripe — ready to harvest' : STAGE_LABELS[stage],
  };
}

export function isReady(key, nowMs = Date.now()) {
  const g = growth(key, nowMs);
  return !!(g && g.ready);
}

// Harvest a ripe plot: removes the planting and returns { cropId, qty }, or null
// if the plot is missing or not yet ripe. `yieldBonus` (e.g. from Farming level)
// scales the base yield when the interaction layer passes one.
export function harvest(key, nowMs = Date.now(), yieldBonus = 1) {
  const g = growth(key, nowMs);
  if (!g || !g.ready) return null;
  const rec = plots.get(key);
  plots.delete(key);
  const qty = Math.max(1, Math.round(3 * yieldBonus));
  return { cropId: rec.cropId, qty };
}

// How many plots are ripe right now — used for a login summary.
export function readyCount(nowMs = Date.now()) {
  let n = 0;
  for (const key of plots.keys()) if (isReady(key, nowMs)) n++;
  return n;
}

// ---- persistence (world state) ------------------------------------------------
const WORLD_FARMS_KEY = 'goblin_empire:world_farms';

export function serializeFarms() {
  return {
    v: 1,
    savedAt: Date.now(),
    plots: [...plots.values()].map((r) => ({
      key: r.key, cropId: r.cropId, seedId: r.seedId, patchId: r.patchId, plantedMs: r.plantedMs,
    })),
  };
}

export function restoreFarms(data) {
  if (!data || data.v !== 1) return false;
  plots.clear();
  for (const r of (data.plots || [])) {
    if (r && r.key) {
      plots.set(r.key, {
        key: r.key, cropId: r.cropId, seedId: r.seedId || null,
        patchId: r.patchId || null, plantedMs: r.plantedMs || 0,
      });
    }
  }
  return true;
}

export function saveWorldFarms() {
  try { localStorage.setItem(WORLD_FARMS_KEY, JSON.stringify(serializeFarms())); return true; }
  catch { return false; }
}

// Restore plantings on login. Because growth is a pure function of world time,
// crops keep maturing while offline — this just reloads them; `growth()` reflects
// however much time passed. Returns how many are ripe now (for a login note).
export function loadWorldFarms() {
  let data = null;
  try { const raw = localStorage.getItem(WORLD_FARMS_KEY); data = raw ? JSON.parse(raw) : null; }
  catch { data = null; }
  if (data) restoreFarms(data);
  return readyCount();
}
