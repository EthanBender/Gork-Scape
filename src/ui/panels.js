// src/ui/panels.js
// Builds the right-hand tabbed panel (Skills / Inventory / Equipment / Combat),
// the top bar, and the chat log, all as plain DOM driven by `Game`.

import {
  Game, equipItem, unequipItem, removeAt, playerCombatLevel, totalBonuses,
  playerAttackRange, needsAmmo, ammoCount, playerProfile,
  grantXp, prayerLevel, togglePrayer,
  bankDeposit, bankDepositAll, bankWithdraw, nextBankSpaceCost, buyBankSpace, BANK_SPACE_CHUNK,
  weaponSpec, toggleSpec, forgeBossWeapon, SPEC_MAX,
  spawnGroundItem,
} from '../engine/state.js';
import { unlockedPrayers } from '../engine/prayer.js';
import { maxHit, maxAttackRoll } from '../engine/combat.js';
import { SKILL_NAMES, levelProgress } from '../engine/skills.js';
import { EQUIP_SLOTS, STAT_KEYS, itemView } from '../items/equipment.js';
import { splitList, GameData } from '../data/gameData.js';
import { itemIcon, itemIconHTML } from '../data/itemIcons.js';
import { recipesForStation, craft, stationTypes } from '../systems/crafting.js';
import { rollMonsterDrops } from '../systems/drops.js';
import { gather, resolveNode } from '../systems/gathering.js';
import { market } from '../systems/grandExchange.js';
import {
  buyOffer, sellOffer, cancelOffer, collectOffer, playerOffers,
  playerCoins, countTotal, ensureLiquidity, geTax, mmInfo, marketEvent,
} from '../systems/geActions.js';
import { checkHeist, heistView, resolveHeistVictory } from '../systems/treasuryHeist.js';
import { startWorldChat, playerSay, cheerLevel } from '../systems/worldChat.js';
import { shopStock, buyFromShop, sellToShop } from '../systems/shops.js';
import { lightFireAt } from '../systems/firemaking.js'; // [economy lane] Firemaking
import { renderAlchemy } from '../systems/alchemy.js'; // [economy lane] Alchemy skill
import { questBoard, startQuest } from '../systems/quests.js'; // [economy lane] quest journal

// Tiny inline SVG sparkline of recent trade prices for the GE price chart.
function sparkline(prices, w = 160, h = 34) {
  if (!prices || prices.length < 2) {
    return `<svg width="${w}" height="${h}"><text x="4" y="20" fill="#a89c7d" font-size="10">no trades yet</text></svg>`;
  }
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const span = hi - lo || 1;
  const step = w / (prices.length - 1);
  const pts = prices.map((p, i) => `${(i * step).toFixed(1)},${(h - 3 - ((p - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  const up = prices[prices.length - 1] >= prices[0];
  const col = up ? '#7bbf4a' : '#c9556a';
  return `<svg width="${w}" height="${h}" style="display:block">`
    + `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
}

// Build a rich, plain-text tooltip for an inventory/equipment item from the
// merged item view (render overlay + economy metadata from items.json).
export function itemTooltip(id, fallbackName) {
  const view = itemView(id);
  if (!view) return fallbackName || id;
  const lines = [view.name];
  const m = view.meta;
  if (m) {
    if (m.category) lines.push(m.subcategory ? `${m.category} · ${m.subcategory}` : m.category);
    if (m.level_requirement > 1 && m.related_skill) {
      lines.push(`Requires ${m.related_skill} ${m.level_requirement}`);
    }
    const uses = splitList(m.used_in_recipes).concat(splitList(m.unlocks_or_supports));
    if (uses.length) lines.push(`Used for: ${uses.slice(0, 4).join(', ')}`);
    if (m.gp_value) lines.push(`Value: ${m.gp_value} gp`);
    if (m.stackable) lines.push('Stackable');
  }
  const o = view.overlay;
  if (o && o.heal) lines.push(`Heals ${o.heal} HP`);
  if (o && o.slot) lines.push(`Equips: ${o.slot}`);
  return lines.join('\n');
}

// ---------- Custom item tooltip (OSRS-style hover card) ----------
const tipEsc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Rich HTML version of itemTooltip for the floating hover card.
function itemTooltipHTML(id, fallbackName, hint) {
  const view = itemView(id);
  if (!view) return `<div class="tip-name">${tipEsc(fallbackName || id)}</div>`;
  const m = view.meta, o = view.overlay;
  let html = `<div class="tip-name">${tipEsc(view.name)}</div>`;
  const rows = [];
  if (m) {
    if (m.category) rows.push(`<span class="tip-dim">${tipEsc(m.subcategory ? `${m.category} · ${m.subcategory}` : m.category)}</span>`);
    if (m.level_requirement > 1 && m.related_skill) rows.push(`<span class="tip-req">Requires ${tipEsc(m.related_skill)} ${m.level_requirement}</span>`);
  }
  if (o && o.slot) rows.push(`Equips: ${tipEsc(o.slot)}`);
  if (o && o.heal) rows.push(`<span class="tip-good">Heals ${o.heal} HP</span>`);
  if (m) {
    const uses = splitList(m.used_in_recipes).concat(splitList(m.unlocks_or_supports));
    if (uses.length) rows.push(`<span class="tip-dim">Used for: ${tipEsc(uses.slice(0, 4).join(', '))}</span>`);
  }
  for (const r of rows) html += `<div class="tip-row">${r}</div>`;
  if (m && m.gp_value) html += `<div class="tip-value">${Number(m.gp_value).toLocaleString()} gp${m.stackable ? ' · stackable' : ''}</div>`;
  if (hint) html += `<div class="tip-row tip-hint">${tipEsc(hint)}</div>`;
  return html;
}

let tipEl = null;
function showTip(html, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'item-tip';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  moveTip(x, y);
}
function moveTip(x, y) {
  if (!tipEl || tipEl.hidden) return;
  const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let nx = x + pad, ny = y + pad;
  if (nx + w > window.innerWidth - 6) nx = x - w - pad;
  if (ny + h > window.innerHeight - 6) ny = y - h - pad;
  tipEl.style.left = Math.max(6, nx) + 'px';
  tipEl.style.top = Math.max(6, ny) + 'px';
}
function hideTip() { if (tipEl) tipEl.hidden = true; }

// Attach hover-card behaviour to a slot element for a given item.
function bindTip(el, id, name, hint) {
  el.onmouseenter = (e) => showTip(itemTooltipHTML(id, name, hint), e.clientX, e.clientY);
  el.onmousemove = (e) => moveTip(e.clientX, e.clientY);
  el.onmouseleave = hideTip;
}

// Long-press → context menu on touch devices (no right-click on a phone). Fires
// handler(x, y) after a stationary ~450ms press; cancels on move/lift; swallows
// the trailing synthetic click so a long-press can't also equip the item.
function bindLongPress(el, handler) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fired = false;
    hideTip();
    timer = setTimeout(() => { fired = true; handler(sx, sy); }, 450);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t && (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10)) clear();
  }, { passive: true });
  el.addEventListener('touchend', (e) => { clear(); if (fired) e.preventDefault(); });
  el.addEventListener('touchcancel', clear);
}

const SKILL_COLORS = {
  Woodcutting: '#2e7d32', Fishing: '#4fa3c7', Mining: '#9c6b3a',
  Cooking: '#d2691e', Firemaking: '#c1440e', Smithing: '#777', Crafting: '#8b5a2b',
  Attack: '#b03030', Strength: '#2f7d4f', Defence: '#3d5a9e',
  Ranged: '#5a8f3d', Prayer: '#c9b458', Alchemy: '#8e5ea8', Tinkering: '#b8863a',
};

const STYLES = ['Accurate', 'Aggressive', 'Defensive', 'Controlled'];

const SKILL_EMOJI = {
  Woodcutting: '🪓', Fishing: '🎣', Mining: '⛏️', Cooking: '🍳',
  Firemaking: '🔥', Smithing: '🔨', Crafting: '🧵', Attack: '⚔️', Strength: '💪',
  Defence: '🛡️', Ranged: '🏹', Prayer: '🙏', Alchemy: '⚗️', Tinkering: '🔧', Hitpoints: '❤️',
};

