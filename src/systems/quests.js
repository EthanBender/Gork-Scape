// src/systems/quests.js
// The quest engine — the first thing that ties the skills, items, combat and
// economy into GOALS. Previously quests existed only as names in worldData.js
// (`QUEST_ACTS`); this makes them real: data-driven objectives that track live
// game state, unlock in a prerequisite chain, and pay out coins/xp on completion.
//
// Design:
//  • Quest DEFINITIONS are data (`src/data/quests.json`) — objectives + rewards.
//  • Quest PROGRESS is a tiny serializable blob on `Game.questState`, saved with
//    the character (see save.js). Kills are tallied (loot can be dropped, so we
//    can't recount them); obtain/level objectives are evaluated LIVE against the
//    inventory / skills, so they need no per-event plumbing — a once-per-tick
//    evaluate() picks them up.
//  • Rewards route through the same addItem/grantXp the rest of the game uses.
//
// The pure predicates (stepStatus / isComplete) take an explicit context object
// so they can be unit-tested headless without a browser (see scripts/, tests).

import { Game, addItem, grantXp } from '../engine/state.js';

let QUESTS = [];                 // ordered quest definitions
const Q_BY_ID = new Map();

// Resilient loader (same rationale as gameData.js): a missing/broken quests.json
// degrades to "no quests" rather than bricking boot. `no-store` dodges the
// stale-ES-module/JSON cache trap under the no-build workflow.
async function loadQuestDefs() {
  try {
    const url = new URL('../data/quests.json', import.meta.url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    console.warn(`quests: could not load quests.json (${e.message}); no quests active`);
    return [];
  }
}

// Register a set of quest definitions (called at boot; also the injection point
// for headless tests, which pass their own list instead of fetching).
export function registerQuests(defs) {
  QUESTS = Array.isArray(defs) ? defs : [];
  Q_BY_ID.clear();
  for (const q of QUESTS) Q_BY_ID.set(q.id, q);
}

export function allQuests() { return QUESTS; }
export function questById(id) { return Q_BY_ID.get(id); }

// ---- live game-state context -----------------------------------------------
// How many of an item the player holds (qty-aware for stackables).
function haveItem(id) {
  let n = 0;
  for (const s of Game.inventory) if (s && s.id === id) n += (s.qty === undefined ? 1 : s.qty);
  return n;
}
function skillLevel(name) {
  if (name === 'Hitpoints') return Game.hitpoints ? Game.hitpoints.level : 1;
  return Game.skills && Game.skills[name] ? Game.skills[name].level : 1;
}

// Build the evaluation context for a quest (kills come from its own tally).
function contextFor(id) {
  const st = Game.questState[id] || {};
  return { have: haveItem, skill: skillLevel, kills: st.kills || {} };
}

// ---- pure predicates (unit-testable) ---------------------------------------
// Progress on one objective. `ctx` = { have(id), skill(name), kills{target:n} }.
export function stepStatus(step, ctx) {
  const need = step.count || 1;
  let have = 0;
  switch (step.type) {
    case 'kill':   have = ctx.kills[step.target] || 0; break;
    case 'obtain': have = ctx.have(step.target); break;
    case 'level':  have = ctx.skill(step.target); break;
    default:       have = 0;
  }
  return { have: Math.min(have, need), need, done: have >= need };
}

export function isComplete(quest, ctx) {
  return quest.steps.every((s) => stepStatus(s, ctx).done);
}

function prereqsMet(quest) {
  const req = quest.requires || {};
  if (Array.isArray(req.quests)) {
    for (const qid of req.quests) {
      const st = Game.questState[qid];
      if (!st || st.status !== 'complete') return false;
    }
  }
  if (req.level && req.level.skill) {
    if (skillLevel(req.level.skill) < req.level.level) return false;
  }
  return true;
}

// ---- lifecycle --------------------------------------------------------------
export function initQuests() {
  if (!Game.questState) Game.questState = {};
  for (const q of QUESTS) {
    if (!Game.questState[q.id]) {
      Game.questState[q.id] = { status: 'locked', kills: {} };
    }
  }
  refreshAvailability();
  // Auto-start the opening quest(s) once their prerequisites are met.
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (q.autoStart && st.status === 'available') startQuest(q.id, true);
  }
  evaluate(true);
}

// Recompute locked -> available as prerequisites come true. Never downgrades an
// active/complete quest.
export function refreshAvailability() {
  if (!Game.questState) return;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status === 'active' || st.status === 'complete') continue;
    st.status = prereqsMet(q) ? 'available' : 'locked';
  }
}

