// src/ui/worldMap.js
// Phase 1 of the OSRS-style world map: a ZOOMABLE, PANNABLE full-world overlay
// with point-of-interest markers (banks, shops, cooking range, furnace, anvil,
// altars, exchange, caves, transports…) and a category legend. Replaces the old
// static 1:1 canvas map.
//
// Self-contained, same pattern as wiki.js / skillGuide.js: injects its own DOM +
// CSS, reads only public data (Game.world + worldData/shops exports + icons.js),
// and takes over the existing map button (#map-btn) via a CAPTURING listener so
// it needs ZERO edits to the hands-off main.js scene/camera/input code. The old
// #worldmap-overlay stays wired but is never opened (we intercept the button).
//
// Rendering: terrain is pre-rasterized ONCE into an offscreen 1px/tile buffer, so
// pan/zoom is a single cheap drawImage blit; POI markers are DOM nodes (crisp SVG
// icons + hover tooltips) repositioned each render. Economy/items lane.
//
// Phase 2 (later): predictive search box + "click a legend row to flash every
// match" + "find nearest". The categorization + marker list here already support
// them. Click-to-walk from the map is intentionally omitted (the minimap keeps
// it; walkTo isn't exposed to modules, and OSRS world maps aren't click-to-walk).

import { Game } from '../engine/state.js';
import { TERRAIN_DEFS, LANDMARKS, REGION_ANCHORS, WORLD_W, WORLD_H } from '../world/worldData.js';
import { SHOP_POSTS } from '../systems/shops.js';
import { icon } from './icons.js';

