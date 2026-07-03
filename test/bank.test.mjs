// test/bank.test.mjs — bank deposit/withdraw quantity semantics.
// Regression guard for the "Deposit/Withdraw 5/10/All only moved one" bug: the
// quantity buttons must work on NON-stackable items (a bag full of the same
// logs/daggers, each in its own slot), not just on stackables like coins. Bank
// slots always stack by id; the inventory is where stackability differs.
import { test, assert, eq } from './run.mjs';
import { Game, initState, bankDeposit, bankDepositAll, bankWithdraw, countItem } from '../src/engine/state.js';
import { makeItem } from '../src/items/equipment.js';

const NS = 'bronze_dagger';   // non-stackable (weapon)
const FILL = 'iron_dagger';   // non-stackable filler, different id
const STK = 'coins';          // stackable
const bankQty = (id) => (Game.bank.find((b) => b.id === id) || {}).qty || 0;

test('bank fixtures are the stackability we assume', () => {
  assert(makeItem(NS).stackable !== true, `${NS} is non-stackable`);
  assert(makeItem(STK).stackable === true, `${STK} is stackable`);
});

test('deposit N non-stackables sweeps N matching inventory slots', () => {
  initState();
  for (let i = 0; i < 12; i++) Game.inventory[i] = makeItem(NS);
  bankDeposit(Game.inventory.findIndex((s) => s && s.id === NS), 5);
  eq(countItem(NS), 7, 'inventory keeps 7 after depositing 5');
  eq(bankQty(NS), 5, 'bank holds 5');
});

test('deposit All non-stackables banks the whole bag', () => {
  initState();
  for (let i = 0; i < 12; i++) Game.inventory[i] = makeItem(NS);
  bankDeposit(Game.inventory.findIndex((s) => s && s.id === NS), Infinity);
  eq(countItem(NS), 0, 'inventory emptied of the item');
  eq(bankQty(NS), 12, 'bank holds all 12');
});

test('deposit stackable moves the whole stack in one slot', () => {
  initState();
  Game.inventory[0] = Object.assign(makeItem(STK), { qty: 500 });
  bankDeposit(0, Infinity);
  eq(countItem(STK), 0, 'inventory stack gone');
  eq(bankQty(STK), 500, 'bank stack is 500');
});

test('withdraw N non-stackables places N into free slots', () => {
  initState();
  Game.bank = [{ id: NS, qty: 12 }];
  bankWithdraw(NS, 5);
  eq(countItem(NS), 5, 'inventory gained 5');
  eq(bankQty(NS), 7, 'bank debited to 7');
  bankWithdraw(NS, Infinity);
  eq(countItem(NS), 12, 'inventory gained the rest');
  eq(bankQty(NS), 0, 'bank emptied');
});

test('withdraw into a nearly-full inventory is partial — no dup, no loss', () => {
  initState();
  Game.bank = [{ id: NS, qty: 10 }];
  for (let i = 0; i < Game.inventory.length - 3; i++) Game.inventory[i] = makeItem(FILL); // 3 free slots
  bankWithdraw(NS, Infinity);
  eq(countItem(NS), 3, 'only 3 fit');
  eq(bankQty(NS), 7, 'bank keeps the 7 that did not fit (conserved)');
  eq(Game.inventory.filter((s) => !s).length, 0, 'inventory now full');
});

test('deposit-all button sweeps every slot including a coin stack', () => {
  initState();
  for (let i = 0; i < 6; i++) Game.inventory[i] = makeItem(NS);
  Game.inventory[6] = Object.assign(makeItem(STK), { qty: 250 });
  bankDepositAll();
  assert(Game.inventory.every((s) => !s), 'inventory fully emptied');
  eq(bankQty(NS), 6, 'all daggers banked');
  eq(bankQty(STK), 250, 'coin stack banked');
});
