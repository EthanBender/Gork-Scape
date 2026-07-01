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
import { serializeQuests, applyQuests } from '../systems/quests.js';

export const SAVE_VERSION = 3;
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
    quests: serializeQuests(), // quest status + kill tallies (obtain/level recompute live)
    bankMax: Game.bankMax,     // [economy lane] bank capacity (quest / GP upgrades)
    bank: Array.isArray(Game.bank) ? Game.bank.map((b) => ({ id: b.id, qty: b.qty })) : [], // [economy lane] stored items (tied to the account, must persist)
    openedShortcuts: Array.isArray(Game.openedShortcuts) ? Game.openedShortcuts.slice() : [], // opened bridges/gates
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
  // Quest progress. applyQuests tolerates undefined (pre-v3 saves) by starting
  // everyone on a clean locked slate and re-deriving availability.
  applyQuests(data.quests);
  // [economy lane] Bank capacity + opened shortcuts (quest-reward payoffs). main.js
  // re-applies the shortcut terrain flips after the world is built (reapplyOpenedShortcuts).
  if (typeof data.bankMax === 'number') Game.bankMax = data.bankMax;
  Game.openedShortcuts = Array.isArray(data.openedShortcuts) ? data.openedShortcuts.slice() : [];
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

// ---- portable backup (export / import) --------------------------------------
// localStorage is the ONLY copy of a character today, so a browser cache-clear
// or a switch to another machine wipes everything. These give the player a
// portable escape hatch: a self-describing JSON blob they can download and
// re-import anywhere. Same shape as the stored save, wrapped with a format tag
// so an import can be validated instead of blindly trusted. This is also the
// natural seam for a future server sync (upload the same blob).
const BACKUP_FORMAT = 'goblin_empire_save';

// Serialize an account's stored save into a portable, human-readable JSON string.
// Uses the on-disk save when present, else a live serialize() of the current
// character. Returns null if there's nothing to export.
export function exportSaveString(account, pretty = true) {
  const data = loadSave(account) || (Game.account === account ? serialize() : null);
  if (!data) return null;
  const blob = { format: BACKUP_FORMAT, exportedAt: Date.now(), account, save: data };
  return JSON.stringify(blob, null, pretty ? 2 : 0);
}

// Parse + validate a backup blob. Returns { ok, account, save, error }. Accepts
// either a wrapped backup (from exportSaveString) or a bare save object, so a
// hand-edited or older export still restores.
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Not valid JSON.' }; }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Empty or malformed backup.' };
  const save = obj.format === BACKUP_FORMAT && obj.save ? obj.save : obj;
  // A real save has a schema version and at least a skills map — cheap sanity
  // check so we don't overwrite a good character with unrelated JSON.
  if (typeof save.v !== 'number' || typeof save.skills !== 'object' || !save.skills) {
    return { ok: false, error: 'This file is not a Goblin Empire save.' };
  }
  const account = (obj.account && typeof obj.account === 'string') ? obj.account : null;
  return { ok: true, account, save: migrate(save) };
}

// Import a backup into an account's storage slot (does NOT touch the live game;
// the player loads it from the login screen afterward). `account` overrides the
// destination name (e.g. importing under a new name). Returns { ok, account, error }.
export function importSaveString(text, account = null) {
  const parsed = parseBackup(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const dest = account || parsed.account;
  if (!dest) return { ok: false, error: 'No character name for this import — provide one.' };
  try {
    localStorage.setItem(saveKey(dest), JSON.stringify(parsed.save));
    rememberAccount(dest);
    return { ok: true, account: dest };
  } catch {
    return { ok: false, error: 'Could not write the save (storage full or disabled).' };
  }
}
