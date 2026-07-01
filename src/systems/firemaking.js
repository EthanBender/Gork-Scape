// src/systems/firemaking.js
// Firemaking: strike Flint & Steel over a stack of logs to light a *temporary*
// fire on the ground that acts as a cooking station. This is the sim/data layer
// (my lane) — it validates the action, spends a log, grants Firemaking XP, and
// keeps the registry of live fires with their lifespans. Rendering the flame and
// placing/animating it in the world is the world-gen + character-render lanes'
// job; they read `activeFires()` and call `lightFireAt()` through a main.js hook.
//
// Seam: a lit fire's `station` is `fire_or_range`, so the EXISTING cooking
// recipes (cook_shrimp, cook_trout, …) already work at it via crafting.js — no
// new cooking data needed. Standing on/next to a fire = "at a range".

import { GameData } from '../data/gameData.js';
import { canonicalId, ITEM_ALIASES } from '../data/idAliases.js';
import { Game, grantXp, countItem } from '../engine/state.js';

// The DB tags firemaking rows `firemaking`; the engine skill is `Firemaking`.
const FM_SKILL = 'Firemaking';
// Ticker cadence (see engine/tick.js) — used to convert a fire's lifespan in
// seconds into a tick deadline.
export const TICK_SECONDS = 0.6;

// ---- inventory helpers (logs are stackable; spend ONE, don't nuke a stack) --
// Count a canonical log id plus any legacy-aliased stacks the player carries
// (gathering adds legacy `logs`; firemaking asks for canonical `normal_logs`).
function heldLogCount(canonId) {
  let n = qtyOf(canonId);
  for (const [legacy, canon] of Object.entries(ITEM_ALIASES)) {
    if (canon === canonId) n += qtyOf(legacy);
  }
  return n;
}
// Total quantity of an exact slot id (stackables carry a qty; others are 1/slot).
function qtyOf(id) {
  return Game.inventory.reduce((n, s) => n + (s && s.id === id ? (s.qty || 1) : 0), 0);
}
// Remove exactly one unit of a log (decrement a stack, or clear a single slot).
// Tries the canonical id first, then any legacy stack. Returns true on success.
function spendOneLog(canonId) {
  const order = [canonId, ...Object.keys(ITEM_ALIASES).filter((l) => ITEM_ALIASES[l] === canonId)];
  for (const id of order) {
    const idx = Game.inventory.findIndex((s) => s && s.id === id);
    if (idx === -1) continue;
    const slot = Game.inventory[idx];
    if ((slot.qty || 1) > 1) slot.qty -= 1;
    else Game.inventory[idx] = null;
    return true;
  }
  return false;
}

// Does the player possess Flint & Steel? (a tool — checked, never consumed)
export function hasFlint() { return countItem('flint_and_steel') > 0; }

function fmLevel() {
  const sk = Game.skills[FM_SKILL];
  return sk ? sk.level : 1;
}

// ---- validation ----------------------------------------------------------
// Can the player light this log right now? -> { ok, reason?, def? }
export function canLight(logId) {
  const def = GameData.firemaking(logId);
  if (!def) return { ok: false, reason: 'not a burnable log' };
  if (!hasFlint()) return { ok: false, reason: 'need Flint & Steel' };
  if (heldLogCount(canonicalId(logId)) < 1) return { ok: false, reason: `no ${def.display_name}` };
  if (fmLevel() < def.level_requirement) {
    return { ok: false, reason: `needs Firemaking ${def.level_requirement}` };
  }
  return { ok: true, def };
}

// ---- active-fire registry (transport-agnostic, like the GE market) --------
// Lifespan is tied to the GLOBAL game tick: `tickFires(count)` is called once
// per 600ms sim tick (from main.js `gameTick`) and reaps fires whose deadline
// has passed. `activeFires()`/`fireAt()` are read-only (render + click routing).
let NEXT_FIRE = 1;
const fires = [];                 // { id, x, y, station, litTick, expiresTick }
export function resetFires(n = 1) { fires.length = 0; NEXT_FIRE = n; } // tests

// Reap fires that have burned out as of `nowTick`; return the ones removed so
// the caller can log "your fire burns out" and clear any interaction on them.
export function tickFires(nowTick) {
  const dead = [];
  for (let i = fires.length - 1; i >= 0; i--) {
    if (fires[i].expiresTick <= nowTick) dead.push(fires.splice(i, 1)[0]);
  }
  return dead;
}

// All currently-burning fires (read-only snapshot for rendering / click tests).
export function activeFires() { return fires; }

// The live fire on this exact tile, or null.
export function fireAt(x, y) { return fires.find((f) => f.x === x && f.y === y) || null; }

// Remaining life as a 0..1 ratio (1 = just lit, 0 = about to gutter out) — lets
// the renderer shrink/dim the flame near the end.
export function fireLifeRatio(fire, nowTick) {
  const total = fire.expiresTick - fire.litTick;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (fire.expiresTick - nowTick) / total));
}

// ---- the action ----------------------------------------------------------
// Light a fire at (x,y) by burning one `logId`. Validates, spends the log,
// grants XP, and registers the fire. Returns { ok, fire } or { ok, reason }.
// `nowTick` is the current game tick; the fire's lifespan comes from the data.
export function lightFireAt(x, y, logId, nowTick = 0) {
  const check = canLight(logId);
  if (!check.ok) return check;
  const def = check.def;
  if (fireAt(x, y)) return { ok: false, reason: 'already a fire here' };
  if (!spendOneLog(canonicalId(logId))) return { ok: false, reason: 'could not use the log' };

  grantXp(FM_SKILL, def.xp_reward);
  const lifeTicks = Math.max(1, Math.ceil(def.fire_seconds / TICK_SECONDS));
  const fire = {
    id: 'fire' + (NEXT_FIRE++),
    x, y,
    // Shaped so the existing main.js interact/cook path treats it as a station:
    // adjacency check reads .x/.y; performSkill's `case 'Cooking'` does the rest.
    label: 'Fire',
    skill: 'Cooking',
    fire: true,
    station: def.station,          // 'fire_or_range' — cook recipes resolve here
    logId: canonicalId(logId),
    litTick: nowTick,
    expiresTick: nowTick + lifeTicks,
  };
  fires.push(fire);
  if (Game.log) {
    Game.log(`The ${def.display_name.toLowerCase()} catch fire. (+${def.xp_reward} Firemaking xp)`);
  }
  if (Game.refresh) Game.refresh();
  return { ok: true, fire };
}

// The station type a lit fire exposes — cooking UI queries recipes for this.
export function fireStation() { return 'fire_or_range'; }