export function startQuest(id, silent = false) {
  const st = Game.questState[id];
  const q = Q_BY_ID.get(id);
  if (!st || !q || st.status !== 'available') return false;
  st.status = 'active';
  if (!st.kills) st.kills = {};
  if (!silent) Game.log(`Quest started: ${q.name}.`);
  syncUI();
  return true;
}

// Tally a kill for every active quest that wants this monster, then evaluate.
export function onKill(monsterId) {
  if (!monsterId || !Game.questState) return;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    const wants = q.steps.some((s) => s.type === 'kill' && s.target === monsterId);
    if (!wants) continue;
    st.kills[monsterId] = (st.kills[monsterId] || 0) + 1;
  }
  evaluate();
}

// Evaluate all active quests; auto-complete any whose objectives are all met.
// Called once per game tick (cheap: a handful of active quests) so obtain/level
// objectives are detected without per-event wiring. `silent` suppresses logs on
// the initial boot pass.
export function evaluate(silent = false) {
  if (!Game.questState) return;
  let changed = false;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    if (isComplete(q, contextFor(q.id))) { completeQuest(q.id, silent); changed = true; }
  }
  if (changed) refreshAvailability();
}

function completeQuest(id, silent) {
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st) return;
  st.status = 'complete';
  const r = q.rewards || {};
  if (r.coins) addItem('coins', r.coins);
  if (Array.isArray(r.items)) for (const it of r.items) addItem(it.id, it.qty || 1);
  if (Array.isArray(r.xp)) for (const x of r.xp) grantXp(x.skill, x.amount);
  if (!silent) {
    Game.log(`✅ Quest complete: ${q.name}!`);
    const bits = [];
    if (r.coins) bits.push(`${r.coins} coins`);
    if (Array.isArray(r.xp)) for (const x of r.xp) bits.push(`${x.amount} ${x.skill} xp`);
    if (bits.length) Game.log(`Reward: ${bits.join(', ')}.`);
    if (Game.ui.onQuestComplete) Game.ui.onQuestComplete(q);
  }
  syncUI();
}

// ---- views for the journal UI ----------------------------------------------
// A quest annotated with its live status + per-step progress, ready to render.
export function questView(id) {
  if (!Game.questState) return null; // UI can render before initQuests() runs
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st) return null;
  const ctx = contextFor(id);
  const steps = q.steps.map((s) => ({ text: s.text, ...stepStatus(s, ctx) }));
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  return { id, name: q.name, act: q.act, giver: q.giver, summary: q.summary,
    status: st.status, steps, done, total, rewards: q.rewards };
}

export function questBoard() {
  const views = QUESTS.map((q) => questView(q.id)).filter(Boolean);
  return {
    active: views.filter((v) => v.status === 'active'),
    available: views.filter((v) => v.status === 'available'),
    complete: views.filter((v) => v.status === 'complete'),
    locked: views.filter((v) => v.status === 'locked'),
    completedCount: views.filter((v) => v.status === 'complete').length,
    total: views.length,
  };
}

// ---- persistence (called by save.js) ---------------------------------------
export function serializeQuests() {
  const out = {};
  if (!Game.questState) return out;
  for (const [id, st] of Object.entries(Game.questState)) {
    out[id] = { status: st.status, kills: st.kills || {} };
  }
  return out;
}

export function applyQuests(data) {
  if (!Game.questState) Game.questState = {};
  // Start from a clean locked slate for every known quest, then overlay the save
  // (so a quest added since the save was written appears, correctly locked).
  for (const q of QUESTS) Game.questState[q.id] = { status: 'locked', kills: {} };
  if (data && typeof data === 'object') {
    for (const [id, st] of Object.entries(data)) {
      if (!Q_BY_ID.has(id)) continue; // drop quests that no longer exist
      Game.questState[id] = {
        status: ['locked', 'available', 'active', 'complete'].includes(st.status) ? st.status : 'locked',
        kills: (st && typeof st.kills === 'object') ? st.kills : {},
      };
    }
  }
  refreshAvailability();
}

function syncUI() { if (Game.ui && Game.ui.renderQuests) Game.ui.renderQuests(); }

// Top-level await (same pattern as gameData.js): any module importing quests.js
// waits until the definitions are loaded before its body runs, so QUESTS is
// guaranteed populated before main.js create()/applyPendingSave touch quest
// state. (In a headless test that lacks fetch, this degrades to no quests; the
// test calls registerQuests() itself.)
registerQuests(await loadQuestDefs());
