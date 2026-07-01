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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');            // repo root (serve the client from here)
const STATE_FILE = join(__dirname, 'world-state.json');
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
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

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
});

server.listen(PORT, () => {
  console.log(`[world] Goblin Empire server on http://localhost:${PORT}`);
  console.log(`[world] authoritative loop @ ${LOOP_MS}ms — the world runs with nobody watching.`);
});

function shutdown() {
  console.log('\n[world] saving + shutting down…');
  saveState();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