// ---- POI categories: key -> { label, icon, color, match } -------------------
// classify() returns a category key for a facility, or null for non-facilities
// (trees/ore/decor fall through and are excluded). Order matters — first hit wins.
const CATEGORIES = [
  { key: 'bank',      label: 'Bank / Deposit', ico: 'bank',     color: '#e3c14a', re: /^bank$|deposit box|bank booth|bank chest/i },
  { key: 'exchange',  label: 'Grand Exchange',  ico: 'exchange', color: '#e3c45a', re: /grand exchange|market stall|\bmarket\b/i },
  { key: 'shop',      label: 'Shops',           ico: 'shop',     color: '#ffcf3f', re: /shop|store|stall|shack|monger|grocer|herbalist|fletcher|tavern|bait|lodge|smithy/i },
  { key: 'cooking',   label: 'Cooking range',   ico: 'cooking',  color: '#d2691e', re: /\bcook|\brange\b|kitchen|oven/i },
  { key: 'smithing',  label: 'Furnace / Anvil', ico: 'smithing', color: '#c0708a', re: /furnace|anvil|forge|smelter/i },
  { key: 'crafting',  label: 'Craft stations',  ico: 'crafting', color: '#8b7a5a', re: /sawmill|crafting bench|loom|tannery|spinning|pottery|workbench|tinker/i },
  { key: 'altar',     label: 'Altars / Shrines', ico: 'prayer',  color: '#c0b070', re: /altar|shrine|\bidol\b|chapel/i },
  { key: 'alchemy',   label: 'Alchemy',         ico: 'alchemy',  color: '#8a6aca', re: /cauldron|potion|alchemy|herblore/i },
  { key: 'quest',     label: 'Quest board',     ico: 'quests',   color: '#ffd23f', re: /quest board|war table|chief hall|notice/i },
  { key: 'dungeon',   label: 'Caves / entrances', ico: 'pin',    color: '#b0b0b0', re: /cave|mine entrance|ladder|mountain pass|grotto|dungeon|frozen cave/i },
  { key: 'transport', label: 'Transport',       ico: 'run',      color: '#c08a4a', re: /cart|boat|portal|route|ferry|dock|gate/i },
  { key: 'landmark',  label: 'Landmarks',       ico: 'star',     color: '#e0c050', re: /.*/ },  // catch-all for named structures
  // Resource layer (Phase 3) — gather nodes, clustered per type. `res:true` keeps
  // them out of classify(); hidden by default so the facility map stays clean.
  { key: 'logs', label: 'Trees (woodcutting)', ico: 'woodcutting', color: '#6a8f3a', res: true, skill: 'Woodcutting' },
  { key: 'ore',  label: 'Rocks (mining)',      ico: 'mining',      color: '#c08a5a', res: true, skill: 'Mining' },
  { key: 'fish', label: 'Fishing spots',       ico: 'fishing',     color: '#4fa3c7', res: true, skill: 'Fishing' },
  { key: 'crop', label: 'Farm patches',        ico: 'farming',     color: '#8aac4a', res: true, skill: 'Farming' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
const RES_BY_SKILL = { Woodcutting: 'logs', Mining: 'ore', Fishing: 'fish', Farming: 'crop' };

function classify(label, skill) {
  if (!label) return null;
  for (const c of CATEGORIES) {
    if (c.key === 'landmark' || c.res) continue; // catch-all + resource layer handled elsewhere
    if (c.re.test(label)) return c.key;
  }
  // skill-tagged stations without a keyword hit
  if (skill === 'Cooking') return 'cooking';
  if (skill === 'Smithing') return 'smithing';
  if (skill === 'Crafting') return 'crafting';
  if (skill === 'Tinkering') return 'crafting';
  return null;
}

// Build the marker list once per open: every named facility with coordinates.
// Sources: placed world objects (structures/buildings/transports), the curated
// LANDMARKS list, and SHOP_POSTS. Deduped by category + a coarse cell so the
// Bank landmark and the Bank structure don't stack.
function buildMarkers() {
  const seen = new Set();
  const out = [];
  const add = (x, y, name, cat) => {
    if (!cat) return;
    const cell = `${cat}:${Math.round(x / 6)},${Math.round(y / 6)}`;
    if (seen.has(cell)) return;
    seen.add(cell);
    out.push({ x, y, name, cat });
  };

  // 1) placed world objects that read as facilities (trees/ore/decor classify to null)
  for (const o of (Game.world && Game.world.objects) || []) {
    if (!o.label) continue;
    if (o.type === 'decor' || o.type === 'resource' || o.type === 'tree') continue;
    // Data-driven gather nodes carry a nodeId and are labelled like real places
    // ("Chalk Bank", "Meteor Bloom", "Cave Ruby Node") — skip them so the map
    // shows FACILITIES, not resource spots (those belong to a later 'resources' layer).
    if (o.nodeId) continue;
    // Only POSITIVELY-classified facilities become markers — a generic
    // "structure" fallback would flood the map with camp props / building tiles
    // (there are ~1200 structure objects; only a fraction are real POIs).
    let cat = classify(o.label, o.skill);
    if (!cat && o.transport) cat = 'transport';
    add(o.x, o.y, o.label, cat);
  }
  // 2) curated landmarks (adds bridges/gates/docks/caves not present as objects)
  for (const lm of LANDMARKS) {
    const cat = classify(lm.name, null) || 'landmark';
    add(lm.x, lm.y, lm.name, cat);
  }
  // 3) shop posts (canonical shop positions; names come from the id)
  for (const [id, pos] of Object.entries(SHOP_POSTS)) {
    add(pos[0], pos[1], id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), 'shop');
  }
  // 4) resource layer — gather nodes clustered per type on a coarse grid, so
  // "where do I mine iron / chop oak / fish" is a few patch markers, not 29k.
  const CELL = 56;
  const clusters = new Map();  // key -> { sx, sy, n, name, cat }
  for (const o of (Game.world && Game.world.objects) || []) {
    if (o.type !== 'resource' && !(o.nodeId && o.skill)) continue;
    const cat = RES_BY_SKILL[o.skill];
    if (!cat) continue;                          // only the four core gathering skills
    const name = String(o.label || o.resKey || o.nodeId || 'Resource').replace(/\s*\(Lv\s*\d+\)/i, '');
    const key = `${cat}:${name}:${Math.floor(o.x / CELL)},${Math.floor(o.y / CELL)}`;
    let c = clusters.get(key);
    if (!c) { c = { sx: 0, sy: 0, n: 0, name, cat }; clusters.set(key, c); }
    c.sx += o.x; c.sy += o.y; c.n++;
  }
  // Keep the richest patches PER RESOURCE TYPE (so common trees don't flood the
  // map yet every type — Oak, Iron, each fish — stays visible and searchable).
  const PER_TYPE = 12;
  const byType = new Map();
  for (const c of clusters.values()) {
    const tk = c.cat + '|' + c.name;
    if (!byType.has(tk)) byType.set(tk, []);
    byType.get(tk).push(c);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => b.n - a.n);
    for (const c of list.slice(0, PER_TYPE)) {
      out.push({ x: Math.round(c.sx / c.n), y: Math.round(c.sy / c.n), name: c.name, cat: c.cat, count: c.n });
    }
  }
  return out;
}

