// src/systems/geActions.js
// Player-facing Grand Exchange actions: escrow, settlement, NPC liquidity, and
// the player's active-offer list. This is the adapter between the pure matching
// engine (grandExchange.js) and the live game (inventory + coins). In a real MMO
// this layer becomes the client<->server request/response; the engine is shared.

import { market } from './grandExchange.js';
import { GameData } from '../data/gameData.js';
import { canonicalId } from '../data/idAliases.js';
import { Game, addItem, firstFreeSlot } from '../engine/state.js';

const COINS = 'coins';

// The 2% GE sell tax is a coin SINK, but rather than vanishing it flows into the
// GOBLIN TREASURY — a visible war-chest that funds world events. So the economy
// has a faucet (drops/gathering), a sink (this tax), and a payoff (events spend
// the treasury) instead of coins just evaporating.
// `geTax.totalSunk` is kept for back-compat; `balance` is the spendable war-chest.
const GE_TAX_RATE = 0.02;
export const geTax = { totalSunk: 0, balance: 0 };
export const treasury = geTax; // friendlier alias
export function spendTreasury(n) {
  if (n <= 0 || geTax.balance < n) return false;
  geTax.balance -= n;
  return true;
}
function creditSale(grossCoins) {
  const tax = Math.floor(grossCoins * GE_TAX_RATE);
  geTax.totalSunk += tax;
  geTax.balance += tax;
  addCoins(grossCoins - tax);
  return { net: grossCoins - tax, tax };
}

// ---- coin + stackable-quantity helpers (state.js counts slots, not amounts) --
export function playerCoins() {
  return Game.inventory.reduce((n, s) => n + (s && s.id === COINS ? (s.qty || 1) : 0), 0);
}
export function countTotal(id) {
  const cid = canonicalId(id);
  return Game.inventory.reduce((n, s) => {
    if (!s) return n;
    if (s.id === id || s.id === cid || canonicalId(s.id) === cid) return n + (s.qty || 1);
    return n;
  }, 0);
}
export function addCoins(n) { if (n > 0) addItem(COINS, n); }

// Remove `qty` units of an item across stacks (decrement stackables, clear
// non-stackable slots). Returns true if the full quantity was removed.
function spendItem(id, qty) {
  const cid = canonicalId(id);
  let left = qty;
  for (let i = 0; i < Game.inventory.length && left > 0; i++) {
    const s = Game.inventory[i];
    if (!s) continue;
    if (!(s.id === id || s.id === cid || canonicalId(s.id) === cid)) continue;
    const have = s.qty || 1;
    const take = Math.min(have, left);
    if (have - take <= 0) { Game.inventory[i] = null; if (Game.selectedInv === i) Game.selectedInv = null; }
    else s.qty = have - take;
    left -= take;
  }
  return left === 0;
}

function basePrice(itemId) {
  const it = GameData.item(itemId) || GameData.item(canonicalId(itemId));
  if (!it) return 0;
  return it.gp_value || it.shop_sell_price || it.shop_buy_price || 0;
}

// ---- Market-maker (finite liquidity, NOT a money printer) ---------------------
// One NPC market-maker per item holds a FINITE, slowly-replenishing stock and
// quotes a two-sided market around the guide price. Its spread WIDENS as stock
// depletes — so heavy buying genuinely moves price and can create shortages,
// while never fully locking up. Dial MM_TARGET toward 0 as real players arrive
// and supply their own liquidity.
const MM = 'market';
const MM_TARGET = 240;   // stock the maker aims to hold per item
const MM_CHUNK = 80;     // max units quoted per side per refresh
const mmState = new Map(); // itemId -> { stock, lastTick }
function mm(itemId) {
  let s = mmState.get(itemId);
  if (!s) { s = { stock: MM_TARGET * 0.5, lastTick: 0 }; mmState.set(itemId, s); }
  return s;
}
// Passive mean-reversion of stock toward target (world production/consumption),
// throttled by game ticks so frequent UI refreshes don't over-replenish.
function mmDrift(itemId) {
  const s = mm(itemId);
  const t = Game.ticker ? Game.ticker.count : 0;
  if (t <= s.lastTick) return;
  const dt = t - s.lastTick;
  s.lastTick = t;
  s.stock += (MM_TARGET * 0.6 - s.stock) * (1 - Math.pow(0.99, dt));
  s.stock = Math.max(0, s.stock);
}
// The maker's own placed order filled immediately → adjust its stock.
function mmAbsorbOwn(itemId, fills, mmSide) {
  let n = 0; for (const f of fills) n += f.qty;
  if (!n) return;
  const s = mm(itemId);
  s.stock += mmSide === 'buy' ? n : -n;
  s.stock = Math.max(0, s.stock);
}
// The PLAYER traded against the maker → adjust the maker's stock the other way.
function mmAbsorbPlayer(itemId, fills, playerSide) {
  let n = 0; for (const f of fills) if (f.counterTrader === MM) n += f.qty;
  if (!n) return;
  const s = mm(itemId);
  s.stock += playerSide === 'sell' ? n : -n; // player sells → maker gains stock
  s.stock = Math.max(0, s.stock);
}
// UI hook: current maker stock vs target (drives a "market depth" readout).
export function mmInfo(itemId) {
  const s = mm(canonicalId(itemId));
  return { stock: Math.round(s.stock), target: MM_TARGET };
}