// ---------- Progression flourishes (xp drops + level-up banner) ----------
// Overlay layer pinned over the game view; created lazily.
function fxLayer() {
  let l = document.getElementById('fx-layer');
  if (!l) {
    l = document.createElement('div');
    l.id = 'fx-layer';
    (document.getElementById('game-panel') || document.body).appendChild(l);
  }
  return l;
}

// Floating "+40 Woodcutting" that rises and fades (OSRS xp drop).
function showXpDrop(skill, amount) {
  const amt = Math.round(amount);
  if (amt <= 0) return;
  const d = document.createElement('div');
  d.className = 'xp-drop';
  const col = SKILL_COLORS[skill] || 'var(--gold)';
  d.innerHTML = `<span class="xp-dot" style="background:${col}"></span>`
    + `<span class="xp-amt">+${amt.toLocaleString()}</span>`
    + `<span class="xp-skill">${SKILL_EMOJI[skill] || ''} ${skill}</span>`;
  fxLayer().appendChild(d);
  d.addEventListener('animationend', () => d.remove());
  // Safety net if animationend doesn't fire.
  setTimeout(() => d.remove(), 2000);
}

// Gold banner celebrating a new level; auto-dismisses.
function showLevelUp(skill, level) {
  const b = document.createElement('div');
  b.className = 'levelup-banner';
  b.innerHTML = `<div class="lu-icon">${SKILL_EMOJI[skill] || '⭐'}</div>`
    + `<div class="lu-text"><b>${skill} Level ${level}</b>`
    + `<span>Congratulations, Gork!</span></div>`;
  fxLayer().appendChild(b);
  setTimeout(() => { b.classList.add('out'); }, 2400);
  setTimeout(() => b.remove(), 3000);
  cheerLevel(skill, level); // a "player" might gz you in world chat
}

// Registered as Game.ui.onXp — called once per XP grant from state.grantXp.
function onXp(skill, amount, leveledTo) {
  showXpDrop(skill, amount);
  if (leveledTo) showLevelUp(skill, leveledTo);
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// OSRS stack coloring: yellow < 100k, white 100k–10M, green ≥ 10M.
function qtyStyle(n) {
  if (n >= 10000000) return { color: '#33e83d', text: Math.floor(n / 1000000) + 'M' };
  if (n >= 100000) return { color: '#ffffff', text: Math.floor(n / 1000) + 'K' };
  return { color: '#ffff2e', text: n.toLocaleString() };
}

let els = {};

export function initPanels() {
  buildLayout();
  Game.ui = {
    appendLog,
    renderSkills,
    renderInventory,
    renderEquipment,
    renderCombat,
    renderTopBar,
    renderStations,
    renderAlchemy: () => renderAlchemy(els.views.alchemy),
    renderGrandExchange,
    renderShop,
    renderBank,
    renderQuests,
    onQuestComplete,
    showDialogue,
    onXp,
    postChat,
  };
  switchTab('skills');
  Game.refresh();
  // backfill any log lines emitted before the panel existed
  els.chatlog.innerHTML = '';
  for (const l of Game.logLines) appendLog(l);
  buildChatInput();
  startWorldChat();
}

function buildLayout() {
  els.tabbar = document.getElementById('tabbar');
  els.panel = document.getElementById('panel-content');
  els.chatlog = document.getElementById('chatlog');

  const tabs = [
    ['skills', 'Skills', '📊'], ['quests', 'Quests', '📜'],
    ['inventory', 'Inventory', '🎒'],
    ['equipment', 'Equipment', '🛡️'], ['combat', 'Combat', '⚔️'],
    ['stations', 'Stations', '🔨'], ['alchemy', 'Alchemy', '⚗️'],
    ['ge', 'Exchange', '💰'],
    ['shop', 'Shop', '🏪'], ['bank', 'Bank', '🏦'],
  ];
  els.tabButtons = {};
  // [economy lane] Exchange + Stations are opened from the WORLD (merchant /
  // anvil), not a persistent tab — the views still exist, they just get no button.
  const NO_BUTTON = new Set(['ge', 'stations', 'shop', 'bank']);
  for (const [id, label, icon] of tabs) {
    if (NO_BUTTON.has(id)) continue;
    const b = document.createElement('button');
    b.className = 'tab-btn';
    b.title = label;
    b.innerHTML = `<span class="tab-icon">${icon}</span><span class="tab-label">${label}</span>`;
    b.onclick = () => switchTab(id);
    els.tabbar.appendChild(b);
    els.tabButtons[id] = b;
  }

  // One container div per tab.
  els.views = {};
  for (const [id] of tabs) {
    const v = document.createElement('div');
    v.className = 'tab-view';
    v.style.display = 'none';
    els.panel.appendChild(v);
    els.views[id] = v;
  }
}

let activeTab = 'skills';
let lastNormalTab = 'skills';
// [economy lane] World-opened panels — reached by talking to an NPC / clicking a
// station, no tab button, and auto-closed when the player walks away (main.js).
const WORLD_PANELS = new Set(['ge', 'stations', 'shop', 'bank']);
function switchTab(id) {
  activeTab = id;
  if (!WORLD_PANELS.has(id)) lastNormalTab = id;
  hideTip();
  for (const key of Object.keys(els.views)) {
    els.views[key].style.display = key === id ? 'block' : 'none';
    if (els.tabButtons[key]) els.tabButtons[key].classList.toggle('active', key === id);
  }
  Game.refresh();
}

// [economy lane] The world (main.js) reads the active panel + can close a
// world-opened panel (shop/bank/exchange/stations) when you leave the asset.
export function activePanel() { return activeTab; }
export function closeWorldPanels() { if (WORLD_PANELS.has(activeTab)) switchTab(lastNormalTab || 'inventory'); }

// [economy lane] Shared header for world-opened panels (shop/bank/exchange/
// station): names what you're interacting with + a ✕ to close by hand (walking
// away also closes it — see main.js panelAnchor).
function worldHeader(v, icon, title) {
  const h = document.createElement('div');
  h.className = 'wp-header';
  const t = document.createElement('span');
  t.className = 'wp-title'; t.textContent = `${icon} ${title}`;
  const x = document.createElement('button');
  x.className = 'wp-close'; x.title = 'Close'; x.textContent = '✕';
  x.onclick = () => closeWorldPanels();
  h.appendChild(t); h.appendChild(x); v.appendChild(h);
}

// ---------- Top bar ----------
export function renderTopBar() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('tb-name', 'Gork');
  set('tb-combat', 'Combat Lv ' + playerCombatLevel());
  set('tb-location', Game.location);
  const gpEl = document.getElementById('tb-gp');
  if (gpEl) { const gp = playerCoins(); gpEl.textContent = gp.toLocaleString(); gpEl.style.color = qtyStyle(gp).color; }
  set('tb-tick', 'Tick ' + (Game.ticker ? Game.ticker.count : 0));

  // Perf probe: live render FPS + active NPC count, so the "135 rigs at 60fps"
  // claim is actually measured rather than asserted. Phaser tracks a smoothed
  // actualFps on the game loop; pair it with the live NPC count (drive it up with
  // window.__GE.stress(n) to stress-test). Colour: green ≥50, amber ≥30, red below.
  const fpsEl = document.getElementById('tb-fps');
  if (fpsEl) {
    const loop = Game.scene && Game.scene.game && Game.scene.game.loop;
    const fps = loop ? Math.round(loop.actualFps) : 0;
    const npcs = Array.isArray(Game.npcs) ? Game.npcs.length : 0;
    fpsEl.textContent = `${fps} fps · ${npcs} npc`;
    fpsEl.style.color = fps >= 50 ? 'var(--accent, #7bbf4a)' : fps >= 30 ? 'var(--gold, #e8c65a)' : '#ff8a8a';
  }
}

