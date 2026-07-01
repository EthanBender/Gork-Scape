// test/skills.test.mjs — the XP curve and skilling roll (src/engine/skills.js).
import { test, assert, eq, almost } from './run.mjs';
import { XP_TABLE, xpForLevel, levelForXp, levelProgress, rollSkillSuccess, MAX_LEVEL } from '../src/engine/skills.js';

// The whole progression system rests on these anchor values matching OSRS.
test('xp table hits the canonical OSRS anchors', () => {
  eq(xpForLevel(1), 0, 'L1');
  eq(xpForLevel(2), 83, 'L2');
  eq(xpForLevel(10), 1154, 'L10');
  eq(xpForLevel(50), 101333, 'L50');
  eq(xpForLevel(99), 13034431, 'L99');
});

test('xp table is strictly increasing', () => {
  for (let l = 2; l <= MAX_LEVEL; l++) assert(XP_TABLE[l] > XP_TABLE[l - 1], `L${l} not > L${l - 1}`);
});

test('levelForXp is the inverse of xpForLevel', () => {
  for (let l = 1; l <= MAX_LEVEL; l++) {
    eq(levelForXp(xpForLevel(l)), l, `at exact threshold L${l}`);
    if (l > 1) eq(levelForXp(xpForLevel(l) - 1), l - 1, `just below L${l}`);
  }
});

test('levelForXp clamps out-of-range xp', () => {
  eq(levelForXp(0), 1);
  eq(levelForXp(-5), 1);
  eq(levelForXp(1e12), 99);
});

test('levelProgress reports the fraction into the current level', () => {
  const atThreshold = levelProgress(xpForLevel(50));
  eq(atThreshold.level, 50);
  eq(atThreshold.current, 0);
  eq(atThreshold.needed, xpForLevel(51) - xpForLevel(50));
  almost(atThreshold.ratio, 0);

  const halfway = levelProgress(xpForLevel(50) + (xpForLevel(51) - xpForLevel(50)) / 2 | 0);
  assert(halfway.ratio > 0.49 && halfway.ratio < 0.51, `ratio ~0.5, got ${halfway.ratio}`);

  eq(levelProgress(xpForLevel(99)).ratio, 1, 'maxed = full bar');
});

// rollSkillSuccess is probabilistic; pin Math.random to test the exact threshold.
test('rollSkillSuccess threshold scales with level', () => {
  const orig = Math.random;
  try {
    // low=32, high=232 → chance(L1)=(1+32)/256≈0.129, chance(L99)=(1+232)/256≈0.910
    Math.random = () => 0.10;                       // below L1 chance
    assert(rollSkillSuccess(1, 32, 232) === true, 'L1 succeeds at r=0.10');
    Math.random = () => 0.50;                       // above L1 chance, below L99 chance
    assert(rollSkillSuccess(1, 32, 232) === false, 'L1 fails at r=0.50');
    assert(rollSkillSuccess(99, 32, 232) === true, 'L99 succeeds at r=0.50');
    Math.random = () => 0.95;                        // above even L99 chance
    assert(rollSkillSuccess(99, 32, 232) === false, 'L99 fails at r=0.95');
  } finally {
    Math.random = orig;
  }
});
