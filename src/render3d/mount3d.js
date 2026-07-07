// ?r3d=1 REAL-3D OVERLAY — render-only, reads the LIVE sim, never writes it.
// Loaded via dynamic import() ONLY when the flag is on, so 2D players never fetch
// three.js and this file stays out of the static import graph (Node smoke never
// parses the CDN `import 'three'`). Renders a WINDOW of the live Game.world as the
// proven /r3d/ low-poly textured heightmap + slope-filled water, with the rigged
// goblin standing/walking at the real Game.player. Everything is wrapped so a bug
// here can never touch the untouched 2D game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TERRAIN_DEFS } from '../world/worldData.js';
import { TILE_SIZE } from '../world/map.js';
import { avatarStateFor } from '../render/characters.js';

const HEIGHT = 13, WIN = 176, TSPX = 12, REBUILD = 40, MARGIN = 6;
const GRASS = new Set([0, 11, 12, 19]), PATH = new Set([3, 6, 7, 20]), WATER = new Set([1, 13, 14]);
const isChanId = id => WATER.has(id) || id === 6;                 // river flows here (+ under bridges)
const FACE = { S: 0, W: Math.PI / 2, N: Math.PI, E: -Math.PI / 2 };

export function mount3d(Game) {
  try { _mount(Game); } catch (e) {
    console.error('[r3d] mount failed', e);
    try {   // surface the failure ON-SCREEN so a broken mount is never a silent black box
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:8px;left:10px;z-index:9;font:12px monospace;color:#ff8a8a;text-shadow:0 1px 2px #000;';
      d.textContent = '3D MOUNT FAILED: ' + ((e && e.message) || e);
      document.body.appendChild(d);
    } catch (_) {}
  }
}

