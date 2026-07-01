// test/gear.test.mjs — the character-render classifiers (src/render/gear.js).
// These drive what weapon motion an NPC uses and which body silhouette a monster
// gets, so a misclassification is a visible bug (a spider drawn as a goblin).
import { test, assert, eq } from './run.mjs';
import { weaponHint, weaponStyleFor, gearHints, bodyTypeFor } from '../src/render/gear.js';

test('weapon attack-style is inferred from the id', () => {
  eq(weaponStyleFor({ id: 'goblin_shortbow' }), 'ranged');
  eq(weaponStyleFor({ id: 'iron_spear' }), 'stab');
  eq(weaponStyleFor({ id: 'bronze_dagger' }), 'stab');
  eq(weaponStyleFor({ id: 'bronze_scimitar' }), 'slash');
  eq(weaponStyleFor({ id: 'bronze_hatchet' }), 'slash');
  eq(weaponStyleFor({ id: 'bronze_mace' }), 'crush');
  eq(weaponStyleFor({ id: 'gnarled_staff' }), 'crush');
  eq(weaponStyleFor(null), 'unarmed', 'no weapon = unarmed');
});

test('weapon silhouette kind is inferred from the id', () => {
  eq(weaponHint({ id: 'goblin_shortbow' }).kind, 'bow');
  eq(weaponHint({ id: 'iron_spear' }).kind, 'spear');
  eq(weaponHint({ id: 'bronze_scimitar' }).kind, 'sword');
  eq(weaponHint({ id: 'bronze_pickaxe' }).kind, 'pick'); // regression: not 'axe'
  eq(weaponHint({ id: 'crude_club' }).kind, 'mace', 'club is a blunt/crush shape');
  eq(weaponHint({ id: 'weird_unknown_thing' }).kind, 'club', 'unknown weapon falls back to club');
});

test('an explicit render block overrides the id guess', () => {
  const h = weaponHint({ id: 'mystery', render: { kind: 'axe', style: 'slash', color: 0x123456, len: 20 } });
  eq(h.kind, 'axe'); eq(h.style, 'slash'); eq(h.color, 0x123456); eq(h.len, 20);
});

test('gearHints resolves a whole loadout', () => {
  const g = gearHints({ weapon: { id: 'goblin_shortbow' }, head: { id: 'bronze_full_helm' }, shield: { id: 'bronze_kiteshield' } });
  eq(g.weapon.style, 'ranged');
  eq(g.head.kind, 'full');
  assert(g.shield && g.shield.shape === 'kite');
  assert(g.cape === null, 'absent slots are null');
});

test('monster names map to the right body silhouette', () => {
  const type = (n) => bodyTypeFor(n).type;
  eq(type('Training Rat'), 'quadruped');
  eq(type('Oak Boar'), 'quadruped');
  eq(type('Moss Wolf'), 'quadruped');
  eq(type('Giant Spider'), 'insectoid');
  eq(type('Cave Bug'), 'insectoid');
  eq(type('Mud Grub'), 'insectoid');
  eq(type('Iron Rock Crab'), 'insectoid');
  eq(type('Bog Slime'), 'amorphous');
  eq(type('Ruin Wisp'), 'amorphous');
  eq(type('Rival Goblin Warrior'), 'humanoid');
  eq(type('Goblin Elder'), 'humanoid');
  eq(type('Cave Bat'), 'avian');
  eq(type('Reed Snake'), 'serpent');
  eq(type('Bog Eel'), 'serpent');
});

test('tougher creatures render larger (size multiplier)', () => {
  assert(bodyTypeFor('Cave Troll').size > bodyTypeFor('Training Rat').size, 'a troll dwarfs a rat');
  assert(bodyTypeFor('Cave Troll').size >= 1.3, 'heavies scale up');
});

test('bosses carry the boss flag (aura) regardless of silhouette', () => {
  const king = bodyTypeFor('Bog King');
  assert(king.boss === true && king.type === 'humanoid', 'a king is a humanoid boss');
  const horror = bodyTypeFor('Grub Bog Horror');
  assert(horror.boss === true && horror.type === 'insectoid', 'an insectoid boss keeps its silhouette');
  assert(bodyTypeFor('Deep Metal Golem').boss === true, 'golem boss');
  assert(!bodyTypeFor('Training Rat').boss, 'a rat is not a boss');
  assert(bodyTypeFor('Bog King').size >= 1.5, 'bosses are large');
});
