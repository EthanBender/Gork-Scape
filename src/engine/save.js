// src/engine/save.js
// Persistence for a single player. State lives in localStorage, keyed per
// account, so logging out and back in (same browser) restores your character.
// This is intentionally a thin, swappable layer: everything network-facing goes
// through serialize()/applySave() + the small storage helpers, so a future
// server backend can reuse the same shapes (see COORDINATION.md — client-side
// persistence is phase 1 of the "hosted" plan).
//
// We persist the PLAYER, not the world. The world is regenerated on load
// (nodes full, nothing on the ground), which is the correct resting state after
// any real time away, so there is nothing stale to restore for it.

import { Game, INVENTORY_SIZE } from './state.js';
import { ITEMS } from '../items/equipment.js';

export const SAVE_VERSION = 2;
const KEY_PREFIX = 'goblin_empire:save:';
const ACCOUNTS_KEY = 'goblin_empire:accounts';

const saveKey = (account) => KEY_PREFIX + account;

// ---- account registry -------------------------------------------------------
export function listAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function rememberAccount(account) {
  const accounts = listAccounts();
  if (!accounts.includes(account)) {
    accounts.push(account);
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch { /* quota */ }
  }
}

export function hasSave(account) {
  try { return localStorage.getItem(saveKey(account)) !== null; } catch { return false; }
}

export function deleteSave(account) {
  try { localStorage.removeItem(saveKey(account)); } catch { /* ignore */ }
  const accounts = listAccounts().filter((a) => a !== account);
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch { /* ignore */ }
}

// When was this account last saved? (epoch ms, or 0 if unknown). Used by the
// login screen to show "last played" and to compute offline elapsed time.
export function savedAt(account) {
  const data = loadSave(account);
  return data && data.savedAt ? data.savedAt : 0;
}

// ---- (de)serialization ------------------------------------------------------
// Items are stored as the minimal {id, qty}; makeItem-style rehydration happens
// on load so a data/schema change to an item definition doesn't corrupt saves.
function serItem(slot) {
  if (!slot) return null;
  const out = { id: slot.id };
  if (slot.qty !== undefined) out.qty = slot.qty;
  return out;
}

function rehydrate(rec) {
  if (!rec || !rec.id) return null;
  const def = ITEMS[rec.id];
  if (!def) return null; // item no longer exists — silently drop rather than crash
  // Mirror addItem(): copy stackables so the shared registry def isn't mutated;
  // share the immutable def for non-stackables.
  if (def.stackable) return Object.assign({}, def, { qty: rec.qty ?? 1 });
  return def;
}

export function serialize() {
  const p = Game.player;
  const skills = {};
  for (const [name, sk] of Object.entries(Game.skills)) {
    skills[name] = { xp: sk.xp, level: sk.level };
  }
  const equipment = {};
  for (const [slot, item] of Object.entries(Game.equipment)) {
    if (item) equipment[slot] = serItem(item);
  }
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    tick: Game.ticker ? Game.ticker.count : 0,
    skills,
    hitpoints: { xp: Game.hitpoints.xp, level: Game.hitpoints.level },
    hp: Game.hp,
    maxHp: Game.maxHp,
    attackStyle: Game.attackStyle,
    inventory: Game.inventory.map(serItem),
    equipment,
    pos: p ? { x: p.tileX, y: p.tileY } : null,
  };
}

// Apply a save blob onto the live Game state. Assumes initState()/buildWorld()
// have already run this session (so Game.skills/player exist); this overwrites
// them with the saved values. Returns nothing; callers sync player px/py.
export function applySave(data) {
  if (!data) return;

  if (data.skills) {
    for (const name of Object.keys(Game.skills)) {
      const s = data.skills[name];
      if (s) { Game.skills[name].xp = s.xp; Game.skills[name].level = s.level; }
    }
  }
  if (data.hitpoints) {
    Game.hitpoints.xp = data.hitpoints.xp;
    Game.hitpoints.level = data.hitpoints.level;
  }
  if (typeof data.maxHp === 'number') Game.maxHp = data.maxHp;
  if (typeof data.hp === 'number') Game.hp = Math.min(data.hp, Game.maxHp);
  if (data.attackStyle) Game.attackStyle = data.attackStyle;

  Game.inventory = new Array(INVENTORY_SIZE).fill(null);
  if (Array.isArray(data.inventory)) {
    for (let i = 0; i < INVENTORY_SIZE && i < data.inventory.length; i++) {
      Game.inventory[i] = rehydrate(data.inventory[i]);
    }
  }

  Game.equipment = {};
  if (data.equipment) {
    for (const [slot, rec] of Object.entries(data.equipment)) {
      const item = rehydrate(rec);
      if (item) Game.equipment[slot] = item;
    }
  }

  if (data.pos && Game.player) {
    Game.player.tileX = data.pos.x;
    Game.player.tileY = data.pos.y;
  }
  Game.selectedInv = null;
}

// ---- storage ----------------------------------------------------------------
export function loadSave(account) {
  try {
    const raw = localStorage.getItem(saveKey(account));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return migrate(data);
  } catch {
    return null;
  }
}

export function saveGame(account) {
  if (!account) return false;
  try {
    const data = serialize();
    localStorage.setItem(saveKey(account), JSON.stringify(data));
    rememberAccount(account);
    return true;
  } catch {
    // Storage full / disabled (private mode). Fail soft — the game keeps running.
    return false;
  }
}

// Forward-compatibility shim. Old saves are best-effort upgraded; anything we
// can't understand still loads with sensible fields missing (applySave guards).
function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.v) data.v = 1;
  return data;
}
