// test/save.test.mjs — player save round-trip (src/engine/save.js).
// Boot-critical and cross-lane: a broken serialize/applySave silently corrupts
// every returning player's character. serialize()/applySave() are pure (no
// localStorage — that's only in the storage helpers), so they test headlessly
// with the run.mjs fetch shim hydrating the item registry.
import { test, assert, eq } from './run.mjs';
import { Game, initState, grantXp } from '../src/engine/state.js';
import { ITEMS } from '../src/items/equipment.js';
import { serialize, applySave, parseBackup, SAVE_VERSION } from '../src/engine/save.js';

// give the live Game a representative character to persist
function setUpCharacter() {
  initState();
  Game.player = { tileX: 123, tileY: 456 };
  grantXp('Attack', 5000);
  grantXp('Woodcutting', 1200);
  Game.hp = 7;
  Game.attackStyle = 'Defensive';
  const stackable = Object.values(ITEMS).find((d) => d.stackable);
  const single = Object.values(ITEMS).find((d) => !d.stackable && d.slot);
  if (stackable) Game.inventory[0] = Object.assign({}, stackable, { qty: 5 });
  if (single) Game.equipment[single.slot] = single;
  return { stackable, single };
}

test('serialize captures the character (schema-versioned)', () => {
  setUpCharacter();
  const blob = serialize();
  eq(blob.v, SAVE_VERSION, 'stamped with the current schema version');
  eq(blob.attackStyle, 'Defensive');
  eq(blob.hp, 7);
  eq(blob.pos, { x: 123, y: 456 });
  assert(blob.skills.Attack.xp === 5000, 'skill xp captured');
  assert(typeof blob.savedAt === 'number', 'savedAt stamped');
});

test('applySave restores skills, position, hp, style, and items', () => {
  const { stackable, single } = setUpCharacter();
  const blob = serialize();

  // wipe to a fresh character, then restore
  initState();
  Game.player = { tileX: 0, tileY: 0 };
  applySave(blob);

  eq(Game.skills.Attack.xp, 5000, 'Attack xp restored');
  eq(Game.skills.Woodcutting.xp, 1200, 'Woodcutting xp restored');
  eq(Game.attackStyle, 'Defensive');
  eq(Game.player.tileX, 123);
  eq(Game.player.tileY, 456);
  assert(Game.hp <= Game.maxHp, 'hp clamped to maxHp on load');
  if (stackable) {
    eq(Game.inventory[0].id, stackable.id, 'stackable item restored');
    eq(Game.inventory[0].qty, 5, 'quantity restored');
  }
  if (single) assert(Game.equipment[single.slot] && Game.equipment[single.slot].id === single.id, 'equipped item restored');
});

test('save is idempotent (serialize∘applySave∘serialize is stable)', () => {
  setUpCharacter();
  const a = serialize();
  initState();
  Game.player = { tileX: 0, tileY: 0 };
  applySave(a);
  const b = serialize();
  // everything except the wall-clock timestamp should match exactly
  delete a.savedAt; delete b.savedAt;
  eq(b, a, 'round-trip preserves the full save shape');
});

test('applySave tolerates junk without crashing', () => {
  setUpCharacter();
  applySave(null);        // no-op
  applySave({});          // missing fields — guarded
  applySave({ inventory: [{ id: 'definitely_not_an_item' }] }); // unknown item dropped
  assert(true, 'no throw on degenerate saves');
});

test('parseBackup validates real saves and rejects junk', () => {
  setUpCharacter();
  const good = JSON.stringify(serialize());
  const parsedBare = parseBackup(good);
  assert(parsedBare.ok, 'a bare save object parses');
  assert(!parseBackup('not json').ok, 'non-JSON rejected');
  assert(!parseBackup('{"hello":1}').ok, 'unrelated JSON rejected');
});
