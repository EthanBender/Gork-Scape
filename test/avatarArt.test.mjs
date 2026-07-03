// test/avatarArt.test.mjs — the avatar real-art seam (src/render/avatarArt.js) and
// the pivot data file. Importing the module must NOT change the rig; it only adds
// a lookup layer that stays empty (procedural) until PNGs are authored.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './run.mjs';
import { hasAvatarArt, avatarArtUrl, pivotFor, avatarArtReady, avatarArtCount } from '../src/render/avatarArt.js';

test('avatar art seam is empty + procedural before any art is loaded', () => {
  eq(avatarArtCount(), 0, 'no art registered on import');
  eq(hasAvatarArt('body_torso_s'), false, 'unknown part has no art');
  eq(avatarArtReady(), false, 'pivots not loaded yet (no side effects on import)');
  eq(pivotFor('torso'), null, 'pivot lookup is null before load');
});

test('avatar art keys map to the right asset path', () => {
  eq(avatarArtUrl('body_head_s'), 'assets/avatar/body_head_s.png');
  eq(avatarArtUrl('weapon_bronze_scimitar'), 'assets/avatar/weapon_bronze_scimitar.png');
});

test('pivots.json is well-formed and covers every rig part', () => {
  const url = new URL('../assets/avatar/pivots.json', import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  assert(data.pivots, 'has a pivots block');
  for (const part of ['torso', 'head', 'arm', 'leg', 'helm', 'weapon']) {
    assert(data.pivots[part], `pivot defined for ${part}`);
  }
  // the numbers must match the rig constants the art has to line up with
  eq(data.pivots.head.center, [0, 26], 'head center = HEAD_Y');
  eq(data.pivots.torso.top, [0, 20], 'torso top = SHOULDER_Y');
  eq(data.pivots.leg.foot, [2.2, 0], 'foot sits on the ground (y0)');
});

test('manifest.json is well-formed and starts empty', () => {
  const url = new URL('../assets/avatar/manifest.json', import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  assert(Array.isArray(data.parts), 'manifest has a parts array');
  eq(data.parts.length, 0, 'no art listed yet (fully procedural)');
});
