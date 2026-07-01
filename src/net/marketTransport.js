// src/net/marketTransport.js
// The seam that makes the Grand Exchange multiplayer-ready. Both implementations
// expose the SAME async interface, so `geActions.js` can be migrated to call
// `await transport.place(...)` and later switch from local to networked with a
// one-line change. See docs/MULTIPLAYER_ARCHITECTURE.md.
//
// This is a SKETCH: LocalMarketTransport is fully working (wraps the in-process
// Market); NetworkMarketTransport documents the wire contract for when a server
// exists. Existing code still calls `market` directly — routing geActions through
// this is migration step 1, done deliberately (it turns the calls async).

import { market as localMarket } from '../systems/grandExchange.js';

// The interface every transport implements. All methods are async so the same
// call sites work whether the market is in-process or across a socket.
//
//   place(side, itemId, qty, limit, trader) -> { order, fills }
//   cancel(orderId)                          -> order | null
//   quote(itemId)                            -> { guide, bestBid, bestAsk, ... }
//   history(itemId, n)                       -> number[]
//   onFill(cb)                               -> unsubscribe   // async fills of resting orders
//
// `trader` is authoritative server-side; the local transport takes it verbatim.

// --- Local (single-player / today): wraps the in-process Market synchronously,
//     but presents the async surface so call sites are already server-shaped. ---
export class LocalMarketTransport {
  constructor(marketInstance = localMarket) {
    this.market = marketInstance;
    this._fillSubs = new Set();
  }

  async place(side, itemId, qty, limit, trader = 'player') {
    const res = this.market.place(side, itemId, qty, limit, trader);
    // Locally, resting orders only fill on a future place(); a real server would
    // also push fills to the *counterparty*. We surface this run's fills now.
    return res;
  }

  async cancel(orderId) { return this.market.cancel(orderId); }
  async quote(itemId) { return this.market.quote(itemId); }
  async history(itemId, n = 30) { return this.market.history(itemId, n); }

  // Server pushes async fills here when your resting order is crossed by another
  // player. Locally this never fires; kept so UI code can subscribe unconditionally.
  onFill(cb) { this._fillSubs.add(cb); return () => this._fillSubs.delete(cb); }
}

// --- Network (MMO / future): same interface over a WebSocket. Left as a stub
//     with the intended wire contract so the migration is mechanical. ---
export class NetworkMarketTransport {
  constructor(socketUrl) {
    this.url = socketUrl;
    this._pending = new Map();  // requestId -> resolver
    this._fillSubs = new Set();
    this._seq = 0;
    // this.ws = new WebSocket(socketUrl);  // wired up when the server exists
    // this.ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
  }

  _rpc(method, params) {
    // const id = ++this._seq;
    // this.ws.send(JSON.stringify({ id, method, params }));
    // return new Promise((res) => this._pending.set(id, res));
    throw new Error('NetworkMarketTransport: server not implemented yet (see docs/MULTIPLAYER_ARCHITECTURE.md)');
  }

  async place(side, itemId, qty, limit, trader) { return this._rpc('place', { side, itemId, qty, limit, trader }); }
  async cancel(orderId) { return this._rpc('cancel', { orderId }); }
  async quote(itemId) { return this._rpc('quote', { itemId }); }
  async history(itemId, n = 30) { return this._rpc('history', { itemId, n }); }

  onFill(cb) { this._fillSubs.add(cb); return () => this._fillSubs.delete(cb); }

  // _onMessage(msg) {
  //   if (msg.id && this._pending.has(msg.id)) { this._pending.get(msg.id)(msg.result); this._pending.delete(msg.id); }
  //   else if (msg.type === 'fill') for (const cb of this._fillSubs) cb(msg.fill);
  // }
}

// The active transport. Single-player uses Local; flip to Network when the server
// lands (ideally chosen by a runtime flag / build env, not a code edit).
export const marketTransport = new LocalMarketTransport();
