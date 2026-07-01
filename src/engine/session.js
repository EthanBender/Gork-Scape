// src/engine/session.js
// Player session lifecycle for the (client-side) hosted world: a login gate,
// autosave, save-on-close, and a 5-minute idle auto-logout. The Phaser game is
// only created after login and destroyed on logout, so the "world" the player
// sees always matches the account they're signed into.
//
// This module owns *when* to start/stop the game and *when* to persist; the
// actual start/stop is delegated back to main.js via the {onStart,onStop}
// hooks, and persistence lives in save.js. Keeping those seams clean is what
// makes a later swap to a real server backend a localized change.

import { Game } from './state.js';
import {
  listAccounts, hasSave, savedAt, loadSave, saveGame, deleteSave,
  exportSaveString, importSaveString,
} from './save.js';

export const IDLE_LOGOUT_MS = 10 * 60 * 1000;  // auto-logout after 10 min idle
const AUTOSAVE_MS = 20 * 1000;                 // periodic background save
const IDLE_CHECK_MS = 15 * 1000;               // how often we test for idleness

let hooks = { onStart: () => {}, onStop: () => {} };
const extraSavers = []; // extra persistence callbacks (e.g. shared world state)
let account = null;
let running = false;               // true between game-ready and logout
let lastActivity = 0;
let autosaveTimer = null;
let idleTimer = null;
let listenersWired = false;

// ---------------------------------------------------------------- public API
export function currentAccount() { return account; }

// Called once at boot. Wires the login screen and window-level listeners, then
// shows the login gate. `onStart` should create the Phaser game; `onStop`
// should tear it down. Both are invoked with no arguments.
export function initSession({ onStart, onStop }) {
  hooks = { onStart, onStop };
  injectStyles();
  wireGlobalListeners();
  showLogin();
}

// Called by main.js create() once the game has finished loading/applying the
// save. Only now is it safe to start autosaving (before this, we'd overwrite a
// good save with default state) and to reveal the in-game chrome.
export function notifyGameReady() {
  running = true;
  Game.playerFrozen = document.visibilityState === 'hidden'; // freeze if launched hidden
  bumpActivity();
  hideLogin();
  showLogoutButton();
  startAutosave();
  startIdleWatch();
}

// Register an extra persistence callback run on every save (autosave, tab close,
// logout) — e.g. shared world state that isn't part of the per-account player
// save. Keeps session.js decoupled from what else needs persisting.
export function registerSaver(fn) {
  if (typeof fn === 'function' && !extraSavers.includes(fn)) extraSavers.push(fn);
}
function runExtraSavers() {
  for (const fn of extraSavers) { try { fn(); } catch { /* best-effort */ } }
}

// Persist the current character + any registered world state (best-effort).
export function save() {
  if (account && running) { saveGame(account); runExtraSavers(); }
}

export function logout(reason) {
  if (!running) return;
  if (account) { saveGame(account); runExtraSavers(); } // persist BEFORE flipping `running`
  running = false;
  stopAutosave();
  stopIdleWatch();
  hideLogoutButton();
  hooks.onStop();
  const who = account;
  account = null;
  Game.account = null;
  Game.pendingSave = null;
  showLogin(reason ? { notice: reasonText(reason, who) } : undefined);
}

// ---------------------------------------------------------------- login flow
function beginSession(name, { isNew }) {
  account = name;
  Game.account = name;
  Game.pendingSave = isNew ? null : loadSave(name);
  hooks.onStart();  // create the Phaser game; create() calls notifyGameReady()
}

function reasonText(reason, who) {
  if (reason === 'idle') return `${who ? `${who} was` : 'You were'} logged out after ${IDLE_LOGOUT_MS / 60000} minutes of inactivity. Your progress was saved.`;
  return '';
}

// ---------------------------------------------------------------- activity / idle
function bumpActivity() { lastActivity = Date.now(); }

function wireGlobalListeners() {
  if (listenersWired) return;
  listenersWired = true;

  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  for (const ev of activityEvents) {
    window.addEventListener(ev, () => { if (running) bumpActivity(); }, { passive: true });
  }

  // Persist on tab close / hide. pagehide + the hidden visibility state are the
  // reliable signals across browsers (beforeunload isn't fired on mobile);
  // include beforeunload as a desktop backstop. These SAVE but do not log out —
  // the page is going away, and offline catch-up will reconcile time on return.
  const flush = () => { if (running && account) { saveGame(account); runExtraSavers(); } };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    // [world-continuity] Freeze the player while the tab is hidden — nothing
    // happens TO the character when nobody's watching — but the world sim keeps
    // ticking. main.js gameTick() honours this flag. Also persist on hide.
    Game.playerFrozen = hidden;
    if (hidden) flush();
    else bumpActivity();
  });
}

function startIdleWatch() {
  stopIdleWatch();
  idleTimer = setInterval(() => {
    if (running && Date.now() - lastActivity >= IDLE_LOGOUT_MS) logout('idle');
  }, IDLE_CHECK_MS);
}
function stopIdleWatch() { if (idleTimer) { clearInterval(idleTimer); idleTimer = null; } }

function startAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(() => save(), AUTOSAVE_MS);
}
function stopAutosave() { if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; } }

// ---------------------------------------------------------------- login UI
function el(id) { return document.getElementById(id); }

function showLogin(opts = {}) {
  let overlay = el('login-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;
  renderLogin(overlay, opts.notice || '');
}

function hideLogin() {
  const overlay = el('login-overlay');
  if (overlay) overlay.hidden = true;
}

function renderLogin(overlay, notice) {
  const accounts = listAccounts().filter(hasSave);
  const rows = accounts.map((name) => {
    const when = relTime(savedAt(name));
    return `<div class="login-acct">
        <button class="login-continue" data-acct="${escapeAttr(name)}">
          <span class="la-name">${escapeHtml(name)}</span>
          <span class="la-when">last played ${when}</span>
        </button>
        <button class="login-backup" data-acct="${escapeAttr(name)}" title="Download a backup of this character">⬇</button>
        <button class="login-delete" data-acct="${escapeAttr(name)}" title="Delete this character">✕</button>
      </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="login-panel">
      <h1 class="login-title">Goblin Empire</h1>
      <p class="login-sub">The world keeps its own time. Sign in to continue.</p>
      ${notice ? `<div class="login-notice">${escapeHtml(notice)}</div>` : ''}
      ${accounts.length ? `<div class="login-section-label">Continue</div><div class="login-accts">${rows}</div>` : ''}
      <div class="login-section-label">${accounts.length ? 'Or start a new character' : 'New character'}</div>
      <div class="login-new">
        <input id="login-name" type="text" maxlength="16" placeholder="Character name" autocomplete="off" spellcheck="false" />
        <button id="login-enter">Enter World</button>
      </div>
      <div id="login-error" class="login-error"></div>
      <div class="login-restore">
        <button id="login-restore-btn" title="Restore a character from a downloaded backup file">Restore from backup…</button>
        <input id="login-restore-file" type="file" accept="application/json,.json" hidden />
      </div>
    </div>`;

  const nameInput = el('login-name');
  const errBox = el('login-error');
  const showErr = (m) => { if (errBox) errBox.textContent = m; };

  const enter = () => {
    const raw = (nameInput.value || '').trim();
    if (!validName(raw)) { showErr('Use 2–16 letters, numbers, spaces, - or _.'); return; }
    beginSession(raw, { isNew: !hasSave(raw) });
  };
  el('login-enter').onclick = enter;
  nameInput.onkeydown = (e) => { if (e.key === 'Enter') enter(); };

  overlay.querySelectorAll('.login-continue').forEach((btn) => {
    btn.onclick = () => beginSession(btn.dataset.acct, { isNew: false });
  });
  overlay.querySelectorAll('.login-delete').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.acct;
      if (confirm(`Delete character "${name}"? This cannot be undone.`)) {
        deleteSave(name);
        renderLogin(overlay, '');
      }
    };
  });

  // ⬇ per-account backup: download a portable JSON copy of the character. This
  // is the escape hatch from localStorage-only persistence — the file survives a
  // cache clear or a move to another machine (restore below re-imports it).
  overlay.querySelectorAll('.login-backup').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.acct;
      const json = exportSaveString(name);
      if (!json) { showErr(`No save to back up for "${name}".`); return; }
      downloadText(`goblin-empire-${sanitizeFile(name)}.json`, json);
    };
  });

  // Restore-from-backup: read a downloaded file, import it into storage, then the
  // player can Continue as usual. If the backup names an existing character we
  // ask before overwriting.
  const restoreBtn = el('login-restore-btn');
  const restoreFile = el('login-restore-file');
  if (restoreBtn && restoreFile) {
    restoreBtn.onclick = () => restoreFile.click();
    restoreFile.onchange = () => {
      const file = restoreFile.files && restoreFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const typed = (nameInput.value || '').trim();
        // Import under the typed name if given, else the backup's own name.
        const res = importSaveString(String(reader.result), typed && validName(typed) ? typed : null);
        restoreFile.value = '';
        if (!res.ok) { showErr(res.error); return; }
        renderLogin(overlay, `Restored “${res.account}”. Select it above to continue.`);
      };
      reader.onerror = () => showErr('Could not read that file.');
      reader.readAsText(file);
    };
  }

  nameInput.focus();
}

// Trigger a client-side download of a text blob (no server round-trip).
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFile(name) { return String(name).replace(/[^A-Za-z0-9_-]+/g, '_'); }

function validName(name) {
  return /^[A-Za-z0-9 _-]{2,16}$/.test(name);
}

