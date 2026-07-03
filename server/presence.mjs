// server/presence.mjs
// Live multiplayer presence + shared chat — the layer that lets signed-in players
// actually SEE each other. Deliberately EPHEMERAL and in-memory: it's who's online
// right now, where they're standing, and the last few chat lines. None of it is
// worth persisting (positions are transient; a restart just means everyone
// re-heartbeats). Player saves + accounts stay in accounts.mjs.
//
// Transport is dead simple: each client POSTs a heartbeat (~1–2s) with its
// position and gets back everyone ELSE plus any new chat. No WebSockets yet —
// short-poll is plenty for a modest player count and keeps the zero-dep server.

const STALE_MS = 12000;  // a player unseen this long is treated as logged off
const CHAT_MAX = 80;     // ring buffer of recent shared-chat lines

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

// Keep only the small, known gear-hint slots (client-computed render hints for a
// player's equipment), so a client can't stuff arbitrary/huge data through here.
function sanitizeGear(g) {
  if (!g || typeof g !== 'object') return null;
  const out = {};
  for (const slot of ['weapon', 'body', 'legs', 'head', 'shield', 'cape']) {
    if (g[slot] && typeof g[slot] === 'object') out[slot] = g[slot];
  }
  return out;
}

// A player's live gathering signal (so others render them mining/chopping/etc.).
// Whitelisted so a client can't push arbitrary strings into everyone's render.
const SKILLS = new Set(['Woodcutting', 'Mining', 'Fishing', 'Smithing', 'Cooking', 'Crafting', 'Farming']);
const DIRS = new Set(['N', 'E', 'S', 'W']);
const sanitizeSkill = (v) => (SKILLS.has(v) ? v : null);
const sanitizeDir = (v) => (DIRS.has(v) ? v : null);

export class Presence {
  constructor() {
    this.players = new Map(); // username -> { name, x, y, dir, combat, skin, feats, lastSeen }
    this.chat = [];           // [{ id, name, text, ts }]
    this.chatSeq = 0;
  }

  // Update a player's position/appearance and return the live world view for
  // them: every OTHER online player, plus chat lines newer than their cursor.
  heartbeat(username, data = {}, sinceChat = 0) {
    const now = Date.now();
    this.players.set(username, {
      name: username,
      x: num(data.x), y: num(data.y),
      combat: num(data.combat),
      gear: sanitizeGear(data.gear), // render hints for the player's equipment
      skill: sanitizeSkill(data.skill), // gathering skill, or null when not skilling
      sdir: sanitizeDir(data.sdir),     // facing toward the node while gathering
      lastSeen: now,
    });
    this._sweep(now);

    const others = [];
    for (const [name, p] of this.players) {
      if (name === username) continue;
      others.push({ name: p.name, x: p.x, y: p.y, combat: p.combat, gear: p.gear, skill: p.skill, sdir: p.sdir });
    }
    const chat = this.chat.filter((m) => m.id > (sinceChat || 0));
    return { players: others, chat, chatCursor: this.chatSeq, online: this.players.size };
  }

  // Append a chat line to the shared buffer. Returns the stored message or null.
  say(username, text) {
    const clean = str(text, 140).trim();
    if (!clean) return null;
    const msg = { id: ++this.chatSeq, name: username, text: clean, ts: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > CHAT_MAX) this.chat.shift();
    return msg;
  }

  leave(username) { this.players.delete(username); }

  _sweep(now) {
    for (const [name, p] of this.players) {
      if (now - p.lastSeen > STALE_MS) this.players.delete(name);
    }
  }
}