// ---------- Skills ----------
export function renderSkills() {
  const v = els.views.skills;
  v.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'skills-grid';
  for (const name of SKILL_NAMES) {
    const sk = Game.skills[name];
    const prog = levelProgress(sk.xp);
    const cell = document.createElement('div');
    cell.className = 'skill-cell';
    const next = GameData.nextSkillUnlock(name.toLowerCase(), prog.level);
    const nextLine = next
      ? `<div class="skill-next">Next: ${next.display_name} @ Lv ${next.level}</div>`
      : '';
    cell.innerHTML = `
      <span class="skill-icon" style="background:${SKILL_COLORS[name]}"></span>
      <div class="skill-info">
        <div class="skill-top"><span>${name}</span><span class="lvl">${prog.level}/99</span></div>
        <div class="xpbar"><div class="xpfill" style="width:${Math.round(prog.ratio * 100)}%"></div></div>
        <div class="xptext">${Math.floor(sk.xp).toLocaleString()} xp</div>
        ${nextLine}
      </div>`;
    cell.classList.add('sg-clickable');
    cell.title = 'View unlock guide';
    cell.onclick = () => showSkillGuide(name);
    grid.appendChild(cell);
  }
  v.appendChild(grid);

  const hp = document.createElement('div');
  hp.className = 'skill-foot';
  hp.textContent = `Hitpoints ${Game.hitpoints.level} · ${Game.hp}/${Game.maxHp} HP`;
  v.appendChild(hp);
}

// ---------- Skill guide popup (RuneScape-style level unlock list) ----------
// Clicking a skill opens a modal listing every unlock for it by level, marking
// which are already available (✓) vs still locked (🔒) at the player's level.
function showSkillGuide(name) {
  const skill = name.toLowerCase();
  const level = levelProgress(Game.skills[name].xp).level;
  const unlocks = (GameData.levelUnlocks || [])
    .filter((u) => u.skill === skill && u.display_name)
    .sort((a, b) => a.level - b.level || String(a.display_name).localeCompare(b.display_name));
  const rows = unlocks.length
    ? unlocks.map((u) => {
        const open = level >= u.level;
        const kind = u.unlock_type === 'world_node' ? 'node' : 'item';
        return `<div class="sg-row ${open ? 'sg-open' : 'sg-locked'}">
          <span class="sg-lvl">${u.level}</span>
          <span class="sg-name">${tipEsc(u.display_name)}</span>
          <span class="sg-kind">${kind}</span>
          <span class="sg-state">${open ? '✓' : '🔒'}</span>
        </div>`;
      }).join('')
    : '<div class="sg-empty">No level unlocks are recorded for this skill yet.</div>';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = () => close();
  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.onclick = (e) => e.stopPropagation();
  panel.innerHTML = `
    <div class="modal-head">
      <span class="modal-title">${SKILL_EMOJI[name] || ''} ${name} — Level ${level}/99</span>
      <button class="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal-sub">${unlocks.length} unlock${unlocks.length === 1 ? '' : 's'} · ✓ available now · 🔒 locked</div>
    <div class="modal-body skill-guide">${rows}</div>`;
  overlay.appendChild(panel);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  panel.querySelector('.modal-close').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// ---------- Quest Journal ----------
// The player-facing goals view. Reads the quest engine's board (active /
// available / complete) and renders each with live per-step progress bars and
// its reward. Available quests get a Start button; the engine auto-completes and
// pays out when objectives are met, so there's no "hand in" click to forget.
const REWARD_ICON = { coins: '🪙' };
function rewardSummary(r) {
  if (!r) return '';
  const bits = [];
  if (r.coins) bits.push(`${r.coins} coins`);
  if (Array.isArray(r.xp)) for (const x of r.xp) bits.push(`${x.amount} ${x.skill} xp`);
  if (Array.isArray(r.items)) for (const it of r.items) {
    const def = GameData.item(it.id);
    const name = (def && def.display_name) || it.id;
    bits.push(`${it.qty && it.qty > 1 ? it.qty + '× ' : ''}${name}`);
  }
  if (r.bankSpace) bits.push(`+${r.bankSpace} bank slots`);
  if (r.openShortcut) bits.push('opens a shortcut');
  return bits.join(' · ');
}
function questCard(q, opts = {}) {
  const card = document.createElement('div');
  card.className = 'quest-card'
    + (q.status === 'complete' ? ' quest-done' : '')
    + (q.status === 'active' ? ' quest-active' : '');
  const giverName = q.giver && q.giver.name ? q.giver.name : '';

  // Steps: past = done, the one you're on = current (with a live counter/bar),
  // future = plain. Only counted objectives show N/need + a bar.
  let stepsHtml = '';
  if (opts.showSteps && q.steps.length) {
    stepsHtml = '<div class="quest-steps">' + q.steps.map((s) => {
      const cls = s.done ? 'qs-done' : (s.current ? 'qs-current' : 'qs-todo');
      const check = s.done ? '✔' : (s.current ? '▸' : '○');
      const counted = (s.type === 'kill' || s.type === 'obtain' || s.type === 'level') && s.need > 1;
      const count = counted ? `<span class="qs-count">${s.have}/${s.need}</span>` : '';
      const pct = s.need ? Math.round((s.have / s.need) * 100) : 0;
      const bar = (s.current && counted) ? `<span class="qs-bar"><span class="qs-fill" style="width:${pct}%"></span></span>` : '';
      return `<div class="quest-step ${cls}"><span class="qs-check">${check}</span>`
        + `<span class="qs-text">${tipEsc(s.text)}</span>${count}${bar}</div>`;
    }).join('') + '</div>';
  }

  // The current step's dialogue/direction — the "he tells you where to go" line.
  const dir = (q.current && q.current.say)
    ? `<div class="quest-directions">“${tipEsc(q.current.say)}”</div>` : '';
  // Available quests are STARTED by finding the giver, not a button.
  const startHint = (q.status === 'available' && giverName)
    ? `<div class="quest-starthint">Speak to <b>${tipEsc(giverName)}</b> to begin — follow the ✦ marker on your map.</div>` : '';

  card.innerHTML = `
    <div class="quest-head">
      <span class="quest-name">${tipEsc(q.name)}</span>
      <span class="quest-badge q-${q.status}">${q.status === 'active' ? `${q.done}/${q.total}` : q.status}</span>
    </div>
    ${giverName ? `<div class="quest-giver">${tipEsc(giverName)}</div>` : ''}
    <div class="quest-summary">${tipEsc(q.summary || '')}</div>
    ${dir}
    ${stepsHtml}
    ${startHint}
    ${q.rewards ? `<div class="quest-reward">Reward: ${tipEsc(rewardSummary(q.rewards))}</div>` : ''}`;
  return card;
}
export function renderQuests() {
  const v = els.views.quests;
  if (!v) return;
  v.innerHTML = '';
  const board = questBoard();

  const header = document.createElement('div');
  header.className = 'quest-header';
  header.innerHTML = `<span class="qh-title">📜 Quest Journal</span>`
    + `<span class="qh-count">${board.completedCount}/${board.total} complete</span>`;
  v.appendChild(header);

  const section = (title, list, opts) => {
    if (!list.length) return;
    const h = document.createElement('div');
    h.className = 'quest-section-label';
    h.textContent = title;
    v.appendChild(h);
    for (const q of list) v.appendChild(questCard(q, opts));
  };

  if (!board.active.length && !board.available.length && !board.complete.length) {
    const empty = document.createElement('div');
    empty.className = 'quest-empty';
    empty.textContent = 'No quests yet — talk to the goblins of the settlement.';
    v.appendChild(empty);
    return;
  }
  section('In progress', board.active, { showSteps: true });
  section('Available — find the giver', board.available, { showSteps: false });
  section('Completed', board.complete, { showSteps: false });
  if (board.locked.length) {
    const h = document.createElement('div');
    h.className = 'quest-section-label';
    h.textContent = `Locked (${board.locked.length})`;
    v.appendChild(h);
    const note = document.createElement('div');
    note.className = 'quest-empty';
    note.textContent = 'Complete earlier quests to unlock these.';
    v.appendChild(note);
  }
}
// Celebration banner when a quest completes (reuses the level-up flourish layer
// + its markup/animation, so it matches the existing level-up moment).
function onQuestComplete(q) {
  const b = document.createElement('div');
  b.className = 'levelup-banner quest-banner';
  b.innerHTML = `<div class="lu-icon">📜</div>`
    + `<div class="lu-text"><b>Quest Complete</b><span>${tipEsc(q.name)}</span></div>`;
  fxLayer().appendChild(b);
  setTimeout(() => { b.classList.add('out'); }, 2400);
  setTimeout(() => b.remove(), 3000);
}
export function openQuests() { switchTab('quests'); }

// A speech box over the game view for quest-giver lines ("head east to the
// yard..."). Registered as Game.ui.showDialogue; the quest engine calls it on
// start / step-advance / turn-in. Click to dismiss, else auto-hides.
let dialogueTimer = null;
function showDialogue(speaker, lines) {
  const host = document.getElementById('game-panel') || document.body;
  let box = document.getElementById('dialogue-box');
  if (!box) { box = document.createElement('div'); box.id = 'dialogue-box'; host.appendChild(box); }
  box.innerHTML = `<div class="dlg-speaker">${tipEsc(speaker)}</div>`
    + (lines || []).map((l) => `<div class="dlg-line">${tipEsc(l)}</div>`).join('')
    + `<div class="dlg-dismiss">▸ click to dismiss</div>`;
  box.hidden = false;
  box.onclick = () => { box.hidden = true; };
  if (dialogueTimer) clearTimeout(dialogueTimer);
  dialogueTimer = setTimeout(() => { if (box) box.hidden = true; }, 9000);
}

// ---------- Stations (data-driven crafting) ----------
let currentStation = 'furnace';
// Friendly labels; the world's station tiles map to these DB station ids.
const STATION_LABELS = {
  furnace: 'Furnace', anvil: 'Anvil', range: 'Cooking Range',
  fire_or_range: 'Cooking Fire',
  fire: 'Campfire', crafting_bench: 'Crafting Bench', sawmill: 'Sawmill',
};

export function renderStations() {
  const v = els.views.stations;
  if (!v) return;
  v.innerHTML = '';

  // [economy lane] You're physically AT one station (opened by clicking it in
  // the world), so no switcher — just this station's header + recipes.
  const stations = stationTypes();
  if (!stations.includes(currentStation)) currentStation = stations[0];
  worldHeader(v, '🔨', STATION_LABELS[currentStation] || currentStation);

  const hint = document.createElement('div');
  hint.className = 'xptext';
  hint.style.margin = '4px 2px 8px';
  hint.textContent = `${STATION_LABELS[currentStation] || currentStation} — recipes read from recipes.json`;
  v.appendChild(hint);

  // Recipe list (available first, then locked — locked stay visible for goals).
  const list = recipesForStation(currentStation)
    .sort((a, b) => (b.available - a.available) || (a.need - b.need));
  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'recipe-row' + (r.available ? '' : ' locked');

    const out = GameData.item(r.recipe.output_item_id);
    const inputStr = r.inputs
      .map((i) => `${i.qty}× ${i.token}${i.kind === 'tool' ? ' (tool)' : ''} ${i.have >= i.qty ? '✓' : `(${i.have}/${i.qty})`}`)
      .join(', ');

    const info = document.createElement('div');
    info.className = 'recipe-info';
    info.innerHTML =
      `<div class="recipe-name">${(out && out.display_name) || r.recipe.output_item_id}`
      + `${r.recipe.output_qty > 1 ? ' ×' + r.recipe.output_qty : ''}</div>`
      + `<div class="recipe-meta">${r.skill} ${r.need}`
      + `${r.haveLevel ? '' : ' 🔒'} · +${r.recipe.xp_reward || 0} xp</div>`
      + `<div class="recipe-inputs">${inputStr || '(no inputs)'}</div>`;

    const btn = document.createElement('button');
    btn.className = 'craft-btn';
    btn.textContent = r.available ? 'Craft' : (r.haveLevel ? 'Need mats' : 'Locked');
    btn.disabled = !r.available;
    btn.onclick = () => {
      const res = craft(r.recipe.recipe_id);
      if (!res.ok) Game.log(`Can't craft: ${res.reason}.`);
      renderStations();
    };

    row.appendChild(info);
    row.appendChild(btn);
    v.appendChild(row);
  }
}

