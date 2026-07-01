// src/net/authClient.js
// The client half of real accounts: it talks to the server auth API
// (server/accounts.mjs) so a player signs in with a username + password and
// their character lives on the SERVER, not in one browser.
//
// Graceful degradation, in the same spirit as serverLink.js: if no auth server
// is reachable (e.g. the client was opened from a plain static host or the dev
// file server), every call reports `offline:true` and session.js falls back to
// local, this-device-only characters — so development and static hosting still
// work. When the Node server IS the host, accounts are real and server-backed.
//
// The session token is kept in localStorage so a page refresh keeps you signed
// in (resume() re-validates it) — standard for a browser game.

const TOKEN_KEY = 'goblin_empire:token';
const FETCH_TIMEOUT_MS = 6000; // password hashing (scrypt) can take a moment server-side

let token = readToken();

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
export function getToken() { return token; }
function setToken(t) {
  token = t || null;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

// POST JSON with a hard timeout. Returns { ok, status, data } on any HTTP reply,
// or { offline:true } when the server can't be reached at all (no server / CORS
// / timeout) — the signal session.js uses to switch to local fallback.
async function post(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch {
    return { offline: true };
  } finally {
    clearTimeout(timer);
  }
}

// Shape every auth call the same way for session.js:
//   { ok, username, save, error?, offline? }
function shape(r) {
  if (r.offline) return { ok: false, offline: true, error: 'No server reachable.' };
  if (r.ok && r.data && r.data.username) {
    if (r.data.token) setToken(r.data.token);
    return { ok: true, username: r.data.username, save: r.data.save ?? null };
  }
  return { ok: false, error: (r.data && r.data.error) || 'Something went wrong.' };
}

export async function register(username, password) {
  return shape(await post('/api/auth/register', { username, password }));
}

export async function login(username, password) {
  return shape(await post('/api/auth/login', { username, password }));
}

// Re-establish a session from the stored token (called at boot). Returns
// { ok, username, save } on success, or { ok:false, offline? } — on a clean
// "session expired" (server answered 401) we clear the dead token.
export async function resume() {
  if (!token) return { ok: false };
  const r = await post('/api/auth/me', { token });
  if (r.offline) return { ok: false, offline: true };
  if (r.ok && r.data && r.data.username) return { ok: true, username: r.data.username, save: r.data.save ?? null };
  setToken(null); // token was rejected — forget it
  return { ok: false };
}

export async function logout() {
  const t = token;
  setToken(null);
  if (t) { try { await post('/api/auth/logout', { token: t }); } catch { /* best-effort */ } }
}

// Persist a save blob server-side. Best-effort: returns true if the server
// stored it, false otherwise (offline / no token) so the caller keeps its local
// cache as the fallback copy.
export async function pushSave(save) {
  if (!token) return false;
  const r = await post('/api/auth/save', { token, save });
  return !!(r.ok && r.data && r.data.ok);
}