// Facility POIs for the MINIMAP (main.js drawMinimap) — same categories as the
// world map, so the two agree. Excludes resource clusters and shops/transports
// (the minimap already draws those). Cached per world. [{ tx, ty, kind, color }].
let _facPOI = null, _facPOIWorld = null;
export function facilityPOIs() {
  if (_facPOI && _facPOIWorld === (Game.world || null)) return _facPOI;
  _facPOI = buildMarkers()
    .filter((m) => !m.count && !(CAT[m.cat] && CAT[m.cat].res) && m.cat !== 'shop' && m.cat !== 'transport')
    .map((m) => { const c = CAT[m.cat] || CAT.landmark; return { tx: m.x, ty: m.y, kind: m.cat, color: parseInt(c.color.slice(1), 16) }; });
  _facPOIWorld = Game.world || null;
  return _facPOI;
}

// ---- terrain buffer: rasterize the whole world once at 1px/tile -------------
let terrainBuf = null;   // offscreen canvas, WORLD_W x WORLD_H
function buildTerrainBuffer() {
  const W = Game.world.W, H = Game.world.H, ter = Game.world.terrain;
  const buf = document.createElement('canvas');
  buf.width = W; buf.height = H;
  const bctx = buf.getContext('2d');
  const img = bctx.createImageData(W, H);
  const data = img.data;
  for (let i = 0; i < W * H; i++) {
    const def = TERRAIN_DEFS[ter[i]] || TERRAIN_DEFS[0];
    const col = def.color >>> 0;
    const o = i * 4;
    data[o] = (col >> 16) & 255; data[o + 1] = (col >> 8) & 255; data[o + 2] = col & 255; data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  // object texture: faint decor + colored resource/structure specks, like the old map
  for (const ob of Game.world.objects) {
    if (ob.type === 'decor') { bctx.globalAlpha = 0.5; bctx.fillStyle = hexCss(ob.color); bctx.fillRect(ob.x, ob.y, 1, 1); }
  }
  bctx.globalAlpha = 1;
  for (const ob of Game.world.objects) {
    if (ob.type === 'decor') continue;
    bctx.fillStyle = hexCss(ob.color);
    bctx.fillRect(ob.x - 0.5, ob.y - 0.5, 1.5, 1.5);
  }
  terrainBuf = buf;
}
const hexCss = (n) => '#' + ((n == null ? 0x808080 : n) >>> 0 & 0xffffff).toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- view state -------------------------------------------------------------
const view = { scale: 4, cx: 500, cy: 500 };  // scale = px per tile; (cx,cy) = world tile at canvas center
let minScale = 0.5, maxScale = 12;
let markers = [];
let hidden = new Set(['logs', 'ore', 'fish', 'crop']);   // category keys toggled off (resource layer off by default)
let els = null;           // cached DOM refs
let dragging = null;

function clampView(canvas) {
  minScale = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H) * 0.9;
  view.scale = Math.max(minScale, Math.min(maxScale, view.scale));
  const halfW = canvas.width / 2 / view.scale, halfH = canvas.height / 2 / view.scale;
  view.cx = Math.max(halfW, Math.min(WORLD_W - halfW, view.cx));
  view.cy = Math.max(halfH, Math.min(WORLD_H - halfH, view.cy));
}
const worldToScreen = (canvas, wx, wy) => ({
  sx: (wx - view.cx) * view.scale + canvas.width / 2,
  sy: (wy - view.cy) * view.scale + canvas.height / 2,
});

function render() {
  if (!els) return;
  const canvas = els.canvas, ctx = canvas.getContext('2d');
  clampView(canvas);
  // terrain blit (crisp pixels when zoomed in)
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0c0c0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const srcW = canvas.width / view.scale, srcH = canvas.height / view.scale;
  const srcX = view.cx - srcW / 2, srcY = view.cy - srcH / 2;
  ctx.drawImage(terrainBuf, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  // region name labels (only when zoomed out enough to read the macro geography)
  if (view.scale < 3) {
    ctx.font = '600 12px "Baloo 2", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    for (const a of REGION_ANCHORS) {
      const { sx, sy } = worldToScreen(canvas, a.x, a.y);
      if (sx < -60 || sx > canvas.width + 60 || sy < 0 || sy > canvas.height) continue;
      ctx.fillStyle = 'rgba(255,245,205,0.9)'; ctx.fillText(a.name, sx, sy);
    }
    ctx.shadowBlur = 0;
  }
  positionMarkers();
}