function _mount(Game) {
  const world = Game && Game.world;
  if (!world || !world.terrain || !world.elevation) { console.error('[r3d] no world data'); return; }
  const W = world.W, H = world.H, ter = world.terrain, elev = world.elevation;
  const colors = {};
  for (let id = 0; id < TERRAIN_DEFS.length; id++) {
    const c = TERRAIN_DEFS[id] && TERRAIN_DEFS[id].color;
    colors[id] = typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : '#4a7c3a';
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
  const cv = renderer.domElement; cv.id = 'r3d-canvas'; cv.style.cssText = 'position:fixed;inset:0;z-index:5;';
  document.body.appendChild(cv);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd8e8');
  scene.fog = new THREE.Fog('#a9c7d6', WIN * 0.8, WIN * 1.8);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.1); sun.position.set(-70, 120, -30); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x54633a, 1.05));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const heightAt = (tx, ty) => { tx = Math.max(0, Math.min(W - 1, tx | 0)); ty = Math.max(0, Math.min(H - 1, ty | 0)); return (elev[ty * W + tx] / 255) * HEIGHT; };

  // ---------- windowed terrain (absolute tile coords) ----------
  let terrainMesh = null, waterMesh = null, winCX = -1e9, winCY = -1e9;
  function buildWindow(cx, cy) {
    const x0 = Math.max(0, (cx - WIN / 2) | 0), y0 = Math.max(0, (cy - WIN / 2) | 0);
    const x1 = Math.min(W - 1, x0 + WIN), y1 = Math.min(H - 1, y0 + WIN);
    const w = x1 - x0, h = y1 - y0;
    // --- bake the game's real terrain texture (same detail* logic as main.js) ---
    const cvx = document.createElement('canvas'); cvx.width = w * TSPX; cvx.height = h * TSPX;
    const g2 = cvx.getContext('2d'), S = TSPX / 32;
    const hexInt = s => parseInt(String(s).slice(1), 16);
    const shade = (ci, f) => { const r = (ci >> 16) & 255, gg = (ci >> 8) & 255, b = ci & 255; return 'rgb(' + (Math.min(255, r * f) | 0) + ',' + (Math.min(255, gg * f) | 0) + ',' + (Math.min(255, b * f) | 0) + ')'; };
    const tHash = (x, y) => { let hh = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) ^ 0x9e3779b9; hh = Math.imul(hh ^ (hh >>> 13), 1274126177); return ((hh ^ (hh >>> 16)) >>> 0) / 4294967295; };
    const rc = (x, y, ww, hh) => g2.fillRect(x, y, Math.max(1, ww), Math.max(1, hh));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gx = x0 + i, gy = y0 + j, id = ter[gy * W + gx], hex = colors[id] || '#4a7c3a', ci = hexInt(hex), px = i * TSPX, py = j * TSPX;
      g2.globalAlpha = 1; g2.fillStyle = hex; rc(px, py, TSPX + 1, TSPX + 1);
      if (GRASS.has(id)) { const r = tHash(gx, gy);
        g2.globalAlpha = 0.42; g2.fillStyle = shade(ci, r < 0.5 ? 0.86 : 1.14); rc(px + ((r * 27 * S) | 0), py + (((r * 271) % 27 * S) | 0), 3.4 * S, 3.4 * S);
        if (r > 0.66) { g2.globalAlpha = 0.38; g2.fillStyle = shade(ci, 1.2); rc(px + (((r * 431) % 29) * S | 0), py + (((r * 733) % 26) * S | 0), 1.4 * S, 4.4 * S); }
      } else if (PATH.has(id)) { for (let k = 0; k < 3; k++) { const r = tHash(gx * 5 + k * 31, gy * 7 + k * 17);
        g2.globalAlpha = 0.5; g2.fillStyle = shade(ci, r < 0.5 ? 0.8 : 1.14); rc(px + (3 + (r * 24 | 0)) * S, py + (3 + ((r * 613) % 24)) * S, 3.4 * S, 3.4 * S); }
      } else if (WATER.has(id)) { g2.globalAlpha = 0.28; g2.fillStyle = shade(ci, 1.4); rc(px + 3 * S, py + 13 * S, 26 * S, 1.8 * S);
      } else if (id === 8) { g2.globalAlpha = 0.7; g2.fillStyle = shade(ci, 0.8); for (let fy = 4; fy < 31; fy += 6) rc(px, py + fy * S, TSPX + 1, 1.3 * S);
      } else if (id === 9) { g2.globalAlpha = 0.28; g2.fillStyle = shade(ci, 1.08); rc(px + 2 * S, py + 2 * S, 28 * S, 28 * S); g2.globalAlpha = 0.6; g2.fillStyle = shade(ci, 0.72); rc(px, py, TSPX + 1, 1.3 * S); rc(px, py, 1.3 * S, TSPX + 1);
      } else if (id === 10) { g2.globalAlpha = 1; g2.fillStyle = shade(ci, 0.62); rc(px, py, TSPX + 1, TSPX + 1); g2.globalAlpha = 0.85; g2.fillStyle = shade(ci, 1.15); rc(px + 2 * S, py + 2 * S, 28 * S, 28 * S); }
    }
    g2.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cvx); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // --- mesh (per-tile vertex, absolute tile coords, low-poly facets) ---
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
      const gx = Math.min(W - 1, x0 + i), gy = Math.min(H - 1, y0 + j);
      pos.push(x0 + i, (elev[gy * W + gx] / 255) * HEIGHT, y0 + j); uv.push(i / w, j / h);
    }
    const vw = w + 1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = j * vw + i, b = a + 1, d = (j + 1) * vw + i, e = d + 1; idx.push(a, d, b, b, d, e); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.map.dispose(); terrainMesh.material.dispose(); }
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, flatShading: true })); scene.add(terrainMesh);
    // --- filled river surface over channel tiles at bank-lip minus margin ---
    const wpos = [], wnorm = [], widx = []; let wc = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gx = x0 + i, gy = y0 + j; if (!isChanId(ter[gy * W + gx])) continue;
      let lip = Infinity;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const xx = gx + di, yy = gy + dj; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; if (!isChanId(ter[yy * W + xx])) lip = Math.min(lip, elev[yy * W + xx]); }
      const bed = elev[gy * W + gx], wl = (lip === Infinity ? bed + 18 : lip - MARGIN), y = (Math.max(wl, bed + 2) / 255) * HEIGHT, s = 0.62, x = x0 + i, z = y0 + j;
      wpos.push(x - s, y, z - s, x + s, y, z - s, x + s, y, z + s, x - s, y, z + s); wnorm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); widx.push(wc, wc + 2, wc + 1, wc, wc + 3, wc + 2); wc += 4;
    }
    if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); waterMesh.material.dispose(); waterMesh = null; }
    if (wc) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(wnorm, 3)); wg.setIndex(widx);
      waterMesh = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x3f7fc4, emissive: 0x11365e, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: true })); waterMesh.renderOrder = 2; scene.add(waterMesh); }
    winCX = cx; winCY = cy;
  }

  // ---------- the player goblin (rigged, walk/idle) ----------
  const goblin = new THREE.Group(); scene.add(goblin);
  let mixer = null, walkAction = null;
  new GLTFLoader().load('/r3d/models/goblin_walk.glb', gl => {
    const m = gl.scene, b = new THREE.Box3().setFromObject(m), sz = b.getSize(new THREE.Vector3());
    m.scale.setScalar(2.2 / Math.max(sz.x, sz.y, sz.z));
    const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z); goblin.add(m);   // center X/Z on the group origin, feet on ground
    if (gl.animations && gl.animations.length) { const clip = gl.animations[0];
      clip.tracks = clip.tracks.filter(t => !/head|neck/i.test(t.name));   // steady the tall hood
      mixer = new THREE.AnimationMixer(m); walkAction = mixer.clipAction(clip); walkAction.play();
    }
  }, undefined, e => console.error('[r3d] goblin load failed', e));

  // ---------- camera (manual follow, mirrors the 2D camera's rotation) ----------
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 4000);
  const pol = 58 * Math.PI / 180;
  const camTarget = new THREE.Vector3();
  let inited = false;
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ---------- on-screen status chip: never fly blind — success shows fps, failure shows WHY ----------
  const chip = document.createElement('div');
  chip.id = 'r3d-status';
  chip.style.cssText = 'position:fixed;top:8px;left:10px;z-index:6;font:12px/1.4 monospace;color:#9fe08a;text-shadow:0 1px 2px #000;pointer-events:none;';
  chip.textContent = '3D: mounting…';
  document.body.appendChild(chip);
  const chipErr = (msg) => { chip.style.color = '#ff8a8a'; chip.textContent = '3D ERROR: ' + msg; };

  // ---------- SELF-DRIVING render loop. Deliberately NOT dependent on the game's update()
  // reaching our hook (any early-return there would black-screen us — that bug shipped once).
  // Reads live sim state each frame; renders terrain even before the player exists. ----------
  const clock = new THREE.Clock();
  let frames = 0, lastFps = performance.now(), lastErr = '';
  function step() {
    try {
      const p = Game.player;
      const wx = p ? p.px / TILE_SIZE : winCX, wz = p ? p.py / TILE_SIZE : winCY;
      const wy = heightAt(wx, wz);
      if (Math.abs(wx - winCX) > REBUILD || Math.abs(wz - winCY) > REBUILD) buildWindow(wx | 0, wz | 0);
      const dt = clock.getDelta();
      if (p) {
        goblin.visible = true;
        goblin.position.set(wx, wy, wz);
        let st = null; try { st = avatarStateFor(p, true, performance.now()); } catch (_) {}
        if (st) {
          goblin.rotation.y = (FACE[st.facing] !== undefined ? FACE[st.facing] : 0) + Math.PI;
          if (mixer && walkAction) { const moving = st.anim === 'walk'; walkAction.paused = !moving; if (moving) mixer.update(dt); else { walkAction.time = 0; mixer.update(0); } }
        }
      } else goblin.visible = false;
      const camMain = Game.scene && Game.scene.cameras && Game.scene.cameras.main;
      const az = camMain ? camMain.rotation : 0, zoom = camMain ? (camMain.zoom || 1) : 1;
      const rr = 13 / Math.sqrt(zoom);                           // third-person distance
      const goal = new THREE.Vector3(wx, wy + 1.6, wz);          // aim at the goblin's torso → centered
      if (!inited) { camTarget.copy(goal); inited = true; } else camTarget.lerp(goal, 0.2);
      camera.position.set(wx + Math.sin(az) * rr, wy + rr * 0.7, wz + Math.cos(az) * rr);
      camera.lookAt(camTarget);
      renderer.render(scene, camera);
      frames++; const t = performance.now();
      if (t - lastFps >= 500) { chip.textContent = '3D α · ' + Math.round(frames * 1000 / (t - lastFps)) + ' fps' + (p ? '' : ' · waiting for player…'); frames = 0; lastFps = t; }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (msg !== lastErr) { lastErr = msg; console.error('[r3d] frame error', e); chipErr(msg); }
    }
  }
  renderer.setAnimationLoop(step);

  window.__r3d = {
    frame() {},   // legacy hook from update() — self-driving loop renders now; kept so the guarded call is harmless
    dispose() { try { renderer.setAnimationLoop(null); renderer.dispose(); cv.remove(); chip.remove(); window.__r3d = null; } catch (_) {} }
  };

  const px0 = (Game.player && Game.player.px / TILE_SIZE | 0) || (W >> 1);
  const py0 = (Game.player && Game.player.py / TILE_SIZE | 0) || (H >> 1);
  buildWindow(px0, py0);
  console.log('[r3d] mounted — windowed 3D over live world at', px0, py0);
}
