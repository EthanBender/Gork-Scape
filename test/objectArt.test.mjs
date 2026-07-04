// test/objectArt.test.mjs — the world-object real-art seam (src/render/objectArt.js).
// Importing it must NOT change the world; it only adds a lookup layer that stays
// empty (procedural) until prop textures are authored + listed in the manifest.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './run.mjs';
import { hasObjectArt, objectArtUrl, objectArtCount } from '../src/render/objectArt.js';

test('object art seam is empty + procedural before any art is loaded', () => {
  eq(objectArtCount(), 0, 'no object art registered on import');
  eq(hasObjectArt('tree'), false, 'unknown object has no art');
});

test('object keys map to the right asset path', () => {
  eq(objectArtUrl('tree'), 'assets/objects/tree.png');
  eq(objectArtUrl('ore'), 'assets/objects/ore.png');
  eq(objectArtUrl('stall'), 'assets/objects/stall.png');
});

test('object manifest.json is well-formed (array of object-key strings)', () => {
  const url = new URL('../assets/objects/manifest.json', import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  assert(Array.isArray(data.objects), 'manifest has an objects array');
  assert(data.objects.every((k) => typeof k === 'string'), 'every listed object-key is a string');
});