// ---- DOM marker layer -------------------------------------------------------
function positionMarkers() {
  const canvas = els.canvas, layer = els.markerLayer;
  const pad = 24;
  for (const m of markers) {
    const { sx, sy } = worldToScreen(canvas, m.x, m.y);
    const off = sx < -pad || sx > canvas.width + pad || sy < -pad || sy > canvas.height + pad;
    const show = !off && !hidden.has(m.cat);
    m.el.style.display = show ? 'block' : 'none';
    if (show) { m.el.style.left = sx + 'px'; m.el.style.top = sy + 'px'; }
  }
  // player "you are here"
  const p = Game.player;
  if (p) {
    const { sx, sy } = worldToScreen(canvas, p.tileX, p.tileY);
    els.player.style.left = sx + 'px'; els.player.style.top = sy + 'px';
  }
}

function makeMarkerEls() {
  const layer = els.markerLayer;
  layer.querySelectorAll('.zmap-mk').forEach((n) => n.remove());
  for (const m of markers) {
    const c = CAT[m.cat] || CAT.landmark;
    const el = document.createElement('div');
    el.className = 'zmap-mk' + (c.res ? ' zmap-mk-res' : '');
    el.title = m.count ? `${m.name}  ×${m.count}  ·  ${c.label}` : `${m.name}  ·  ${c.label}`;
    el.style.setProperty('--mk', c.color);
    el.innerHTML = (icon(c.ico) || '') + (m.count > 1 ? `<span class="zmap-mk-n">${m.count}</span>` : '');
    layer.appendChild(el);
    m.el = el;
  }
}

// ---- legend -----------------------------------------------------------------
// Small no-emoji "eye" glyph for the show/hide toggle.
const EYE_SVG = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
function buildLegend() {
  const present = [...new Set(markers.map((m) => m.cat))];
  const ordered = CATEGORIES.filter((c) => present.includes(c.key));
  els.legend.innerHTML = ordered.map((c) => {
    const n = markers.filter((m) => m.cat === c.key).length;
    const off = hidden.has(c.key) ? ' zmap-off' : '';
    return `<div class="zmap-lg${off}" data-cat="${c.key}">
      <button class="zmap-lg-main" title="Show all ${esc(c.label)} on the map">
        <span class="zmap-lg-ico" style="color:${c.color}">${icon(c.ico) || ''}</span>
        <span class="zmap-lg-lbl">${esc(c.label)}</span><span class="zmap-lg-n">${n}</span>
      </button>
      <button class="zmap-lg-eye" title="Show / hide on map">${EYE_SVG}</button>
    </div>`;
  }).join('');
  els.legend.querySelectorAll('.zmap-lg').forEach((row) => {
    const k = row.dataset.cat;
    row.querySelector('.zmap-lg-main').onclick = () => flashCategory(k);   // OSRS "Key": flash all of this type
    row.querySelector('.zmap-lg-eye').onclick = () => {
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
      row.classList.toggle('zmap-off');
      positionMarkers();
    };
  });
}
function syncLegendOff() {
  if (!els) return;
  els.legend.querySelectorAll('.zmap-lg').forEach((row) => row.classList.toggle('zmap-off', hidden.has(row.dataset.cat)));
}

// ---- search / locate / flash (Phase 2) --------------------------------------
// 8-way compass from the player to a tile. y grows downward (south).
function dirTo(dx, dy) {
  if (!dx && !dy) return 'here';
  const a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(a / 45) % 8];
}
function distFrom(p, m) { return Math.round(Math.hypot(m.x - p.tileX, m.y - p.tileY)); }

// Pulse a set of markers (make them visible first) so the eye is drawn to them.
function flashMarkers(list) {
  for (const m of list) {
    if (!m.el) continue;
    hidden.delete(m.cat);
    m.el.style.display = 'block';
    m.el.classList.remove('zmap-flash'); void m.el.offsetWidth;  // restart the animation
    m.el.classList.add('zmap-flash');
  }
  positionMarkers();
  syncLegendOff();
}
// Center the view on a marker (zoom in a touch) and flash it.
function locate(m) {
  view.cx = m.x; view.cy = m.y;
  view.scale = Math.max(view.scale, 5);
  render();
  flashMarkers([m]);
}
function flashCategory(cat) { flashMarkers(markers.filter((m) => m.cat === cat)); }