// ---------- Grand Exchange (player-driven market) ----------
let geSelected = null; // selected item id
const GE_RANGE = 3;    // tiles from the Exchange Merchant needed to trade

// The GE is a PHYSICAL place: you can only trade near the Exchange Merchant in
// the Grand Bazaar (central city). Returns the merchant NPC if in range, else null.
function exchangeMerchantInRange() {
  const p = Game.player;
  const m = Game.npcs && Game.npcs.find((n) => n.id === 'exchange_merchant');
  if (!p || !m) return null;
  const dist = Math.abs(p.tileX - m.tileX) + Math.abs(p.tileY - m.tileY);
  return dist <= GE_RANGE ? m : null;
}

// Talking to the merchant jumps you to the Exchange tab (called from main.js).
export function openExchange() { switchTab('ge'); }
// [economy lane] Open the data-driven crafting UI for a specific station type,
// triggered by clicking that station in the world (furnace/anvil/range/bench).
export function openStation(stationType) { if (stationType) currentStation = stationType; switchTab('stations'); }

export function renderGrandExchange() {
  const v = els.views.ge;
  if (!v) return;
  v.innerHTML = '';
  worldHeader(v, '🏛️', 'Grand Exchange');

  // Gate: must be at the Grand Bazaar with the Exchange Merchant.
  if (!exchangeMerchantInRange()) {
    const gate = document.createElement('div');
    gate.className = 'ge-gate';
    gate.innerHTML = `<div class="ge-gate-title">🏛️ Grand Exchange</div>`
      + `<div class="ge-gate-body">The Exchange is only open at the <b>Grand Bazaar</b> in the`
      + ` central city. Travel there and speak to the <b>Exchange Merchant</b> to buy and sell.</div>`;
    v.appendChild(gate);
    return;
  }

  // Coins header.
  const head = document.createElement('div');
  head.className = 'ge-head';
  head.innerHTML = `<span class="stat-title" style="margin:0">Grand Exchange</span>`
    + `<span class="ge-coins">${playerCoins().toLocaleString()} coins</span>`;
  v.appendChild(head);

  // Goblin Treasury heist cycle — the 2% sell tax pools into a hoard that lures
  // a dragon. Poll the trigger each render (idempotent).
  checkHeist();
  const hv = heistView();
  if (hv.phase === 'raided') {
    // The dragon has struck — show the raid alert + a way to confront it.
    const raid = document.createElement('div');
    raid.className = 'ge-raid';
    raid.innerHTML = `<div class="ge-raid-title">🐉 ${hv.dragon.name} — Lv ${hv.bossLevel}</div>`
      + `<div class="ge-raid-body">The dragon looted <b>${hv.hoard.toLocaleString()} gp</b> and `
      + `carried it to its lair. Slay it to reclaim ${Math.round(hv.hoard * 0.6).toLocaleString()} gp `
      + `(split on a team) plus its hoard drops.</div>`;
    const btn = document.createElement('button');
    btn.className = 'ge-raid-btn';
    btn.textContent = '⚔️ Confront the Dragon';
    btn.title = 'Temporary — the real lair fight is being wired by the world/combat lane';
    btn.onclick = () => { resolveHeistVictory(['player']); renderGrandExchange(); };
    raid.appendChild(btn);
    v.appendChild(raid);
  } else {
    // Hoarding — a meter fills toward the dragon threshold.
    const pct = Math.round(hv.ratio * 100);
    const treas = document.createElement('div');
    treas.className = 'ge-treasury';
    treas.innerHTML = `<div class="ge-treasury-head"><span>🏛️ Goblin Treasury</span>`
      + `<span class="ge-treasury-bal">${hv.balance.toLocaleString()} / ${hv.threshold.toLocaleString()} gp</span></div>`
      + `<div class="ge-hoard"><span class="ge-hoard-fill" style="width:${pct}%"></span>`
      + `<span class="ge-hoard-dragon" title="A dragon is drawn to large hoards">🐉</span></div>`
      + `<div class="ge-treasury-note">2% sell tax feeds the hoard`
      + `${hv.tier > 0 ? ` · ${hv.tier} raid${hv.tier > 1 ? 's' : ''} survived` : ''}. `
      + `A dragon raids when it fills.</div>`;
    treas.title = `${geTax.totalSunk.toLocaleString()} coins collected via the 2% sell tax`;
    v.appendChild(treas);
  }

  // Active market event banner (demand shock).
  if (marketEvent.active) {
    const ev = document.createElement('div');
    ev.className = 'ge-event';
    ev.innerHTML = `<b>${marketEvent.active.name}</b> ${marketEvent.active.msg}`;
    v.appendChild(ev);
  }

  // Distinct sellable inventory items -> quick-select + sell.
  const invIds = [...new Set(Game.inventory.filter(Boolean).map((s) => s.id))]
    .filter((id) => id !== 'coins');
  if (!geSelected && invIds.length) geSelected = invIds[0];

  const chips = document.createElement('div');
  chips.className = 'ge-chips';
  for (const id of invIds) {
    const c = document.createElement('button');
    c.className = 'ge-chip' + (id === geSelected ? ' active' : '');
    const it = GameData.item(id);
    c.textContent = `${(it && it.display_name) || id} ×${countTotal(id)}`;
    c.onclick = () => { geSelected = id; renderGrandExchange(); };
    chips.appendChild(c);
  }
  if (!invIds.length) chips.innerHTML = '<div class="xptext">Inventory empty — buy something below.</div>';
  v.appendChild(chips);

  // Selected-item market panel: guide/bid/ask + buy & sell forms.
  if (geSelected) {
    ensureLiquidity(geSelected);
    const q = market.quote(geSelected);
    const s = market.stats(geSelected);
    const it = GameData.item(geSelected);
    const depth = mmInfo(geSelected);
    const pct = depth.target ? Math.max(0, Math.min(100, Math.round((depth.stock / depth.target) * 100))) : 0;
    const supply = pct <= 5 ? 'critically low' : pct < 25 ? 'low' : pct < 60 ? 'moderate' : 'plentiful';
    const supplyCls = pct < 25 ? 'ge-supply-low' : pct < 60 ? 'ge-supply-mid' : 'ge-supply-hi';
    const panel = document.createElement('div');
    panel.className = 'ge-market';
    panel.innerHTML =
      `<div class="ge-item">${(it && it.display_name) || geSelected}</div>`
      + `<div class="ge-quote">Guide <b>${q.guide}</b> · Buy @ ${q.bestAsk ?? '—'} · Sell @ ${q.bestBid ?? '—'}</div>`
      + `<div class="ge-chart">${sparkline(market.history(geSelected, 40))}</div>`
      + `<div class="ge-quote">Last ${s.last} · Hi ${s.hi ?? '—'} · Lo ${s.lo ?? '—'} · Vol ${s.vol}</div>`
      + `<div class="ge-depth"><span>Market supply: <b class="${supplyCls}">${supply}</b></span>`
      + `<span class="ge-depth-bar"><span class="ge-depth-fill ${supplyCls}" style="width:${pct}%"></span></span></div>`;
    v.appendChild(panel);

    const guide = q.guide || 1;
    const form = document.createElement('div');
    form.className = 'ge-form';
    form.innerHTML = `
      <label>Qty <input id="ge-qty" type="number" min="1" value="1"></label>
      <label>Price <input id="ge-price" type="number" min="1" value="${guide}"></label>`;
    const buyBtn = document.createElement('button');
    buyBtn.className = 'ge-btn buy'; buyBtn.textContent = 'Buy';
    buyBtn.onclick = () => {
      const qty = +document.getElementById('ge-qty').value || 1;
      const price = +document.getElementById('ge-price').value || guide;
      const r = buyOffer(geSelected, qty, price);
      if (!r.ok) Game.log(`GE: ${r.reason}.`);
      renderGrandExchange();
    };
    const sellBtn = document.createElement('button');
    sellBtn.className = 'ge-btn sell'; sellBtn.textContent = 'Sell';
    sellBtn.onclick = () => {
      const qty = +document.getElementById('ge-qty').value || 1;
      const price = +document.getElementById('ge-price').value || guide;
      const r = sellOffer(geSelected, qty, price);
      if (!r.ok) Game.log(`GE: ${r.reason}.`);
      renderGrandExchange();
    };
    const btns = document.createElement('div'); btns.className = 'ge-btns';
    btns.appendChild(buyBtn); btns.appendChild(sellBtn);
    v.appendChild(form); v.appendChild(btns);
  }

  // Active offers (resting orders) with collect / cancel.
  const offers = playerOffers();
  const oh = document.createElement('div');
  oh.className = 'stat-title'; oh.style.marginTop = '10px';
  oh.textContent = `Your offers (${offers.length})`;
  v.appendChild(oh);
  for (const o of offers) {
    const it = GameData.item(o.itemId);
    const row = document.createElement('div');
    row.className = 'ge-offer ' + o.side;
    row.innerHTML = `<div class="ge-offer-info">${o.side.toUpperCase()} ${o.qty}× `
      + `${(it && it.display_name) || o.itemId} @ ${o.limit}`
      + `<span class="xptext"> · filled ${o.filled}</span></div>`;
    const collect = document.createElement('button');
    collect.className = 'ge-mini'; collect.textContent = 'Collect';
    collect.onclick = () => { collectOffer(o.id); renderGrandExchange(); };
    const cancel = document.createElement('button');
    cancel.className = 'ge-mini'; cancel.textContent = 'Cancel';
    cancel.onclick = () => { cancelOffer(o.id); renderGrandExchange(); };
    row.appendChild(collect); row.appendChild(cancel);
    v.appendChild(row);
  }
}

