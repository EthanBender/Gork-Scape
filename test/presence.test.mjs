// test/presence.test.mjs — multiplayer skill-sync. When you gather, you broadcast
// a whitelisted skill + facing over presence so OTHER clients render you actually
// mining/chopping/fishing instead of just standing there holding your weapon.
// Two halves: the server relay (Presence) and the client render (avatarStateFor).
import { test, assert, eq } from './run.mjs';
import { Presence } from '../server/presence.mjs';
import { avatarStateFor } from '../src/render/characters.js';
import { gearHints } from '../src/render/gear.js';
import { Game } from '../src/engine/state.js';

const TILE = 32;
const tilePx = (t) => t * TILE + TILE / 2;

// ---- server: heartbeat relays a gathering signal to other players ----------
test('presence relays a gathering skill + facing to other players', () => {
  const pr = new Presence();
  pr.heartbeat('alice', { x: 10, y: 10, skill: 'Mining', sdir: 'E' });
  const view = pr.heartbeat('bob', { x: 12, y: 10 });
  const alice = view.players.find((p) => p.name === 'alice');
  assert(alice, 'bob sees alice in the roster');
  eq(alice.skill, 'Mining', 'skill relayed');
  eq(alice.sdir, 'E', 'facing relayed');
});

test('presence nulls an absent or bogus gathering signal', () => {
  const pr = new Presence();
  pr.heartbeat('alice', { x: 1, y: 1 });                                   // not skilling
  pr.heartbeat('mallory', { x: 2, y: 2, skill: 'DROP TABLE', sdir: 'ZZ' }); // junk
  const view = pr.heartbeat('bob', { x: 3, y: 3 });
  eq(view.players.find((p) => p.name === 'alice').skill, null, 'no skill -> null');
  const m = view.players.find((p) => p.name === 'mallory');
  eq(m.skill, null, 'bogus skill rejected (whitelist)');
  eq(m.sdir, null, 'bogus facing rejected');
});

// ---- client: a remote entity carrying a broadcast skill mimes the tool -----
test('avatarStateFor renders a remote player’s broadcast skill', () => {
  const prev = Game.player;
  Game.player = { tileX: 0, tileY: 0 }; // read by the NPC "attention" branch
  try {
    const remote = {
      tileX: 5, tileY: 5, px: tilePx(5), py: tilePx(5), // stationary => not moving
      color: 0x6fbf3f, _skill: 'Mining', _sdir: 'E',
      _gearCache: gearHints({}), _tOff: 0, _body: { type: 'humanoid', size: 1 },
    };
    const st = avatarStateFor(remote, false, 1000);
    eq(st.anim, 'skill', 'remote reads as skilling');
    eq(st.skillType, 'chop', 'mining uses the overhead chop/mine motion');
    eq(st.tool.kind, 'pick', 'and holds a pick');
    eq(st.facing, 'E', 'faces the direction it broadcast');
  } finally { Game.player = prev; }
});

test('a remote with no broadcast skill does not skill', () => {
  const prev = Game.player;
  Game.player = { tileX: 0, tileY: 0 };
  try {
    const remote = {
      tileX: 5, tileY: 5, px: tilePx(5), py: tilePx(5),
      color: 0x6fbf3f, _skill: null,
      _gearCache: gearHints({}), _tOff: 0, _body: { type: 'humanoid', size: 1 },
    };
    const st = avatarStateFor(remote, false, 1000);
    assert(st.anim !== 'skill', 'stands/idles, not skilling');
  } finally { Game.player = prev; }
});
