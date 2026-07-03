// src/systems/contracts.js — Slayer-lite CONTRACTS (M3): Sergeant Grimjaw hands
// out "slay N of X" tasks tuned to your combat level. This is combat's goal
// ladder: it names a target, points at its region, pays coins + spread combat
// XP on completion, and builds a streak (every 5th contract pays double).
//
// Deliberately thin: targets are the 60 database monsters (kills already carry
// monsterId through dropLoot/questOnKill), state is two fields on Game (saved
// by save.js), and the only UI is chat lines + the goal chip.

import { Game, addItem, grantXp, playerCombatLevel } from '../engine/state.js';
import { GameData } from '../data/gameData.js';

const prettyRegion = (r) => String(r || 'the wilds').split(';')[0].replace(/_/g, ' ');

export function contractState() { return Game.contract || null; }
export function contractActive() { const c = Game.contract; return !!(c && c.done < c.need); }

// Pick a fresh contract suited to the player's combat level. Replaces a
// completed one; refuses to replace one still in progress.
export function assignContract() {
  if (contractActive()) return Game.contract;
  const cl = Math.max(3, playerCombatLevel());
  const all = (GameData.monsters || []).filter((m) => m.monster_id !== 'training_rat' && m.combat_level >= 2);
  let pool = all.filter((m) => m.combat_level >= cl * 0.35 && m.combat_level <= cl * 1.25);
  if (!pool.length) pool = all.filter((m) => m.combat_level <= Math.max(4, cl));
  if (!pool.length) return null;
  const pick = pool[(Math.random() * pool.length) | 0];
  const need = Math.max(4, Math.min(15, Math.round(60 / Math.max(3, pick.combat_level)) + 4));
  Game.contract = {
    monsterId: pick.monster_id, name: pick.display_name, region: prettyRegion(pick.region),
    need, done: 0,
    coins: Math.max(25, Math.round(pick.combat_level * need * 2)),
    xp: Math.max(30, Math.round(pick.combat_level * need * 4)),
  };
  return Game.contract;
}

// Tally a kill against the active contract (called beside questOnKill).
export function contractOnKill(monsterId) {
  const c = Game.contract;
  if (!c || !monsterId || monsterId !== c.monsterId || c.done >= c.need) return;
  c.done++;
  if (c.done >= c.need) {
    Game.contractStreak = (Game.contractStreak || 0) + 1;
    const bonus = Game.contractStreak % 5 === 0 ? 2 : 1;
    addItem('coins', c.coins * bonus);
    if (Game.sfx) Game.sfx('coins');
    const per = Math.round((c.xp * bonus) / 3);
    grantXp('Attack', per); grantXp('Strength', per); grantXp('Defence', per);
    Game.log(`Contract complete: ${c.need}× ${c.name}! ${c.coins * bonus} coins + combat XP` +
      `${bonus > 1 ? ' — STREAK BONUS ×2 (' + Game.contractStreak + ' in a row)!' : '.'} Grimjaw has more work.`);
  } else {
    Game.log(`Contract: ${c.done}/${c.need} ${c.name}.`);
  }
}

// What Grimjaw says when you talk to him.
export function contractDialog() {
  const c = Game.contract;
  if (c && c.done < c.need) return `Still hunting? ${c.name}: ${c.done}/${c.need}. They won't slay themselves.`;
  const nc = assignContract();
  if (!nc) return 'No work today. Come back when something needs killing.';
  return `New contract: slay ${nc.need}× ${nc.name}. Last seen around ${nc.region}. ` +
    `${nc.coins} coins on completion${(Game.contractStreak || 0) % 5 === 4 ? ' — and this one completes a streak!' : '.'}`;
}
