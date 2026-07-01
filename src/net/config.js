// src/net/config.js
// One source of truth for WHERE the game server lives.
//
// The client is served statically (Cloudflare Pages at gorkscape.ca), but the
// authoritative server — accounts, the always-on economy — runs separately: on
// the owner's laptop for now, exposed via a Cloudflare Tunnel at api.gorkscape.ca.
// Everywhere else (local dev against `node server/index.mjs`, previews) the API
// is same-origin, so API_BASE is empty and `/api/...` just works.
//
// If the server moves (a paid host, a different subdomain), change PROD_API_BASE
// here and nowhere else — every fetch in serverLink.js / authClient.js routes
// through api().

const PROD_HOSTS = ['gorkscape.ca', 'www.gorkscape.ca'];
const PROD_API_BASE = 'https://api.gorkscape.ca';

const host = (typeof location !== 'undefined' && location.hostname) || '';

// On the public domain the API is the tunnelled server; otherwise same-origin.
export const API_BASE = PROD_HOSTS.includes(host) ? PROD_API_BASE : '';

// Prefix a server path with the active base. Use for EVERY server call so the
// static-client / remote-server split is invisible to callers.
export const api = (path) => API_BASE + path;
