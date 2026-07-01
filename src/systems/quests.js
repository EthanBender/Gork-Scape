// src/systems/quests.js
// The quest engine (v2) — the game's onboarding + goal layer. Quests are the
// tutorial: you find a marked quest-giver, TALK to them to start, and they send
// you somewhere ("head east to the training yard"), teaching movement, combat,
// gathering, the Grand Exchange, etc. one step at a time.
//
// Design:
//  • Quest DEFINITIONS are data (src/data/quests.json): a giver, intro/outro
//    dialogue, and an ORDERED list of steps. Only the current step is active —
//    finishing it reveals the next, so quests read like a story, not a checklist.
//  • Step types: 'talk' (converse with an NPC), 'goto' (reach a place/region),
//    'kill', 'obtain', 'level'. Each step carries `text` (the objective), `say`
//    (dialogue/narration shown when it becomes active) and optional `where`
//    ({x,y,name}) used for the map + minimap marker.
//  • Quest PROGRESS is a small serializable blob on Game.questState (status +
//    active step index + a per-step counter), saved with the character.
//  • Rewards route through the same addItem/grantXp the rest of the game uses.
//
// Pure predicates are exported for headless tests. Talk/goto are event-driven
// (onTalk/onArrive); kill is tallied at the kill site; obtain/level are checked
// live by a once-per-tick evaluate().

import { Game, addItem, grantXp, grantBankSpace } from '../engine/state.js';

let QUESTS = [];
const Q_BY_ID = new Map();

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

export function registerQuests(defs) {
  QUESTS = Array.isArray(defs) ? defs : [];
  Q_BY_ID.clear();
  for (const q of QUESTS) Q_BY_ID.set(q.id, q);
}
export function allQuests() { return QUESTS; }
export function questById(id) { return Q_BY_ID.get(id); }

// ---- live game-state helpers ------------------------------------------------
function haveItem(id) {
  let n = 0;
  for (const s of Game.inventory) if (s && s.id === id) n += (s.qty === undefined ? 1 : s.qty);
  return n;
}
function skillLevel(name) {
  if (name === 'Hitpoints') return Game.hitpoints ? Game.hitpoints.level : 1;
  return Game.skills && Game.skills[name] ? Game.skills[name].level : 1;
}

// ---- step model -------------------------------------------------------------
// The one step a quest is currently working on (or null if not active / done).
export function activeStep(id) {
  const q = Q_BY_ID.get(id);
  const st = Game.questState && Game.questState[id];
  if (!q || !st || st.status !== 'active') return null;
  return q.steps[st.step] || null;
}

// Progress {have, need, done} for a step, given the quest's stored counter.
export function stepProgress(step, st) {
  if (!step) return { have: 0, need: 1, done: true };
  const need = step.count || 1;
  let have = 0;
  switch (step.type) {
    case 'kill':   have = st.prog || 0; break;         // tallied at kill site
    case 'obtain': have = haveItem(step.target); break; // live inventory
    case 'level':  have = skillLevel(step.target); break;
    case 'talk':   have = st.prog || 0; break;          // 0 until the talk happens
    case 'goto':   have = st.prog || 0; break;          // 0 until arrival
    default:       have = 0;
  }
  return { have: Math.min(have, need), need, done: have >= need };
}

function prereqsMet(quest) {
  const req = quest.requires || {};
  if (Array.isArray(req.quests)) {
    for (const qid of req.quests) {
      const st = Game.questState[qid];
      if (!st || st.status !== 'complete') return false;
    }
  }
  if (req.level && req.level.skill && skillLevel(req.level.skill) < req.level.level) return false;
  return true;
}

// ---- lifecycle --------------------------------------------------------------
export function initQuests() {
  if (!Game.questState) Game.questState = {};
  for (const q of QUESTS) {
    if (!Game.questState[q.id]) Game.questState[q.id] = { status: 'locked', step: 0, prog: 0 };
  }
  refreshAvailability();
  evaluate(true);
}

export function refreshAvailability() {
  if (!Game.questState) return;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status === 'active' || st.status === 'complete') continue;
    st.status = prereqsMet(q) ? 'available' : 'locked';
  }
}

// Short "what to do next" line for a step (objective + destination).
function directionOf(step) {
  if (!step) return '';
  const where = step.where && step.where.name ? ` — ${step.where.name}` : '';
  return `${step.text}${where}`;
}

// Fire the dialogue/narration for entering `step` (chat log + optional box UI).
function announceStep(quest, stepIndex, speaker) {
  const step = quest.steps[stepIndex];
  if (!step) return;
  const lines = [];
  if (step.say) lines.push(step.say);
  lines.push(`Objective: ${directionOf(step)}`);
  emitDialogue(speaker || quest.giver?.name || 'Quest', lines);
}

