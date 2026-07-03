#!/usr/bin/env node
// scripts/geo2_preview.mjs — render the OLD stamped world and the NEW geo2 macro
// world as hillshaded map images, for the side-by-side judgment call.
//   node scripts/geo2_preview.mjs new /tmp/new.bmp
//   node scripts/geo2_preview.mjs old /tmp/old.bmp
import { writeFileSync } from 'node:fs';

const mode = process.argv[2] || 'new';
const out = process.argv[3] || `/tmp/geo2_${mode}.bmp`;

// ---- minimal 24bpp BMP writer ----
function writeBMP(path, W, H, px /* Uint8Array RGB row-major top-down */) {
  const rowPad = (4 - ((W * 3) % 4)) % 4, rowSize = W * 3 + rowPad;
  const size = 54 + rowSize * H;
  const b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(W, 18); b.writeInt32LE(H, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < H; y++) {
    const srcY = y, dstRow = 54 + (H - 1 - y) * rowSize; // BMP is bottom-up
    for (let x = 0; x < W; x++) {
      const s = (srcY * W + x) * 3, d = dstRow + x * 3;
      b[d] = px[s + 2]; b[d + 1] = px[s + 1]; b[d + 2] = px[s]; // BGR
    }
  }
  writeFileSync(path, b);
}

const shadeMul = (px, i, m) => { px[i] = Math.min(255, px[i] * m); px[i + 1] = Math.min(255, px[i + 1] * m); px[i + 2] = Math.min(255, px[i + 2] * m); };
const set = (px, i, r, g, b) => { px[i] = r; px[i + 1] = g; px[i + 2] = b; };

if (mode === 'new') {
  const { buildMacro, GW, GH } = await import('../src/world/geo2.js');
  const { T } = await import('../src/world/worldData.js');
  const m = buildMacro(Number(process.env.SEED) || 1337);
  console.log(`geo2: lake ${m.lakeSize} tiles, sites:`, JSON.stringify(m.sites));
  const px = new Uint8Array(GW * GH * 3);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x, p = i * 3, h = m.height[i];
    if (m.water[i] === 1) { const d = Math.max(0, m.seaLevel - h) / m.seaLevel; set(px, p, 36 + 30 * (1 - d), 70 + 40 * (1 - d), 120 + 50 * (1 - d)); continue; }  // sea by depth
    if (m.water[i] === 2) { set(px, p, 52, 96, 150); continue; }   // lake
    if (m.water[i] === 3) { set(px, p, 70, 120, 170); continue; }  // rivers
    if (m.terrain[i] === T.SAND) { set(px, p, 214, 198, 138); }
    else if (m.terrain[i] === T.SWAMP) { set(px, p, 86, 104, 74); }
    else if (m.terrain[i] === T.ROCK) { const t = Math.min(1, (h - 0.6) / 0.35); set(px, p, 110 + 90 * t, 108 + 88 * t, 106 + 92 * t); } // grey→snowcap
    else if (m.forest[i]) { set(px, p, 46, 92, 44); }
    else { const t = Math.exp(-m.waterDist[i] / 70); set(px, p, 150 - 76 * t, 138 - 16 * t, 84 - 22 * t); } // grass: lush near water, dry uplands
    // hillshade: light from the south (matches the game's shadow model)
    if (y < GH - 1) { const dh = m.height[i + GW] - h; shadeMul(px, p, 1 + dh * 26); }
  }
  writeBMP(out, GW, GH, px);
} else {
  const { generateWorld } = await import('../src/world/map.js');
  const { T, TERRAIN_DEFS } = await import('../src/world/worldData.js');
  const w = generateWorld(Number(process.env.SEED) || 1337);
  const px = new Uint8Array(w.W * w.H * 3);
  for (let i = 0; i < w.W * w.H; i++) {
    const c = TERRAIN_DEFS[w.terrain[i]].color, p = i * 3;
    set(px, p, (c >> 16) & 255, (c >> 8) & 255, c & 255);
    if (i + w.W < w.W * w.H) { const dh = (w.elevation[i + w.W] - w.elevation[i]) / 255; shadeMul(px, p, 1 + dh * 10); }
  }
  writeBMP(out, w.W, w.H, px);
}
console.log('wrote', out);
