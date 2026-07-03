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
import { loadSave, saveGame, serialize } from './save.js';
import * as authClient from '../net/authClient.js';
import { startLoginFx, stopLoginFx } from '../ui/loginFx.js';
import { icon } from '../ui/icons.js';

export const IDLE_LOGOUT_MS = 10 * 60 * 1000;  // auto-logout after 10 min idle
const AUTOSAVE_MS = 20 * 1000;                 // periodic background save
const IDLE_CHECK_MS = 15 * 1000;               // how often we test for idleness

let hooks = { onStart: () => {}, onStop: () => {} };
const extraSavers = []; // extra persistence callbacks (e.g. shared world state)
let account = null;
let serverAvailable = false;       // is the authoritative server reachable this session?
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
export async function initSession({ onStart, onStop }) {
  hooks = { onStart, onStop };
  injectStyles();
  wireGlobalListeners();
  await gateOnServer();
}

// Boot / refresh gate. The game REQUIRES the authoritative server — there is no
// local, this-device play mode (that dual state was confusing). If the server is
// up, resume a held token (refresh stays signed in) or show the login. If it's
// down, show the "server resting" landing page — an ad for the game with a Retry
// — never a throwaway local character. The Retry button calls this again.
async function gateOnServer() {
  showConnecting();
  const resumed = await authClient.resume();
  if (resumed.ok) { serverAvailable = true; beginSession(resumed.username, resumed.save); return; }
  // resume() only reports `offline` when it actually tried (had a token). With no
  // token it returns {ok:false}; probe to see whether a server is there at all.
  serverAvailable = resumed.offline ? false : await authClient.probe();
  if (serverAvailable) showLogin();
  else showComingSoon();
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

// Persist the current character + any registered world state. The server is the
// source of truth (pushSave); localStorage is kept only as a silent crash-safety
// cache, never surfaced as a separate "local character".
export function save() {
  if (!(account && running)) return;
  saveGame(account);
  runExtraSavers();
  authClient.pushSave(serialize()); // async, best-effort
}

export function logout(reason) {
  if (!running) return;
  // persist BEFORE flipping `running`
  if (account) {
    saveGame(account);
    runExtraSavers();
    authClient.pushSave(serialize());
  }
  running = false;
  stopAutosave();
  stopIdleWatch();
  hideLogoutButton();
  hooks.onStop();
  const who = account;
  account = null;
  Game.account = null;
  Game.pendingSave = null;
  authClient.logout();   // drop the server session token (best-effort)
  showLogin(reason ? { notice: reasonText(reason, who) } : undefined);
}

// ---------------------------------------------------------------- login flow
// Enter the world as a signed-in server account. The save comes from the server
// (source of truth); localStorage is only a fallback if the server had none yet.
function beginSession(username, serverSave) {
  account = username;
  Game.account = username;
  Game.pendingSave = serverSave || loadSave(username);
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
  const flush = () => {
    if (!(running && account)) return;
    saveGame(account);
    runExtraSavers();
    // An async fetch can't be awaited during unload — use a queued beacon that
    // survives the page going away.
    authClient.beaconSave(serialize());
  };
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

function ensureOverlay() {
  let overlay = el('login-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

// The masthead every login page shares: goblin crest + wordmark. Sits above
// whatever card the page renders into #login-card. setStage() paints it AND
// (re)starts the animated valley — innerHTML replacement detaches the old
// canvas, so the FX must start after the markup lands.
function setStage(overlay, cardHTML) {
  overlay.innerHTML = stageHTML(cardHTML);
  startLoginFx(overlay);
}

function stageHTML(cardHTML) {
  return `
    <div class="login-stage">
      <div class="login-mast">
        <div class="login-crest">${icon('goblin')}</div>
        <h1 class="login-wordmark">Goblin&nbsp;Empire</h1>
        <div class="login-tagline">A living low-poly world that keeps its own time</div>
      </div>
      <div id="login-card">${cardHTML}</div>
      <div class="login-foot">gorkscape.ca</div>
    </div>`;
}

// A brief interstitial while we probe the server / resume a session at boot, so
// the player never sees a flash of the wrong login form.
function showConnecting() {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, `
    <div class="login-panel login-connecting">
      <div class="conn-spinner"></div>
      <p class="login-sub">Connecting to the world…</p>
    </div>`);
}

function showLogin(opts = {}) {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, '');
  renderAuthLogin(el('login-card'), opts.notice || '');
}

// The "server is resting" landing page — shown whenever the authoritative server
// can't be reached (e.g. the host laptop is closed). It's an ad for the game, not
// an error: title, tagline, and a Retry that re-probes. There is deliberately no
// way to "play offline" from here — one canonical world, hosted by the server.
function showComingSoon() {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, `
    <div class="login-panel coming-soon">
      <p class="cs-tagline">Mine, craft, trade, and fight in a goblin realm that keeps living whether you're watching or not.</p>
      <div class="cs-status">
        <span class="cs-dot"></span>
        <span>The realm is resting — the server is offline right now.</span>
      </div>
      <p class="cs-sub">Come back soon. Your character and everything you've built are safe on the server.</p>
      <button id="cs-retry" class="login-primary">Try again</button>
    </div>`);
  const retry = el('cs-retry');
  if (retry) retry.onclick = () => { retry.disabled = true; retry.textContent = 'Checking…'; gateOnServer(); };
}

function hideLogin() {
  const overlay = el('login-overlay');
  if (overlay) overlay.hidden = true;
  stopLoginFx(); // tear the background animation down — it must cost the game nothing
}

// The account screen: Sign In / Create Account, username + password. The username
// IS the in-game character name (created accounts are told so). If the server
// drops between the boot probe and submit, we fall through to the coming-soon page.
let authFormMode = 'signin'; // 'signin' | 'create'

function renderAuthLogin(card, notice) {
  const isCreate = authFormMode === 'create';
  card.innerHTML = `
    <div class="login-panel">
      ${notice ? `<div class="login-notice">${escapeHtml(notice)}</div>` : ''}
      <div class="login-tabs" role="tablist">
        <button class="login-tab ${isCreate ? '' : 'active'}" data-mode="signin">Sign In</button>
        <button class="login-tab ${isCreate ? 'active' : ''}" data-mode="create">Create Account</button>
      </div>
      <div class="login-form">
        <label class="login-field">
          <span>Username${isCreate ? ' <em>— your name in the world</em>' : ''}</span>
          <input id="auth-user" type="text" maxlength="16" autocomplete="username"
                 autocapitalize="off" spellcheck="false" placeholder="e.g. Grukthar" />
        </label>
        <label class="login-field">
          <span>Password</span>
          <input id="auth-pass" type="password" autocomplete="${isCreate ? 'new-password' : 'current-password'}"
                 placeholder="${isCreate ? 'At least 6 characters' : 'Your password'}" />
        </label>
        ${isCreate ? `<label class="login-field">
          <span>Confirm password</span>
          <input id="auth-pass2" type="password" autocomplete="new-password" placeholder="Re-enter password" />
        </label>` : ''}
        <button id="auth-submit" class="login-primary">${isCreate ? 'Create Account & Enter' : 'Sign In'}</button>
      </div>
      <div id="login-error" class="login-error"></div>
      <div class="login-hint">${isCreate
        ? 'Your username is your character name — every other player sees it in the world.'
        : 'Your character is saved to your account — sign in from any device to keep playing.'}</div>
    </div>`;

  const userInput = el('auth-user');
  const passInput = el('auth-pass');
  const errBox = el('login-error');
  const submitBtn = el('auth-submit');
  const showErr = (m) => { if (errBox) errBox.textContent = m; };
  const label = isCreate ? 'Create Account & Enter' : 'Sign In';
  const setBusy = (b) => { if (submitBtn) { submitBtn.disabled = b; submitBtn.textContent = b ? 'Please wait…' : label; } };

  card.querySelectorAll('.login-tab').forEach((btn) => {
    btn.onclick = () => { authFormMode = btn.dataset.mode; renderAuthLogin(card, ''); };
  });

  const submit = async () => {
    const username = (userInput.value || '').trim();
    const password = passInput.value || '';
    if (!validName(username)) { showErr('Username must be 2–16 letters, numbers, spaces, - or _.'); return; }
    if (password.length < 6) { showErr('Password must be at least 6 characters.'); return; }
    if (isCreate && password !== (el('auth-pass2').value || '')) { showErr('Passwords don’t match.'); return; }

    setBusy(true);
    const res = isCreate
      ? await authClient.register(username, password)
      : await authClient.login(username, password);

    if (res.offline) {
      // Server dropped between the boot probe and this submit → the realm is
      // resting. Show the coming-soon page (no local play).
      serverAvailable = false;
      setBusy(false);
      showComingSoon();
      return;
    }
    if (!res.ok) { showErr(res.error || 'Sign-in failed.'); setBusy(false); return; }
    beginSession(res.username, res.save);
  };

  submitBtn.onclick = submit;
  const onEnter = (e) => { if (e.key === 'Enter') submit(); };
  userInput.onkeydown = onEnter;
  passInput.onkeydown = onEnter;
  if (isCreate) el('auth-pass2').onkeydown = onEnter;
  userInput.focus();
}

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
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function injectStyles() {
  if (el('session-styles')) return;
  const style = document.createElement('style');
  style.id = 'session-styles';
  style.textContent = `
    #login-overlay {
      position: fixed; inset: 0; z-index: 3000; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      background: #0a0e14;
      font-family: var(--font-ui, "Segoe UI", Tahoma, sans-serif);
    }
    #login-overlay[hidden] { display: none; }
    .login-stage {
      position: relative; z-index: 1; width: min(400px, calc(100vw - 32px));
      display: flex; flex-direction: column; align-items: center;
      max-height: 100dvh; overflow-y: auto; padding: 18px 0;
      animation: stageIn .7s cubic-bezier(.2,.9,.3,1) both;
    }
    @keyframes stageIn { 0% { opacity: 0; transform: translateY(16px); }
      100% { opacity: 1; transform: none; } }
    /* Masthead: crest + wordmark, gently bobbing over the valley. */
    .login-mast { text-align: center; margin-bottom: 18px; }
    .login-crest { width: clamp(84px, 16vh, 124px); height: clamp(84px, 16vh, 124px);
      margin: 0 auto 4px; filter: drop-shadow(0 8px 18px rgba(0,0,0,.6)) drop-shadow(0 0 26px rgba(123,191,74,.28));
      animation: crestBob 4.2s ease-in-out infinite; }
    .login-crest svg { width: 100%; height: 100%; }
    @keyframes crestBob { 0%,100% { transform: translateY(0) rotate(-1.2deg); }
      50% { transform: translateY(-7px) rotate(1.2deg); } }
    .login-wordmark {
      margin: 0; font-family: var(--font-display, inherit); font-weight: 800;
      font-size: clamp(34px, 7.5vh, 46px); line-height: 1.05; letter-spacing: .5px;
      background: linear-gradient(180deg, #c9ef9c 0%, #7bbf4a 55%, #4d7a2f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      filter: drop-shadow(0 3px 0 rgba(0,0,0,.85)) drop-shadow(0 0 22px rgba(123,191,74,.35));
    }
    .login-tagline { margin-top: 6px; font-size: 12.5px; letter-spacing: 2.5px;
      text-transform: uppercase; color: #b9c9a6; opacity: .85; text-shadow: 0 1px 3px #000; }
    #login-card { width: 100%; }
    .login-foot { margin-top: 14px; font-size: 11px; letter-spacing: 1.5px;
      color: #6f7d62; text-shadow: 0 1px 2px #000; }
    /* The card: dark glass over the valley. */
    .login-panel {
      width: 100%; padding: 20px 22px 18px;
      background: linear-gradient(180deg, rgba(24,28,20,.86), rgba(14,17,12,.92));
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      border: 1px solid rgba(143,208,92,.22); border-radius: 16px;
      box-shadow: 0 24px 70px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.07);
      color: var(--text, #efe8d4);
    }
    .login-sub { margin: 0; text-align: center; color: var(--muted, #a89c7d); font-size: 13px; }
    .login-connecting { display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding-top: 26px; padding-bottom: 26px; }
    .conn-spinner { width: 30px; height: 30px; border-radius: 50%;
      border: 3px solid rgba(143,208,92,.18); border-top-color: #8fd05c;
      animation: connSpin .9s linear infinite; }
    @keyframes connSpin { to { transform: rotate(360deg); } }
    .login-tabs {
      display: flex; gap: 4px; margin: 0 0 16px; padding: 4px;
      background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.06); border-radius: 10px;
    }
    .login-tab {
      flex: 1; padding: 9px 10px; cursor: pointer; font-size: 13px; font-weight: 700;
      font-family: var(--font-display, inherit); letter-spacing: .3px;
      border-radius: 7px; border: 1px solid transparent; background: transparent;
      color: var(--muted, #a89c7d); transition: color .15s, background .15s;
    }
    .login-tab:hover { color: var(--text, #efe8d4); }
    .login-tab.active {
      background: linear-gradient(180deg, rgba(143,208,92,.2), rgba(77,122,47,.25));
      color: #c9ef9c; border-color: rgba(143,208,92,.35);
      text-shadow: 0 1px 2px #000;
    }
    .login-form { display: flex; flex-direction: column; gap: 12px; }
    .login-field { display: flex; flex-direction: column; gap: 5px; }
    .login-field > span { font-size: 12px; color: var(--muted, #a89c7d); font-weight: 600; }
    .login-field > span em { font-style: italic; font-weight: 400; color: var(--gold, #e8c65a); }
    .login-field input {
      padding: 11px 13px; font-size: 16px; border-radius: 9px;
      background: rgba(0,0,0,.4); color: var(--text, #efe8d4);
      border: 1px solid rgba(255,255,255,.1); transition: border-color .15s, box-shadow .15s;
    }
    .login-field input:focus { outline: none; border-color: #7bbf4a;
      box-shadow: 0 0 0 3px rgba(123,191,74,.18); }
    .login-primary {
      margin-top: 6px; padding: 13px 16px; cursor: pointer; font-weight: 800; font-size: 15px;
      font-family: var(--font-display, inherit); letter-spacing: .4px;
      border-radius: 10px; color: #0f1408;
      background: linear-gradient(180deg, #a4e070, #5a8f3d);
      border: 1px solid #3c6428;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 4px 14px rgba(90,143,61,.35);
      text-shadow: 0 1px 0 rgba(255,255,255,.25);
      transition: transform .08s, filter .12s;
    }
    .login-primary:hover { filter: brightness(1.08); }
    .login-primary:active { transform: translateY(1px); }
    .login-primary:disabled { opacity: .6; cursor: default; filter: grayscale(.3); }
    .login-hint { margin-top: 12px; font-size: 11.5px; line-height: 1.5; text-align: center; color: var(--muted, #a89c7d); }
    /* "Server resting" landing / ad page */
    .login-panel.coming-soon { text-align: center; }
    .cs-tagline { margin: 2px 2px 16px; font-size: 13.5px; line-height: 1.55; color: var(--text, #efe8d4); }
    .cs-status {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin: 0 0 10px; padding: 10px 12px; border-radius: 9px; font-size: 12.5px;
      background: rgba(232,198,90,.10); border: 1px solid rgba(232,198,90,.35); color: var(--gold, #e8c65a);
    }
    .cs-dot {
      width: 9px; height: 9px; border-radius: 50%; background: var(--gold, #e8c65a);
      box-shadow: 0 0 0 0 rgba(232,198,90,.6); animation: cs-pulse 1.8s infinite;
    }
    @keyframes cs-pulse {
      0% { box-shadow: 0 0 0 0 rgba(232,198,90,.5); }
      70% { box-shadow: 0 0 0 8px rgba(232,198,90,0); }
      100% { box-shadow: 0 0 0 0 rgba(232,198,90,0); }
    }
    .cs-sub { margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: var(--muted, #a89c7d); }
    .coming-soon .login-primary { width: 100%; }
    .login-notice {
      margin: 0 0 14px; padding: 9px 11px; font-size: 12.5px; border-radius: 9px;
      background: rgba(232,198,90,.12); border: 1px solid rgba(232,198,90,.35);
      color: var(--gold, #e8c65a);
    }
    .login-error { min-height: 16px; margin-top: 8px; font-size: 12px; color: #ff8a8a; text-align: center; }
    #logout-btn {
      margin-left: auto; margin-right: 12px; padding: 4px 12px; cursor: pointer;
      font-size: 12px; font-weight: 700; border-radius: 6px;
      background: var(--panel, #26221a); color: var(--muted, #a89c7d);
      border: 1px solid var(--border, #4a4331);
    }
    #logout-btn:hover { color: #ff8a8a; border-color: #7a3030; }
    #logout-btn[hidden] { display: none; }
    /* Short screens (landscape phones): compress the masthead so the form fits. */
    @media (max-height: 600px) {
      .login-crest { width: 64px; height: 64px; }
      .login-wordmark { font-size: 30px; }
      .login-tagline { display: none; }
      .login-mast { margin-bottom: 10px; }
    }
  `;
  document.head.appendChild(style);
}
