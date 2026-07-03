// src/systems/treasuryHeist.js
// The Goblin Treasury heist cycle: the 2% GE sell tax pools into a visible hoard
// (see geActions.geTax.balance). When the pile grows past a threshold it LURES a
// dragon, which swoops in and steals the whole hoard and carries it to its lair.
// Players track the dragon down, slay it, and reclaim a PORTION of the gold (the
// rest burns — a deflationary sink) plus the dragon's item drops. On a team the
// reclaimed gold is split. Then the cycle resets and the dragon returns hungrier.
//
// This module owns the ECONOMIC state machine + reward math only. The lair's
// location and the actual boss encounter belong to the world-gen / combat lanes;
// they drive the fight and call `resolveHeistVictory()` when the dragon dies.
// Rendering the growing pile + the dragon/steal animation belongs to the
// character-render lane, which reads `heistView()`.

import { Game, addItem } from '../engine/state.js';
import { geTax, spendTreasury } from './geActions.js';
import { GameData } from '../data/gameData.js';
import { randInt } from '../engine/rng.js';

const COINS = 'coins';

// The boss + its reward table. Kept self-contained here until world-gen promotes
// the dragon into monsters.json for real world placement (JSON-first, coordinated).
// Every drop id is verified to exist in items.json.
export const HOARD_DRAGON = {
  id: 'hoard_dragon',
  name: 'Goldscale, the Hoard Dragon',
  baseCombatLevel: 90, // scales up per tier (see resolveHeistVictory)
  drops: [
    { id: 'meteor_diamond', chance: 55, min: 1, max: 3 },
    { id: 'cut_meteor_diamond', chance: 28, min: 1, max: 2 },
    { id: 'trollbone_longbow', chance: 10, min: 1, max: 1 },
    { id: 'trollbone_sword', chance: 10, min: 1, max: 1 },
    { id: 'meteor_diamond_amulet', chance: 6, min: 1, max: 1 },
  ],
};

// --- Tunables ---------------------------------------------------------------
const BASE_THRESHOLD = 2500;   // gp in the treasury that first lures the dragon
const THRESHOLD_GROWTH = 1.6;  // each cycle the dragon grows hungrier
const PLAYER_SHARE = 0.6;      // fraction of the stolen hoard players can reclaim

// --- State ------------------------------------------------------------------
export const heist = {
  phase: 'hoarding',           // 'hoarding' -> 'raided' -> (fight) -> 'hoarding'
  tier: 0,                     // heists completed; scales threshold + boss level
  threshold: BASE_THRESHOLD,
  hoard: 0,                    // gold the dragon currently sits on (0 while hoarding)
};

// Read-only snapshot for the UI + the render lane (pile size, raid state, boss).
export function heistView() {
  const ratio = heist.phase === 'hoarding'
    ? Math.max(0, Math.min(1, geTax.balance / heist.threshold))
    : 1;
  return {
    phase: heist.phase,
    tier: heist.tier,
    threshold: heist.threshold,
    balance: geTax.balance,
    hoard: heist.hoard,
    ratio,                                   // 0..1 pile fullness (drives the visual)
    dragonActive: heist.phase === 'raided',  // world-gen: spawn the boss at the lair
    bossLevel: HOARD_DRAGON.baseCombatLevel + heist.tier * 15,
    dragon: HOARD_DRAGON,
  };
}

// Poll each tick: if the pile is big enough, the dragon raids. Idempotent — only
// fires on the hoarding -> raided transition.
export function checkHeist() {
  if (heist.phase !== 'hoarding') return false;
  if (geTax.balance < heist.threshold) return false;
  heist.hoard = Math.floor(geTax.balance);
  spendTreasury(heist.hoard);               // the treasury is drained INTO the hoard
  heist.phase = 'raided';
  Game.log(`${HOARD_DRAGON.name} descends and plunders `
    + `${heist.hoard.toLocaleString()} gp from the Goblin Treasury! `
    + `Hunt it to its lair and take back the hoard.`);
  Game.refresh();
  return true;
}

function rollDragonDrops() {
  const out = [];
  for (const d of HOARD_DRAGON.drops) {
    if (Math.random() * 100 < d.chance) {
      out.push({ id: d.id, qty: d.max > d.min ? randInt(d.min, d.max) : d.min });
    }
  }
  return out;
}

// Called by the combat/world lane when the dragon is killed. `party` is the list
// of trader ids that earned the kill (solo defaults to the local player). Awards
// each member an even split of the reclaimable gold plus the item drops, then
// resets the cycle. Returns a payout summary.
export function resolveHeistVictory(party = ['player']) {
  if (heist.phase !== 'raided') return { ok: false, reason: 'no active dragon raid' };

  const drops = rollDragonDrops();
  const reclaimable = Math.floor(heist.hoard * PLAYER_SHARE);
  const members = Math.max(1, party.length);
  const perMember = Math.floor(reclaimable / members);
  const lost = heist.hoard - reclaimable; // burned in the dragon's fire = coin sink

  // Single-player: the local player IS the whole party, so they get their share
  // and all the item loot. In a networked build the server credits each member.
  addItem(COINS, perMember);
  for (const d of drops) addItem(d.id, d.qty);

  const dropText = drops.length
    ? drops.map((d) => `${d.qty}× ${itemName(d.id)}`).join(', ')
    : 'no rare drops this time';
  Game.log(`${HOARD_DRAGON.name} is slain! You reclaim ${perMember.toLocaleString()} gp`
    + (members > 1 ? ` (your split of ${reclaimable.toLocaleString()} across ${members})` : '')
    + ` and loot ${dropText}. ${lost.toLocaleString()} gp was lost to the flames.`);

  heist.tier += 1;
  heist.threshold = Math.round(BASE_THRESHOLD * Math.pow(THRESHOLD_GROWTH, heist.tier));
  heist.hoard = 0;
  heist.phase = 'hoarding';
  Game.refresh();
  return { ok: true, coins: perMember, drops, reclaimable, lost, members };
}

function itemName(id) { const it = GameData.item(id); return (it && it.display_name) || id; }

// Debug/verification handle. `force()` fast-fills the treasury to trigger a raid;
// `slay()` resolves an active raid — the temporary stand-in for the real lair
// fight until world-gen/combat wires the encounter.
if (typeof window !== 'undefined') {
  window.__HEIST = {
    heist, heistView, checkHeist,
    force: () => { geTax.balance = heist.threshold; return checkHeist(); },
    slay: (party) => resolveHeistVictory(party),
  };
}
