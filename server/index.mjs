// server/index.mjs
// Goblin Empire — authoritative world server (Phase 4, step 2).
//
// This is the real thing the client-side "world continuity" phases were building
// toward: a process that runs the world loop 24/7 and OWNS the shared state, so
// the world advances even when ZERO players are connected — not "simulated on the
// next login" like the client build, but genuinely always-on.
//
// Deliberately DEPENDENCY-FREE: Node built-ins only (`http`, `fs`), no npm / no
// build step — matching the repo. Transport is HTTP + Server-Sent Events (SSE):
//   GET  /                → serves the game client (replaces the python dev server)
//   GET  /api/world       → snapshot: world clock, active event, sample prices
//   GET  /api/quote?item= → { guide, bestBid, bestAsk, ... } for one item
//   POST /api/order       → place a GE order (the client→server "intent" seam)
//   GET  /api/stream      → SSE: pushes a world snapshot every tick
// SSE is enough to prove always-on + live push; swapping to WebSockets later is a
// transport change behind the same messages (see docs/MULTIPLAYER_ARCHITECTURE.md).
//
// It REUSES the pure modules verbatim — the whole point of keeping them DOM-free:
//   - src/systems/grandExchange.js  (the Market matching engine)
//   - src/engine/worldClock.js      (day/night as a pure fn of time)
//   - src/systems/worldEvents.js    (deterministic event calendar)
// The economy DATA is read straight off disk (fs) instead of the browser's fetch,
// so none of the client's DOM/fetch chain is needed here.

import http from 'node:http';
import { readFile, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

import { Market } from '../src/systems/grandExchange.js';
import * as WorldClock from '../src/engine/worldClock.js';
import * as WorldEvents from '../src/systems/worldEvents.js';
import { Accounts } from './accounts.mjs';
import { Presence } from './presence.mjs';
import { Mobs } from './mobs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');            // repo root (serve the client from here)
// Paths default next to the server but can be overridden (isolated test runs, or
// pointing at a persistent volume on a hosted deploy).
const STATE_FILE = process.env.STATE_FILE || join(__dirname, 'world-state.json');
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || join(__dirname, 'accounts.json');
const PORT = Number(process.env.PORT) || process.argv[2] || 5200;

const LOOP_MS = 2000;        // world tick cadence (economy loop can be slow)
const SAVE_EVERY = 8;        // persist every N loops (~16s)
const SEED_MIN_VALUE = 2;    // only track items worth trading

// ---------------------------------------------------------------- economy data
// Read item base prices + a searchable text (category/subcategory/name) so world
// events can bias the right items — all off disk, no gameData.js fetch chain.
const basePrice = new Map();   // itemId -> base gp value
const matchText = new Map();   // itemId -> "category subcategory name" (for event regex)
const displayName = new Map();

function loadItems() {
  const items = JSON.parse(readFileSync(join(ROOT, 'src/data/items.json'), 'utf8'));
  for (const it of items) {
    const base = it.gp_value || it.shop_sell_price || it.shop_buy_price || 0;
    if (base >= SEED_MIN_VALUE) {
      basePrice.set(it.item_id, base);
      matchText.set(it.item_id, `${it.category || ''} ${it.subcategory || ''} ${it.display_name || it.item_id}`);
      displayName.set(it.item_id, it.display_name || it.item_id);
    }
  }
  return items.length;
}

// ---------------------------------------------------------------- accounts
// Server-authoritative player accounts (username + password) and their saves.
// See server/accounts.mjs. This is what makes profiles real: the save lives on
// the server keyed to the account, not in one browser's localStorage.
const accounts = new Accounts(ACCOUNTS_FILE);

// ---------------------------------------------------------------- presence
// Live multiplayer presence + shared chat (who's online, where, recent chat).
// Ephemeral — see server/presence.mjs.
const presence = new Presence();

// ---------------------------------------------------------------- mobs
// Server-authoritative monsters in the shared central zone (Stage 1 of the shared
// world). See server/mobs.mjs. Generated from the same seed the clients use.
const mobs = new Mobs();
const MOB_VIEW_RADIUS = 32; // tiles of mobs to send a client around its position

// ---------------------------------------------------------------- world state
const market = new Market();
let loopCount = 0;
const serverStartedAt = Date.now();

function seedGuides() {
  for (const [id, base] of basePrice) market.ensureGuide(id, base);
}

