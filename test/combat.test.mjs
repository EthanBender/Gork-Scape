// test/combat.test.mjs — combat math (src/engine/combat.js).
import { test, assert, eq } from './run.mjs';
import {
  combatLevel, maxHit, maxAttackRoll, maxDefenceRoll, weaponRange, resolveAttack,
  DEFAULT_MELEE_RANGE, DEFAULT_RANGED_RANGE,
} from '../src/engine/combat.js';

const noBonus = {
  stab_atk: 0, slash_atk: 0, crush_atk: 0, range_atk: 0,
  melee_str: 0, range_str: 0,
  stab_def: 0, slash_def: 0, crush_def: 0, range_def: 0,
};
const profile = (over = {}) => ({
  levels: { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 },
  bonuses: { ...noBonus },
  weaponType: 'crush', style: 'Aggressive',
  ...over,
});

test('combatLevel matches the spec for the starter goblin', () => {
  // 0.25*(1+10) + max(13/40*(1+1), 13/40*1.5*1) = 2.75 + 0.65 = 3.40 -> 3
  eq(combatLevel({ attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 }), 3);
});

test('combatLevel: melee vs ranged branch and a mid build', () => {
  // pure melee 60s + 60 def/hp: 0.25*120 + 13/40*120 = 30 + 39 = 69
  eq(combatLevel({ attack: 60, strength: 60, defence: 60, ranged: 1, hitpoints: 60 }), 69);
  // pure ranged: 13/40*1.5*99 = 48.2625; def/hp 1/10 -> 0.25*11=2.75 -> floor(51.01)=51
  eq(combatLevel({ attack: 1, strength: 1, defence: 1, ranged: 99, hitpoints: 10 }), 51);
});

test('maxHit: a level-1 aggressive attacker can hit exactly 1', () => {
  // eff = 1(str) + 3(aggr) + 8 = 12 ; floor(0.5 + 12*(0+64)/640) = floor(0.5+1.2)=1
  eq(maxHit(profile()), 1);
});

test('maxHit scales with strength level and strength bonus', () => {
  eq(maxHit(profile({ levels: { attack: 1, strength: 99, defence: 1, ranged: 1, hitpoints: 10 } })), 11);
  eq(maxHit(profile({
    levels: { attack: 1, strength: 99, defence: 1, ranged: 1, hitpoints: 10 },
    bonuses: { ...noBonus, melee_str: 100 },
  })), 28);
});

test('ranged maxHit reads the ranged level + range strength', () => {
  const p = profile({ weaponType: 'ranged', levels: { attack: 1, strength: 1, defence: 1, ranged: 40, hitpoints: 10 }, bonuses: { ...noBonus, range_str: 20 } });
  // eff = 40 + 3(aggr) + 8 = 51 ; floor(0.5 + 51*(20+64)/640) = floor(0.5+6.69)=7
  eq(maxHit(p), 7);
});

test('max attack/defence rolls follow (eff+9)*(bonus+64)', () => {
  // attack 1, aggressive(+0 atk), crush bonus 0 -> (1+0+9)*(0+64)=640
  eq(maxAttackRoll(profile()), 640);
  // accurate style adds +3 attack -> (1+3+9)*64 = 832
  eq(maxAttackRoll(profile({ style: 'Accurate' })), 832);
  // defence 1, crush def 0 -> (1+9)*(0+64)=640
  eq(maxDefenceRoll(profile(), 'crush'), 640);
  // a crush def bonus of 100 -> (1+9)*(100+64)=1640
  eq(maxDefenceRoll(profile({ bonuses: { ...noBonus, crush_def: 100 } }), 'crush'), 1640);
});

test('weaponRange is determined by the weapon', () => {
  eq(weaponRange(null), DEFAULT_MELEE_RANGE);
  eq(weaponRange({ weaponType: 'crush' }), 1);
  eq(weaponRange({ weaponType: 'ranged' }), DEFAULT_RANGED_RANGE);
  eq(weaponRange({ weaponType: 'stab', attackRange: 2 }), 2, 'explicit override (spear)');
  eq(weaponRange({ weaponType: 'ranged', attackRange: 6 }), 6, 'longbow override');
});

test('resolveAttack always returns a damage within [0, maxHit]', () => {
  const atk = profile({ levels: { attack: 50, strength: 50, defence: 1, ranged: 1, hitpoints: 10 } });
  const def = profile({ levels: { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 } });
  const max = maxHit(atk);
  for (let i = 0; i < 2000; i++) {
    const r = resolveAttack(atk, def);
    assert(typeof r.hit === 'boolean', 'hit is boolean');
    assert(Number.isInteger(r.damage) && r.damage >= 0 && r.damage <= max, `damage ${r.damage} out of [0,${max}]`);
    if (!r.hit) assert(r.damage === 0, 'a miss deals 0');
  }
});

test('a vastly superior attacker lands the large majority of hits', () => {
  const strong = profile({ levels: { attack: 99, strength: 99, defence: 99, ranged: 1, hitpoints: 99 }, bonuses: { ...noBonus, crush_atk: 100, melee_str: 100 } });
  const weak = profile();
  let hits = 0;
  for (let i = 0; i < 3000; i++) if (resolveAttack(strong, weak).hit) hits++;
  assert(hits / 3000 > 0.9, `expected >90% hit rate, got ${(hits / 30).toFixed(1)}%`);
});
