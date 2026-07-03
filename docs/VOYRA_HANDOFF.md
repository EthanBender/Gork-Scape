# Voyra Handoff — managing Goblin Empire's hosting & server from Voyra

*Audience: the agent working inside Voyra that will take over **operations** of this
game (hosting, server status, deploys, backups). This doc is self-contained — you do
not need the build history. Written 2026-07-02.*

## 1. What you are managing (two deployables, one repo)

| Piece | What | Where it runs | How it updates |
|---|---|---|---|
| **Client** | Static site: `index.html` + `src/**` ES modules + JSON. **No build step, no npm.** | Cloudflare Pages → **https://gorkscape.ca** | Automatically on every push to `origin/main`. Nothing to operate. |
| **World server** | `server/index.mjs` — zero-dependency Node (built-ins only). Accounts, login, presence, chat, always-on economy, authoritative mobs. | Currently the owner's laptop: `node server/index.mjs` (default **:5200**), exposed via **Cloudflare Tunnel → https://api.gorkscape.ca** | You start/stop/monitor it. This is the part that needs managing. |

Client↔server seam: `src/net/config.js`. On gorkscape.ca the client calls
`https://api.gorkscape.ca`; everywhere else it calls same-origin `/api`. **If the
server ever moves, change `PROD_API_BASE` there + DNS — no other change.**

When the server is **down**, the site still loads but shows the "realm is resting"
landing page (by design — there is no offline mode). So *server process up + tunnel
up* is the entire definition of "the game is online."

## 2. Getting the repo into Voyra

- Live remote: `git clone https://github.com/EthanBender/Gork-Scape.git`
- Offline/one-file transfer: from a checkout run
  `git bundle create gork-scape.bundle --all`
  then in Voyra: `git clone gork-scape.bundle gork-scape`.
- **Not in git (live data — migrate these separately, and back them up):**
  `server/accounts.json` (salted+hashed user accounts + saves) and
  `server/world-state.json` (persistent world/economy state). They live next to the
  server on whatever machine runs it. Losing them = losing every player's progress.

## 3. Ops runbook

| Task | Command / check |
|---|---|
| Start server | `node server/index.mjs [port]` (default 5200; env: `PORT`, `ACCOUNTS_FILE`, `STATE_FILE`) |
| Health check | `GET https://api.gorkscape.ca/api/world` → `200` + JSON (tick, clock, event) = **up**. Non-200/timeout = **down**. |
| Live status stream | `GET /api/stream` (SSE; one world snapshot per tick) — good for a Voyra status widget |
| Tunnel | `cloudflared` config → `api.gorkscape.ca` → `localhost:5200`. Setup + service install: [DEPLOY_SERVER.md](../DEPLOY_SERVER.md) |
| Backup | Copy `server/accounts.json` + `server/world-state.json` (the server also writes `*.tmp` during atomic saves — ignore those). Daily is plenty for now. |
| Client deploy | Nothing — push to `main` = live in ~1 min. Deploy config: `_headers`, `netlify.toml`, `wrangler.jsonc` (don't delete). CI: `.github/workflows/ci.yml`. |
| Restart safety | The server saves state on write; restart any time. Players see "resting" while it's down and reconnect after. |

## 4. If Voyra's agent changes code (rules that keep the site alive)

1. Run the gates before pushing: `node scripts/smoke.mjs` (boot — **red = the
   auto-publish refuses to ship**), `node test/run.mjs`,
   `node scripts/economy_sim.mjs`, `node scripts/quest_test.mjs`,
   `node scripts/audit_world.mjs` (after any world-gen change).
2. **Never add client build tooling** — the browser gets files as-is from Pages.
3. All server calls go through `api()` from `src/net/config.js` — never hardcode.
4. Preview against the real server (`node server/index.mjs` serves client + API
   same-origin), not a static file server, or you'll only see the landing page.
5. The repo has a Stop-hook (`scripts/autocommit.sh`) that green-gates, commits, and
   pushes automatically when driven by Claude Code. If Voyra doesn't use those hooks,
   replicate the invariant manually: **only push a tree where smoke passes.**

## 5. Orientation map

```
index.html            client shell + all CSS
src/main.js           Phaser scene, input, render loop (largest file)
src/world/            map generation, world data, wilderness POIs, interiors
src/engine/, systems/ state, combat, skills, save, session, economy systems
src/net/config.js     THE client↔server seam
src/data/*.json       item/monster/node design database
server/               the Node world server (see server/README.md)
scripts/              gates + autocommit + world audit tools
docs/                 architecture (MULTIPLAYER_ARCHITECTURE, SERVER_DECISION,
                      ELEVATION_MODEL, economy docs) — and this file
ROADMAP.md            what's done / what's next
COORDINATION.md       historical multi-agent build log + "HOW IT GOES LIVE"
goblin_*_pack/        original design documents (inputs, not code)
```

**If a local model does feature work**, the execution order lives in
[CRITICAL_PATH.md](CRITICAL_PATH.md) — start with the map design pass
([MAP_DESIGN_PASS.md](MAP_DESIGN_PASS.md): scanner, patch system, runbook;
bounded, verifiable, per-chunk commits), and note the "NOT for smaller
models" list before touching anything else.

**Objective for Voyra (owner's words):** manage "the hosting, the server statuses,
and all of that stuff" — i.e. §3. Feature work (ROADMAP.md "Next") comes after the
ops migration is solid.