// ---------- Shop (NPC store, gated behind its Shopkeeper) ----------
let currentShop = 'general_store';
const SHOP_RANGE = 3;

// A shop is a physical place: only usable near its Shopkeeper NPC.
function shopkeeperInRange(shopId) {
  const p = Game.player;
  const k = Game.npcs && Game.npcs.find((n) => n.id === 'shopkeeper_' + shopId);
  if (!p || !k) return null;
  return (Math.abs(p.tileX - k.tileX) + Math.abs(p.tileY - k.tileY)) <= SHOP_RANGE ? k : null;
}

// Called from main.js when the player talks to a Shopkeeper.
export function openShop(shopId) { currentShop = shopId || 'general_store'; switchTab('shop'); }

export function renderShop() {
  const v = els.views.shop;
  if (!v) return;
  v.innerHTML = '';
  worldHeader(v, '🏪', (GameData.shop(currentShop)[0] || {}).shop_name || 'Shop');

  if (!shopkeeperInRange(currentShop)) {
    const gate = document.createElement('div');
    gate.className = 'ge-gate';
    gate.innerHTML = `<div class="ge-gate-title">🏪 Shop</div>`
      + `<div class="ge-gate-body">Shops are run by <b>Shopkeepers</b> in town. Stand next to a`
      + ` Shopkeeper and talk to them to browse their wares.</div>`;
    v.appendChild(gate);
    return;
  }

  const head = document.createElement('div');
  head.className = 'ge-head';
  const name = currentShop.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  head.innerHTML = `<span class="stat-title" style="margin:0">${name}</span>`
    + `<span class="ge-coins">${playerCoins().toLocaleString()} coins</span>`;
  v.appendChild(head);

  for (const row of shopStock(currentShop)) {
    const it = GameData.item(row.item_id);
    const r = document.createElement('div');
    r.className = 'recipe-row';
    r.innerHTML = `<div class="recipe-info"><div class="recipe-name">${(it && it.display_name) || row.item_id}</div>`
      + `<div class="recipe-meta">Buy ${row.buy_price} · Sell ${row.sell_price} · stock ${row.stock ?? '∞'}</div></div>`;
    const buy = document.createElement('button');
    buy.className = 'craft-btn'; buy.textContent = 'Buy';
    buy.onclick = () => { const res = buyFromShop(currentShop, row.item_id, 1); if (!res.ok) Game.log(`Shop: ${res.reason}.`); renderShop(); };
    r.appendChild(buy);
    v.appendChild(r);
  }

  // Sell-from-inventory: sell one of a held item this shop will take.
  const sellable = [...new Set(Game.inventory.filter(Boolean).map((s) => s.id))].filter((id) => id !== 'coins');
  if (sellable.length) {
    const t = document.createElement('div');
    t.className = 'stat-title'; t.style.marginTop = '10px'; t.textContent = 'Sell from inventory';
    v.appendChild(t);
    for (const id of sellable) {
      const it = GameData.item(id);
      const r = document.createElement('div');
      r.className = 'recipe-row';
      r.innerHTML = `<div class="recipe-info"><div class="recipe-name">${(it && it.display_name) || id} ×${countTotal(id)}</div></div>`;
      const sell = document.createElement('button');
      sell.className = 'ge-mini'; sell.textContent = 'Sell 1';
      sell.onclick = () => { const res = sellToShop(currentShop, id, 1); if (!res.ok) Game.log(`Shop: ${res.reason}.`); renderShop(); };
      r.appendChild(sell);
      v.appendChild(r);
    }
  }
}