// Shared market-maker liquidity. Before matching an order we (re)post a deep
// two-sided quote around the item's guide, so every player trades against the
// same NPC liquidity pool at a realistic spread (buy above / sell below guide).
// Deep quantities stand in for "infinite" NPC depth until real players supply the
// book. Fills move the guide via the engine's EMA, so player demand is shared.
const MM = 'mm';
const MM_SPREAD = 0.05;
const MM_DEPTH = 100000;
function ensureServerLiquidity(itemId) {
  const g = market.guidePrice(itemId) || basePrice.get(itemId) || 1;
  const book = market.book(itemId);
  for (const key of ['buys', 'sells']) {
    for (let i = book[key].length - 1; i >= 0; i--) if (book[key][i].trader === MM) book[key].splice(i, 1);
  }
  market.place('sell', itemId, MM_DEPTH, Math.max(1, Math.round(g * (1 + MM_SPREAD))), MM);
  market.place('buy', itemId, MM_DEPTH, Math.max(1, Math.round(g * (1 - MM_SPREAD))), MM);
}

// Registry of players' resting orders. We retain the order OBJECT (same reference
// the matching engine mutates) even after the engine splices a fully-filled order
// out of the book — so its accrued `coinsOwed`/`itemsOwed` stay collectable. This
// is in-memory only: resting orders don't survive a server restart yet (guide
// prices do). Moving escrow fully server-side is the step that fixes that.
const placedOrders = new Map();  // orderId -> order object
const traderOrders = new Map();  // trader -> Set<orderId>
function registerOrder(order, trader) {
  placedOrders.set(order.id, order);
  if (!traderOrders.has(trader)) traderOrders.set(trader, new Set());
  traderOrders.get(trader).add(order.id);
}
function deregisterOrder(orderId, trader) {
  placedOrders.delete(orderId);
  const s = traderOrders.get(trader);
  if (s) s.delete(orderId);
}
function ownedOrder(orderId, trader) {
  const o = placedOrders.get(orderId);
  return o && o.trader === trader ? o : null;
}

// Authoritative price movement. Runs every loop with NO client required: guides
// mean-revert toward their base value (biased by any live world event) plus a
// small bounded random walk. Same shape as the client's offline drift — here it
// runs continuously instead of once at login.
function driftStep() {
  const now = Date.now();
  const bias = WorldEvents.marketBias(now); // { match, mult } for the live event, or null
  for (const [id, g] of market.guide) {
    if (!(g > 0)) continue;
    const base = basePrice.get(id) || g;
    let target = base;
    if (bias && bias.match.test(matchText.get(id) || id)) target *= bias.mult;
    let ng = g + (target - g) * 0.04;                 // gentle pull toward target
    ng *= 1 + (Math.random() * 2 - 1) * 0.01;         // ±1% noise
    ng = Math.max(base * 0.35, Math.min(base * 3, ng)); // sane band
    market.setGuide(id, Math.max(1, Math.round(ng)));
  }
}

// ---------------------------------------------------------------- persistence
// The world remembers across restarts: guide prices + seq are written to disk and
// reloaded on boot. This is the server-authoritative analogue of the client's
// localStorage `world_market` snapshot.
function saveState() {
  const data = { savedAt: Date.now(), seq: market.seq, guide: [...market.guide.entries()] };
  // Atomic write: a process killed mid-write must never leave a half-written
  // state file (that would wipe the world). Write a temp file, then rename —
  // rename is atomic on the same filesystem, so readers always see a whole file.
  try {
    const tmp = STATE_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('[world] save failed:', err.message);
  }
}

function loadState() {
  if (!existsSync(STATE_FILE)) return false;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(data.guide)) for (const [id, price] of data.guide) market.setGuide(id, price);
    if (typeof data.seq === 'number') market.seq = data.seq;
    const ago = Math.round((Date.now() - (data.savedAt || Date.now())) / 1000);
    console.log(`[world] restored ${data.guide?.length || 0} prices (saved ${ago}s ago)`);
    return true;
  } catch (e) {
    console.error('[world] could not restore state:', e.message);
    return false;
  }
}

// ---------------------------------------------------------------- snapshots
const SAMPLE_ITEMS = ['bronze_bar', 'normal_logs', 'potato', 'copper_ore', 'raw_shrimp', 'coal_ore'];

