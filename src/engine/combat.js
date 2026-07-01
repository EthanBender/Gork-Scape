// src/engine/combat.js
// Two-stage per-tick combat: an accuracy roll then a damage roll.
// All functions are pure; XP granting is handled by the caller (state.js).

import { randInt } from '../engine/rng.js';

// Attack-style effects: which combat skill earns XP and the +level bias.
// (Accurate -> Attack, Aggressive -> Strength, Defensive -> Defence,
//  Controlled -> shared.) Ranged weapons always train Ranged.
export const STYLES = {
  Accurate:   { atk: 3, str: 0, def: 0, xp: 'attack' },
  Aggressive: { atk: 0, str: 3, def: 0, xp: 'strength' },
  Defensive:  { atk: 0, str: 0, def: 3, xp: 'defence' },
  Controlled: { atk: 1, str: 1, def: 1, xp: 'shared' },
};

// Pick the relevant attack & strength bonus for the weapon type / style.
function offensiveBonuses(profile) {
  const b = profile.bonuses;
  if (profile.weaponType === 'ranged') {
    return { atkBonus: b.range_atk, strBonus: b.range_str };
  }
  if (profile.weaponType === 'tinker') {
    return { atkBonus: b.tinker_atk, strBonus: b.tinker_str };
  }
  // Melee: choose the attack bonus matching the weapon's damage type.
  const byType = { stab: b.stab_atk, slash: b.slash_atk, crush: b.crush_atk };
  const atkBonus = byType[profile.weaponType] ?? b.slash_atk;
  return { atkBonus, strBonus: b.melee_str };
}

// Defensive bonus the defender uses against this attack type.
function defensiveBonus(profile, weaponType) {
  const b = profile.bonuses;
  if (weaponType === 'ranged') return b.range_def;
  if (weaponType === 'tinker') return b.tinker_def;
  const byType = { stab: b.stab_def, slash: b.slash_def, crush: b.crush_def };
  return byType[weaponType] ?? b.slash_def;
}

// Which combat level drives a weapon type's accuracy & max hit.
function attackLevel(profile) {
  if (profile.weaponType === 'ranged') return profile.levels.ranged;
  if (profile.weaponType === 'tinker') return profile.levels.tinkering || 1;
  return profile.levels.attack;
}
function powerLevel(profile) {
  if (profile.weaponType === 'ranged') return profile.levels.ranged;
  if (profile.weaponType === 'tinker') return profile.levels.tinkering || 1;
  return profile.levels.strength;
}

// ---- attack range (in tiles, manhattan) ----
// Melee reaches one tile; ranged weapons reach further. A weapon may override
// the default with an explicit `attackRange` (e.g. a spear that pokes 2 tiles,
// or a longbow that outranges a shortbow), so range is "determined by the
// weapon" — mirroring how OSRS gives each weapon its own attack range.
export const DEFAULT_MELEE_RANGE = 1;
export const DEFAULT_RANGED_RANGE = 4;

// Resolve the reach of a weapon-like object ({ weaponType, attackRange }).
// Passing null/undefined (unarmed) yields the melee default.
export function weaponRange(weapon) {
  if (weapon && typeof weapon.attackRange === 'number') return weapon.attackRange;
  if (weapon && weapon.weaponType === 'ranged') return DEFAULT_RANGED_RANGE;
  return DEFAULT_MELEE_RANGE;
}

// max_attack_roll = (Attack_eff + 9) * (atk_bonus + 64)
export function maxAttackRoll(profile) {
  const style = STYLES[profile.style] || STYLES.Aggressive;
  const isRanged = profile.weaponType === 'ranged';
  const lvl = isRanged ? profile.levels.ranged : profile.levels.attack;
  const eff = lvl + style.atk;
  const { atkBonus } = offensiveBonuses(profile);
  return (eff + 9) * (atkBonus + 64);
}

// max_defence_roll = (Defence_eff + 9) * (armour_def_bonus + 64)
export function maxDefenceRoll(profile, incomingWeaponType) {
  const eff = profile.levels.defence;
  const defBonus = defensiveBonus(profile, incomingWeaponType);
  return (eff + 9) * (defBonus + 64);
}

// Max hit = floor(0.5 + Strength_eff * (str_bonus + 64) / 640)
// Strength_eff = strength level + style bonus + 8 (the standard constant);
// without the +8 a level-1 attacker can never roll above 0 damage.
export function maxHit(profile) {
  const style = STYLES[profile.style] || STYLES.Aggressive;
  const isRanged = profile.weaponType === 'ranged';
  const lvl = isRanged ? profile.levels.ranged : profile.levels.strength;
  const eff = lvl + style.str + 8;
  const { strBonus } = offensiveBonuses(profile);
  return Math.floor(0.5 + (eff * (strBonus + 64)) / 640);
}

// Resolve one attack. Returns { hit: bool, damage: int, max: int }.
export function resolveAttack(attacker, defender) {
  const atkRoll = maxAttackRoll(attacker);
  const defRoll = maxDefenceRoll(defender, attacker.weaponType);
  const a = randInt(0, atkRoll);
  const d = randInt(0, defRoll);
  if (a > d) {
    const max = maxHit(attacker);
    return { hit: true, damage: randInt(0, max), max };
  }
  return { hit: false, damage: 0, max: maxHit(attacker) };
}

// Resolve a WEAPON SPECIAL ATTACK — returns an array of per-hit results.
// spec fields (all optional): hits (default 1), accuracyMult, damageMult,
// armorPierce (0..1, fraction of the defender's armour ignored). Boss-forged
// weapons carry these; see equipment.js. Pure — energy is spent by the caller.
export function resolveSpecial(attacker, defender, spec) {
  const n = Math.max(1, spec.hits || 1);
  const accMult = spec.accuracyMult || 1;
  const dmgMult = spec.damageMult || 1;
  const pierce = Math.min(0.95, Math.max(0, spec.armorPierce || 0));
  const results = [];
  for (let i = 0; i < n; i++) {
    const atkRoll = Math.round(maxAttackRoll(attacker) * accMult);
    const defRoll = Math.round(maxDefenceRoll(defender, attacker.weaponType) * (1 - pierce));
    const a = randInt(0, atkRoll);
    const d = randInt(0, defRoll);
    const max = Math.max(1, Math.round(maxHit(attacker) * dmgMult));
    results.push(a > d ? { hit: true, damage: randInt(0, max), max } : { hit: false, damage: 0, max });
  }
  return results;
}

// Combat level per the spec:
//   base = 1/4; melee = 13/40*(att+str); ranged = 13/40*1.5*ranged
//   combat = floor(base*(def+hp) + max(melee, ranged))
export function combatLevel(levels) {
  const base = 0.25 * (levels.defence + levels.hitpoints);
  const melee = (13 / 40) * (levels.attack + levels.strength);
  const ranged = (13 / 40) * 1.5 * levels.ranged;
  return Math.floor(base + Math.max(melee, ranged));
}
