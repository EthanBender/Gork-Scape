// src/net/presence.js
// Live multiplayer presence + shared chat on the CLIENT — the piece that lets you
// see other signed-in players walking around the same world, and chat with them
// for real (instead of the old local bot chatter).
//
// How it works: a light heartbeat (~1.5s) POSTs my tile position to the server and
// gets back everyone else + any new chat. Remote players are dropped into the
// normal NPC list as `type: 'player'` entities, so the existing render pipeline
// draws them, interpolates their movement, and labels them for free — main.js only
// needed two one-line guards so they're never AI-driven or attackable. Facing and
// the walk animation are derived from position changes by avatarStateFor(), so we
// don't even send direction.
//
// Fully fallback-safe: if the server can't be reached, heartbeats just no-op.

import { Game } from '../engine/state.js';
import { NPC } from '../world/entities.js';
import { gearHints } from '../render/gear.js';
import { api } from './config.js';
import * as authClient from './authClient.js';

const TILE = 32;
const tilePx = (t) => t * TILE + TILE / 2;
const HEARTBEAT_MS = 1500;
const FETCH_TIMEOUT_MS = 4000;
const PLAYER_SKIN = 0x6fbf3f; // goblin green — remote players are fellow goblins

let timer = null;
let running = false;
let chatCursor = 0;
const remotes = new Map(); // username -> NPC entity

export function onlineCount() { return remotes.size + (running ? 1 : 0); }

async function post(path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(api(path), {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline / timeout — presence just pauses
  } finally {
    clearTimeout(t);
  }
}

// Create a render-only NPC for a remote player. type:'player' keeps it out of the
// AI/aggro/targeting paths (see the [presence lane] guards in main.js).
// Force the render caches avatarStateFor() would otherwise derive from the name,
// so a remote player renders as a humanoid goblin wearing THEIR real equipment
// (the gear hints they sent) instead of a name-guessed default loadout.
function applyAppearance(npc, pl) {
  npc._body = { type: 'humanoid', size: 1 };
  npc._features = null;
  npc._variant = null;
  if (npc._tOff == null) npc._tOff = 0;
  npc._gearCache = pl.gear || npc._gearCache || gearHints({});
}

function spawnRemote(pl) {
  const npc = new NPC({
    id: 'net_' + pl.name, name: pl.name, type: 'player',
    tileX: pl.x, tileY: pl.y, color: PLAYER_SKIN,
    combatLevel: pl.combat || 3,
    levels: { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 },
    bonuses: {}, aggressive: false, wanderRadius: 0, leashRadius: 0,
  });
  npc.remote = true;
  npc.px = tilePx(pl.x);
  npc.py = tilePx(pl.y);
  applyAppearance(npc, pl);
  Game.npcs.push(npc);
  remotes.set(pl.name, npc);
  return npc;
}

// Bring the local NPC list in line with the server's roster: spawn newcomers,
// move existing ones (px/py interpolate in main.js update()), drop those gone.
function reconcile(players) {
  const seen = new Set();
  for (const pl of players) {
    if (!pl || !pl.name) continue;
    seen.add(pl.name);
    const npc = remotes.get(pl.name);
    if (!npc) {
      spawnRemote(pl);
    } else {
      npc.tileX = pl.x;
      npc.tileY = pl.y;
      if (pl.combat) npc.combatLevel = pl.combat;
      if (pl.gear) npc._gearCache = pl.gear; // keep gear live as they swap equipment
    }
  }
  for (const [name, npc] of remotes) {
    if (!seen.has(name)) {
      Game.npcs = Game.npcs.filter((n) => n !== npc);
      remotes.delete(name);
    }
  }
}

function showChat(m) {
  if (!m || !Game.ui || !Game.ui.postChat) return;
  if (m.name === Game.account) return; // my own line was already echoed locally
  Game.ui.postChat({ channel: 'public', name: m.name, text: m.text });
}

async function beat() {
  const token = authClient.getToken();
  const p = Game.player;
  if (!token || !p) return;
  const data = await post('/api/presence', {
    token, x: p.tileX, y: p.tileY,
    combat: Game.myCombat || 0,
    gear: gearHints(Game.equipment), // render hints so others see my real weapon/armour
    sinceChat: chatCursor,
  });
  if (!data) return;
  if (Array.isArray(data.players)) reconcile(data.players);
  if (Array.isArray(data.chat)) {
    for (const m of data.chat) { if (m.id > chatCursor) chatCursor = m.id; showChat(m); }
  }
}

// Post a chat line to everyone online. Called by worldChat.playerSay().
export function sendChat(text) {
  const token = authClient.getToken();
  const clean = (text || '').trim();
  if (!token || !clean) return;
  post('/api/chat', { token, text: clean });
}

// Start presence once the game is ready (Game.player exists). Idempotent.
export function startPresence() {
  if (running) return;
  running = true;
  chatCursor = 0;
  beat();
  timer = setInterval(beat, HEARTBEAT_MS);
}

// Stop presence and clear remote players (logout / teardown).
export function stopPresence() {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  for (const [, npc] of remotes) Game.npcs = Game.npcs.filter((n) => n !== npc);
  remotes.clear();
}