// ---- Market events (demand shocks that make the economy feel alive) -----------
const MARKET_EVENTS = [
  { id: 'war', name: '⚔️ Goblin War', mult: 1.35,
    match: /weapon|sword|axe|mace|dagger|scimitar|spear|bow|arrow|armou?r|shield|helm|plate/i,
    msg: 'A goblin war erupts — weapons, armour and ammo are in demand!' },
  { id: 'feast', name: '🍖 Great Feast', mult: 1.30,
    match: /food|fish|cook|meat|fruit|bread|stew/i,
    msg: 'The clan calls a great feast — food prices climb.' },
  { id: 'glut', name: '🪵 Timber Glut', mult: 0.70,
    match: /log|wood|plank|timber/i,
    msg: 'A timber glut floods the market — wood prices crash.' },
  { id: 'rush', name: '⛏️ Ore Rush', mult: 1.25,
    match: /ore|bar|coal|metal|ingot|rock/i,
    msg: 'An ore rush grips the mines — metal prices rise.' },
];
export const marketEvent = { active: null }; // { ...event, until, nudged:Set }
let lastEventTick = 0, lastDriveTick = -1;

function driveMarketEvents(itemId) {
  const t = Game.ticker ? Game.ticker.count : 0;
  // Global scheduler runs once per tick (first item queried that tick).
  if (t !== lastDriveTick) {
    lastDriveTick = t;
    if (marketEvent.active && t >= marketEvent.active.until) {
      Game.log(`📉 ${marketEvent.active.name} has passed; prices settle.`);
      marketEvent.active = null;
    }
    if (!marketEvent.active && t - lastEventTick > 250) {
      lastEventTick = t;
      if (Math.random() < 0.45) {
        const ev = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
        marketEvent.active = { ...ev, until: t + 180, nudged: new Set() };
        Game.log(`📣 ${ev.name}: ${ev.msg}`);
      }
    }
  }
  // One-time guide shock per affected item the first time it's quoted during the
  // event; normal trading re-equilibrates afterward (no permanent distortion).
  const ev = marketEvent.active;
  if (!ev || ev.nudged.has(itemId)) return;
  const it = GameData.item(itemId);
  if (!it) return;
  const hay = `${it.category || ''} ${it.subcategory || ''} ${it.display_name || itemId}`;
  if (ev.match.test(hay)) {
    ev.nudged.add(itemId);
    market.setGuide(itemId, market.guidePrice(itemId) * ev.mult);
  }
}

export function ensureLiquidity(itemId) {
  const cid = canonicalId(itemId);
  const base = basePrice(cid);
  if (base <= 0) return;
  market.ensureGuide(cid, base);
  driveMarketEvents(cid); // schedule/expire events + apply per-item guide shocks
  mmDrift(cid);           // passive replenishment toward target

  const g = market.guidePrice(cid);
  const s = mm(cid);
  const r = Math.max(0, s.stock / MM_TARGET);
  // Spread is tight (~5%) when well-stocked, widens sharply as stock runs dry.
  const spread = 0.05 + 0.20 * Math.max(0, 1 - r);
  const book = market.book(cid);

  // Re-quote from scratch: drop the maker's stale orders, then post fresh ones.
  for (const key of ['buys', 'sells']) {
    for (let i = book[key].length - 1; i >= 0; i--) {
      if (book[key][i].trader === MM) book[key].splice(i, 1);
    }
  }
  // Sell side is capped by what the maker actually holds (finite!).
  const sellQty = Math.min(Math.floor(s.stock), MM_CHUNK);
  if (sellQty > 0) {
    const { fills } = market.place('sell', cid, sellQty, Math.max(1, Math.round(g * (1 + spread))), MM);
    mmAbsorbOwn(cid, fills, 'sell');
  }
  // Buy side is capped by room below target.
  const buyRoom = Math.max(0, Math.min(MM_CHUNK, Math.floor(MM_TARGET - s.stock)));
  if (buyRoom > 0) {
    const { fills } = market.place('buy', cid, buyRoom, Math.max(1, Math.round(g * (1 - spread))), MM);
    mmAbsorbOwn(cid, fills, 'buy');
  }
}