function runSearch(q) {
  const s = (q || '').trim().toLowerCase();
  const box = els.results;
  if (!s) { box.innerHTML = ''; box.classList.remove('zmap-has'); return; }
  const p = Game.player || { tileX: WORLD_W / 2, tileY: WORLD_H / 2 };
  const hits = markers
    .filter((m) => m.name.toLowerCase().includes(s) || (CAT[m.cat] && CAT[m.cat].label.toLowerCase().includes(s)))
    .map((m) => ({ m, d: distFrom(p, m) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 14);
  box.classList.add('zmap-has');
  if (!hits.length) { box.innerHTML = `<div class="zmap-nohit">No match for “${esc(s)}”.</div>`; return; }
  box.innerHTML = hits.map(({ m, d }, i) => {
    const c = CAT[m.cat] || CAT.landmark;
    const dir = dirTo(m.x - p.tileX, m.y - p.tileY);
    return `<button class="zmap-res" data-i="${i}">
      <span class="zmap-res-ico" style="color:${c.color}">${icon(c.ico) || ''}</span>
      <span class="zmap-res-nm">${esc(m.name)}</span>
      <span class="zmap-res-d">${dir === 'here' ? 'here' : `${d}·${dir}`}</span></button>`;
  }).join('');
  box.querySelectorAll('.zmap-res').forEach((b) => { b.onclick = () => locate(hits[+b.dataset.i].m); });
}

// ---- open / close -----------------------------------------------------------
function open() {
  if (!Game.world || !Game.world.terrain) return;   // world not built yet
  ensureDom();
  buildTerrainBuffer();
  markers = buildMarkers();
  makeMarkerEls();
  buildLegend();
  els.search.value = ''; runSearch('');
  // center on the player at a comfortable zoom the first time
  const p = Game.player;
  if (p) { view.cx = p.tileX; view.cy = p.tileY; }
  view.scale = 4;
  els.overlay.hidden = false;
  sizeCanvas(); render();                                    // immediate first paint
  requestAnimationFrame(() => { sizeCanvas(); render(); });  // re-fit once layout has settled
}
function close() { if (els) els.overlay.hidden = true; }
function isOpen() { return els && !els.overlay.hidden; }

function sizeCanvas() {
  const canvas = els.canvas, box = els.stage.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(box.width));
  canvas.height = Math.max(240, Math.floor(box.height));
}

// ---- DOM + CSS --------------------------------------------------------------
function ensureDom() {
  if (els) return;
  injectCss();
  const overlay = document.createElement('div');
  overlay.id = 'zmap-overlay'; overlay.hidden = true;
  overlay.innerHTML = `
    <div class="zmap-panel">
      <div class="zmap-head">
        <span class="zmap-title">World Map</span>
        <div class="zmap-tools">
          <button class="zmap-btn" data-act="out" title="Zoom out">–</button>
          <button class="zmap-btn" data-act="in" title="Zoom in">+</button>
          <button class="zmap-btn" data-act="me" title="Center on me">◎</button>
          <button class="zmap-btn" data-act="fit" title="Fit whole map">⤢</button>
          <button class="zmap-btn zmap-x" data-act="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="zmap-body">
        <div class="zmap-stage">
          <canvas class="zmap-canvas"></canvas>
          <div class="zmap-markers"></div>
          <div class="zmap-you" title="You are here"></div>
          <div class="zmap-hint">drag to pan · scroll to zoom</div>
        </div>
        <div class="zmap-side">
          <div class="zmap-search-wrap">
            <input class="zmap-search" type="text" autocomplete="off" spellcheck="false"
                   placeholder="Search: bank, cooking range, shop…" />
            <div class="zmap-results"></div>
          </div>
          <div class="zmap-legend"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  els = {
    overlay,
    panel: overlay.querySelector('.zmap-panel'),
    stage: overlay.querySelector('.zmap-stage'),
    canvas: overlay.querySelector('.zmap-canvas'),
    markerLayer: overlay.querySelector('.zmap-markers'),
    player: overlay.querySelector('.zmap-you'),
    legend: overlay.querySelector('.zmap-legend'),
    search: overlay.querySelector('.zmap-search'),
    results: overlay.querySelector('.zmap-results'),
  };
  wireInput();
}

function wireInput() {
  const { overlay, canvas, stage } = els;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.zmap-btn').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'close') return close();
      if (a === 'in') view.scale *= 1.4;
      if (a === 'out') view.scale /= 1.4;
      if (a === 'me' && Game.player) { view.cx = Game.player.tileX; view.cy = Game.player.tileY; view.scale = Math.max(view.scale, 4); }
      if (a === 'fit') { view.cx = WORLD_W / 2; view.cy = WORLD_H / 2; view.scale = 0; }  // clampView pins to minScale
      render();
    };
  });
  // wheel zoom around the cursor
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = view.cx + (mx - canvas.width / 2) / view.scale;
    const wy = view.cy + (my - canvas.height / 2) / view.scale;
    view.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
    clampView(canvas);
    // keep the tile under the cursor fixed
    view.cx = wx - (mx - canvas.width / 2) / view.scale;
    view.cy = wy - (my - canvas.height / 2) / view.scale;
    render();
  }, { passive: false });
  // drag to pan
  stage.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    stage.setPointerCapture(e.pointerId); stage.classList.add('zmap-grab');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    view.cx = dragging.cx - (e.clientX - dragging.x) / view.scale;
    view.cy = dragging.cy - (e.clientY - dragging.y) / view.scale;
    render();
  });
  const end = () => { dragging = null; stage.classList.remove('zmap-grab'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (isOpen()) { sizeCanvas(); render(); } });
  // search box (Phase 2): predictive, distance-sorted; Enter locates the top hit.
  els.search.addEventListener('input', () => runSearch(els.search.value));
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = els.results.querySelector('.zmap-res'); if (first) first.click(); }
    else if (e.key === 'Escape' && els.search.value) { e.stopImmediatePropagation(); els.search.value = ''; runSearch(''); }
  });
}

function injectCss() {
  if (document.getElementById('zmap-css')) return;
  const s = document.createElement('style');
  s.id = 'zmap-css';
  s.textContent = `
  #zmap-overlay { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,.62); }
  #zmap-overlay[hidden] { display:none; }
  .zmap-panel { width:min(96vw,1100px); height:min(92vh,780px); display:flex; flex-direction:column;
    background:linear-gradient(180deg,#26221a,#1c190f); border:2px solid #4a4331; border-radius:12px;
    box-shadow:0 12px 48px rgba(0,0,0,.6); overflow:hidden; }
  .zmap-head { display:flex; align-items:center; justify-content:space-between; padding:8px 12px;
    border-bottom:2px solid #0d0c08; background:#201d15; }
  .zmap-title { color:#e8c65a; font-weight:800; font-size:15px; font-family:"Baloo 2",system-ui,sans-serif; }
  .zmap-tools { display:flex; gap:6px; }
  .zmap-btn { width:30px; height:30px; border-radius:6px; border:1px solid #0d0c08; cursor:pointer;
    background:linear-gradient(180deg,#3d3728,#26221a); color:#e8c65a; font-size:16px; font-weight:700; line-height:1; }
  .zmap-btn:hover { color:#fff; background:#4a4331; }
  .zmap-x { color:#c98; }
  .zmap-body { flex:1; display:flex; min-height:0; }
  .zmap-stage { position:relative; flex:1; overflow:hidden; cursor:grab; background:#0c0c0a; }
  .zmap-stage.zmap-grab { cursor:grabbing; }
  .zmap-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
  .zmap-markers { position:absolute; inset:0; pointer-events:none; }
  .zmap-mk { position:absolute; width:22px; height:22px; margin:-11px 0 0 -11px; color:var(--mk);
    filter:drop-shadow(0 1px 1px #000) drop-shadow(0 0 2px #000); pointer-events:auto; cursor:help; }
  .zmap-mk svg { width:100%; height:100%; display:block; }
  .zmap-mk-res { width:18px; height:18px; margin:-9px 0 0 -9px; }
  .zmap-mk-n { position:absolute; right:-6px; bottom:-5px; min-width:11px; height:13px; padding:0 2px;
    font:700 9px/13px "Baloo 2",system-ui,sans-serif; color:#1a1a12; background:var(--mk); border:1px solid #0d0c08;
    border-radius:7px; text-align:center; }
  .zmap-you { position:absolute; width:16px; height:16px; margin:-8px 0 0 -8px; border:2px solid #fff; border-radius:50%;
    box-shadow:0 0 0 2px rgba(0,0,0,.6), 0 0 8px #fff; pointer-events:none; }
  .zmap-you::after { content:""; position:absolute; inset:5px; background:#fff; border-radius:50%; }
  .zmap-hint { position:absolute; left:10px; bottom:8px; color:#cdc3a6; font-size:11px; opacity:.7;
    background:rgba(10,10,8,.5); padding:2px 7px; border-radius:5px; pointer-events:none; }
  .zmap-side { width:232px; flex:0 0 232px; display:flex; flex-direction:column; min-height:0;
    background:#1a170f; border-left:2px solid #0d0c08; }
  .zmap-search-wrap { padding:8px 8px 5px; border-bottom:1px solid #0d0c08; }
  .zmap-search { width:100%; box-sizing:border-box; padding:7px 9px; font-size:12px; color:#efe8d4;
    background:#14130f; border:1px solid #3a3527; border-radius:6px; font-family:inherit; }
  .zmap-search::placeholder { color:#8a8168; }
  .zmap-search:focus { outline:none; border-color:#8a7a3a; }
  .zmap-results { max-height:44%; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
  .zmap-results.zmap-has { margin-top:5px; }
  .zmap-res { display:flex; align-items:center; gap:7px; padding:5px 6px; border-radius:5px; cursor:pointer;
    background:transparent; border:1px solid transparent; color:#e9e2cf; font-size:12px; text-align:left; width:100%; font-family:inherit; }
  .zmap-res:hover { background:#2a2519; border-color:#3a3527; }
  .zmap-res-ico { width:16px; height:16px; flex:0 0 16px; } .zmap-res-ico svg { width:100%; height:100%; display:block; }
  .zmap-res-nm { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .zmap-res-d { color:#8a8168; font-size:10px; flex:0 0 auto; }
  .zmap-nohit { color:#8a8168; font-size:11px; font-style:italic; padding:4px 6px; }
  .zmap-legend { flex:1; overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:2px; }
  .zmap-lg { display:flex; align-items:center; border-radius:6px; border:1px solid transparent; }
  .zmap-lg:hover { background:#26221a; border-color:#3a3527; }
  .zmap-lg.zmap-off { opacity:.4; }
  .zmap-lg-main { flex:1; display:flex; align-items:center; gap:8px; padding:5px 7px; cursor:pointer; min-width:0;
    background:none; border:none; color:#e9e2cf; font-size:12px; text-align:left; font-family:inherit; }
  .zmap-lg-ico { width:18px; height:18px; flex:0 0 18px; } .zmap-lg-ico svg { width:100%; height:100%; display:block; }
  .zmap-lg-lbl { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .zmap-lg-n { color:#8a8168; font-size:11px; }
  .zmap-lg-eye { flex:0 0 24px; width:24px; height:26px; background:none; border:none; cursor:pointer; color:#7a7256; padding:0; }
  .zmap-lg-eye:hover { color:#e8c65a; } .zmap-lg-eye svg { width:15px; height:15px; display:block; margin:auto; }
  .zmap-off .zmap-lg-eye { color:#4a4638; }
  .zmap-mk.zmap-flash { animation:zmapFlash 1.9s ease-out; z-index:5; }
  @keyframes zmapFlash {
    0%,100% { transform:scale(1); }
    12% { transform:scale(2.2); filter:drop-shadow(0 0 6px #fff) drop-shadow(0 0 13px var(--mk)); }
    60% { transform:scale(1.35); filter:drop-shadow(0 0 5px var(--mk)); }
  }
  @media (max-width:620px){ .zmap-side{ width:168px; flex-basis:168px; } .zmap-panel{ height:94vh; } }
  `;
  document.head.appendChild(s);
}

// ---- public init: take over the map button without touching main.js ---------
let inited = false;
export function initWorldMap() {
  if (inited) return;
  inited = true;
  // Capturing listeners fire BEFORE main.js's #map-btn.onclick / window keydown,
  // so stopImmediatePropagation lets us open OUR overlay and suppress the old one
  // — regardless of init order and without editing main.js.
  const btn = document.getElementById('map-btn');
  if (btn) btn.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); open(); }, true);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && document.activeElement === document.body) {
      e.stopImmediatePropagation(); isOpen() ? close() : open();
    } else if (e.key === 'Escape' && isOpen()) {
      e.stopImmediatePropagation(); close();
    }
  }, true);
}
