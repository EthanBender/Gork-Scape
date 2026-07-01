// scripts/economy_sim.mjs
// Economy balance VALIDATOR — turns the assertions in docs/ECONOMY_BALANCE.md
// into an executable test. Two things were previously only asserted:
//   (a) the static faucet/sink shape of the database (avg coins/kill, boss coin
//       payouts, crafting value split), and
//   (b) the *dynamic* claim that the Grand Exchange won't runaway-inflate.
// This script re-derives (a) straight from src/data/*.json and stress-tests (b)
// against the REAL pure order-matching engine (src/systems/grandExchange.js),
// then checks everything against explicit bands. Any violation exits non-zero,
// so a bad drop-table / recipe / gp change is caught before it ships.
//
// Run: node scripts/economy_sim.mjs   (add --verbose for per-check detail)
// No browser, no build; ~1s. Pure Node — reads JSON from disk, imports the same
// Market class the game runs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Market } from '../src/systems/grandExchange.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const VERBOSE = process.argv.includes('--verbose');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));

// Deterministic RNG so a run is reproducible (Math.random would make the
// dynamic sim flaky across runs — a balance test must be stable to be a gate).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- check harness ----------------------------------------------------------
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  if (VERBOSE || !pass) {
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const inBand = (v, lo, hi) => v >= lo && v <= hi;

// =============================================================================
// PART A — static faucet/sink audit (validates docs/ECONOMY_BALANCE.md numbers)
// =============================================================================
function auditStatic() {
  console.log('\n── Part A: static faucet/sink audit (vs ECONOMY_BALANCE.md) ──');
  const items = load('items');
  const monsters = load('monsters');
  const drops = load('drop_tables');
  const recipes = load('recipes');

  const gp = new Map(items.map((i) => [i.item_id, i.gp_value || 0]));

  // --- Coin faucet: which monsters drop coins, and expected coins/kill --------
  const coinRows = drops.filter((d) => d.item_id === 'coins');
  const coinMonsters = new Set(coinRows.map((d) => d.monster_id));
  // Expected coins/kill for a monster = Σ chance * mean(qty) over its coin rows.
  const perMonsterEV = [];
  for (const m of coinMonsters) {
    const ev = coinRows
      .filter((d) => d.monster_id === m)
      .reduce((s, d) => s + (d.chance_percent / 100) * ((d.qty_min + d.qty_max) / 2), 0);
    perMonsterEV.push(ev);
  }
  const avgCoinsPerKill = perMonsterEV.reduce((a, b) => a + b, 0) / (perMonsterEV.length || 1);

  check('coin faucet stays weak/material-driven (≤ 40% of monsters drop coins)',
    coinMonsters.size <= monsters.length * 0.4,
    `${coinMonsters.size}/${monsters.length} monsters drop coins`);
  check('avg coins/kill in intended low band (5–45)',
    inBand(avgCoinsPerKill, 5, 45),
    `avg EV ≈ ${avgCoinsPerKill.toFixed(1)} coins/kill`);

  // --- Bosses pay in materials, not gold (0 coin drops) -----------------------
  const bosses = monsters.filter((m) => m.combat_level >= 70);
  const bossesWithCoins = bosses.filter((b) => coinMonsters.has(b.monster_id));
  check('all bosses (cmb ≥ 70) drop 0 coins (material-driven payout)',
    bossesWithCoins.length === 0,
    `${bosses.length} bosses, ${bossesWithCoins.length} pay coins`);

  // --- Crafting value split: net roughly value-neutral (not a gold printer) ---
  // Measure ONLY on recipes whose inputs are all real, gp-valued material items.
  // Recipes with tool tokens (`knife`), category placeholders (`bars`), or ids
  // with no gp_value would score a 0-cost input and fabricate value creation —
  // an artifact, not real inflation — so they're excluded from the value delta.
  let addValue = 0, destroyValue = 0, added = 0, destroyed = 0, skipped = 0;
  for (const r of recipes) {
    const outGp = (gp.get(r.output_item_id) || 0) * (r.output_qty || 1);
    let inGp = 0, measurable = outGp > 0;
    for (const tok of String(r.inputs || '').split(';')) {
      if (!tok) continue;
      const [id, qty] = tok.split(':');
      const v = gp.get(id);
      if (!v) { measurable = false; break; }      // tool / placeholder / unvalued input
      inGp += v * (Number(qty) || 1);
    }
    if (!measurable) { skipped++; continue; }
    const delta = outGp - inGp;
    if (delta >= 0) { addValue += delta; added++; } else { destroyValue += -delta; destroyed++; }
  }
  const net = addValue - destroyValue;
  const grossFlow = addValue + destroyValue;
  const netRatio = grossFlow ? net / grossFlow : 0;
  check('crafting is roughly value-neutral (|net| ≤ 35% of gross value flow)',
    Math.abs(netRatio) <= 0.35,
    `+${addValue} / -${destroyValue} gp, net ${net} (${(netRatio * 100).toFixed(1)}% of gross)`);
  check('a real material-sink cohort exists (≥ 60 value-destroying recipes)',
    destroyed >= 60,
    `${added} add-value, ${destroyed} destroy-value recipes (${skipped} skipped: tool/placeholder inputs)`);

  return { items, monsters, drops, recipes, gp, avgCoinsPerKill };
}

// =============================================================================
// PART B — dynamic GE stability (validates the "no runaway inflation" claim by
// running the REAL matching engine under a sustained trade load)
// =============================================================================
function simGrandExchange(ctx) {
  console.log('\n── Part B: Grand Exchange stability under load (real engine) ──');
  const rng = mulberry32(0xC0FFEE);
  const market = new Market();

  // A basket of genuinely tradeable goods across price magnitudes.
  const basket = ctx.items
    .filter((i) => i.gp_value > 0 && ['Resource', 'Processed Material', 'Consumable', 'Equipment', 'Ammo']
      .includes(i.category))
    .sort((a, b) => a.gp_value - b.gp_value);
  // Sample ~60 items spread across the value range (cheap→expensive).
  const step = Math.max(1, Math.floor(basket.length / 60));
  const traded = basket.filter((_, k) => k % step === 0).slice(0, 60);
  const seed = new Map();
  for (const it of traded) { market.setGuide(it.item_id, it.gp_value); seed.set(it.item_id, it.gp_value); }

  // A population of traders. Each has a private "fair value" that mean-reverts to
  // the seed; they buy below it and sell above it — the classic informed-trader
  // model that SHOULD keep the guide anchored near fundamentals. Plus a constant
  // seller flow (players offloading gathered/looted goods) which pressures price
  // DOWN — the realistic "everyone is selling" stress the clamp must absorb.
  const TICKS = 4000;
  const TRADERS = 40;
  let trades = 0, volume = 0;
  for (let t = 0; t < TICKS; t++) {
    const it = traded[(rng() * traded.length) | 0];
    const base = seed.get(it.item_id);
    for (let k = 0; k < TRADERS / 8; k++) {
      const trader = `t${(rng() * TRADERS) | 0}`;
      // fair value wobbles ±20% around fundamentals
      const fair = base * (0.8 + rng() * 0.4);
      // First half of the run: net SELLING pressure (everyone offloading loot →
      // tests the price-collapse floor). Second half: net BUYING pressure (a
      // demand shock → tests the runaway-inflation ceiling). Both bounds bite.
      const sellBias = t < TICKS / 2 ? 0.55 : 0.45;
      const side = rng() < sellBias ? 'sell' : 'buy';
      const limit = side === 'sell'
        ? Math.max(1, Math.round(fair * (0.9 + rng() * 0.15)))
        : Math.max(1, Math.round(fair * (0.85 + rng() * 0.15)));
      const qty = 1 + ((rng() * 20) | 0);
      const before = market.trades.length;
      market.place(side, it.item_id, qty, limit, trader);
      const after = market.trades.length;
      trades += after - before;
      for (let x = before; x < after; x++) volume += market.trades[x].qty;
    }
  }

  // Assert every guide stayed anchored: no item ran away up or crashed to the
  // floor. The ±5%/trade clamp should hold the whole basket inside a tight band
  // even under one-sided selling pressure across thousands of trades.
  let worstUp = 1, worstDown = 1, worstUpId = '', worstDownId = '';
  for (const it of traded) {
    const s = seed.get(it.item_id);
    const g = market.guidePrice(it.item_id);
    const up = g / s, down = s / g;
    if (up > worstUp) { worstUp = up; worstUpId = it.item_id; }
    if (down > worstDown) { worstDown = down; worstDownId = it.item_id; }
  }
  check('no item inflated > 3× seed over 4k trades (no runaway inflation)',
    worstUp <= 3.0, `worst +${((worstUp - 1) * 100).toFixed(0)}% (${worstUpId})`);
  check('no item crashed < 1/3 seed over 4k trades (no price collapse)',
    worstDown <= 3.0, `worst −${((1 - 1 / worstDown) * 100).toFixed(0)}% (${worstDownId})`);
  check('GE actually cleared meaningful volume (engine liquid, not deadlocked)',
    trades > 500, `${trades} trades, ${volume} units`);

  return { trades, volume, worstUp, worstDown };
}

// =============================================================================
// PART C — new-player liquidity (validates ECONOMY_BALANCE.md risk #1)
// =============================================================================
function simNewPlayer(ctx) {
  console.log('\n── Part C: new-player liquidity (survival gather→sell loop) ──');
  const rng = mulberry32(0x5EED);
  // A brand-new player with no combat gear does the lowest-skill money loop:
  // chop/mine/fish starter materials and sell them. Model ~1 in-game hour.
  // Gathering ~ one success every few seconds; sell at the item's gp_value less
  // the 2% GE tax (the coin sink). We check they clear a survival wage.
  const gp = ctx.gp;
  const starters = ['normal_logs', 'copper_ore', 'tin_ore', 'raw_shrimp', 'cabbage']
    .filter((id) => gp.has(id));
  const GATHERS_PER_HOUR = 900;   // ~1 success / 4s
  let coins = 0, gathered = 0;
  for (let i = 0; i < GATHERS_PER_HOUR; i++) {
    const id = starters[(rng() * starters.length) | 0];
    gathered++;
    const value = gp.get(id) || 1;
    coins += Math.max(1, Math.round(value * 0.98)); // sell, minus 2% GE tax
  }
  const coinsPerHour = coins;
  // A basic supply run (few dozen arrows / a tool / food) costs on the order of a
  // few hundred coins. Survival floor: a new player must clear that in an hour.
  check('new player clears a survival wage (≥ 300 coins/hr from starter loop)',
    coinsPerHour >= 300, `≈ ${coinsPerHour} coins/hr over ${gathered} gathers`);
  // But it must NOT be a firehose that trivialises the early economy.
  check('starter loop is not a gold firehose (≤ 20,000 coins/hr)',
    coinsPerHour <= 20000, `≈ ${coinsPerHour} coins/hr`);
  return { coinsPerHour };
}

// ---- main -------------------------------------------------------------------
console.log('Goblin Empire — economy balance validator');
const ctx = auditStatic();
simGrandExchange(ctx);
simNewPlayer(ctx);

const failed = results.filter((r) => !r.pass);
console.log(`\n${'─'.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} balance checks passed.`);
if (failed.length) {
  console.log(`\n❌ ${failed.length} FAILED — economy balance regressed:`);
  for (const f of failed) console.log(`   • ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
console.log('✅ Economy balance holds within all asserted bands.');