// Debug/verification handle for the economy systems.
if (typeof window !== 'undefined') {
  window.__ECON = { recipesForStation, craft, rollMonsterDrops, gather, resolveNode };
  window.__GEX = { market, buyOffer, sellOffer, cancelOffer, collectOffer, playerOffers, playerCoins, ensureLiquidity };
  window.__SHOP = { openShop, buyFromShop, sellToShop, shopStock };
  window.__BANK = { openBank, bankDeposit, bankWithdraw, bankDepositAll };
}

// ---------- Bank (physical: usable only near the Banker) ----------
const BANK_RANGE = 3;
function bankerInRange() {
  const p = Game.player;
  const b = Game.npcs && Game.npcs.find((n) => n.id === 'banker');
  if (!p || !b) return null;
  return (Math.abs(p.tileX - b.tileX) + Math.abs(p.tileY - b.tileY)) <= BANK_RANGE ? b : null;
}
export function openBank() { switchTab('bank'); }

export function renderBank() {
  const v = els.views.bank;
  if (!v) return;
  v.innerHTML = '';
  worldHeader(v, '🏦', 'Bank');

  if (!bankerInRange()) {
    const gate = document.createElement('div');
    gate.className = 'ge-gate';
    gate.innerHTML = `<div class="ge-gate-title">🏦 Bank</div>`
      + `<div class="ge-gate-body">Your bank is only reachable at the <b>Bank</b> in town.`
      + ` Find the <b>Banker</b> and talk to them to deposit and withdraw.</div>`;
    v.appendChild(gate);
    return;
  }

  const used = Game.bank.length, cap = Game.bankMax || 120;
  const head = document.createElement('div');
  head.className = 'ge-head';
  head.innerHTML = `<span class="stat-title" style="margin:0">Bank of Gorkholm</span>`
    + `<span class="ge-coins" style="color:${used >= cap ? '#c9556a' : 'var(--muted)'}">${used} / ${cap} slots</span>`;
  const depAll = document.createElement('button');
  depAll.className = 'ge-mini'; depAll.textContent = 'Deposit all';
  depAll.onclick = () => { bankDepositAll(); renderBank(); };
  head.appendChild(depAll);
  v.appendChild(head);

  // Expand-bank control: buy +chunk slots for escalating GP (a coin sink), or
  // earn slots from quests via grantBankSpace().
  const cost = nextBankSpaceCost();
  const upg = document.createElement('button');
  upg.className = 'ge-mini'; upg.style.marginBottom = '8px';
  upg.textContent = `Buy +${BANK_SPACE_CHUNK} slots — ${cost.toLocaleString()} gp`;
  upg.onclick = () => { buyBankSpace(); renderBank(); };
  v.appendChild(upg);

  // Stored items — left-click withdraw 1, right-click withdraw all.
  const store = document.createElement('div');
  store.className = 'inv-grid';
  if (!Game.bank.length) store.innerHTML = '<div class="xptext">Your bank is empty. Deposit items below.</div>';
  for (const b of Game.bank) {
    const def = GameData.item(b.id) || ITEMS[b.id] || {};
    const name = def.display_name || (ITEMS[b.id] && ITEMS[b.id].name) || b.id;
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    slot.title = `${name} ×${b.qty} — click withdraw 1, right-click withdraw all`;
    const sq = document.createElement('div');
    sq.className = 'item-sq';
    sq.style.background = hex((ITEMS[b.id] && ITEMS[b.id].color) || 0x8a8a8a);
    sq.textContent = String(name).split(' ').map((w) => w[0]).join('').slice(0, 2);
    slot.appendChild(sq);
    const q = document.createElement('span'); q.className = 'item-qty';
    q.textContent = b.qty > 9999 ? Math.floor(b.qty / 1000) + 'k' : b.qty;
    slot.appendChild(q);
    slot.onclick = () => { bankWithdraw(b.id, 1); renderBank(); };
    slot.oncontextmenu = (e) => { e.preventDefault(); bankWithdraw(b.id, b.qty); renderBank(); };
    store.appendChild(slot);
  }
  v.appendChild(store);

  // Inventory strip — click to deposit.
  const t = document.createElement('div');
  t.className = 'stat-title'; t.style.marginTop = '10px'; t.textContent = 'Inventory — click to deposit';
  v.appendChild(t);
  const inv = document.createElement('div');
  inv.className = 'inv-grid';
  for (let i = 0; i < Game.inventory.length; i++) {
    const item = Game.inventory[i];
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (item) {
      slot.title = `${item.name || item.id} — click to deposit`;
      const sq = document.createElement('div');
      sq.className = 'item-sq';
      sq.style.background = hex(item.color || 0x8a8a8a);
      sq.textContent = String(item.name || item.id).split(' ').map((w) => w[0]).join('').slice(0, 2);
      slot.appendChild(sq);
      if (item.qty > 1) { const q = document.createElement('span'); q.className = 'item-qty'; q.textContent = item.qty; slot.appendChild(q); }
      slot.onclick = () => { bankDeposit(i); renderBank(); };
    }
    inv.appendChild(slot);
  }
  v.appendChild(inv);
}

// ---------- Inventory ----------
export function renderInventory() {
  const v = els.views.inventory;
  v.innerHTML = '';
  const used = Game.inventory.filter(Boolean).length;
  const head = document.createElement('div');
  head.className = 'inv-head';
  head.textContent = `Inventory \u00b7 ${used}/${Game.inventory.length}`;
  v.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  for (let i = 0; i < Game.inventory.length; i++) {
    const item = Game.inventory[i];
    const slot = document.createElement('div');
    slot.className = 'inv-slot' + (Game.selectedInv === i ? ' selected' : '');
    // [economy lane] every slot is a drag target so items can be rearranged
    // (drop onto an item = swap; drop onto an empty slot = move there).
    slot.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; slot.classList.add('drag-over'); };
    slot.ondragleave = () => slot.classList.remove('drag-over');
    slot.ondrop = (e) => { e.preventDefault(); slot.classList.remove('drag-over'); const from = parseInt(e.dataTransfer.getData('text/plain'), 10); if (!Number.isNaN(from)) moveInv(from, i); };
    if (item) {
      bindTip(slot, item.id, item.name);
      const sq = document.createElement('div');
      sq.className = 'item-sq';
      sq.innerHTML = itemIconHTML(item.id);
      slot.appendChild(sq);
      if (item.qty && item.qty > 1) {
        const q = document.createElement('span');
        q.className = 'item-qty';
        const qs = qtyStyle(item.qty);
        q.textContent = qs.text;
        q.style.color = qs.color;
        slot.appendChild(q);
      }
      slot.draggable = true;
      slot.ondragstart = (e) => { hideTip(); e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; slot.classList.add('dragging'); };
      slot.ondragend = () => slot.classList.remove('dragging');
      slot.onclick = () => onInvClick(i);
      slot.oncontextmenu = (e) => { e.preventDefault(); onInvContext(e, i); };
      bindLongPress(slot, (x, y) => onInvContext({ clientX: x, clientY: y, preventDefault() {} }, i));
    }
    grid.appendChild(slot);
  }
  v.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'Click to equip/select · drag to rearrange · right-click for options';
  v.appendChild(hint);
}

// [economy lane] Rearrange the inventory: move the item from slot `from` to slot
// `to`. Swaps if `to` holds an item, else relocates into the empty slot. Pure
// UI-side reorder of Game.inventory - no items are created or destroyed.
function moveInv(from, to) {
  if (from === to || from == null || to == null) return;
  const inv = Game.inventory;
  if (from < 0 || to < 0 || from >= inv.length || to >= inv.length) return;
  const tmp = inv[to]; inv[to] = inv[from]; inv[from] = tmp;
  if (Game.selectedInv === from) Game.selectedInv = to;
  else if (Game.selectedInv === to) Game.selectedInv = from;
  Game.refresh();
}

function onInvClick(i) {
  const item = Game.inventory[i];
  if (!item) return;
  hideTip();
  if (item.slot) {
    equipItem(i);
    Game.refresh();
  } else {
    Game.selectedInv = (Game.selectedInv === i) ? null : i;
    renderInventory();
  }
}

