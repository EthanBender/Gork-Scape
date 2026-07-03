// test/terrainArt.test.mjs — the terrain real-art seam (src/render/terrainArt.js).
// Importing it must NOT change the map; it only adds a lookup layer that stays
// empty (procedural) until ground textures are authored + listed in the manifest.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './run.mjs';
import { hasTerrainArt, terrainArtUrl, terrainArtCount } from '../src/render/terrainArt.js';

test('terrain art seam is empty + procedural before any art is loaded', () => {
  eq(terrainArtCount(), 0, 'no tile art registered on import');
  eq(hasTerrainArt('grass'), false, 'unknown tile has no art');
});

test('terrain tile-keys map to the right asset path', () => {
  eq(terrainArtUrl('grass'), 'assets/terrain/grass.png');
  eq(terrainArtUrl('water'), 'assets/terrain/water.png');
});

test('terrain manifest.json is well-formed and starts empty', () => {
  const url = new URL('../assets/terrain/manifest.json', import.meta.url);
  const data = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  assert(Array.isArray(data.tiles), 'manifest has a tiles array');
  eq(data.tiles.length, 0, 'no tile art listed yet (fully procedural)');
});
