// src/engine/run.js
// Run mechanics, modelled on OSRS run energy (oldschool.runescape.wiki/w/Energy).
//
//   - Walking moves 1 tile per game tick; RUNNING moves 2 tiles per tick.
//   - Run energy is 0..100%. It DRAINS while you actually run and REGENERATES
//     any tick you're not running (walking or standing still).
//   - Heavier carried weight drains energy faster (OSRS caps the effect at 64kg;
//     negative/zero weight drain the same).
//   - At 0% you can't run — you auto-revert to walking until it recovers.
//
// OSRS ties regen to the Agility skill; this game has no Agility skill, so regen
// is a flat tunable rate (kept a touch more generous than low-level OSRS so early
// play isn't a slog). All numbers are named constants below — easy to retune.
//
// This module is pure sim state + a tiny HUD sync. main.js owns the actual
// per-tick tile stepping (movement lives there); it calls wantsToRun()/
// updateRunEnergy() around the step and reads RUN_TILES for render interpolation.

import { Game } from './state.js';

export const RUN_TILES = 2;         // tiles moved per tick while running
const DRAIN_BASE = 0.60;            // % drained per run-tick at 0 weight (OSRS ≈ 0.64 for 2 tiles)
const WEIGHT_MAX = 64;              // kg cap on weight's drain contribution (OSRS)
const REGEN = 0.45;                 // % recovered per non-run tick (no Agility skill here)

// No per-item weight in the item DB yet, so approximate: equipped gear is heavy,
// carried non-stackable items are light, stackables (logs/ore/coins) are free —
// the OSRS "more gear = drains faster" feel. Swap for a sum of real item.weight
// once the economy lane adds the field.
const EQUIP_WEIGHT = {
  weapon: 2.5, shield: 5, body: 9, legs: 6, head: 2,
  cape: 0.5, hands: 0.5, feet: 0.5, ring: 0, amulet: 0, neck: 0,
};

export function ensureRun() {
  if (!Game.run) Game.run = { on: false, energy: 100 };
  return Game.run;
}

// Carried weight in kg, clamped to 0..WEIGHT_MAX.
export function playerWeight() {
  let w = 0;
  const eq = Game.equipment || {};
  for (const slot in eq) if (eq[slot]) w += (EQUIP_WEIGHT[slot] ?? 2);
  for (const s of (Game.inventory || [])) if (s && !s.stackable) w += 0.5;
  return Math.max(0, Math.min(WEIGHT_MAX, w));
}

// True if the player intends to run AND is able to (toggle on, energy left, and
// there's a path to move along). Read this BEFORE stepping the path.
export function wantsToRun(p) {
  const r = ensureRun();
  return r.on && r.energy > 0 && !!(p && p.path && p.path.length > 0);
}

// Apply one tick of energy change. `ran` = did the player actually move a 2nd
// tile this tick (i.e. truly ran). Drains (weight-scaled) when ran, else regens.
export function updateRunEnergy(ran) {
  const r = ensureRun();
  if (ran) {
    r.energy = Math.max(0, r.energy - (DRAIN_BASE + playerWeight() / 100));
    if (r.energy === 0) r.on = false; // exhausted → back to walking
  } else {
    r.energy = Math.min(100, r.energy + REGEN);
  }
}

// Toggle run on/off (from the HUD button or the R key).
export function toggleRun() {
  const r = ensureRun();
  if (!r.on && r.energy <= 0) { Game.log && Game.log('You are too exhausted to run.'); return; }
  r.on = !r.on;
  Game.log && Game.log(r.on ? 'Auto-run enabled.' : 'Auto-run disabled — walking.');
  updateRunHud(true);
}

// Push run state into the HUD button. Cheap change-detection so it's safe to call
// every frame. `force` bypasses the cache (used right after a toggle).
let _lastHud = '';
export function updateRunHud(force) {
  const r = ensureRun();
  const btn = document.getElementById('run-btn');
  if (!btn) return;
  const pct = Math.round(r.energy);
  const key = (r.on ? 1 : 0) + ':' + pct;
  if (!force && key === _lastHud) return;
  _lastHud = key;
  const ico = document.getElementById('run-ico');
  const txt = document.getElementById('run-pct');
  const fill = document.getElementById('run-fill');
  if (ico) ico.textContent = r.on ? '🏃' : '🚶';
  if (txt) txt.textContent = pct + '%';
  if (fill) fill.style.width = pct + '%';
  btn.classList.toggle('on', r.on);
  btn.classList.toggle('low', pct <= 20);
}