// ---- player active offers (resting orders owned by the player) ----------------
const playerOrders = new Map(); // orderId -> { order, side, itemId, escrowCoins }
export function playerOffers() {
  return [...playerOrders.values()].map(({ order, side, itemId, escrowCoins }) => ({
    id: order.id, side, itemId,
    qty: order.qty, filled: order.filled, limit: order.limit,
    coinsOwed: order.coinsOwed, itemsOwed: order.itemsOwed, escrowCoins,
    complete: order.qty === 0,
  }));
}

// ---- place a BUY offer (escrow coins up to qty*maxPrice) ----------------------
export function buyOffer(itemId, qty, maxPrice) {
  const cid = canonicalId(itemId);
  const cost = qty * maxPrice;
  if (playerCoins() < cost) return { ok: false, reason: `need ${cost} coins (have ${playerCoins()})` };
  ensureLiquidity(cid);
  spendItem(COINS, cost); // escrow

  const { order, fills } = market.place('buy', cid, qty, maxPrice, 'player');
  mmAbsorbPlayer(cid, fills, 'buy'); // player bought from the maker → its stock drops
  // Immediate settlement: receive filled items + refund any savings vs maxPrice.
  const gotItems = order.itemsOwed; order.itemsOwed = 0;
  if (gotItems > 0) addItem(cid, gotItems);
  const spentOnFills = fills.reduce((s, f) => s + f.price * f.qty, 0);
  const savings = gotItems * maxPrice - spentOnFills; // fills executed at/below max
  if (savings > 0) addCoins(savings);

  if (order.qty > 0) playerOrders.set(order.id, { order, side: 'buy', itemId: cid, escrowCoins: order.qty * maxPrice });
  Game.log(`GE buy: ${gotItems}/${qty} ${itemName(cid)} filled${order.qty ? `, ${order.qty} pending` : ''}.`);
  Game.refresh();
  return { ok: true, filled: gotItems, pending: order.qty, fills };
}

// ---- place a SELL offer (escrow the items) ------------------------------------
export function sellOffer(itemId, qty, minPrice) {
  const cid = canonicalId(itemId);
  if (countTotal(cid) < qty) return { ok: false, reason: `only have ${countTotal(cid)} ${itemName(cid)}` };
  ensureLiquidity(cid);
  if (!spendItem(cid, qty)) return { ok: false, reason: 'could not escrow items' }; // escrow

  const { order, fills } = market.place('sell', cid, qty, minPrice, 'player');
  mmAbsorbPlayer(cid, fills, 'sell'); // player sold to the maker → its stock rises
  const gross = order.coinsOwed; order.coinsOwed = 0;
  const { net, tax } = gross > 0 ? creditSale(gross) : { net: 0, tax: 0 };

  if (order.qty > 0) playerOrders.set(order.id, { order, side: 'sell', itemId: cid, escrowCoins: 0 });
  Game.log(`GE sell: ${order.filled}/${qty} ${itemName(cid)} → ${net} coins`
    + (tax ? ` (−${tax} tax)` : '') + `${order.qty ? `, ${order.qty} pending` : ''}.`);
  Game.refresh();
  return { ok: true, sold: order.filled, coins: net, tax, pending: order.qty, fills };
}

// ---- collect owed goods from a resting order that filled later ----------------
export function collectOffer(orderId) {
  const rec = playerOrders.get(orderId);
  if (!rec) return { ok: false };
  const { order, side, itemId } = rec;
  if (side === 'sell' && order.coinsOwed > 0) { creditSale(order.coinsOwed); order.coinsOwed = 0; }
  if (side === 'buy' && order.itemsOwed > 0) { addItem(itemId, order.itemsOwed); order.itemsOwed = 0; }
  if (order.qty === 0) playerOrders.delete(orderId);
  Game.refresh();
  return { ok: true };
}

// ---- cancel: refund the unfilled escrow -------------------------------------
export function cancelOffer(orderId) {
  const rec = playerOrders.get(orderId);
  if (!rec) return { ok: false };
  const { order, side, itemId } = rec;
  market.cancel(orderId);
  // return owed + unfilled escrow
  if (side === 'buy') {
    if (order.itemsOwed > 0) { addItem(itemId, order.itemsOwed); order.itemsOwed = 0; }
    addCoins(order.qty * order.limit);          // unfilled coins escrow back
  } else {
    if (order.coinsOwed > 0) { addCoins(order.coinsOwed); order.coinsOwed = 0; }
    if (order.qty > 0) addItem(itemId, order.qty); // unfilled item escrow back
  }
  playerOrders.delete(orderId);
  Game.log(`GE offer cancelled.`);
  Game.refresh();
  return { ok: true };
}

function itemName(id) { const it = GameData.item(id); return (it && it.display_name) || id; }