function worldSnapshot() {
  const now = Date.now();
  const ev = WorldEvents.activeEvent(now);
  const prices = {};
  for (const id of SAMPLE_ITEMS) if (market.guide.has(id)) prices[id] = market.guidePrice(id);
  return {
    now,
    day: WorldClock.dayNumber(now),
    clock: WorldClock.label(now),
    phase: WorldClock.phase(now),
    event: ev ? { id: ev.id, name: ev.name } : null,
    prices,
    tracked: market.guide.size,
    loop: loopCount,
    uptimeSec: Math.round((now - serverStartedAt) / 1000),
  };
}

// ---------------------------------------------------------------- SSE clients
const sseClients = new Set();
function broadcast() {
  if (!sseClients.size) return;
  const payload = `data: ${JSON.stringify(worldSnapshot())}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---------------------------------------------------------------- world loop
loadItems();
seedGuides();
loadState();

setInterval(() => {
  loopCount++;
  driftStep();
  mobs.step(loopCount); // shared-world mobs: wander + respawn
  if (loopCount % SAVE_EVERY === 0) saveState();
  broadcast();
}, LOOP_MS);

// ---------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const filePath = join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); } // no traversal
  readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    // no-cache mirrors the production _headers policy: this is a fast-moving,
    // no-build dev world — a heuristically-cached stale ES module is the #1
    // "my change isn't in the game" trap. Revalidate every time.
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}

// Read + JSON-parse a request body, tolerating an empty/garbage body.
async function readJson(req) {
  try { return JSON.parse(await readBody(req) || '{}'); } catch { return null; }
}

const handleRequest = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS preflight: the client is normally same-origin (this server serves it),
  // but answering OPTIONS lets the auth API also work from a separate client host.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  // ---- accounts / auth ----
  // Create a new account. The username IS the in-game character name.
  if (path === '/api/auth/register' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: 'Bad request.' });
    const r = accounts.register(body.username, body.password);
    return sendJson(res, r.ok ? 200 : (r.code || 400), r.ok ? r : { error: r.error });
  }

  // Sign in to an existing account; returns a session token + the stored save.
  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: 'Bad request.' });
    const r = accounts.login(body.username, body.password);
    return sendJson(res, r.ok ? 200 : (r.code || 401), r.ok ? r : { error: r.error });
  }

  // Resume a session from a held token (page refresh) — no password needed.
  if (path === '/api/auth/me' && req.method === 'POST') {
    const body = await readJson(req);
    const r = accounts.me(body && body.token);
    return sendJson(res, r.ok ? 200 : (r.code || 401), r.ok ? r : { error: r.error });
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, accounts.logout(body && body.token));
  }

  // Persist a player's save server-side (authenticated by their token).
  if (path === '/api/auth/save' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: 'Bad request.' });
    const r = accounts.putSave(body.token, body.save);
    return sendJson(res, r.ok ? 200 : (r.code || 400), r.ok ? r : { error: r.error });
  }

  // ---- multiplayer presence + shared chat ----
  // Heartbeat: report my position, get everyone else + new chat. Token-authed.
  if (path === '/api/presence' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: 'Bad request.' });
    const rec = accounts.resolve(body.token);
    if (!rec) return sendJson(res, 401, { error: 'Session expired.' });
    const view = presence.heartbeat(rec.username, body, body.sinceChat);
    // Attach the shared mobs near this player (interest-managed) — Stage 1 of the
    // shared world. Clients render these instead of their own local mobs (Stage 2).
    const px = Number(body.x) || 0, py = Number(body.y) || 0;
    view.mobs = mobs.snapshotNear(px, py, MOB_VIEW_RADIUS);
    return sendJson(res, 200, view);
  }

  // Post a shared-chat line (seen by everyone online). Token-authed.
  if (path === '/api/chat' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: 'Bad request.' });
    const rec = accounts.resolve(body.token);
    if (!rec) return sendJson(res, 401, { error: 'Session expired.' });
    const msg = presence.say(rec.username, body.text);
    return sendJson(res, 200, { ok: true, msg });
  }

  // ---- API ----
  if (path === '/api/world') return sendJson(res, 200, worldSnapshot());

  if (path === '/api/quote') {
    const id = url.searchParams.get('item');
    if (!id) return sendJson(res, 400, { error: 'missing ?item=' });
    return sendJson(res, 200, { item: id, name: displayName.get(id) || id, ...market.quote(id) });
  }

  // Full authoritative guide-price table — the client mirrors this into its local
  // market so every player sees the same shared, always-on prices.
  if (path === '/api/prices') {
    return sendJson(res, 200, { savedAt: Date.now(), guide: [...market.guide.entries()] });
  }

  if (path === '/api/order' && req.method === 'POST') {
    try {
      const { side, itemId, qty, limit, trader } = JSON.parse(await readBody(req) || '{}');
      if (!['buy', 'sell'].includes(side) || !itemId || !(qty > 0) || !(limit > 0)) {
        return sendJson(res, 400, { error: 'need { side:"buy"|"sell", itemId, qty>0, limit>0 }' });
      }
      const who = trader || 'player';
      ensureServerLiquidity(itemId);                         // shared market-maker depth
      const { order, fills } = market.place(side, itemId, qty, limit, who);
      const gross = fills.reduce((s, f) => s + f.price * f.qty, 0);
      // The client settles these IMMEDIATE fills from the response; clear the
      // order's owed so they aren't double-collected, then register any resting
      // remainder so later cross-fills (from other players) accrue fresh owed.
      order.coinsOwed = 0; order.itemsOwed = 0;
      if (order.qty > 0) registerOrder(order, who);
      return sendJson(res, 200, {
        orderId: order.id, side, itemId,
        filled: order.filled, remaining: order.qty, gross, fills,
        guide: market.guidePrice(itemId),
      });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // A trader's resting orders (still open OR filled-but-uncollected).
  if (path === '/api/offers') {
    const trader = url.searchParams.get('trader');
    const ids = traderOrders.get(trader) || new Set();
    const offers = [];
    for (const id of ids) {
      const o = placedOrders.get(id);
      if (!o) continue;
      offers.push({ id: o.id, side: o.side, itemId: o.itemId, qty: o.qty, filled: o.filled,
        limit: o.limit, coinsOwed: o.coinsOwed, itemsOwed: o.itemsOwed });
    }
    return sendJson(res, 200, { offers });
  }

  // Collect owed goods from a resting order that filled (partially or fully).
  if (path === '/api/collect' && req.method === 'POST') {
    try {
      const { orderId, trader } = JSON.parse(await readBody(req) || '{}');
      const o = ownedOrder(orderId, trader);
      if (!o) return sendJson(res, 404, { error: 'no such order' });
      const coins = o.coinsOwed, items = o.itemsOwed;
      o.coinsOwed = 0; o.itemsOwed = 0;
      if (o.qty === 0) deregisterOrder(orderId, trader); // fully filled + collected → gone
      return sendJson(res, 200, { side: o.side, itemId: o.itemId, coins, items });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // Cancel a resting order: hand back the unfilled remainder (for the client to
  // refund escrow) plus any already-filled-but-uncollected owed.
  if (path === '/api/cancel' && req.method === 'POST') {
    try {
      const { orderId, trader } = JSON.parse(await readBody(req) || '{}');
      const o = ownedOrder(orderId, trader);
      if (!o) return sendJson(res, 404, { error: 'no such order' });
      market.cancel(orderId); // remove from the book if still resting
      const out = { side: o.side, itemId: o.itemId, remaining: o.qty, limit: o.limit,
        coinsOwed: o.coinsOwed, itemsOwed: o.itemsOwed };
      o.coinsOwed = 0; o.itemsOwed = 0; o.qty = 0;
      deregisterOrder(orderId, trader);
      return sendJson(res, 200, out);
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (path === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache',
      connection: 'keep-alive', 'access-control-allow-origin': '*',
    });
    res.write(`data: ${JSON.stringify(worldSnapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ---- static client ----
  serveStatic(req, res, path);
};

// One throw in a route must never kill the always-on world. The handler is async,
// so an uncaught throw would otherwise become an unhandled rejection → process
// crash (Node 15+) → game down for everyone until someone notices the laptop.
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[world] request error on', req.url, err);
    try { sendJson(res, 500, { error: 'internal error' }); } catch { try { res.end(); } catch { /* socket gone */ } }
  });
});
process.on('unhandledRejection', (err) => console.error('[world] unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  console.error('[world] uncaught exception (world kept alive, state saved):', err);
  try { saveState(); accounts.flush(); } catch { /* best effort */ }
});

server.listen(PORT, () => {
  console.log(`[world] Goblin Empire server on http://localhost:${PORT}`);
  console.log(`[world] authoritative loop @ ${LOOP_MS}ms — the world runs with nobody watching.`);
});

function shutdown() {
  console.log('\n[world] saving + shutting down…');
  saveState();
  accounts.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