// ---------------------------------------------------------------- logout button
function showLogoutButton() {
  let btn = el('logout-btn');
  const bar = el('topbar');
  if (!btn && bar) {
    btn = document.createElement('button');
    btn.id = 'logout-btn';
    btn.textContent = 'Log out';
    btn.title = 'Save and return to the sign-in screen';
    btn.onclick = () => logout('manual');
    bar.appendChild(btn);
  }
  if (btn) {
    btn.hidden = false;
    btn.textContent = account ? `Log out (${account})` : 'Log out';
  }
}
function hideLogoutButton() {
  const btn = el('logout-btn');
  if (btn) btn.hidden = true;
}

// ---------------------------------------------------------------- helpers
function relTime(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) { return escapeHtml(s); }

function injectStyles() {
  if (el('session-styles')) return;
  const style = document.createElement('style');
  style.id = 'session-styles';
  style.textContent = `
    #login-overlay {
      position: fixed; inset: 0; z-index: 3000;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 30%, #241f16 0%, #0c0b08 80%);
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    #login-overlay[hidden] { display: none; }
    .login-panel {
      width: 380px; max-width: 92vw; padding: 26px 26px 22px;
      background: var(--panel2, #322d21);
      border: 1px solid var(--border, #4a4331);
      border-radius: 10px;
      box-shadow: 0 18px 60px rgba(0,0,0,.6), var(--raise, inset 1px 1px 0 #6b6144);
      color: var(--text, #efe8d4);
    }
    .login-title {
      margin: 0 0 2px; text-align: center; font-size: 30px; letter-spacing: .5px;
      color: var(--accent, #7bbf4a); text-shadow: 0 2px 0 #000;
    }
    .login-sub { margin: 0 0 16px; text-align: center; color: var(--muted, #a89c7d); font-size: 13px; }
    .login-notice {
      margin: 0 0 14px; padding: 8px 10px; font-size: 12.5px; border-radius: 6px;
      background: rgba(232,198,90,.12); border: 1px solid var(--gold-dk, #a8842a);
      color: var(--gold, #e8c65a);
    }
    .login-section-label {
      margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
      color: var(--muted, #a89c7d);
    }
    .login-accts { display: flex; flex-direction: column; gap: 6px; }
    .login-acct { display: flex; gap: 6px; }
    .login-continue {
      flex: 1; display: flex; flex-direction: column; align-items: flex-start;
      padding: 8px 12px; cursor: pointer; text-align: left;
      background: var(--panel, #26221a); color: var(--text, #efe8d4);
      border: 1px solid var(--border, #4a4331); border-radius: 6px;
    }
    .login-continue:hover { background: var(--panel-hi, #3d3728); border-color: var(--accent, #7bbf4a); }
    .la-name { font-weight: 700; font-size: 15px; }
    .la-when { font-size: 11px; color: var(--muted, #a89c7d); }
    .login-delete {
      width: 34px; cursor: pointer; border-radius: 6px;
      background: var(--panel, #26221a); color: var(--muted, #a89c7d);
      border: 1px solid var(--border, #4a4331);
    }
    .login-delete:hover { color: #ff8a8a; border-color: #7a3030; }
    .login-backup {
      width: 34px; cursor: pointer; border-radius: 6px;
      background: var(--panel, #26221a); color: var(--muted, #a89c7d);
      border: 1px solid var(--border, #4a4331);
    }
    .login-backup:hover { color: var(--gold, #e8c65a); border-color: var(--gold-dk, #a8842a); }
    .login-restore { margin-top: 12px; text-align: center; }
    #login-restore-btn {
      padding: 6px 12px; cursor: pointer; font-size: 12px; border-radius: 6px;
      background: transparent; color: var(--muted, #a89c7d);
      border: 1px dashed var(--border, #4a4331);
    }
    #login-restore-btn:hover { color: var(--text, #efe8d4); border-color: var(--accent, #7bbf4a); }
    .login-new { display: flex; gap: 6px; }
    #login-name {
      flex: 1; padding: 9px 12px; font-size: 14px; border-radius: 6px;
      background: var(--panel-lo, #191710); color: var(--text, #efe8d4);
      border: 1px solid var(--border, #4a4331); box-shadow: var(--sink, none);
    }
    #login-name:focus { outline: none; border-color: var(--accent, #7bbf4a); }
    #login-enter {
      padding: 9px 16px; cursor: pointer; font-weight: 700; border-radius: 6px;
      background: var(--accent-dk, #4d7a2f); color: #fff;
      border: 1px solid var(--accent, #7bbf4a);
    }
    #login-enter:hover { background: var(--accent, #7bbf4a); }
    .login-error { min-height: 16px; margin-top: 8px; font-size: 12px; color: #ff8a8a; }
    #logout-btn {
      margin-left: auto; margin-right: 12px; padding: 4px 12px; cursor: pointer;
      font-size: 12px; font-weight: 700; border-radius: 5px;
      background: var(--panel, #26221a); color: var(--muted, #a89c7d);
      border: 1px solid var(--border, #4a4331);
    }
    #logout-btn:hover { color: #ff8a8a; border-color: #7a3030; }
    #logout-btn[hidden] { display: none; }
  `;
  document.head.appendChild(style);
}
