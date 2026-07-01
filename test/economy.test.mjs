// test/economy.test.mjs — the data-driven registry + drop roller.
// This is the payoff of the fetch shim in run.mjs: gameData.js hydrates from
// JSON via top-level `await fetch`, which normally only works in a browser. With
// the shim, the whole economy data layer is testable headlessly.
import { test, assert, eq } from './run.mjs';
import { GameData } from '../src/data/gameData.js';
import { rollDropTable, rollMonsterDrops } from '../src/systems/drops.js';

test('the game database actually loaded (shim works)', () => {
  assert(GameData.items.length > 0, 'items loaded');
  assert(GameData.monsters.length > 0, 'monsters loaded');
  assert(GameData.recipes.length > 0, 'recipes loaded');
  assert(GameData.dropTables.length > 0, 'drop tables loaded');
});

test('id resolvers round-trip against the loaded data', () => {
  const rat = GameData.monster('training_rat');
  assert(rat && rat.display_name === 'Training Rat', 'training_rat resolves');
  assert(GameData.item('rat_meat'), 'a known drop item resolves');
});

test('rollMonsterDrops returns well-formed, resolvable drops', () => {
  let sawADrop = false;
  for (let i = 0; i < 500; i++) {
    const drops = rollMonsterDrops('training_rat');
    assert(Array.isArray(drops), 'always an array');
    for (const d of drops) {
      sawADrop = true;
      assert(typeof d.id === 'string' && d.id.length > 0, 'drop has an id');
      assert(Number.isInteger(d.qty) && d.qty >= 1, `drop qty ${d.qty} >= 1`);
      assert(GameData.item(d.id) || d.id === 'coins', `dropped id "${d.id}" resolves in the registry`);
    }
  }
  assert(sawADrop, 'over 500 rolls the rat dropped something at least once');
});

test('an unknown monster or table drops nothing (no throw)', () => {
  eq(rollMonsterDrops('does_not_exist'), []);
  eq(rollDropTable('no_such_table'), []);
});

test('recipesForStation returns recipes for a real station', () => {
  const withStation = GameData.recipes.find((r) => r.station);
  assert(withStation, 'at least one recipe names a station');
  const recipes = GameData.recipesForStation(withStation.station);
  assert(recipes.length > 0, `station "${withStation.station}" exposes recipes`);
});