// ---- world-market persistence + offline drift (Phase 3, world-continuity) -----
// The Grand Exchange is part of the WORLD, not the player: its guide prices,
// recent trades, market-maker stock, active demand event and treasury persist
// GLOBALLY (one shared world — a single key, NOT per-account) and keep drifting
// while everyone is offline. On login we restore the snapshot and advance it by
// the real time elapsed, so the market "kept trading" while you were away.
//
// We deliberately do NOT touch the player's own resting offers here — nothing
// happens to the player while offline; their escrowed offers settle through
// normal play on return. When the server lands (Phase 4), this snapshot IS the
// server's authoritative market state and this drift becomes the live tick loop.
const WORLD_MARKET_KEY = 'goblin_empire:world_market';
const WM_VERSION = 1;

export function serializeMarket() {
  const ev = marketEvent.active;
  return {
    v: WM_VERSION,
    savedAt: Date.now(),
    seq: market.seq,
    guide: [...market.guide.entries()],
    trades: market.trades.slice(-300),
    mm: [...mmState.entries()].map(([id, s]) => [id, { stock: Math.round(s.stock), lastTick: s.lastTick }]),
    event: ev ? { id: ev.id, name: ev.name, mult: ev.mult, msg: ev.msg, until: ev.until,
                  match: ev.match.source, nudged: [...ev.nudged] } : null,
    lastEventTick,
    treasury: { totalSunk: geTax.totalSunk, balance: geTax.balance },
  };
}

export function restoreMarket(data) {
  if (!data || data.v !== WM_VERSION) return false;
  market.guide = new Map(data.guide || []);
  market.trades = Array.isArray(data.trades) ? data.trades.slice(-300) : [];
  if (typeof data.seq === 'number') market.seq = data.seq;
  mmState.clear();
  for (const [id, s] of (data.mm || [])) mmState.set(id, { stock: s.stock, lastTick: s.lastTick });
  if (data.treasury) { geTax.totalSunk = data.treasury.totalSunk || 0; geTax.balance = data.treasury.balance || 0; }
  lastEventTick = data.lastEventTick || 0;
  marketEvent.active = data.event
    ? { ...data.event, match: new RegExp(data.event.match, 'i'), nudged: new Set(data.event.nudged || []) }
    : null;
  return true;
}

// Simulate the market having traded for `elapsedMs` of real time. Guide prices
// mean-revert toward their base value plus a bounded random walk (drift grows
// with, but saturates over, time away). Returns the top movers for a login
// summary. Player orders are never filled here.
export function advanceMarketOffline(elapsedMs) {
  const movers = [];
  const hours = (elapsedMs > 0 ? elapsedMs : 0) / 3600000;
  if (hours < 0.01) return movers; // < ~36s away: nothing meaningful moved

  const revert = 1 - Math.pow(0.6, Math.min(hours, 48)); // pull toward base; saturates
  const noiseAmp = 0.06 * Math.min(4, Math.sqrt(hours));  // random walk grows, then caps

  for (const [id, g] of market.guide.entries()) {
    if (!(g > 0)) continue;
    const base = basePrice(id) || g;
    let ng = g + (base - g) * revert * 0.6;
    ng *= 1 + (Math.random() * 2 - 1) * noiseAmp;
    ng = Math.max(g * 0.55, Math.min(g * 1.8, ng));     // cap the move vs the old price
    ng = Math.max(base * 0.35, Math.min(base * 3, ng)); // keep within a sane band of base
    ng = Math.max(1, Math.round(ng));
    if (ng !== g) {
      market.setGuide(id, ng);
      const pct = (ng - g) / g;
      if (Math.abs(pct) >= 0.05) movers.push({ id, name: itemName(id), from: g, to: ng, pct });
    }
  }
  // Market-maker stock relaxes toward its resting target over the absence.
  for (const s of mmState.values()) {
    s.stock += (MM_TARGET * 0.6 - s.stock) * revert;
    s.stock = Math.max(0, s.stock);
  }
  // Any demand event that was running has long since passed if we were away more
  // than a few minutes (events last ~180 ticks ≈ a couple of minutes).
  if (marketEvent.active && hours * 60 > 3) marketEvent.active = null;

  movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return movers.slice(0, 3);
}

export function saveWorldMarket() {
  try { localStorage.setItem(WORLD_MARKET_KEY, JSON.stringify(serializeMarket())); return true; }
  catch { return false; }
}

// Restore the shared market and fast-forward it to now. Returns
// { elapsedMs, movers } for a login summary, or null if there was no snapshot.
export function loadAndAdvanceWorldMarket() {
  let data = null;
  try { const raw = localStorage.getItem(WORLD_MARKET_KEY); data = raw ? JSON.parse(raw) : null; }
  catch { data = null; }
  if (!data) return null;
  restoreMarket(data);
  const elapsedMs = Math.max(0, Date.now() - (data.savedAt || Date.now()));
  return { elapsedMs, movers: advanceMarketOffline(elapsedMs) };
}
