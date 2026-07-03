// src/systems/grandExchange.js
// The Grand Exchange: a transport-agnostic order-matching engine for a
// player-driven economy. This is PURE logic — no game/DOM imports — so the exact
// same engine runs client-side today (single-player against simulated market
// liquidity) and server-side later for a real MMO. When networking lands, the
// server owns one Market instance; clients send place/cancel and receive fills.
//
// Model (mirrors OSRS's GE):
//   - Players post BUY offers (item, qty, max price) and SELL offers (min price).
//   - Matching is price-then-time priority; a trade executes at the RESTING
//     order's price (the earlier order gets its asked price).
//   - Partial fills are tracked; leftover quantity rests in the book.
//   - A rolling "guide price" per item tracks recent trade value.
//
// The engine never touches inventories/coins — an adapter (geActions.js) handles
// escrow and settlement so this stays portable and unit-testable.

let NEXT_ID = 1;
export function resetOrderIds(n = 1) { NEXT_ID = n; } // deterministic tests

// One resting order.
function makeOrder(side, itemId, qty, limit, trader, ts) {
  return {
    id: 'o' + (NEXT_ID++),
    side,                 // 'buy' | 'sell'
    itemId,
    qty,                  // remaining quantity
    filled: 0,            // cumulative filled
    limit,                // max price (buy) / min price (sell), per unit
    trader,               // trader id ('market' = NPC liquidity)
    ts,                   // sequence stamp for time priority
    coinsOwed: 0,         // coins collectable by this order's owner
    itemsOwed: 0,         // items collectable by this order's owner
    done: false,
  };
}

export class Market {
  // GE tax (M2 gold sink): sellers pay this fraction of proceeds on every fill;
  // the coins are destroyed. Lives on the ENGINE so client and server agree.
  static GE_TAX = 0.01;

  constructor() {
    this.books = new Map();   // itemId -> { buys: Order[], sells: Order[] }
    this.guide = new Map();   // itemId -> guide price (int)
    this.trades = [];         // recent { itemId, price, qty, ts }
    this.seq = 0;
    this.taxBurned = 0;       // cumulative coins removed by the GE tax
  }

  now() { return ++this.seq; }

  book(itemId) {
    let b = this.books.get(itemId);
    if (!b) { b = { buys: [], sells: [] }; this.books.set(itemId, b); }
    return b;
  }

  guidePrice(itemId) {
    return this.guide.get(itemId) ?? 0;
  }

  setGuide(itemId, price) {
    this.guide.set(itemId, Math.max(1, Math.round(price)));
  }

  // Guide price drifts toward each executed trade (EMA), so the market "learns"
  // its price from real activity — the OSRS guide-price feel.
  _recordTrade(itemId, price, qty) {
    const ts = this.now();
    this.trades.push({ itemId, price, qty, ts });
    if (this.trades.length > 2000) this.trades.shift();
    const g = this.guide.get(itemId) ?? price;
    // EMA drift toward the trade price, but CLAMP the per-trade move to ±5% so a
    // single outlier — or a manipulative high-limit resting order that a
    // counterparty fills into — can't blow up the guide. Sustained real pressure
    // still moves it, just gradually and visibly (OSRS-style guide guardrail).
    const target = g * 0.85 + price * 0.15;
    const clamped = Math.max(g * 0.95, Math.min(g * 1.05, target));
    this.setGuide(itemId, clamped);
  }

  // Seed a guide price for an item (from the database gp_value) if unset.
  ensureGuide(itemId, basePrice) {
    if (!this.guide.has(itemId) && basePrice > 0) this.setGuide(itemId, basePrice);
  }

