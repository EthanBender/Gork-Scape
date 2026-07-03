// src/systems/shops.js
// NPC stores, driven by shops.json. Unlike the Grand Exchange (player-to-player
// market), shops are fixed-price NPC vendors: a coin SINK when you buy tools/
// supplies and a modest coin FAUCET when you sell junk. Like the GE, a shop is a
// PHYSICAL place — the UI gates access to being near its Shopkeeper NPC.
//
// Buy price > sell price (per shops.json notes) to prevent infinite arbitrage.

import { GameData } from '../data/gameData.js';
import { canonicalId } from '../data/idAliases.js';
import { Game, addItem } from '../engine/state.js';
import { playerCoins, countTotal } from './geActions.js';
import { DAY_MS } from '../engine/worldClock.js';
import { activeEvent } from './worldEvents.js';

const COINS = 'coins';

// Spend N units of an item across stacks (decrement stackables, clear slots).
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

// Stock rows for a shop id (from shops.json).
export function shopStock(shopId) { return GameData.shop(shopId); }

// Distinct shop ids present in the data.
export function shopIds() { return [...new Set(GameData.shops.map((s) => s.shop_id))]; }

// [economy lane] Where each town-ward shopkeeper stands — a walkable interior
// tile of its building in the Gorkholm layout (see map.js buildTown /
// CENTRAL_REGION_DESIGN.md). Shops WITHOUT a town building (region shops like the
// miner's camp / rival black market) are omitted and fall back to the ring.
export const SHOP_POSTS = {
  // Gorkholm (re-authored): each keeper stands on the interior floor beside its
  // counter. Legacy town frame (main.js adds the town offset).
  weapon_shop: [473, 415], armour_shop: [527, 415],   // Forge District (N)
  fishing_shack: [537, 448], fishmonger: [546, 455], bait_tackle: [523, 468], // Wharf (E)
  farming_shed: [487, 498], grocer: [473, 498], general_store: [498, 501],    // Green District (S)
  fletcher: [469, 455], lumber_stall: [455, 468],     // Timber District (W)
  tavern: [485, 470],                                 // the Bazaar
  // Region shops — posted at their landmark out in the world, not the town.
  miner_camp: [606, 206],          // Miners Lodge, Northern Mine Hills
  witch_hut: [250, 801],           // Witch-Goblin Hut, Mushroom Forest
  rival_black_market: [840, 811],  // Captured Anvil, Rival Goblin Territory
};

// One spawn descriptor per shop, so main.js can place a Shopkeeper NPC for each
// without importing GameData itself. `post` (if set) is the keeper's exact tile
// in its themed building; otherwise main.js falls back to the provisional ring.
export function shopkeeperSpawns() {
  return shopIds().map((sid) => {
    const rows = GameData.shop(sid);
    return {
      shopId: sid,
      npcId: 'shopkeeper_' + sid,
      shopName: (rows[0] && rows[0].shop_name) || 'Shop',
      region: (rows[0] && rows[0].region) || 'spawn',
      post: SHOP_POSTS[sid] || null,
    };
  });
}

function itemName(id) { const it = GameData.item(id); return (it && it.display_name) || id; }

// ---- restock over world time (Phase 3, world-continuity) ----------------------
// Shop stock is WORLD state: shelves deplete as players buy and refill on their
// own over time, so a shortage recovers whether or not anyone is online. Each
// row's original JSON `stock` is captured as its max; current stock drifts back
// toward that max at RESTOCK_PER_HOUR units per world-hour (faster during a
// 🐫 Merchant Caravan). Persisted globally, restored + fast-forwarded on login.
const WORLD_SHOPS_KEY = 'goblin_empire:world_shops';
const RESTOCK_PER_WORLD_HOUR = 4; // units refilled per world-hour toward max
const MIN_RESTOCK_STEP_MS = 15000; // coalesce frequent calls so sub-unit gains don't round to 0
let lastRestockMs = 0;

function ensureMax(row) { if (row._max == null && row.stock != null) row._max = row.stock; }