// OSRS-style "examine" flavor text from the item's notes / category / value.
function examineText(id, name) {
  const v = itemView(id);
  const m = v && v.meta;
  if (m && m.notes) return `${name}: ${m.notes}`;
  const bits = [];
  if (m && m.subcategory) bits.push(m.subcategory);
  else if (m && m.category) bits.push(m.category);
  if (m && m.gp_value) bits.push(`worth about ${Number(m.gp_value).toLocaleString()} gp`);
  return bits.length ? `${name} — ${bits.join(', ')}.` : `It's ${name}.`;
}

function onInvContext(e, i) {
  const item = Game.inventory[i];
  if (!item) return;
  const opts = [];
  if (item.slot) opts.push(['Equip', () => { hideTip(); equipItem(i); Game.refresh(); }]);
  // [economy lane] Firemaking: burnable logs offer "Light a fire" (needs Flint &
  // Steel — lightFireAt reports the reason if the player lacks it or the level).
  if (GameData.firemaking(item.id)) {
    opts.push(['Light a fire', () => {
      hideTip();
      const p = Game.player;
      const res = lightFireAt(p.tileX, p.tileY, item.id, Game.ticker ? Game.ticker.count : 0);
      if (!res.ok) Game.log(`You can't light a fire here: ${res.reason}.`);
      Game.refresh();
    }]);
  }
  // Any food with a heal value is edible (hand-authored cooked_* + all DB food
  // stubs, which get heal derived from cooking tier during hydration).
  const heal = item.heal || (item.id === 'cooked_fish' ? 3 : 0);
  if (heal > 0) {
    opts.push([`Eat (+${heal} HP)`, () => {
      hideTip();
      removeAt(i);
      const before = Game.hp;
      Game.hp = Math.min(Game.maxHp, Game.hp + heal);
      Game.log(`You eat the ${item.name}. It heals ${Game.hp - before} HP.`);
      Game.refresh();
    }]);
  }
  if (item.id !== 'coins') {
    opts.push(['Offer on Exchange', () => { hideTip(); geSelected = item.id; switchTab('ge'); }]);
  }
  // Boss components can be forged into a legendary weapon (needs bars + Smithing).
  if (item.forge) {
    const out = itemView(item.forge.into);
    const label = out && out.name ? out.name : item.forge.into;
    opts.push([`Forge ${label}`, () => {
      hideTip();
      forgeBossWeapon(item.id);
      Game.refresh();
    }]);
  }
  // Bones can be buried for Prayer XP (an altar gives more — see the world).
  if (item.buryXp) {
    opts.push([`Bury (+${item.buryXp} Prayer)`, () => {
      hideTip();
      removeAt(i);
      grantXp('Prayer', item.buryXp);
      Game.log(`You bury the ${item.name}. (+${item.buryXp} Prayer xp)`);
      Game.refresh();
    }]);
  }
  opts.push(['Examine', () => Game.log(examineText(item.id, item.name))]);
  opts.push(['Drop', () => { hideTip(); const it = Game.inventory[i]; if (!it) return; removeAt(i); spawnGroundItem(it.id, it.qty || 1, Game.player.tileX, Game.player.tileY, Game.ticker ? Game.ticker.count : 0); Game.log(`You drop the ${it.name}.`); Game.refresh(); }]);
  showContextMenu(e.clientX, e.clientY, opts);
}

// ---------- Equipment ----------
const SLOT_LAYOUT = [
  [null, 'head', null],
  ['cape', 'neck', 'ammo'],
  [null, 'weapon', null],
  ['shield', 'body', null],
  [null, 'legs', null],
  ['hands', 'feet', 'ring'],
];

// Faint glyph shown in an empty equipment slot (OSRS slot silhouettes).
const SLOT_ICON = {
  head: '🪖', cape: '🧣', neck: '📿', ammo: '🎯', weapon: '⚔️',
  shield: '🛡️', body: '👕', legs: '👖', hands: '🧤', feet: '🥾', ring: '💍',
};

// Human-readable labels for the raw stat keys in the bonus summary.
const STAT_LABELS = {
  stab_atk: 'Stab attack', slash_atk: 'Slash attack', crush_atk: 'Crush attack',
  magic_atk: 'Magic attack', range_atk: 'Ranged attack',
  stab_def: 'Stab defence', slash_def: 'Slash defence', crush_def: 'Crush defence',
  magic_def: 'Magic defence', range_def: 'Ranged defence',
  melee_str: 'Melee strength', range_str: 'Ranged strength',
  magic_dmg: 'Magic damage', prayer: 'Prayer',
};

export function renderEquipment() {
  const v = els.views.equipment;
  v.innerHTML = '';
  const doll = document.createElement('div');
  doll.className = 'paperdoll';
  for (const row of SLOT_LAYOUT) {
    for (const slot of row) {
      const cell = document.createElement('div');
      if (slot === null) { cell.className = 'doll-empty'; doll.appendChild(cell); continue; }
      cell.className = 'doll-slot';
      const item = Game.equipment[slot];
      if (item) {
        bindTip(cell, item.id, item.name, 'Click to remove · right-click for options');
        cell.classList.add('doll-filled');
        cell.innerHTML = itemIconHTML(item.id);
        // Stackable equipment (ammo) shows its remaining quantity, like inventory.
        if (item.qty && item.qty > 1) {
          const q = document.createElement('span');
          q.className = 'item-qty';
          const qs = qtyStyle(item.qty);
          q.textContent = qs.text;
          q.style.color = qs.color;
          cell.appendChild(q);
        }
        cell.onclick = () => { hideTip(); unequipItem(slot); Game.refresh(); };
        const equipMenu = (x, y) => {
          hideTip();
          showContextMenu(x, y, [
            ['Remove', () => { unequipItem(slot); Game.refresh(); }],
            ['Examine', () => Game.log(examineText(item.id, item.name))],
          ]);
        };
        cell.oncontextmenu = (ev) => { ev.preventDefault(); equipMenu(ev.clientX, ev.clientY); };
        bindLongPress(cell, equipMenu);
      } else {
        cell.classList.add('doll-vacant');
        cell.textContent = SLOT_ICON[slot] || slot.slice(0, 3);
        cell.title = slot[0].toUpperCase() + slot.slice(1);
      }
      doll.appendChild(cell);
    }
  }
  v.appendChild(doll);

  const totals = totalBonuses();
  const list = document.createElement('div');
  list.className = 'stat-summary';
  list.innerHTML = '<div class="stat-title">Equipment bonuses</div>';
  for (const k of STAT_KEYS) {
    if (totals[k] === 0) continue;
    const row = document.createElement('div');
    row.className = 'stat-row' + (totals[k] < 0 ? ' neg' : '');
    const val = totals[k] > 0 ? '+' + totals[k] : '' + totals[k];
    row.innerHTML = `<span>${STAT_LABELS[k] || k}</span><span>${val}</span>`;
    list.appendChild(row);
  }
  if (list.children.length === 1) {
    const none = document.createElement('div');
    none.className = 'stat-row'; none.textContent = 'No bonuses';
    list.appendChild(none);
  }
  v.appendChild(list);
}

