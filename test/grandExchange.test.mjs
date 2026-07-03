// test/grandExchange.test.mjs — the order-matching engine (src/systems/grandExchange.js).
// This is the heart of the shared player economy; a matching bug here quietly
// mis-settles real gp, so it's the most important thing to pin down.
import { test, assert, eq } from './run.mjs';
import { Market, resetOrderIds } from '../src/systems/grandExchange.js';

const fresh = () => { resetOrderIds(1); return new Market(); };

test('a crossing order matches at the resting order price', () => {
  const m = fresh();
  const { order: bid } = m.place('buy', 'logs', 10, 100, 'A'); // rests (no sells)
  eq(bid.filled, 0);
  const { order: ask, fills } = m.place('sell', 'logs', 10, 95, 'B'); // crosses A's 100
  eq(ask.filled, 10, 'seller fully filled');
  eq(fills.length, 1);
  eq(fills[0].price, 100, 'executes at the resting bid price, not the new ask');
  eq(fills[0].qty, 10);
  eq(fills[0].counterTrader, 'A');
  // Sellers pay the 1% GE tax on proceeds (M2 gold sink) — coins leave the economy.
  eq(ask.coinsOwed, 990, 'seller owed 10*100 minus the 1% GE tax');
  eq(m.taxBurned, 10, 'the tax is burned, not transferred');
});

test('partial fills leave the remainder resting', () => {
  const m = fresh();
  const { order: bid } = m.place('buy', 'logs', 10, 100, 'A');
  const { order: ask } = m.place('sell', 'logs', 4, 100, 'B');
  eq(ask.filled, 4);
  eq(bid.filled, 4, 'resting buyer partially filled');
  eq(m.book('logs').buys[0].qty, 6, '6 remain on the bid');
  eq(m.book('logs').sells.length, 0, 'ask fully consumed');
});

test('no cross when the spread is uncrossed', () => {
  const m = fresh();
  m.place('buy', 'logs', 5, 90, 'A');
  const { fills } = m.place('sell', 'logs', 5, 100, 'B'); // 100 > 90, no trade
  eq(fills.length, 0);
  eq(m.book('logs').buys.length, 1);
  eq(m.book('logs').sells.length, 1);
});

test('price priority: the best-priced resting order fills first', () => {
  const m = fresh();
  m.place('buy', 'logs', 5, 100, 'A'); // lower
  m.place('buy', 'logs', 5, 105, 'B'); // higher — should be hit first
  const { fills } = m.place('sell', 'logs', 5, 100, 'C');
  eq(fills.length, 1);
  eq(fills[0].counterTrader, 'B', 'highest bid served first');
  eq(fills[0].price, 105);
});

test('time priority breaks price ties (FIFO)', () => {
  const m = fresh();
  m.place('buy', 'logs', 5, 100, 'A'); // earlier
  m.place('buy', 'logs', 5, 100, 'B'); // later, same price
  const { fills } = m.place('sell', 'logs', 5, 100, 'C');
  eq(fills[0].counterTrader, 'A', 'oldest at the same price fills first');
});

test("a trader's own resting order is skipped, not matched", () => {
  const m = fresh();
  m.place('buy', 'logs', 5, 100, 'A');       // A's own bid
  const { fills } = m.place('sell', 'logs', 5, 100, 'A'); // A tries to sell into it
  eq(fills.length, 0, 'no self-trade');
  assert(m.book('logs').buys.length === 1 && m.book('logs').sells.length === 1, 'both rest');
});

test('cancel removes a resting order', () => {
  const m = fresh();
  const { order } = m.place('buy', 'logs', 5, 100, 'A');
  const removed = m.cancel(order.id);
  assert(removed && removed.id === order.id);
  eq(m.book('logs').buys.length, 0);
  eq(m.cancel(999999), null, 'cancelling an unknown id is a no-op');
});

test('guide price drifts toward trades but is clamped to ±5% per trade', () => {
  const m = fresh();
  m.setGuide('logs', 100);
  // a trade well above guide should nudge up, but never more than 5% in one go
  m.place('buy', 'logs', 1, 200, 'A');
  m.place('sell', 'logs', 1, 200, 'B'); // trades at 200
  const g = m.guidePrice('logs');
  assert(g > 100 && g <= 105, `guide moved within +5% clamp, got ${g}`);
});

test('history returns recent trade prices oldest→newest', () => {
  const m = fresh();
  m.setGuide('logs', 100);
  for (const px of [100, 101, 102]) { m.place('buy', 'logs', 1, px, 'A'); m.place('sell', 'logs', 1, px, 'B'); }
  const h = m.history('logs', 10);
  eq(h[h.length - 1], 102, 'newest last');
  assert(h.length === 3);
});