// Refill shop stock toward each row's max based on world-time elapsed since the
// last restock. Self-throttled, so it's safe to call every tick.
export function restockShops(nowMs = Date.now()) {
  if (!lastRestockMs) {
    // First call anchors the clock AND locks in each row's base stock as its max,
    // while stock is still at the JSON value — so later depletion can't erase it.
    lastRestockMs = nowMs;
    for (const sid of shopIds()) for (const row of GameData.shop(sid)) ensureMax(row);
    return 0;
  }
  if (nowMs - lastRestockMs < MIN_RESTOCK_STEP_MS) return 0;
  const worldHours = (nowMs - lastRestockMs) / (DAY_MS / 24);
  lastRestockMs = nowMs;
  const caravan = (() => { const e = activeEvent(nowMs); return e && e.id === 'merchant_caravan'; })();
  const gain = worldHours * RESTOCK_PER_WORLD_HOUR * (caravan ? 3 : 1);
  if (gain < 1) return 0;
  let refilled = 0;
  for (const sid of shopIds()) {
    for (const row of GameData.shop(sid)) {
      ensureMax(row);
      if (row._max == null || row.stock >= row._max) continue;
      const next = Math.min(row._max, Math.round(row.stock + gain));
      refilled += next - row.stock;
      row.stock = next;
    }
  }
  return refilled;
}

export function serializeShops() {
  const stock = {};
  for (const sid of shopIds()) {
    const m = {};
    for (const row of GameData.shop(sid)) {
      if (row.stock == null) continue;
      ensureMax(row);
      m[row.item_id] = { cur: row.stock, max: row._max };
    }
    stock[sid] = m;
  }
  return { v: 1, savedAt: Date.now(), lastRestockMs, stock };
}

export function restoreShops(data) {
  if (!data || data.v !== 1) return false;
  lastRestockMs = data.lastRestockMs || 0;
  for (const sid of Object.keys(data.stock || {})) {
    for (const row of GameData.shop(sid)) {
      ensureMax(row); // capture the true JSON max BEFORE overwriting with saved cur
      const rec = data.stock[sid][row.item_id];
      if (!rec) continue;
      if (rec.max != null) row._max = rec.max;
      if (rec.cur != null) row.stock = rec.cur;
    }
  }
  return true;
}

export function saveWorldShops() {
  try { localStorage.setItem(WORLD_SHOPS_KEY, JSON.stringify(serializeShops())); return true; }
  catch { return false; }
}

// Restore saved shop stock and fast-forward restock over the offline gap.
// Returns units refilled while away (for a login note), or 0.
export function loadAndRestockShops() {
  let data = null;
  try { const raw = localStorage.getItem(WORLD_SHOPS_KEY); data = raw ? JSON.parse(raw) : null; }
  catch { data = null; }
  if (data) restoreShops(data);
  return restockShops();
}

// Buy `qty` of an item from a shop. Returns { ok, reason?, spent? }.
export function buyFromShop(shopId, itemId, qty = 1) {
  const row = shopStock(shopId).find((s) => s.item_id === itemId);
  if (!row) return { ok: false, reason: 'not sold here' };
  const price = row.buy_price || 0;
  const cost = price * qty;
  if (playerCoins() < cost) return { ok: false, reason: `need ${cost} coins` };
  if (row.stock != null && row.stock < qty) return { ok: false, reason: 'out of stock' };
  spendItem(COINS, cost);
  addItem(itemId, qty);
  if (row.stock != null) { ensureMax(row); row.stock -= qty; } // deplete (max already captured)
  Game.log(`Bought ${qty}× ${itemName(itemId)} for ${cost} coins.`);
  Game.refresh();
  return { ok: true, spent: cost };
}

// Sell `qty` of an item to a shop. Returns { ok, reason?, gained? }.
export function sellToShop(shopId, itemId, qty = 1) {
  const row = shopStock(shopId).find((s) => s.item_id === itemId);
  // Shops only buy what they stock (keeps NPC economy scoped); fall back to a
  // small fraction of gp_value if the shop lists no sell price.
  const price = row ? (row.sell_price || 0)
    : Math.floor(((GameData.item(itemId) || {}).gp_value || 0) * 0.4);
  if (price <= 0) return { ok: false, reason: "this shop won't buy that" };
  if (countTotal(itemId) < qty) return { ok: false, reason: `only have ${countTotal(itemId)}` };
  if (!spendItem(itemId, qty)) return { ok: false, reason: 'sell failed' };
  const gained = price * qty;
  addItem(COINS, gained);
  if (row && row.stock != null) row.stock += qty;
  Game.log(`Sold ${qty}× ${itemName(itemId)} for ${gained} coins.`);
  Game.refresh();
  return { ok: true, gained };
}