// ---------- Combat ----------
let lastHp = null;
export function renderCombat() {
  const v = els.views.combat;
  v.innerHTML = '';

  const hpWrap = document.createElement('div');
  hpWrap.className = 'hp-wrap';
  const ratio = Game.maxHp ? Game.hp / Game.maxHp : 0;
  const hurt = lastHp !== null && Game.hp < lastHp; // flash on damage taken
  const low = ratio > 0 && ratio <= 0.25;           // pulse when critical
  hpWrap.innerHTML = `
    <div class="hp-label">Hitpoints ${Game.hp} / ${Game.maxHp}</div>
    <div class="hpbar${low ? ' low' : ''}"><div class="hpfill${hurt ? ' hurt' : ''}" style="width:${Math.round(ratio * 100)}%"></div></div>`;
  v.appendChild(hpWrap);
  lastHp = Game.hp;

  const styleWrap = document.createElement('div');
  styleWrap.className = 'style-wrap';
  styleWrap.innerHTML = '<div class="stat-title">Attack style</div>';
  for (const s of STYLES) {
    const b = document.createElement('button');
    b.textContent = s;
    b.className = 'style-btn' + (Game.attackStyle === s ? ' active' : '');
    b.onclick = () => { Game.attackStyle = s; renderCombat(); };
    styleWrap.appendChild(b);
  }
  v.appendChild(styleWrap);

  const weapon = Game.equipment.weapon;
  const range = playerAttackRange();
  const kind = weapon && weapon.weaponType === 'ranged' ? 'Ranged' : 'Melee';
  const reach = document.createElement('div');
  reach.className = 'target-info';
  let reachHtml = `<div class="stat-title">Weapon</div>
    <div>${weapon ? weapon.name : 'Unarmed'} — ${kind}, reach ${range} tile${range === 1 ? '' : 's'}</div>`;
  if (needsAmmo()) {
    const n = ammoCount();
    const ammoName = Game.equipment.ammo ? Game.equipment.ammo.name : 'No ammo';
    const cls = n > 0 ? 'tip-good' : 'tip-req';
    reachHtml += `<div class="${cls}">${n > 0 ? `${ammoName} ×${n}` : 'Out of ammo — equip arrows'}</div>`;
  }
  reach.innerHTML = reachHtml;
  v.appendChild(reach);

  v.appendChild(renderSpec());

  // Combat summary — derived from the same formulas combat.js uses.
  const prof = playerProfile();
  const sum = document.createElement('div');
  sum.className = 'stat-summary';
  sum.style.marginTop = '12px';
  sum.innerHTML = '<div class="stat-title">Combat summary</div>'
    + `<div class="stat-row"><span>Max hit</span><span>${maxHit(prof)}</span></div>`
    + `<div class="stat-row"><span>Accuracy rating</span><span>${maxAttackRoll(prof).toLocaleString()}</span></div>`
    + `<div class="stat-row"><span>Combat level</span><span>${playerCombatLevel()}</span></div>`;
  v.appendChild(sum);

  v.appendChild(renderPrayer());

  const tgt = document.createElement('div');
  tgt.className = 'target-info';
  const t = Game.player && Game.player.combatTarget;
  if (t && !t.dead) {
    tgt.innerHTML = `<div class="stat-title">Target</div>
      <div>${t.name} — ${t.hp}/${t.maxHp} HP</div>`;
  } else {
    tgt.innerHTML = '<div class="stat-title">Target</div><div>None. Click a goblin guard to attack.</div>';
  }
  v.appendChild(tgt);
}

// Prayer block for the Combat tab: a points bar + a toggle per unlocked prayer.
// Points are trained by burying bones / offering them at the Bones Altar.
// Human-readable summary of a weapon special's effects (for the button tooltip).
function specDesc(spec) {
  const bits = [];
  if (spec.hits) bits.push(`${spec.hits} hits`);
  if (spec.damageMult) bits.push(`${Math.round(spec.damageMult * 100)}% damage`);
  if (spec.accuracyMult) bits.push(`${Math.round(spec.accuracyMult * 100)}% accuracy`);
  if (spec.armorPierce) bits.push(`ignores ${Math.round(spec.armorPierce * 100)}% armour`);
  return `${spec.name}: ${bits.join(', ')} · costs ${spec.cost}% energy`;
}

// Special-attack block: an energy bar + (if the weapon has one) an arm button.
function renderSpec() {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '10px';
  const spec = weaponSpec();
  const e = Math.round(Game.specEnergy);
  const ratio = Math.max(0, Math.min(1, Game.specEnergy / SPEC_MAX));
  wrap.innerHTML = `<div class="stat-title">Special attack — ${e}%</div>
    <div class="hpbar"><div class="hpfill" style="width:${Math.round(ratio * 100)}%;background:#d08a4a"></div></div>`;
  if (spec) {
    const btn = document.createElement('button');
    const armed = Game.specArmed;
    const ready = Game.specEnergy >= spec.cost;
    btn.className = 'style-btn' + (armed ? ' active' : '');
    btn.style.marginTop = '6px';
    btn.style.width = '100%';
    btn.textContent = `${armed ? '▶ ' : ''}${spec.name} (${spec.cost}%)`;
    btn.title = specDesc(spec);
    btn.disabled = !ready && !armed;
    btn.onclick = () => { toggleSpec(); renderCombat(); };
    wrap.appendChild(btn);
  } else {
    const note = document.createElement('div');
    note.className = 'tip-dim';
    note.style.marginTop = '4px';
    note.textContent = 'Equip a boss-forged weapon to use a special.';
    wrap.appendChild(note);
  }
  return wrap;
}

function renderPrayer() {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '12px';
  const lvl = prayerLevel();
  const pts = Math.max(0, Math.ceil(Game.prayerPoints));
  const ratio = Game.maxPrayer ? Math.max(0, Game.prayerPoints) / Game.maxPrayer : 0;
  wrap.innerHTML = `<div class="stat-title">Prayer — ${pts} / ${Game.maxPrayer} points</div>
    <div class="hpbar"><div class="hpfill" style="width:${Math.round(ratio * 100)}%;background:#c9b458"></div></div>
    <div class="tip-dim" style="margin:4px 0 6px">Bury bones or use the Bones Altar to train Prayer.</div>`;

  const list = document.createElement('div');
  list.className = 'style-wrap';
  for (const pr of unlockedPrayers(lvl)) {
    const b = document.createElement('button');
    const on = Game.activePrayers.includes(pr.id);
    b.textContent = pr.name;
    b.className = 'style-btn' + (on ? ' active' : '');
    b.title = `${pr.desc} · Lv ${pr.level} · ${pr.drain}/tick`;
    b.onclick = () => { togglePrayer(pr.id); renderCombat(); };
    list.appendChild(b);
  }
  wrap.appendChild(list);
  return wrap;
}

// ---------- Chat log ----------
export function appendLog(msg) {
  if (!els.chatlog) return;
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.textContent = msg;
  els.chatlog.appendChild(line);
  while (els.chatlog.children.length > 100) els.chatlog.removeChild(els.chatlog.firstChild);
  els.chatlog.scrollTop = els.chatlog.scrollHeight;
}

// Stable per-name colour so each "player" reads consistently in chat.
const CHAT_COLORS = ['#8fbcff', '#f0a24a', '#7bbf4a', '#e88fd0', '#5ecfc0', '#d9c25a', '#c98af0', '#e0796f', '#9fd86a'];
function nameColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHAT_COLORS[h % CHAT_COLORS.length];
}

// Render a public-chat line (bot chatter, replies, or the player's own message).
export function postChat({ name, text, self }) {
  if (!els.chatlog) return;
  const line = document.createElement('div');
  line.className = 'chat-line chat-msg' + (self ? ' chat-self' : '');
  const col = self ? 'var(--accent)' : nameColor(name);
  line.innerHTML = `<span class="chat-name" style="color:${col}">${tipEsc(name)}:</span> `
    + `<span class="chat-text">${tipEsc(text)}</span>`;
  els.chatlog.appendChild(line);
  while (els.chatlog.children.length > 120) els.chatlog.removeChild(els.chatlog.firstChild);
  els.chatlog.scrollTop = els.chatlog.scrollHeight;
}

// Inject the "Press Enter to chat" input below the chat log. keydown/up are
// stopped from bubbling so typing doesn't trigger the game's movement/camera keys.
function buildChatInput() {
  if (!els.chatlog || document.getElementById('chat-input-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'chat-input-bar';
  const input = document.createElement('input');
  input.id = 'chat-input';
  input.type = 'text';
  input.maxLength = 120;
  input.placeholder = 'Press Enter to chat…';
  ['keydown', 'keyup', 'keypress'].forEach((ev) => input.addEventListener(ev, (e) => e.stopPropagation()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { playerSay(input.value); input.value = ''; }
  });
  bar.appendChild(input);
  els.chatlog.parentNode.insertBefore(bar, els.chatlog.nextSibling);
}

// ---------- Context menu ----------
let menuEl = null;
export function showContextMenu(x, y, options) {
  hideContextMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'ctx-menu';
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  for (const [label, fn] of options) {
    const item = document.createElement('div');
    item.className = 'ctx-item';
    item.textContent = label;
    item.onclick = () => { hideContextMenu(); fn(); };
    menuEl.appendChild(item);
  }
  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0);
}

export function hideContextMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
