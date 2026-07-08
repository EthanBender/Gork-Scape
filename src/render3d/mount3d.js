// ?r3d=1 REAL-3D OVERLAY — render-only, reads the LIVE sim, never writes it.
// Loaded via dynamic import() ONLY when the flag is on, so 2D players never fetch
// three.js and this file stays out of the static import graph (Node smoke never
// parses the CDN `import 'three'`). Renders a WINDOW of the live Game.world as the
// proven /r3d/ low-poly textured heightmap + slope-filled water, with the rigged
// goblin standing/walking at the real Game.player. Everything is wrapped so a bug
// here can never touch the untouched 2D game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TERRAIN_DEFS } from '../world/worldData.js';
import { TILE_SIZE, objectsInView } from '../world/map.js';
import { avatarStateFor, AV_SCALE } from '../render/characters.js';
import { activeFires, fireLifeRatio } from '../systems/firemaking.js';

const HEIGHT = 13, WIN = 176, TSPX = 12, REBUILD = 40, MARGIN = 6;
const GRASS = new Set([0, 11, 12, 19]), PATH = new Set([3, 6, 7, 20]), WATER = new Set([1, 13, 14]);
const isChanId = id => WATER.has(id) || id === 6;                 // river flows here (+ under bridges)
const FACE = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };  // model rest faces +Z (south); yaw = atan2(dx, dz)

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
  let world = Game && Game.world;
  if (!world || !world.terrain || !world.elevation) { console.error('[r3d] no world data'); return; }
  let W = world.W, H = world.H, ter = world.terrain, elev = world.elevation;
  const colors = {};
  for (let id = 0; id < TERRAIN_DEFS.length; id++) {
    const c = TERRAIN_DEFS[id] && TERRAIN_DEFS[id].color;
    colors[id] = typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : '#4a7c3a';
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));   // phones render fewer pixels
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.32;
  // SHADOWS: a single sun shadow-map grounds everything (nothing floated before).
  // Desktop ON by default (2048 PCFSoft); phones OFF by default to protect the
  // ~35fps the owner approved — opt in with ?shadow=1 (renders 1024 PCF), and
  // desktop can opt out with ?noshadow=1.
  const _qs = typeof location !== 'undefined' ? location.search : '';
  const wantShadow = /[?&]shadow=1/.test(_qs) || (!coarse && !/[?&]noshadow=1/.test(_qs));
  renderer.shadowMap.enabled = wantShadow;
  renderer.shadowMap.type = coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  const cv = renderer.domElement; cv.id = 'r3d-canvas'; cv.style.cssText = 'position:fixed;z-index:5;';
  document.body.appendChild(cv);
  // Fit the 3D canvas over the GAME viewport (the #game-canvas area), not the whole
  // window — so the sidebar/chat/HUD keep their place and nothing spills behind them.
  let vw = innerWidth, vh = innerHeight;
  function fitCanvas() {
    const gc = document.getElementById('game-canvas');
    const r = gc ? gc.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    vw = Math.max(1, r.width | 0); vh = Math.max(1, r.height | 0);
    cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px';
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    renderer.setSize(vw, vh, false);
  }
  fitCanvas();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd8e8');
  scene.fog = new THREE.Fog('#a9c7d6', WIN * 0.8, WIN * 1.8);
  // warm key sun (off-noon so shadows read as form) + cool sky fill + low ambient
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.15); sun.position.set(-70, 120, -30); scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x5a6a3e, 1.0); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.32); scene.add(amb);
  // cool back-rim light (no shadow) opposite the sun — edge separation so the
  // low-poly forms and characters pop off the ground instead of reading flat
  const rim = new THREE.DirectionalLight(0xbcd0ff, 0.55); rim.position.set(70, 55, 60); scene.add(rim);
  // shadow frustum follows the player each frame (see updateSunShadow); the light
  // DIRECTION stays fixed so shadows never swim as you walk.
  const SUN_DIR = new THREE.Vector3(-70, 120, -30).normalize();
  if (wantShadow) {
    sun.castShadow = true;
    const ms = coarse ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    const R = 46;                                        // shadow covers ~92 tiles around the player
    sun.shadow.camera.left = -R; sun.shadow.camera.right = R;
    sun.shadow.camera.top = R; sun.shadow.camera.bottom = -R;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.9;
    scene.add(sun.target);
  }
  const _sunAnchor = new THREE.Vector3();
  function updateSunShadow(px, py, pz) {
    if (!wantShadow) return;
    sun.target.position.set(px, py, pz);
    _sunAnchor.copy(SUN_DIR).multiplyScalar(130).add(sun.target.position);
    sun.position.copy(_sunAnchor);
  }

  // Day/night SCRAPPED (owner call 2026-07-08: "just scrap day night, day is
  // fine") — permanent clear daylight outdoors; interiors keep a steady warm
  // torch tint. The 2D daylight film stays hidden while 3D runs.
  const dlFilm = document.getElementById('daylight-overlay');
  if (dlFilm) dlFilm.style.display = 'none';
  const BASE = { sky: new THREE.Color('#bcd8e8'), fog: new THREE.Color('#a9c7d6'),
    sun: new THREE.Color(0xfff4e0), hemiSky: new THREE.Color(0xdcecff), hemiGnd: new THREE.Color(0x54633a), amb: new THREE.Color(0xffffff) };
  const tintC = new THREE.Color(), tint2 = new THREE.Color();
  let lastIndoor = null;
  function daylight3d() {
    const indoor = !!(Game.world && Game.world.interior);
    if (indoor === lastIndoor) return; lastIndoor = indoor;
    const c = indoor ? [205, 180, 150] : [255, 255, 255];   // torch-lit interiors / clear day
    tintC.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    tint2.copy(tintC).multiply(tintC);                 // squared for the LIGHTS: tonemapping washes a single multiply out
    if (indoor) {                                       // beyond a cave's edge is DARKNESS, not blue sky
      scene.background.set(0x141008); scene.fog.color.set(0x1a140c);
    } else {
      scene.background.copy(BASE.sky).multiply(tintC);  // sky keeps the softer single tint
      scene.fog.color.copy(BASE.fog).multiply(tintC);
    }
    sun.color.copy(BASE.sun).multiply(tint2);
    hemi.color.copy(BASE.hemiSky).multiply(tint2); hemi.groundColor.copy(BASE.hemiGnd).multiply(tint2);
    amb.color.copy(BASE.amb).multiply(tint2);
  }

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
      } else if (id === 9) { g2.globalAlpha = 0.22; g2.fillStyle = shade(ci, 1.1); rc(px + 2 * S, py + 2 * S, 28 * S, 28 * S); g2.globalAlpha = 0.28; g2.fillStyle = shade(ci, 0.9); rc(px, py, TSPX + 1, 1.3 * S); rc(px, py, 1.3 * S, TSPX + 1);   // clean stone foundation pad (soft seam, not a dark bevel)
      } else if (id === 10) { g2.globalAlpha = 1; g2.fillStyle = shade(ci, 0.62); rc(px, py, TSPX + 1, TSPX + 1); g2.globalAlpha = 0.85; g2.fillStyle = shade(ci, 1.15); rc(px + 2 * S, py + 2 * S, 28 * S, 28 * S); }
    }
    g2.globalAlpha = 1;
    // bake the flat 'decor' scatter into the ground texture — the 62k tiny
    // ground details (ruts, rugs, tufts, hay, the great-hall carpet) that the
    // 2D renderer draws as sprites; the 3D prop pass skips them, so without
    // this bake none of them exist in the 3D view at all.
    for (const o of objectsInView(world, x0, y0, x1, y1)) {
      if (o.type !== 'decor' || o.mush) continue;
      if (o.x < x0 || o.x >= x1 || o.y < y0 || o.y >= y1) continue;
      const dpx = (o.x - x0) * TSPX + TSPX / 2, dpy = (o.y - y0) * TSPX + TSPX / 2;
      const rad = Math.min(14, o.size || 4) * S;
      g2.globalAlpha = 0.85; g2.fillStyle = '#' + (o.color || 0x3f6e2c).toString(16).padStart(6, '0');
      if (o.shape === 'rect') g2.fillRect(dpx - rad, dpy - rad, rad * 2, rad * 2);
      else { g2.beginPath(); g2.arc(dpx, dpy, rad, 0, Math.PI * 2); g2.fill(); }
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
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, flatShading: true })); terrainMesh.receiveShadow = true; scene.add(terrainMesh);
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
    buildWalls(x0, y0, x1, y1);                          // raised wall blocks follow the window
    propBounds = { x0, y0, x1, y1 }; buildProps();      // props follow the terrain window
  }

  // ---------- the player goblin (rigged, walk/idle) ----------
  const goblin = new THREE.Group(); scene.add(goblin);
  let mixer = null, walkAction = null, animRoot = null;
  const gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder);   // compressed models (~95% smaller)
  gltf.load('/r3d/models/opt/goblin_walk.glb', gl => {
    const m = gl.scene, b = new THREE.Box3().setFromObject(m), sz = b.getSize(new THREE.Vector3());
    // player goblin ~1.6 tiles tall — a person, not a landmark. Buildings (below)
    // are 3.8-5.5 so a house properly DWARFS the goblin (owner: "goblin as big as
    // a house"). NPC bodies load at ~1.5 so player + crowd read the same height.
    m.scale.setScalar(1.65 / Math.max(sz.x, sz.y, sz.z));
    const b2 = new THREE.Box3().setFromObject(m);
    m.position.y = -b2.min.y; goblin.add(m); animRoot = m;    // feet on ground; x/z zeroed per-frame (root motion)
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });  // the player casts a shadow
    if (gl.animations && gl.animations.length) { const clip = gl.animations[0];
      clip.tracks = clip.tracks.filter(t => !/head|neck/i.test(t.name));   // steady the tall hood
      // NOTE: the meshopt/optimized goblin breaks its rig (scale tracks + bind units) —
      // player model stays the original GLB until the skinned-compression pass is solved.
      mixer = new THREE.AnimationMixer(m); walkAction = mixer.clipAction(clip); walkAction.play();
    }
    // Re-parent the gear sockets from the static group offsets onto the actual
    // hand bones so weapons/shields ride the walk swing instead of floating.
    // Socket scale compensates the bone chain's world scale so gear builders
    // keep working in world units.
    m.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    const rh = m.getObjectByName('RightHand'), lf = m.getObjectByName('LeftForeArm') || m.getObjectByName('LeftHand');
    if (rh) {
      rh.add(handSocket);
      rh.getWorldScale(ws); handSocket.scale.setScalar(1 / (ws.x || 1));
      // +Y blade along the fingers, tilted back off vertical so an idle sword
      // rests down-and-forward beside the leg instead of skewering it
      handSocket.position.set(0, 0.02, 0); handSocket.rotation.set(Math.PI / 2 - 0.55, 0, 0.18);
    }
    if (lf) {
      lf.add(shieldSocket);
      lf.getWorldScale(ws); shieldSocket.scale.setScalar(1 / (ws.x || 1));
      // strapped to the OUTSIDE of the forearm, face outward so it reads from the camera
      shieldSocket.position.set(0.16, 0.08, 0); shieldSocket.rotation.set(0, Math.PI / 2, Math.PI / 2);
    }
    const sp = m.getObjectByName('Spine02') || m.getObjectByName('Spine01');
    if (sp) {
      sp.add(torsoSocket);
      sp.getWorldScale(ws); torsoSocket.scale.setScalar(1 / (ws.x || 1));
      torsoSocket.position.set(0, 0.02, 0); torsoSocket.rotation.set(0, 0, 0);
    }
  }, undefined, e => console.error('[r3d] goblin load failed', e));

  // ---------- world objects: instanced clay props tinted from each object's own colour.
  // Trees/ore/fishing spots/structures from objectsInView; tiny 'decor' scatter is
  // skipped (the baked ground texture already carries it). Rebuilt with the terrain
  // window and every 2s so depleted trees vanish and respawns reappear. ----------
  const P_CAP = { leaf: 4096, trunk: 4096, dead: 512, rock: 512, base: 1024, roof: 1024, fence: 768, fish: 256, mcap: 512 };
  const P_GEO = {
    leaf: new THREE.ConeGeometry(1.05, 2.0, 7),
    trunk: new THREE.CylinderGeometry(0.16, 0.22, 1.0, 6),
    dead: new THREE.CylinderGeometry(0.12, 0.2, 1.5, 6),
    rock: new THREE.DodecahedronGeometry(0.55, 0),
    base: new THREE.BoxGeometry(1.2, 1.1, 1.2),
    roof: new THREE.ConeGeometry(1.05, 0.8, 4),
    fence: new THREE.BoxGeometry(0.9, 0.55, 0.14),
    fish: new THREE.RingGeometry(0.18, 0.34, 12),
    mcap: new THREE.SphereGeometry(0.95, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2),   // giant toadstool cap
  };
  const props = {};
  for (const k of Object.keys(P_GEO)) {
    const m = new THREE.InstancedMesh(P_GEO[k], new THREE.MeshLambertMaterial({ flatShading: true, ...(k === 'fish' ? { transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false } : {}) }), P_CAP[k]);
    m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (k !== 'fish') { m.castShadow = true; m.receiveShadow = true; }   // props cast + catch shadows
    scene.add(m); props[k] = m;
  }
  // ---------- raised WALL blocks: town / keep / camp / ruin perimeters (T.WALL
  // tiles) stand UP as clean flat stone instead of being painted flat on the
  // ground. Rebuilt per terrain window. (Owner: "you don't have walls up.") ----
  const WALL_CAP = 6000, WALLH = 1.9, WALL_ID = 10;
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1, 1.02),
    new THREE.MeshLambertMaterial({ flatShading: true }), WALL_CAP);
  wallMesh.count = 0; wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); wallMesh.castShadow = true; wallMesh.receiveShadow = true; scene.add(wallMesh);
  const wallM = new THREE.Matrix4(), wallP = new THREE.Vector3(), wallS = new THREE.Vector3(), wallQ = new THREE.Quaternion(), wallC = new THREE.Color();
  // Only LARGE wall enclosures stand up (town perimeter, the keep, the training
  // yard). Individual buildings are floor+wall rooms in the 2D data with a
  // structure marker inside — in 3D the house MODEL is the building, so its
  // little wall ring must NOT raise or every house sits boxed in stone. Flood-
  // fill wall components once per world; raise only those spanning >=12 tiles.
  function bigWallMask(wrld) {
    if (wrld._bigWallMask) return wrld._bigWallMask;
    const t = wrld.terrain, ww = wrld.W, hh = wrld.H, N = ww * hh;
    const mask = new Uint8Array(N), seen = new Uint8Array(N), stack = [];
    for (let i = 0; i < N; i++) {
      if (t[i] !== WALL_ID || seen[i]) continue;
      stack.length = 0; stack.push(i); seen[i] = 1; const comp = [i];
      let x0c = 1e9, x1c = -1, y0c = 1e9, y1c = -1;
      while (stack.length) {
        const c = stack.pop(), cx = c % ww, cy = (c - cx) / ww;
        if (cx < x0c) x0c = cx; if (cx > x1c) x1c = cx; if (cy < y0c) y0c = cy; if (cy > y1c) y1c = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
          const ni = ny * ww + nx; if (seen[ni] || t[ni] !== WALL_ID) continue;
          seen[ni] = 1; stack.push(ni); comp.push(ni);
        }
      }
      if (Math.max(x1c - x0c, y1c - y0c) >= 12) for (const ci of comp) mask[ci] = 1;
    }
    wrld._bigWallMask = mask;
    return mask;
  }
  function buildWalls(x0, y0, x1, y1) {
    const mask = bigWallMask(world);
    let n = 0;
    for (let gy = y0; gy <= y1 && n < WALL_CAP; gy++) for (let gx = x0; gx <= x1 && n < WALL_CAP; gx++) {
      if (ter[gy * W + gx] !== WALL_ID || !mask[gy * W + gx]) continue;
      const gh = (elev[gy * W + gx] / 255) * HEIGHT;
      wallP.set(gx + 0.5, gh + WALLH / 2, gy + 0.5); wallS.set(1, WALLH, 1);
      wallM.compose(wallP, wallQ, wallS); wallMesh.setMatrixAt(n, wallM);
      const v = 0.92 + 0.1 * (((gx * 7 + gy * 13) % 5) / 5);   // subtle per-tile shade
      wallC.setRGB(0.55 * v, 0.52 * v, 0.47 * v); wallMesh.setColorAt(n, wallC);
      n++;
    }
    wallMesh.count = n; wallMesh.instanceMatrix.needsUpdate = true;
    if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
  }
  // real generated models for the numerous props: load compressed GLBs, normalize
  // (feet at y=0, ~unit height), and swap them into the instancing in place of the
  // procedural cones — the whole forest becomes the owner's actual tree model.
  function instanceGLB(url, kind, cap, targetH) {
    const ld = new GLTFLoader(); ld.setMeshoptDecoder(MeshoptDecoder);
    ld.load(url, gl => {
      let best = null;
      gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(o => { if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
      if (!best) return;
      const geo = best.geometry.clone(); geo.applyMatrix4(best.matrixWorld);
      geo.computeBoundingBox(); const bb = geo.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
      const s = targetH / (size.y || 1), c = new THREE.Vector3(); bb.getCenter(c);
      geo.translate(-c.x, -bb.min.y, -c.z); geo.scale(s, s, s);
      const m = new THREE.InstancedMesh(geo, best.material, cap);
      m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      P_CAP[kind] = cap; props[kind] = m;
      buildProps();                                        // re-lay props with the real model
    }, undefined, e => console.error('[r3d] prop model failed', url, e));
  }
  // Clean CUTE buildings: load an UNTEXTURED preview mesh and paint flat 2-tone
  // vertex colours by height (walls below, roof above roofFrac) — clean low-poly,
  // no muddy photo texture. This is the look the owner wants ("clean low poly
  // cute like the goblin"); it replaces the muddy textured building GLBs.
  function instanceGLBClean(url, kind, cap, targetH, wallHex, roofHex, roofFrac) {
    const ld = new GLTFLoader(); ld.setMeshoptDecoder(MeshoptDecoder);
    ld.load(url, gl => {
      let best = null; gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(o => { if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
      if (!best) return;
      const geo = best.geometry.clone(); geo.applyMatrix4(best.matrixWorld);
      geo.computeBoundingBox(); const bb = geo.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
      const s = targetH / (size.y || 1), c = new THREE.Vector3(); bb.getCenter(c);
      geo.translate(-c.x, -bb.min.y, -c.z); geo.scale(s, s, s);
      geo.computeBoundingBox(); const h2 = geo.boundingBox.max.y, cut = h2 * roofFrac;
      const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
      const wc = new THREE.Color(wallHex), rc = new THREE.Color(roofHex);
      for (let vi = 0; vi < pos.count; vi++) { const col = pos.getY(vi) >= cut ? rc : wc; cols[vi * 3] = col.r; cols[vi * 3 + 1] = col.g; cols[vi * 3 + 2] = col.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }), cap);
      m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      P_CAP[kind] = cap; props[kind] = m;
      buildProps();
    }, undefined, e => console.error('[r3d] clean model failed', url, e));
  }
  instanceGLB('/r3d/models/opt/tree.glb', 'treeG', 4096, 2.4);
  instanceGLB('/r3d/models/opt/bush.glb', 'bushG', 1024, 0.9);
  // town models: label-matched structures render as the real generated pieces
  instanceGLB('/r3d/models/opt/fence.glb', 'fenceG', 768, 0.7);
  instanceGLB('/r3d/models/opt/barrel.glb', 'barrelG', 256, 0.8);
  instanceGLB('/r3d/models/opt/crate.glb', 'crateG', 256, 0.7);
  instanceGLB('/r3d/models/opt/chest.glb', 'chestG', 128, 0.6);
  instanceGLB('/r3d/models/opt/campfire.glb', 'campfireG', 128, 0.5);
  instanceGLB('/r3d/models/opt/signpost.glb', 'signG', 256, 1.6);
  // species trees + the tall wilderness landmark (models from the batch-2 gen;
  // graceful fallback to treeG / clay box until each file exists)
  instanceGLB('/r3d/models/opt/willow.glb', 'willowG', 2048, 2.6);
  instanceGLB('/r3d/models/opt/oak.glb', 'oakG', 2048, 3.0);
  instanceGLB('/r3d/models/opt/anvil.glb', 'anvilG', 64, 0.9);
  // CLEAN cute buildings (untextured previews, flat 2-tone by height) — replaces
  // the muddy textured cottage/hut/stall/tower/well. wallHex, roofHex, roofFrac.
  instanceGLBClean('/r3d/models/opt/cottage_clean.glb', 'cottageG', 256, 4.6, 0xe6d2a8, 0xc25a3c, 0.55);
  instanceGLBClean('/r3d/models/opt/hut_clean.glb', 'hutG', 256, 3.8, 0xceb488, 0xd8b256, 0.5);
  instanceGLBClean('/r3d/models/opt/stall_clean.glb', 'stallG', 128, 2.9, 0xc39a5e, 0xcf4d3c, 0.55);
  instanceGLBClean('/r3d/models/opt/tower_clean.glb', 'towerG', 64, 5.5, 0xb99162, 0x9a6b3e, 0.7);
  instanceGLBClean('/r3d/models/opt/well_clean.glb', 'wellG', 64, 1.9, 0xb4aca0, 0x8a6a48, 0.62);
  // first regex match wins; anything unmatched stays the tinted clay box+roof.
  // third value = scale class: minor scatter renders SMALL so hay piles / dropped
  // packs read as ground clutter, not full furniture dumped on the road.
  // fourth value = facing: 'row' = uniform (market aisles read aligned),
  // 'cardinal' = snap to N/S/E/W (grid-town buildings), default = free random.
  // fifth value = tint multiplied over the texture: the barrel's pale rim +
  // dark open top reads as an EYEBALL from the game camera — warm it to wood.
  // Intentionally UNMAPPED (tinted box is correct): unique quest landmarks
  // (Throne of Gorkholm, gates, caves, Boss Arena, Boat to Lake Island...) and
  // creature-ambush POIs (Feral Hog, Wild Goblin, Root Horror...) — no static
  // prop honestly represents them; do not add rows for these.
  const STRUCT_MODELS = [
    [/Barrel/i, 'barrelG', 0.75, null, 0xb9885a],
    [/Cauldron|Cookpot/i, 'campfireG', 0.8],
    [/Campfire|Fire/i, 'campfireG', 1],
    [/Anvil|Furnace|Forge|Smith/i, 'anvilG', 1, 'cardinal'],
    [/Well\b/i, 'wellG', 1, 'cardinal'],
    [/Bench|Cart\b|Table\b|Wagon|Trough|Wreck|Debris|Golem|Midden/i, 'crateG', 0.6],
    [/Lamp|Cross\b|Dummy|Banner/i, 'signG', 0.9, 'cardinal'],
    [/Exchange/i, 'stallG', 1.25, 'row'],
    [/Fishmonger|Bait|Tackle/i, 'stallG', 1, 'row'],
    [/Stall|Market|Store|Shop|Trader/i, 'stallG', 1, 'row'],
    [/Sawmill|Fletcher|Grocer|Herbalist|Shed\b|Kiln|Cooking Range/i, 'hutG', 1, 'cardinal'],
    [/Watchtower|Guard Tower|Lookout/i, 'towerG', 1, 'cardinal'],
    [/Chest|Stash|Cache|Hoard|Coffer|Strongbox/i, 'chestG', 0.7, 'cardinal'],
    [/Dropped|Pile|Heap/i, 'crateG', 0.45],
    [/Crate|Box|Pack/i, 'crateG', 0.7],
    [/Sign/i, 'signG', 1, 'cardinal'],
    [/Hut|Tent|Blind|Shack|Lean-to/i, 'hutG', 1, 'cardinal'],
    [/Cottage|House|Home|Bank|Hall|Inn|Tavern/i, 'cottageG', 1, 'cardinal'],
    // wayfinding vocabulary: shrines/milestones/boards read as upright markers,
    // restoring the road-rhythm the boxes erased
    [/Shrine|Idol|Totem|Obelisk|Milestone|Standing Stone|Boundary Stone|Prayer Stone|\bBoard\b|\bPost\b|Scarecrow/i, 'signG', 1, 'cardinal'],
    [/Grave|Tomb|Headstone/i, 'signG', 0.85, 'cardinal'],   // gravestone = upright slab
    [/Sack|Bale|\bBin\b|Compost/i, 'crateG', 0.6],          // farm sacks / bales / bins
    // gardens/meadows/farm nodes: flat vegetation, NOT architecture
    [/\b(Patch|Garden|Meadow|Planter|Bed)\b/i, 'bushG', 0.55],
    // animal homes: a half-buried earth mound, not a cabin
    [/\b(Nest|Den|Burrow|Warren|Sett|Wallow|Beehive)\b|Owl Hollow/i, 'rock', 0.55, null, 0x8a6f4f],
    [/\bRack\b|Skinning Frame/i, 'fenceG', 0.8, 'cardinal'],
  ];
  const pM = new THREE.Matrix4(), pP = new THREE.Vector3(), pS = new THREE.Vector3(), pC = new THREE.Color();
  const pQ0 = new THREE.Quaternion(), pQflat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const hash01 = (x, y) => { let h = (Math.imul(x, 668265263) + Math.imul(y, 374761393)) >>> 0; return ((h ^ (h >>> 13)) % 1000) / 1000; };
  let propBounds = null, lastPropBuild = 0;
  function put(kind, x, z, y, sx, sy, sz, color, rotY) {
    const m = props[kind]; if (m.count >= P_CAP[kind]) return;
    pP.set(x, y, z); pS.set(sx, sy, sz);
    const q = kind === 'fish' ? pQflat : pQ0.setFromEuler(new THREE.Euler(0, rotY || 0, 0));
    pM.compose(pP, q, pS); m.setMatrixAt(m.count, pM);
    pC.set(color); m.setColorAt(m.count, pC);
    m.count++;
  }
  function buildProps() {
    if (!propBounds) return;
    for (const k of Object.keys(props)) props[k].count = 0;
    const list = objectsInView(world, propBounds.x0, propBounds.y0, propBounds.x1, propBounds.y1);
    for (const o of list) {
      // giant toadstools are BLOCKING decor (they're in the collision grid) —
      // skipping them left invisible walls all over the Mushroom Forest
      if (o.type === 'decor' && o.mush === 'giant') {
        const mx = o.x + 0.5, mz = o.y + 0.5;
        const my = Math.min(heightAt(o.x, o.y), heightAt(o.x + 1, o.y), heightAt(o.x, o.y + 1), heightAt(o.x + 1, o.y + 1));
        const ms2 = (o.size || 17) / 17;
        put('trunk', mx, mz, my + 0.55 * ms2, ms2 * 0.9, ms2 * 1.2, ms2 * 0.9, 0xd8cfc0, 0);
        put('mcap', mx, mz, my + 1.05 * ms2, ms2 * 1.15, ms2, ms2 * 1.15, o.color || 0xc44a6a, 0);
        continue;
      }
      if (o.type === 'decor' || o.depleted) continue;
      if (o.x < propBounds.x0 || o.x > propBounds.x1 || o.y < propBounds.y0 || o.y > propBounds.y1) continue;
      const x = o.x + 0.5, z = o.y + 0.5, lbl = o.label || '', col = o.color || 0x8a7a5a;
      // seat props at the LOWEST corner of their tile so nothing floats on a slope
      const y = Math.min(heightAt(o.x, o.y), heightAt(o.x + 1, o.y), heightAt(o.x, o.y + 1), heightAt(o.x + 1, o.y + 1));
      const r = hash01(o.x, o.y), rot = r * Math.PI * 2;
      if (o.skill === 'Fishing') { put('fish', x, z, y + 0.06, 1, 1, 1, 0x9fd4ff); continue; }
      // minerals: word-bounded metal names + the gathering-node vocabulary (seams,
      // veins, geodes...); exclusions keep Iron Lamp / Iron Bars / Deposit Box out
      if (o.skill === 'Mining' || (/\b(Coal|Iron|Gold|Copper|Tin|Rock)\b|Node\b|Seam|Vein|Geode|Deposit|Outcrop|Boulder|Crag|Lode\b|Crust|Vent\b|Seep/.test(lbl) && !/Lamp|Bars|Crab|Box\b/i.test(lbl))) { const s = 0.8 + r * 0.5; put('rock', x, z, y + 0.28 * s, s, s * 0.8, s, col, rot); continue; }
      if (/Dead Tree|Lightning-Struck|Dead Stump/.test(lbl)) { put('dead', x, z, y + 0.75, 1, 1, 1, 0x5a4a38, rot); continue; }
      if (/Bush|Hedge|Thicket|Copse/.test(lbl)) {
        const s = 0.8 + r * 0.5;
        if (props.bushG) put('bushG', x, z, y, s, s, s, 0xffffff, rot);
        else { put('leaf', x, z, y + 0.55 * s, s * 0.55, s * 0.55, s * 0.55, col, rot); }
        continue;
      }
      if (o.skill === 'Woodcutting' || /Tree|Willow|Oak/.test(lbl)) {
        const big = /Oak/.test(lbl) ? 1.35 : /Willow/.test(lbl) ? 1.15 : 1.0;
        const s = big * (0.85 + r * 0.35);
        // species-accurate trees when their models are in: oaks broad, willows weeping
        const tk = /Oak/.test(lbl) && props.oakG ? 'oakG' : /Willow/.test(lbl) && props.willowG ? 'willowG' : 'treeG';
        if (props[tk]) { put(tk, x, z, y, s, s, s, 0xffffff, rot); continue; }
        put('trunk', x, z, y + 0.5 * s, s, s, s, 0x6b4a2a, rot);
        put('leaf', x, z, y + (1.0 + 1.0) * s * 0.95, s, s, s, col, rot);
        continue;
      }
      if (/Fence|Hedge Row|Rail/.test(lbl)) {
        const fRot = rot < Math.PI ? 0 : Math.PI / 2;
        if (props.fenceG) put('fenceG', x, z, y, 1, 1, 1, 0xffffff, fRot);
        else put('fence', x, z, y + 0.3, 1, 1, 1, col, fRot);
        continue;
      }
      if (o.type === 'structure') {
        let placed = false;
        for (const [re, kind, ms, face, tint] of STRUCT_MODELS) {
          if (re.test(lbl) && props[kind]) {
            const s = ms * (0.92 + r * 0.16);
            const rr = face === 'row' ? 0 : face === 'cardinal' ? Math.round(rot / (Math.PI / 2)) * (Math.PI / 2) : rot;
            put(kind, x, z, y, s, s, s, tint || 0xffffff, rr); placed = true; break;
          }
        }
        if (placed) continue;
        const tall = o.blocking ? 1 : 0.55, s = 0.9 + r * 0.25;
        put('base', x, z, y + 0.55 * tall * s, s, tall * s, s, col, 0);
        if (o.blocking) put('roof', x, z, y + (1.1 * s) + 0.4 * s, s * 1.1, s, s * 1.1, 0x7a5a40, Math.PI / 4);
        continue;
      }
    }
    for (const k of Object.keys(props)) { props[k].instanceMatrix.needsUpdate = true; if (props[k].instanceColor) props[k].instanceColor.needsUpdate = true; }
    lastPropBuild = performance.now();
  }

  // ---------- NPCs, monsters & other players: pooled low-poly clay bodies. One shared
  // geometry set; per-creature tint from the SAME avatarStateFor state the 2D uses
  // (skin colour, bodyType silhouette, size incl. boss footprint, walk/attack/hit). ----
  const AG = {
    torso: new THREE.CapsuleGeometry(0.32, 0.5, 3, 8),
    head: new THREE.SphereGeometry(0.24, 10, 8),
    ball: new THREE.SphereGeometry(0.4, 10, 8),
    leg: new THREE.CylinderGeometry(0.07, 0.09, 0.34, 6),
    wing: new THREE.BoxGeometry(0.5, 0.05, 0.22),
    dome: new THREE.SphereGeometry(0.45, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  const matCache = new Map();
  const matFor = (hex) => { let m = matCache.get(hex); if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); matCache.set(hex, m); } return m; };

  // real creature bodies per silhouette: generated clay meshes tinted by each
  // creature's own colour (untextured on purpose — the tint system does the work).
  // Humanoid NPCs use the textured base goblin. Procedural shapes remain the
  // pre-load fallback; existing actors rebuild when a body model arrives.
  const bodyGLB = {};
  function loadBody(url, type, targetH, textured, yOff = 0) {
    const ld = new GLTFLoader(); ld.setMeshoptDecoder(MeshoptDecoder);
    ld.load(url, gl => {
      let best = null; gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(o => { if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
      if (!best) return;
      const geo = best.geometry.clone(); geo.applyMatrix4(best.matrixWorld);
      geo.computeBoundingBox(); const bb = geo.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
      const s = targetH / (size.y || 1), c = new THREE.Vector3(); bb.getCenter(c);
      geo.translate(-c.x, -bb.min.y, -c.z); geo.scale(s, s, s);
      bodyGLB[type] = { geo, mat: textured ? best.material : null, yOff };
      for (const [, a] of actorPool) scene.remove(a.g); actorPool.clear();
    }, undefined, e => console.error('[r3d] body model failed', url, e));
  }
  loadBody('/r3d/models/opt/wolf.glb', 'quadruped', 0.95, false);
  loadBody('/r3d/models/opt/spider.glb', 'insectoid', 0.6, false);
  loadBody('/r3d/models/opt/bat.glb', 'avian', 0.85, false, 0.55);
  loadBody('/r3d/models/opt/snake.glb', 'serpent', 0.55, false);
  loadBody('/r3d/models/opt/slime.glb', 'blob', 0.6, false);
  loadBody('/r3d/models/opt/npc_goblin.glb', 'humanoid', 1.5, true);
  // species-accurate bodies: a rat shouldn't wear the wolf mesh. Name-keyed,
  // checked before the bodyType fallback; missing files just fall through.
  loadBody('/r3d/models/opt/rat.glb', 'rat', 0.55, false);
  loadBody('/r3d/models/opt/boar.glb', 'boar', 0.8, false);
  loadBody('/r3d/models/opt/frog.glb', 'frog', 0.45, false);
  loadBody('/r3d/models/opt/crab.glb', 'crab', 0.5, false);
  loadBody('/r3d/models/opt/bandit.glb', 'bandit', 1.5, false);
  loadBody('/r3d/models/opt/bug.glb', 'bug', 0.55, false);
  const SPECIES_GLB = [
    [/\brat\b/i, 'rat'],
    [/boar|\bhog\b|\bpig\b/i, 'boar'],
    [/frog|toad/i, 'frog'],
    [/crab/i, 'crab'],
    [/bandit|brigand|outlaw|cutpurse/i, 'bandit'],
    [/\bbug\b|beetle|grub\b/i, 'bug'],
  ];
  function makeActor(bodyType, skin, name = '') {
    const g = new THREE.Group();
    let real = null;
    for (const [re, key] of SPECIES_GLB) { if (re.test(name) && bodyGLB[key]) { real = bodyGLB[key]; break; } }
    real = real || bodyGLB[bodyType];
    if (real) { const me = new THREE.Mesh(real.geo, real.mat || matFor(skin)); me.position.y = real.yOff; me.castShadow = true; g.add(me); return g; }
    const m = matFor(skin); const dark = matFor((skin >> 1) & 0x7f7f7f);
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.scale.set(sx, sy, sz); g.add(me); return me; };
    switch (bodyType) {
      case 'quadruped': add(AG.ball, m, 0, 0.55, 0, 1.35, 0.75, 0.85); add(AG.head, m, 0, 0.75, 0.62);
        add(AG.leg, dark, 0.22, 0.18, 0.3); add(AG.leg, dark, -0.22, 0.18, 0.3); add(AG.leg, dark, 0.22, 0.18, -0.3); add(AG.leg, dark, -0.22, 0.18, -0.3); break;
      case 'insectoid': add(AG.ball, m, 0, 0.4, -0.1, 1.15, 0.5, 1.35); add(AG.head, dark, 0, 0.45, 0.6, 0.8, 0.8, 0.8); break;
      case 'avian': add(AG.ball, m, 0, 1.0, 0, 0.7, 0.6, 0.8); add(AG.wing, dark, 0.42, 1.05, 0); add(AG.wing, dark, -0.42, 1.05, 0); add(AG.head, m, 0, 1.3, 0.3, 0.7, 0.7, 0.7); break;
      case 'serpent': add(AG.ball, m, 0, 0.3, 0.35, 0.8, 0.55, 0.8); add(AG.ball, m, 0, 0.28, -0.15, 0.65, 0.45, 0.7); add(AG.ball, dark, 0, 0.26, -0.55, 0.5, 0.35, 0.55); add(AG.head, m, 0, 0.5, 0.65, 0.9, 0.9, 0.9); break;
      case 'blob': add(AG.dome, m, 0, 0.05, 0, 1.1, 1.0, 1.1); break;
      default: add(AG.torso, m, 0, 0.75, 0); add(AG.head, m, 0, 1.35, 0.02);  // humanoid (incl. other players)
        add(AG.leg, dark, 0.14, 0.17, 0); add(AG.leg, dark, -0.14, 0.17, 0); break;
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });   // procedural bodies cast too
    return g;
  }
  const actorPool = new Map();   // npc object -> { g, lastX, lastZ, yaw }
  let npcShown = 0;

  // ---------- floating labels + HP bars (DOM, projected from 3D each frame):
  // enemies show name+bar when hurt/aggroed, other players always show their name,
  // and whatever the mouse is over shows its name — OSRS-style readability. ----------
  const labelLayer = document.createElement('div');
  labelLayer.id = 'r3d-labels';
  labelLayer.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;overflow:hidden;';
  document.body.appendChild(labelLayer);
  const labelPool = [];
  const getLabel = (i) => {
    let L = labelPool[i];
    if (!L) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);font:600 11px monospace;color:#ffe97a;text-shadow:0 1px 2px #000,0 0 3px #000;text-align:center;white-space:nowrap;';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:4px;width:42px;background:#551111;border-radius:2px;margin:2px auto 0;overflow:hidden;display:none;';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:100%;background:#33cc33;';
      bar.appendChild(fill); el.appendChild(bar);
      const txt = document.createElement('span'); el.insertBefore(txt, bar);
      labelLayer.appendChild(el);
      L = { el, txt, bar, fill }; labelPool[i] = L;
    }
    return L;
  };
  let hoverNpc = null, lastHoverCheck = 0;
  const projV = new THREE.Vector3();
  function updateLabels3d() {
    const r = cv.getBoundingClientRect();
    // hover pick (throttled): which actor is under the mouse?
    const now = performance.now();
    if (mouseX >= 0 && now - lastHoverCheck > 120) {
      lastHoverCheck = now;
      ndc.x = ((mouseX - r.left) / r.width) * 2 - 1;
      ndc.y = -((mouseY - r.top) / r.height) * 2 + 1;
      if (ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1) {
        ray.setFromCamera(ndc, camera);
        const groups = []; for (const [, a] of actorPool) groups.push(a.g);
        const hits = ray.intersectObjects(groups, true);
        hoverNpc = null;
        if (hits.length) { let o = hits[0].object; while (o && !o.userData.npc) o = o.parent; hoverNpc = o ? o.userData.npc : null; }
      } else hoverNpc = null;
    }
    let li = 0;
    for (const [n, a] of actorPool) {
      if (li >= 24) break;
      const isPlayerType = n.type === 'player';
      const hurt = n.type === 'guard' && n.maxHp && (n.hp < n.maxHp || n.target);
      const show = hurt || isPlayerType || n === hoverNpc;
      if (!show) continue;
      projV.setFromMatrixPosition(a.g.matrixWorld); projV.y += 2.1 * a.g.scale.y;
      projV.project(camera);
      if (projV.z > 1 || projV.x < -1 || projV.x > 1 || projV.y < -1 || projV.y > 1) continue;
      const L = getLabel(li++);
      L.el.style.left = (r.left + (projV.x + 1) / 2 * r.width) + 'px';
      L.el.style.top = (r.top + (1 - projV.y) / 2 * r.height) + 'px';
      L.el.style.display = 'block';
      L.txt.textContent = n.combatLevel && !isPlayerType ? `${n.name} (Lv ${n.combatLevel})` : (n.name || '');
      L.txt.style.color = isPlayerType ? '#9fd4ff' : '#ffe97a';
      if (hurt) { L.bar.style.display = 'block'; L.fill.style.width = Math.max(0, Math.min(100, (n.hp / n.maxHp) * 100)) + '%'; }
      else L.bar.style.display = 'none';
    }
    for (let i = li; i < labelPool.length; i++) if (labelPool[i]) labelPool[i].el.style.display = 'none';
  }
  function syncActors(time, dt) {
    const list = Game.activeNpcs || [];
    const seen = new Set();
    npcShown = 0;
    for (let i = 0; i < list.length && npcShown < 120; i++) {
      const n = list[i];
      if (!n || n.dead) continue;
      let st = null; try { st = avatarStateFor(n, false, time); } catch (_) { continue; }
      seen.add(n);
      let a = actorPool.get(n);
      if (!a) { a = { g: makeActor(st.bodyType, st.skin, n.name || ''), lastX: n.px / TILE_SIZE, lastZ: n.py / TILE_SIZE, yaw: 0 }; a.g.userData.npc = n; scene.add(a.g); actorPool.set(n, a); }
      const ax = n.px / TILE_SIZE, az2 = n.py / TILE_SIZE, ay = heightAt(ax, az2);
      const sizeMul = Math.max(0.35, st.scale / AV_SCALE);
      a.g.scale.setScalar(sizeMul);
      // facing: turn toward movement, idle falls back to the sim's 4-way facing
      const adx = ax - a.lastX, adz = az2 - a.lastZ;
      let ty2 = a.yaw;
      if (adx * adx + adz * adz > 1e-6) ty2 = Math.atan2(adx, adz);
      else if (FACE[st.facing] !== undefined) ty2 = FACE[st.facing];
      a.lastX = ax; a.lastZ = az2;
      let dyw = ty2 - a.yaw; dyw = Math.atan2(Math.sin(dyw), Math.cos(dyw));
      a.yaw += dyw * Math.min(1, dt * 10);
      a.g.rotation.y = a.yaw;
      // cheap clay animation: walk bob, attack lunge, hit recoil
      let bobY = 0, lunge = 0;
      if (st.anim === 'walk') bobY = Math.abs(Math.sin((time + (n._tOff || 0)) * 0.012)) * 0.09 * sizeMul;
      else if (st.anim === 'attack') lunge = Math.sin(Math.PI * Math.min(1, st.phase)) * 0.3 * sizeMul;
      else if (st.anim === 'hit') lunge = -Math.sin(Math.PI * Math.min(1, st.phase)) * 0.18 * sizeMul;
      a.g.position.set(ax + Math.sin(a.yaw) * lunge, ay + bobY, az2 + Math.cos(a.yaw) * lunge);
      npcShown++;
    }
    for (const [n, a] of actorPool) if (!seen.has(n)) { scene.remove(a.g); actorPool.delete(n); }
  }

  // ---------- equipment on the goblin: procedural clay weapon in a hand socket +
  // shield on the off-arm, tinted by the item's metal, rebuilt when gear changes.
  // Hints come from the SAME avatarStateFor().gear the 2D uses (kind/color/len). ----
  const handSocket = new THREE.Group(); handSocket.position.set(0.62, 1.02, 0.34); handSocket.rotation.set(0.15, 0, -0.3); goblin.add(handSocket);
  const shieldSocket = new THREE.Group(); shieldSocket.position.set(-0.62, 1.0, 0.28); shieldSocket.rotation.set(0, 0.25, 0); goblin.add(shieldSocket);
  const torsoSocket = new THREE.Group(); torsoSocket.position.set(0, 1.05, 0); goblin.add(torsoSocket);
  const HAND_REST_X = Math.PI / 2 - 0.55;   // idle blade angle; attack swings from here
  let gearKey = null;
  const wood = 0x6b4a2a, darkWood = 0x54381e;
  // Real weapon models (textured Meshy statics) for the kinds we have; the
  // procedural clay shapes below stay the fallback for everything else.
  // Normalized: grip end at origin, blade along +Y, unit length (scaled per hint).
  const weaponGLB = {};
  for (const [kind, url] of [['sword', '/r3d/models/weapon_sword.glb'], ['pick', '/r3d/models/weapon_pickaxe.glb']]) {
    const ld = new GLTFLoader(); ld.setMeshoptDecoder(MeshoptDecoder);
    ld.load(url, gl => {
      let best = null; gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(o => { if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
      if (!best) return;
      const geo = best.geometry.clone(); geo.applyMatrix4(best.matrixWorld);
      geo.computeBoundingBox(); let bb = geo.boundingBox; const size = new THREE.Vector3(); bb.getSize(size);
      if (size.x >= size.y && size.x >= size.z) geo.rotateZ(-Math.PI / 2);        // longest axis -> +Y
      else if (size.z >= size.y && size.z >= size.x) geo.rotateX(Math.PI / 2);
      geo.computeBoundingBox(); bb = geo.boundingBox; const s2 = new THREE.Vector3(); bb.getSize(s2);
      const c = new THREE.Vector3(); bb.getCenter(c);
      geo.translate(-c.x, -bb.min.y, -c.z);
      geo.scale(1 / (s2.y || 1), 1 / (s2.y || 1), 1 / (s2.y || 1));
      weaponGLB[kind] = { geo, mat: best.material };
      gearKey = null;                                   // rebuild so equipped gear upgrades to the model
    }, undefined, () => {});                            // missing model = procedural fallback, no noise
  }
  function buildWeapon(hint) {
    const g = new THREE.Group();
    if (!hint || hint.kind === 'fist' || !hint.len) return g;
    const L = Math.max(0.5, hint.len / 12);                    // 2D px len -> world units
    const real = weaponGLB[hint.kind];
    if (real) {
      // tint the texture toward the item's metal so a bronze sword reads BRONZE
      // (the raw Meshy steel texture is near-black at gameplay zoom)
      const mat = real.mat.clone(); mat.color = new THREE.Color(hint.color).lerp(new THREE.Color(0xffffff), 0.25);
      const me = new THREE.Mesh(real.geo, mat);
      // stylized-oversize: longer than life and extra-chunky in cross-section
      // so the weapon reads at gameplay zoom, not just in close-ups
      me.scale.set(L * 2.2, L * 1.5, L * 2.2); me.position.y = -0.16 * L;
      g.add(me); return g;
    }
    const mk = (geo, color, y, rx = 0, rz = 0, x = 0, z = 0) => { const m = new THREE.Mesh(geo, matFor(color)); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m; };
    const grip = () => mk(new THREE.CylinderGeometry(0.045, 0.055, 0.3, 6), darkWood, 0);
    switch (hint.kind) {
      case 'sword': grip(); mk(new THREE.BoxGeometry(0.24, 0.05, 0.07), 0x8a6a3a, 0.18); mk(new THREE.BoxGeometry(0.1, L, 0.03), hint.color, 0.2 + L / 2); break;
      case 'dagger': grip(); mk(new THREE.BoxGeometry(0.09, L * 0.7, 0.03), hint.color, 0.18 + L * 0.35); break;
      case 'spear': mk(new THREE.CylinderGeometry(0.04, 0.045, L * 1.7, 6), wood, L * 0.45); mk(new THREE.ConeGeometry(0.09, 0.34, 6), hint.color, L * 1.3 + 0.17); break;
      case 'axe': mk(new THREE.CylinderGeometry(0.045, 0.055, L, 6), wood, L * 0.3); mk(new THREE.BoxGeometry(0.28, 0.2, 0.05), hint.color, L * 0.72, 0, 0, 0.13); break;
      case 'pick': mk(new THREE.CylinderGeometry(0.045, 0.055, L, 6), wood, L * 0.3);
        mk(new THREE.ConeGeometry(0.06, 0.3, 5), hint.color, L * 0.78, 0, Math.PI / 2, 0.16); mk(new THREE.ConeGeometry(0.06, 0.3, 5), hint.color, L * 0.78, 0, -Math.PI / 2, -0.16); break;
      case 'mace': mk(new THREE.CylinderGeometry(0.045, 0.055, L, 6), wood, L * 0.3); mk(new THREE.DodecahedronGeometry(0.14, 0), hint.color, L * 0.78); break;
      case 'staff': mk(new THREE.CylinderGeometry(0.045, 0.055, L * 1.5, 6), wood, L * 0.4); mk(new THREE.SphereGeometry(0.11, 8, 6), hint.color, L * 1.12); break;
      case 'bow': case 'cbow': { const arc = new THREE.Mesh(new THREE.TorusGeometry(L * 0.5, 0.035, 6, 12, Math.PI * 1.15), matFor(hint.color)); arc.rotation.z = Math.PI * 0.92; g.add(arc); break; }
      default: mk(new THREE.CylinderGeometry(0.05, 0.09, L, 6), wood, L * 0.35); break;   // club
    }
    return g;
  }
  function buildShield(hint) {
    const g = new THREE.Group();
    if (!hint) return g;
    if (hint.shape === 'round') { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 14), matFor(hint.color)); d.rotation.x = Math.PI / 2; g.add(d);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), matFor(darkWood)); b.position.z = 0.05; g.add(b); }
    else { const k = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.05), matFor(hint.color)); g.add(k);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.2, 4), matFor(hint.color)); tip.position.y = -0.38; tip.rotation.set(Math.PI, Math.PI / 4, 0); g.add(tip); }
    return g;
  }
  function syncPlayerGear(gear) {
    const w = gear && gear.weapon, s = gear && gear.shield, b = gear && gear.body, c = gear && gear.cape;
    const key = (w ? w.kind + ':' + w.color + ':' + w.len : 'none') + '|' + (s ? s.shape + ':' + s.color : 'none')
      + '|' + (b ? 'b' + b.color : 'none') + '|' + (c ? 'c' + c.color : 'none');
    if (key === gearKey) return;
    gearKey = key;
    while (handSocket.children.length) handSocket.remove(handSocket.children[0]);
    while (shieldSocket.children.length) shieldSocket.remove(shieldSocket.children[0]);
    while (torsoSocket.children.length) torsoSocket.remove(torsoSocket.children[0]);
    handSocket.add(buildWeapon(w));
    shieldSocket.add(buildShield(s));
    // body armour: a chest plate wrapped over the tunic, tinted by the item
    if (b) { const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.58, 10), matFor(b.color)); plate.scale.z = 0.74; torsoSocket.add(plate); }
    // cape: hangs from the shoulders, covers the baked-in one
    if (c) { const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.88), new THREE.MeshLambertMaterial({ color: c.color, side: THREE.DoubleSide })); cape.position.set(0, -0.26, -0.32); cape.rotation.x = 0.14; torsoSocket.add(cape); }
  }

  // ---------- dynamic FX the 2D canvas redraws each frame — dropped LOOT,
  // player-lit FIRES, in-flight ARROWS. All three were invisible in 3D.
  // Pooled meshes refreshed per frame (cheap: <=80 total). ----------
  const lootPool = [], firePool = [], arrowPool = [];
  const lootGeo = new THREE.OctahedronGeometry(0.16, 0);
  const lootMat = new THREE.MeshLambertMaterial({ color: 0xd9b14a, emissive: 0x4a3a10 });
  const flameGeo = new THREE.ConeGeometry(0.28, 0.65, 7);
  const flameMat = new THREE.MeshLambertMaterial({ color: 0xff8a2a, emissive: 0xcc4400 });
  const logGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 5);
  const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
  const arrowGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.55, 4);
  const arrowMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2c });
  const poolSync = (pool, n, mk) => {
    while (pool.length < n) { const m2 = mk(); scene.add(m2); pool.push(m2); }
    for (let i2 = 0; i2 < pool.length; i2++) pool[i2].visible = i2 < n;
  };
  function syncFX(now) {
    const gi = Game.groundItems || [];
    const n1 = Math.min(48, gi.length);
    poolSync(lootPool, n1, () => new THREE.Mesh(lootGeo, lootMat));
    for (let i2 = 0; i2 < n1; i2++) {
      const g3 = gi[i2], m2 = lootPool[i2];
      m2.position.set(g3.x + 0.5, heightAt(g3.x, g3.y) + 0.26 + Math.sin(now * 0.003 + i2) * 0.05, g3.y + 0.5);
      m2.rotation.y = now * 0.0015 + i2;                     // slow spin: "loot here"
    }
    let fs = []; try { fs = activeFires() || []; } catch (_) {}
    const n2 = Math.min(16, fs.length);
    poolSync(firePool, n2, () => {
      const gr = new THREE.Group();
      const l1 = new THREE.Mesh(logGeo, logMat); l1.rotation.z = Math.PI / 2; l1.position.y = 0.06; gr.add(l1);
      const l2 = new THREE.Mesh(logGeo, logMat); l2.rotation.set(Math.PI / 2, 0, 0); l2.position.y = 0.06; gr.add(l2);
      const fl = new THREE.Mesh(flameGeo, flameMat); fl.position.y = 0.42; gr.userData.flame = fl; gr.add(fl);
      return gr;
    });
    const nowTick = Game.ticker ? Game.ticker.count : 0;
    for (let i2 = 0; i2 < n2; i2++) {
      const f2 = fs[i2], gr = firePool[i2];
      gr.position.set(f2.x + 0.5, heightAt(f2.x, f2.y), f2.y + 0.5);
      const life = fireLifeRatio(f2, nowTick);
      const flick = 0.85 + 0.15 * Math.sin(now * 0.02 + f2.x * 1.7 + f2.y);
      const s2 = Math.max(0.2, (0.55 + 0.45 * life) * flick);
      gr.userData.flame.scale.set(s2, s2, s2);
    }
    const prs = Game._projectiles || [];
    const gtime = (Game.scene && Game.scene.time && Game.scene.time.now) || now;
    const n3 = Math.min(16, prs.length);
    poolSync(arrowPool, n3, () => new THREE.Mesh(arrowGeo, arrowMat));
    for (let i2 = 0; i2 < n3; i2++) {
      const pr = prs[i2], m2 = arrowPool[i2];
      const k = Math.max(0, Math.min(1, (gtime - pr.at) / pr.dur));
      const px2 = (pr.x + (pr.tx - pr.x) * k) / TILE_SIZE, pz2 = (pr.y + (pr.ty - pr.y) * k) / TILE_SIZE;
      m2.position.set(px2, heightAt(px2, pz2) + 1.0 + Math.sin(Math.PI * k) * 0.35, pz2);
      m2.lookAt(pr.tx / TILE_SIZE, m2.position.y, pr.ty / TILE_SIZE); m2.rotateX(Math.PI / 2);
    }
  }

  // ---------- walk feedback: gold ring on the destination tile + white dots along the
  // live path (read from p.travelTarget / p.path every frame, same data the 2D uses) ----
  const destMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.46, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.95, depthWrite: false }));
  destMarker.rotation.x = -Math.PI / 2; destMarker.visible = false; destMarker.renderOrder = 3; scene.add(destMarker);
  const dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.11, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 64);
  dots.renderOrder = 3; dots.count = 0; scene.add(dots);
  const dotM = new THREE.Matrix4(), dotP = new THREE.Vector3(), dotS = new THREE.Vector3(1, 1, 1);
  const dotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  // ---------- camera (manual follow, mirrors the 2D camera's rotation) ----------
  const camera = new THREE.PerspectiveCamera(52, vw / vh, 0.5, 4000);
  const camTarget = new THREE.Vector3();
  let inited = false;
  let lastWX = 0, lastWZ = 0, yaw = 0, targetYaw = 0;       // movement-based facing state
  function onResize() { fitCanvas(); fitMinimap(); camera.aspect = vw / vh; camera.updateProjectionMatrix(); }
  addEventListener('resize', onResize);
  setTimeout(onResize, 500); setTimeout(onResize, 2500);   // layout settles after login/HUD mounts

  // ---------- OSRS-style click: raycast the 3D pick down to a world tile, then route
  // through the game's real interaction logic (walk/attack/interact/pickup). ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null, midDrag = null;
  let pol = Math.atan2(1, 0.85);                            // camera pitch (polar angle from vertical); drag Y adjusts
  cv.style.touchAction = 'none';                            // we own all touch gestures on the 3D canvas
  const tileAt = (cx, cy) => {                              // screen point -> world tile via terrain raycast
    const r = cv.getBoundingClientRect();
    ndc.x = ((cx - r.left) / r.width) * 2 - 1;
    ndc.y = -((cy - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = terrainMesh ? ray.intersectObject(terrainMesh)[0] : null;
    return hit ? { tx: Math.floor(hit.point.x), ty: Math.floor(hit.point.z) } : null;
  };
  const pickAt = (cx, cy) => { const t = tileAt(cx, cy); if (t) { try { if (Game._clickWorldTile) Game._clickWorldTile(t.tx, t.ty); } catch (err) { console.error('[r3d] click route failed', err); } } };
  const menuAt = (cx, cy) => { const t = tileAt(cx, cy); if (t) { try { if (Game._rightClickWorldTile) Game._rightClickWorldTile(t.tx, t.ty, cx, cy); } catch (err) { console.error('[r3d] menu route failed', err); } } };
  const orbitBy = (dx, dy) => {
    try { if (Game._camOrbit) Game._camOrbit(-dx * 0.006); } catch (_) {}
    pol = Math.min(1.32, Math.max(0.30, pol + dy * 0.005)); // drag up = higher camera, down = lower
  };

  // ----- mouse: left click = action, middle-drag = orbit, wheel = zoom, right = menu
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;                   // touch has its own path below
    if (e.button === 1) { e.preventDefault(); midDrag = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} return; }
    downAt = { x: e.clientX, y: e.clientY };
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouseX = e.clientX; mouseY = e.clientY;
    if (!midDrag) return;                                    // OSRS: hold middle mouse + drag to orbit
    const dx = e.clientX - midDrag.x, dy = e.clientY - midDrag.y; midDrag = { x: e.clientX, y: e.clientY };
    orbitBy(dx, dy);
  });
  cv.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button === 1) { midDrag = null; return; }
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null;
    if (moved > 6 || e.button !== 0) return;                 // a drag or non-left click, not a pick
    pickAt(e.clientX, e.clientY);
  });
  cv.addEventListener('pointercancel', () => { midDrag = null; downAt = null; });
  cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); menuAt(e.clientX, e.clientY); });
  cv.addEventListener('wheel', (e) => {                      // scroll = zoom (drives the shared 2D targetZoom)
    e.preventDefault();
    try { if (Game._camZoomWheel) Game._camZoomWheel(e.deltaY); } catch (_) {}
  }, { passive: false });
  let mouseX = -1, mouseY = -1;

  // ----- touch (OSRS-mobile): tap = action, one-finger drag = orbit, pinch = zoom,
  // long-press = context menu. All gestures stay on the canvas (touch-action none).
  const touches = new Map();
  let touchDragged = false, longPressTimer = null, pinchDist = 0;
  const clearLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}   // best-effort; never abort gesture state setup
    if (touches.size === 1) {
      touchDragged = false;
      clearLongPress();
      longPressTimer = setTimeout(() => { longPressTimer = null; if (!touchDragged && touches.size === 1) { const t = touches.values().next().value; menuAt(t.x, t.y); touches.clear(); } }, 480);
    } else { clearLongPress(); }
    if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    const t = touches.get(e.pointerId); if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (Math.hypot(t.x - t.x0, t.y - t.y0) > 9) { touchDragged = true; clearLongPress(); }
    if (touches.size === 1 && touchDragged) orbitBy(dx, dy);
    else if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && Math.abs(d - pinchDist) > 8) {   // pinch out = zoom in
        try { if (Game._camZoomWheel) Game._camZoomWheel(d > pinchDist ? -120 : 120); } catch (_) {}
        pinchDist = d;
      }
    }
  });
  const endTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    const t = touches.get(e.pointerId); touches.delete(e.pointerId);
    clearLongPress(); pinchDist = 0;
    if (!t || e.type === 'pointercancel') return;
    const quick = performance.now() - t.t0 < 350 && Math.hypot(t.x - t.x0, t.y - t.y0) <= 9;
    if (quick && !touchDragged && touches.size === 0) pickAt(t.x, t.y);   // a clean tap = action
  };
  cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch);

  // ---------- minimap for 3D players (the 2D one lives on the covered Phaser canvas):
  // small north-up DOM canvas, terrain colours around the player + NPC/player dots +
  // facing arrow; click-to-walk via the same tile routing. ----------
  const MM = 148, MSPT = 3, MTILES = MM / MSPT;               // 148px, 3px/tile ≈ 49 tiles across
  const mm = document.createElement('canvas'); mm.width = MM; mm.height = MM; mm.id = 'r3d-minimap';
  mm.style.cssText = 'position:fixed;z-index:6;border:2px solid #3a2f22;border-radius:10px;box-shadow:0 2px 8px #0008;cursor:pointer;';
  document.body.appendChild(mm);
  const mmCtx = mm.getContext('2d');
  function fitMinimap() { const r = cv.getBoundingClientRect(); mm.style.left = (r.left + r.width - MM - 12) + 'px'; mm.style.top = (r.top + 64) + 'px'; }
  let mmLast = 0;
  function drawMinimap3d() {
    const now = performance.now(); if (now - mmLast < 150) return; mmLast = now;
    const p = Game.player; if (!p) return;
    const ctx2 = mmCtx, ptx = p.px / TILE_SIZE, pty = p.py / TILE_SIZE;
    const x0 = ptx - MTILES / 2, y0 = pty - MTILES / 2;
    for (let j = 0; j < MTILES; j++) for (let i = 0; i < MTILES; i++) {
      const tx = (x0 + i) | 0, ty = (y0 + j) | 0;
      ctx2.fillStyle = (tx < 0 || ty < 0 || tx >= W || ty >= H) ? '#181410' : (colors[ter[ty * W + tx]] || '#4a7c3a');
      ctx2.fillRect(i * MSPT, j * MSPT, MSPT, MSPT);
    }
    // npc + player dots
    for (const n of (Game.activeNpcs || [])) {
      if (!n || n.dead) continue;
      const mx = (n.px / TILE_SIZE - x0) * MSPT, my = (n.py / TILE_SIZE - y0) * MSPT;
      if (mx < 0 || my < 0 || mx > MM || my > MM) continue;
      ctx2.fillStyle = n.type === 'player' ? '#9fd4ff' : n.type === 'elder' ? '#ffe97a' : '#ff5a5a';
      ctx2.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // player arrow (faces the goblin's yaw)
    const cx2 = MM / 2, cy2 = MM / 2;
    ctx2.save(); ctx2.translate(cx2, cy2); ctx2.rotate(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    ctx2.fillStyle = '#ffffff'; ctx2.beginPath(); ctx2.moveTo(0, 5); ctx2.lineTo(-3.5, -4); ctx2.lineTo(3.5, -4); ctx2.closePath(); ctx2.fill();
    ctx2.restore();
    // N marker
    ctx2.fillStyle = '#ffe97a'; ctx2.font = 'bold 11px monospace'; ctx2.fillText('N', MM / 2 - 3, 12);
  }
  mm.addEventListener('pointerup', (e) => {
    const r = mm.getBoundingClientRect(), p = Game.player; if (!p) return;
    const tx = Math.floor(p.px / TILE_SIZE - MTILES / 2 + (e.clientX - r.left) / MSPT);
    const ty = Math.floor(p.py / TILE_SIZE - MTILES / 2 + (e.clientY - r.top) / MSPT);
    try { if (Game._clickWorldTile) Game._clickWorldTile(tx, ty); } catch (_) {}
  });

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
      // WORLD SWAP (enter/exit a dungeon): main.js replaces Game.world with an
      // inner world (same contract: W/H/terrain/elevation/objectsByChunk).
      // Rebind and rebuild everything, or 3D keeps rendering the stale
      // overworld under the player's dungeon coordinates.
      if (Game.world && Game.world !== world && Game.world.terrain && Game.world.elevation) {
        world = Game.world; W = world.W; H = world.H; ter = world.terrain; elev = world.elevation;
        winCX = -1e9; winCY = -1e9;                       // force terrain window + props rebuild
        for (const [, a] of actorPool) scene.remove(a.g); actorPool.clear();
        lastIndoor = null;                                 // re-evaluate interior lighting
      }
      const p = Game.player;
      const wx = p ? p.px / TILE_SIZE : winCX, wz = p ? p.py / TILE_SIZE : winCY;
      const wy = heightAt(wx, wz);
      if (Math.abs(wx - winCX) > REBUILD || Math.abs(wz - winCY) > REBUILD) buildWindow(wx | 0, wz | 0);
      updateSunShadow(wx, wy, wz);                             // shadow frustum tracks the player
      daylight3d();                                            // interior/day lighting (on change)
      syncFX(performance.now());                               // loot / fires / arrows
      if (performance.now() - lastPropBuild > 2000) buildProps();   // depleted trees vanish, respawns return
      const dt = clock.getDelta();
      syncActors(performance.now(), dt);                       // NPCs / monsters / other players
      if (p) {
        goblin.visible = true;
        goblin.position.set(wx, wy, wz);
        let st = null; try { st = avatarStateFor(p, true, performance.now()); } catch (_) {}
        if (st && st.gear) syncPlayerGear(st.gear);            // weapon/shield follow Game.equipment
        // FACING: turn toward the actual direction of travel (smooth shortest-arc),
        // like OSRS — the 4-way _facing map is only the idle fallback.
        const mdx = wx - lastWX, mdz = wz - lastWZ;
        const speed = dt > 0 ? Math.hypot(mdx, mdz) / dt : 0;      // tiles/sec
        if (mdx * mdx + mdz * mdz > 1e-6) targetYaw = Math.atan2(mdx, mdz);
        else if (st && FACE[st.facing] !== undefined) targetYaw = FACE[st.facing];
        lastWX = wx; lastWZ = wz;
        let dy = targetYaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw += dy * Math.min(1, dt * 12);
        goblin.rotation.y = yaw;
        if (st && mixer && walkAction) {
          const moving = st.anim === 'walk';
          walkAction.paused = !moving;
          if (moving) { walkAction.timeScale = Math.min(2.4, Math.max(0.6, speed / 1.5)); mixer.update(dt); }  // stride matches ground speed
          else { walkAction.time = 0; mixer.update(0); }
        }
        // The walk clip carries ROOT MOTION — without this the model drifts off its
        // anchor (the goblin ends up in a screen corner). Walk in place, always.
        if (animRoot) { animRoot.position.x = 0; animRoot.position.z = 0; }
        // combat feedback (same motion language as NPCs): lunge toward facing on
        // attack, recoil on hit — driven by the sim's anim/phase.
        if (st && (st.anim === 'attack' || st.anim === 'hit')) {
          const ph = Math.min(1, st.phase || 0);
          const amt = st.anim === 'attack' ? Math.sin(Math.PI * ph) * 0.35 : -Math.sin(Math.PI * ph) * 0.2;
          goblin.position.x += Math.sin(yaw) * amt;
          goblin.position.z += Math.cos(yaw) * amt;
        }
        // melee SWING: the weapon socket sweeps forward through the attack phase
        // (absolute set every frame — idempotent, no mixer interference)
        const atkPh = st && st.anim === 'attack' ? Math.min(1, st.phase || 0) : 0;
        handSocket.rotation.x = HAND_REST_X - Math.sin(Math.PI * atkPh) * 1.5;
        // destination ring (gently pulsing) + path dots from the live pathfinder state
        const tt = p.travelTarget;
        if (tt) { destMarker.visible = true;
          destMarker.position.set(tt.x + 0.5, heightAt(tt.x, tt.y) + 0.08, tt.y + 0.5);
          const ps = 1 + 0.15 * Math.sin(performance.now() * 0.006); destMarker.scale.set(ps, ps, 1);
        } else destMarker.visible = false;
        let dn = 0;
        if (p.path && p.path.length) for (let i = 0; i < p.path.length && dn < 64; i++) {
          const stp = p.path[i];
          dotP.set(stp[0] + 0.5, heightAt(stp[0], stp[1]) + 0.06, stp[1] + 0.5);
          dotM.compose(dotP, dotQ, dotS); dots.setMatrixAt(dn++, dotM);
        }
        dots.count = dn; if (dn) dots.instanceMatrix.needsUpdate = true;
      } else { goblin.visible = false; destMarker.visible = false; dots.count = 0; }
      const camMain = Game.scene && Game.scene.cameras && Game.scene.cameras.main;
      const az = camMain ? camMain.rotation : 0, zoom = camMain ? (camMain.zoom || 1) : 1;
      // OSRS framing: character centered (slightly below middle); spherical orbit —
      // azimuth mirrors the 2D camera (arrows/Q/E/compass/middle-drag), pitch is the
      // 3D-only `pol` from middle-drag Y, wheel zooms via the shared 2D targetZoom.
      const R = 21 / Math.sqrt(zoom);
      const goal = new THREE.Vector3(wx, wy + 1.0, wz);
      if (!inited) { camTarget.copy(goal); inited = true; } else camTarget.lerp(goal, 0.2);
      camera.position.set(
        camTarget.x + Math.sin(az) * Math.sin(pol) * R,
        camTarget.y + Math.cos(pol) * R,
        camTarget.z + Math.cos(az) * Math.sin(pol) * R);
      camera.lookAt(camTarget);
      updateLabels3d();                                        // names + HP bars over actors
      drawMinimap3d();
      renderer.render(scene, camera);
      frames++; const t = performance.now();
      if (t - lastFps >= 500) { chip.textContent = '3D α · ' + Math.round(frames * 1000 / (t - lastFps)) + ' fps · ' + npcShown + ' npcs' + (p ? '' : ' · waiting for player…'); frames = 0; lastFps = t; }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (msg !== lastErr) { lastErr = msg; console.error('[r3d] frame error', e); chipErr(msg); }
    }
  }
  renderer.setAnimationLoop(step);

  window.__r3d = {
    frame() {},   // legacy hook from update() — self-driving loop renders now; kept so the guarded call is harmless
    dispose() { try { if (dlFilm) dlFilm.style.display = ''; renderer.setAnimationLoop(null); renderer.dispose(); cv.remove(); chip.remove(); labelLayer.remove(); mm.remove(); window.__r3d = null; } catch (_) {} }
  };

  const px0 = (Game.player && Game.player.px / TILE_SIZE | 0) || (W >> 1);
  const py0 = (Game.player && Game.player.py / TILE_SIZE | 0) || (H >> 1);
  buildWindow(px0, py0);
  console.log('[r3d] mounted — windowed 3D over live world at', px0, py0);
}