// Start an available quest (usually via talking to its giver). Fires the giver's
// intro + the first step's directions.
export function startQuest(id) {
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st || st.status !== 'available') return false;
  st.status = 'active';
  st.step = 0;
  st.prog = 0;
  Game.log(`Quest started: ${q.name}.`);
  const intro = q.intro ? [q.intro] : [];
  const step0 = q.steps[0];
  if (step0) {
    if (step0.say) intro.push(step0.say);
    intro.push(`Objective: ${directionOf(step0)}`);
  }
  emitDialogue(q.giver?.name || q.name, intro);
  syncUI();
  return true;
}

// Advance the active quest past its current (satisfied) step. Fires the next
// step's dialogue, or completes the quest if that was the last step.
function advance(id, speaker) {
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st || st.status !== 'active') return;
  st.step += 1;
  st.prog = 0;
  if (st.step >= q.steps.length) { completeQuest(id, speaker); return; }
  announceStep(q, st.step, speaker);
  syncUI();
}

function completeQuest(id, speaker) {
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st) return;
  st.status = 'complete';
  const r = q.rewards || {};
  if (r.coins) addItem('coins', r.coins);
  if (Array.isArray(r.items)) for (const it of r.items) addItem(it.id, it.qty || 1);
  if (Array.isArray(r.xp)) for (const x of r.xp) grantXp(x.skill, x.amount);
  // World-payoff rewards: more bank space, and opening a real world shortcut.
  // grantBankSpace lives in state.js; opening a shortcut is a world action, so it
  // routes through a hook main.js installs (Game.grantShortcut) to avoid a cycle.
  if (r.bankSpace) grantBankSpace(r.bankSpace);
  if (r.openShortcut && Game.grantShortcut) Game.grantShortcut(r.openShortcut);
  const lines = [];
  if (q.outro) lines.push(q.outro);
  const bits = [];
  if (r.coins) bits.push(`${r.coins} coins`);
  if (Array.isArray(r.xp)) for (const x of r.xp) bits.push(`${x.amount} ${x.skill} xp`);
  if (Array.isArray(r.items)) for (const it of r.items) bits.push(`${it.qty || 1}× ${it.id}`);
  if (r.bankSpace) bits.push(`+${r.bankSpace} bank slots`);
  if (r.openShortcut) bits.push('a new shortcut opens');
  if (bits.length) lines.push(`Reward: ${bits.join(', ')}.`);
  emitDialogue(speaker || q.giver?.name || q.name, lines);
  Game.log(`✅ Quest complete: ${q.name}!`);
  if (Game.ui.onQuestComplete) Game.ui.onQuestComplete(q);
  refreshAvailability();
  syncUI();
}

// ---- event entry points -----------------------------------------------------
// Talking to an NPC: starts an available quest whose giver is this NPC, or
// advances an active quest whose current step is `talk` this NPC. Returns true if
// it handled a quest interaction (so the caller can skip the generic greeting).
export function onTalk(npcId) {
  if (!npcId || !Game.questState) return false;
  // Advance an active talk-step first (turn-ins / mid-quest conversations).
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    const step = q.steps[st.step];
    if (step && step.type === 'talk' && step.target === npcId) {
      st.prog = step.count || 1;
      advance(q.id, step.speaker || npcNameFor(npcId, q));
      return true;
    }
  }
  // Otherwise, start an available quest given by this NPC.
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (st && st.status === 'available' && q.giver && q.giver.npc === npcId) {
      startQuest(q.id);
      return true;
    }
  }
  return false;
}

// Player reached tile (x,y) in region `regionId`: satisfy any active goto step
// that targets this region or a nearby point.
export function onArrive(regionId, x, y) {
  if (!Game.questState) return;
  let changed = false;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    const step = q.steps[st.step];
    if (!step || step.type !== 'goto') continue;
    let hit = false;
    if (step.target && step.target === regionId) hit = true;
    if (!hit && step.where) {
      const r = step.where.radius || 4;
      if (Math.abs(x - step.where.x) <= r && Math.abs(y - step.where.y) <= r) hit = true;
    }
    if (hit) { st.prog = 1; advance(q.id); changed = true; }
  }
  if (changed) syncUI();
}

// A kill: advance any active kill-step for this monster.
export function onKill(monsterId) {
  if (!monsterId || !Game.questState) return;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    const step = q.steps[st.step];
    if (step && step.type === 'kill' && step.target === monsterId) {
      st.prog = (st.prog || 0) + 1;
      if (st.prog >= (step.count || 1)) advance(q.id);
      else syncUI();
    }
  }
}

