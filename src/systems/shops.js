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

// One spawn descriptor per shop, so main.js can place a Shopkeeper NPC for each
// without importing GameData itself. `region` (from shops.json) lets world-gen
// eventually place each keeper in its themed building.
export function shopkeeperSpawns() {
  return shopIds().map((sid) => {
    const rows = GameData.shop(sid);
    return {
      shopId: sid,
      npcId: 'shopkeeper_' + sid,
      shopName: (rows[0] && rows[0].shop_name) || 'Shop',
      region: (rows[0] && rows[0].region) || 'spawn',
    };
  });
}

function itemName(id) { const it = GameData.item(id); return (it && it.display_name) || id; }

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
  if (row.stock != null) row.stock -= qty; // deplete stock this session
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