  // Place an order. Returns { order, fills:[{price, qty, counterTrader}] }.
  // Matching executes against the opposite book at the resting order's price.
  place(side, itemId, qty, limit, trader) {
    const order = makeOrder(side, itemId, qty, limit, trader, this.now());
    const book = this.book(itemId);
    const fills = [];

    const opposite = side === 'buy' ? book.sells : book.buys;
    // Best counter first: sells ascending (cheapest), buys descending (highest).
    const priceOk = side === 'buy'
      ? (o) => o.limit <= order.limit
      : (o) => o.limit >= order.limit;

    // Scan the opposite book best-first. We use an index (not always the head)
    // so we can SKIP the trader's own resting orders and keep matching against
    // everyone behind them — otherwise a player's own order at the top of book
    // would wall them off from the rest of the market (the flipper's-own-order
    // deadlock). Price-time priority is preserved among non-self orders.
    let idx = 0;
    while (order.qty > 0 && idx < opposite.length) {
      const best = opposite[idx];
      if (best.trader === order.trader && best.trader !== 'market') { idx++; continue; }
      if (!priceOk(best)) break; // book is sorted best-first — nothing further can match

      const tradePrice = best.limit;            // execute at resting order's price
      const n = Math.min(order.qty, best.qty);
      order.qty -= n; order.filled += n;
      best.qty -= n; best.filled += n;

      // Settlement bookkeeping (adapter collects these). Sellers pay the GE tax
      // (M2 gold sink): 1% of proceeds, floored — so small trades are naturally
      // exempt and the coins leave the economy entirely (tracked in taxBurned).
      const gross = n * tradePrice;
      const tax = Math.floor(gross * Market.GE_TAX);
      this.taxBurned = (this.taxBurned || 0) + tax;
      if (side === 'buy') {
        order.itemsOwed += n;                   // buyer receives items
        best.coinsOwed += gross - tax;          // resting seller receives coins (net of tax)
      } else {
        order.coinsOwed += gross - tax;         // seller receives coins (net of tax)
        best.itemsOwed += n;                    // resting buyer receives items
      }
      fills.push({ price: tradePrice, qty: n, counterTrader: best.trader });
      this._recordTrade(itemId, tradePrice, n);

      if (best.qty === 0) { best.done = true; opposite.splice(idx, 1); }
      // if best.qty > 0 here, order.qty has hit 0 and the loop exits next check
    }

    // Rest any remainder in this side's book, keeping best-first order.
    if (order.qty > 0) {
      const side_book = side === 'buy' ? book.buys : book.sells;
      side_book.push(order);
      side_book.sort(side === 'buy'
        ? (a, b) => b.limit - a.limit || a.ts - b.ts   // buys: highest price, then oldest
        : (a, b) => a.limit - b.limit || a.ts - b.ts); // sells: lowest price, then oldest
    } else {
      order.done = true;
    }
    return { order, fills };
  }

  cancel(orderId) {
    for (const b of this.books.values()) {
      for (const key of ['buys', 'sells']) {
        const i = b[key].findIndex((o) => o.id === orderId);
        if (i >= 0) { const [o] = b[key].splice(i, 1); o.done = true; return o; }
      }
    }
    return null;
  }

  // Recent trade prices for an item (oldest→newest), for a price chart.
  history(itemId, n = 30) {
    const out = [];
    for (let i = this.trades.length - 1; i >= 0 && out.length < n; i--) {
      if (this.trades[i].itemId === itemId) out.push(this.trades[i].price);
    }
    return out.reverse();
  }

  // Last / high / low / volume over the recent trade window for an item.
  // `vol` is real units traded (sum of qty), not the number of trades.
  stats(itemId, n = 50) {
    const recent = [];
    for (let i = this.trades.length - 1; i >= 0 && recent.length < n; i--) {
      if (this.trades[i].itemId === itemId) recent.push(this.trades[i]);
    }
    if (!recent.length) return { last: this.guidePrice(itemId), hi: null, lo: null, vol: 0 };
    const prices = recent.map((t) => t.price);
    const vol = recent.reduce((s, t) => s + t.qty, 0);
    return { last: prices[0], hi: Math.max(...prices), lo: Math.min(...prices), vol };
  }

  // Snapshot of the top of book for UI (best bid/ask + depth).
  quote(itemId) {
    const b = this.book(itemId);
    const bestBid = b.buys[0] ? b.buys[0].limit : null;
    const bestAsk = b.sells[0] ? b.sells[0].limit : null;
    const bidQty = b.buys.reduce((s, o) => s + o.qty, 0);
    const askQty = b.sells.reduce((s, o) => s + o.qty, 0);
    return { guide: this.guidePrice(itemId), bestBid, bestAsk, bidQty, askQty };
  }
}

// The live market instance. In a networked build this moves server-side; clients
// talk to it through the same place/cancel/quote surface over the wire.
export const market = new Market();