// Per-tick: advance active obtain/level steps (checked live). Cheap.
export function evaluate(silent = false) {
  if (!Game.questState) return;
  let changed = false;
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st || st.status !== 'active') continue;
    const step = q.steps[st.step];
    if (!step || (step.type !== 'obtain' && step.type !== 'level')) continue;
    if (stepProgress(step, st).done) { advance(q.id); changed = true; }
  }
  if (!silent && changed) syncUI();
}

// ---- dialogue plumbing ------------------------------------------------------
function npcNameFor(npcId, quest) {
  if (quest && quest.giver && quest.giver.npc === npcId) return quest.giver.name;
  return 'Goblin';
}
// Route a spoken exchange to the chat log AND (if wired) a dialogue box.
function emitDialogue(speaker, lines) {
  const clean = (lines || []).filter(Boolean);
  if (!clean.length) return;
  for (const l of clean) Game.log(`💬 ${speaker}: ${l}`);
  if (Game.ui && Game.ui.showDialogue) Game.ui.showDialogue(speaker, clean);
}

// ---- views for the journal + markers ----------------------------------------
export function questView(id) {
  if (!Game.questState) return null;
  const q = Q_BY_ID.get(id);
  const st = Game.questState[id];
  if (!q || !st) return null;
  // Per-step display: done for steps before the active one, current = active.
  const steps = q.steps.map((s, i) => {
    let done = false, current = false, prog = { have: 0, need: s.count || 1 };
    if (st.status === 'complete' || i < st.step) done = true;
    else if (st.status === 'active' && i === st.step) { current = true; prog = stepProgress(s, st); }
    return { text: s.text, where: s.where || null, type: s.type, done, current,
      have: done ? (s.count || 1) : prog.have, need: s.count || 1 };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const cur = st.status === 'active' ? q.steps[st.step] : null;
  return {
    id, name: q.name, act: q.act, status: st.status,
    giver: q.giver || null, summary: q.summary || q.intro || '',
    steps, done: doneCount, total: steps.length,
    current: cur ? { text: cur.text, say: cur.say || '', where: cur.where || null } : null,
    rewards: q.rewards,
  };
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

// Marker descriptors for the map/minimap. `npc` (id) means "wherever that NPC is
// right now"; else use x/y. main.js resolves npc -> live tile.
export function questMarkers() {
  if (!Game.questState) return [];
  const out = [];
  for (const q of QUESTS) {
    const st = Game.questState[q.id];
    if (!st) continue;
    if (st.status === 'available' && q.giver) {
      out.push({ kind: 'available', npc: q.giver.npc || null,
        x: q.giver.where?.x, y: q.giver.where?.y, label: q.name });
    } else if (st.status === 'active') {
      const step = q.steps[st.step];
      if (!step) continue;
      const m = { kind: 'active', label: step.text };
      if (step.type === 'talk') m.npc = step.target;
      if (step.where) { m.x = step.where.x; m.y = step.where.y; }
      if (m.npc || (m.x !== undefined && m.y !== undefined)) out.push(m);
    }
  }
  return out;
}

// ---- persistence ------------------------------------------------------------
export function serializeQuests() {
  const out = {};
  if (!Game.questState) return out;
  for (const [id, st] of Object.entries(Game.questState)) {
    out[id] = { status: st.status, step: st.step || 0, prog: st.prog || 0 };
  }
  return out;
}

export function applyQuests(data) {
  if (!Game.questState) Game.questState = {};
  for (const q of QUESTS) Game.questState[q.id] = { status: 'locked', step: 0, prog: 0 };
  if (data && typeof data === 'object') {
    for (const [id, st] of Object.entries(data)) {
      if (!Q_BY_ID.has(id) || !st) continue;
      // v1 saves had {status, kills} with a parallel-step model; an in-progress
      // v1 quest can't map onto ordered steps, so only 'complete' carries over —
      // anything else re-derives from prereqs (may re-offer the quest). Clean.
      const status = st.status === 'complete' ? 'complete'
        : (['available', 'active', 'locked'].includes(st.status) && typeof st.step === 'number' ? st.status : 'locked');
      Game.questState[id] = { status, step: status === 'active' ? (st.step || 0) : 0, prog: st.prog || 0 };
    }
  }
  refreshAvailability();
}

function syncUI() { if (Game.ui && Game.ui.renderQuests) Game.ui.renderQuests(); }

registerQuests(await loadQuestDefs());
