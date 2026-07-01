// server/accounts.mjs
// Server-authoritative player accounts for Goblin Empire (Phase 4, step 3:
// "session.js login → real auth", per server/README.md).
//
// This is the piece that turns the name-only, this-browser-only login into real
// accounts: a username + password, verified by the server, with the player's
// save stored SERVER-SIDE keyed to that account — so a player can sign in from
// any device and get their character, and "Gork for everybody" becomes a name
// that belongs to one person.
//
// Deliberately DEPENDENCY-FREE (Node built-ins only: `crypto`, `fs`) to match the
// rest of the server. Passwords are salted + scrypt-hashed (never stored in the
// clear); sessions are opaque random tokens with an expiry. The whole store lives
// in one JSON file written atomically (temp + rename) exactly like world-state.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in for 30 days
const SCRYPT_KEYLEN = 64;
const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;       // mirrors the client's validName()
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;
const SAVE_DEBOUNCE_MS = 1500;                  // coalesce rapid autosave writes

// A username is matched case-insensitively (so "Gork" and "gork" are the same
// account) but the ORIGINAL casing the player typed is preserved for display.
const keyOf = (username) => String(username).trim().toLowerCase();

function newToken() { return randomBytes(24).toString('hex'); }
function newSalt() { return randomBytes(16).toString('hex'); }

function hashPassword(password, saltHex) {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN).toString('hex');
}

// Constant-time compare so a wrong password can't be timed byte-by-byte.
function passwordMatches(password, rec) {
  const attempt = Buffer.from(hashPassword(password, rec.salt), 'hex');
  const stored = Buffer.from(rec.hash, 'hex');
  return attempt.length === stored.length && timingSafeEqual(attempt, stored);
}

export class Accounts {
  constructor(file) {
    this.file = file;
    this.users = new Map();     // key -> { username, salt, hash, createdAt, lastLogin, save, savedAt }
    this.sessions = new Map();  // token -> { key, exp }
    this._dirty = false;
    this._saveTimer = null;
    this._load();
  }

  // ------------------------------------------------------------ persistence
  _load() {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      if (data.users) for (const [k, v] of Object.entries(data.users)) this.users.set(k, v);
      const now = Date.now();
      if (data.sessions) {
        for (const [t, s] of Object.entries(data.sessions)) {
          if (s && s.exp > now && this.users.has(s.key)) this.sessions.set(t, s);
        }
      }
      console.log(`[accounts] loaded ${this.users.size} account(s), ${this.sessions.size} live session(s)`);
    } catch (e) {
      console.error('[accounts] could not load store:', e.message);
    }
  }

  // Coalesce writes: autosave can fire often, so mark dirty and flush shortly
  // after instead of writing the whole file on every keystroke of progress.
  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
  }

  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const data = {
      version: 1,
      users: Object.fromEntries(this.users),
      sessions: Object.fromEntries(this.sessions),
    };
    try {
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file); // atomic on the same filesystem — never a half file
    } catch (err) {
      console.error('[accounts] save failed:', err.message);
      this._dirty = true; // try again on the next tick
    }
  }

  // ------------------------------------------------------------ sessions
  _issueSession(key) {
    const token = newToken();
    this.sessions.set(token, { key, exp: Date.now() + TOKEN_TTL_MS });
    this._scheduleSave();
    return token;
  }

  // Resolve a token to its account record, sliding the expiry forward on use so
  // active players stay signed in. Returns null for missing/expired/unknown.
  resolve(token) {
    const s = token && this.sessions.get(token);
    if (!s) return null;
    if (s.exp <= Date.now()) { this.sessions.delete(token); this._scheduleSave(); return null; }
    const rec = this.users.get(s.key);
    if (!rec) { this.sessions.delete(token); return null; }
    s.exp = Date.now() + TOKEN_TTL_MS;
    return rec;
  }

  logout(token) {
    if (this.sessions.delete(token)) this._scheduleSave();
    return { ok: true };
  }

  // ------------------------------------------------------------ auth
  register(username, password) {
    const name = String(username || '').trim();
    if (!NAME_RE.test(name)) return { ok: false, code: 400, error: 'Username must be 2–16 letters, numbers, spaces, - or _.' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return { ok: false, code: 400, error: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.` };
    }
    const key = keyOf(name);
    if (this.users.has(key)) return { ok: false, code: 409, error: 'That name is already taken. Try signing in instead.' };
    const salt = newSalt();
    const rec = {
      username: name, salt, hash: hashPassword(password, salt),
      createdAt: Date.now(), lastLogin: Date.now(), save: null, savedAt: 0,
    };
    this.users.set(key, rec);
    const token = this._issueSession(key);
    console.log(`[accounts] registered "${name}"`);
    return { ok: true, token, username: name, save: null };
  }

  login(username, password) {
    const rec = this.users.get(keyOf(username || ''));
    // Same generic message whether the name is unknown or the password is wrong,
    // so we don't reveal which usernames exist.
    if (!rec || !passwordMatches(password || '', rec)) {
      return { ok: false, code: 401, error: 'Wrong username or password.' };
    }
    rec.lastLogin = Date.now();
    const token = this._issueSession(rec.username && keyOf(rec.username));
    this._scheduleSave();
    return { ok: true, token, username: rec.username, save: rec.save };
  }

  // Resume an existing session (e.g. the client still holds a token after a page
  // refresh) — returns the account + its save without re-entering a password.
  me(token) {
    const rec = this.resolve(token);
    if (!rec) return { ok: false, code: 401, error: 'Session expired — please sign in again.' };
    return { ok: true, username: rec.username, save: rec.save };
  }

  // ------------------------------------------------------------ saves
  putSave(token, save) {
    const rec = this.resolve(token);
    if (!rec) return { ok: false, code: 401, error: 'Session expired — please sign in again.' };
    if (save == null || typeof save !== 'object') return { ok: false, code: 400, error: 'Malformed save.' };
    rec.save = save;
    rec.savedAt = Date.now();
    this._scheduleSave();
    return { ok: true, savedAt: rec.savedAt };
  }
}
