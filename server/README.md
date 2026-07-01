# Goblin Empire — Authoritative World Server (Phase 4)

The server that makes the world **actually** always-on. The client-side
"world continuity" work (phases 1–3) made the world *appear* to advance while you
were away by fast-forwarding your own copy on login. This process advances the
**shared** world continuously — it keeps ticking with **zero players connected** —
which is the thing a client can never do.

Status: **step 2 of the Phase 4 migration** (see `docs/MULTIPLAYER_ARCHITECTURE.md`).
It runs the authoritative economy loop + serves the client. Moving player state and
the world simulation server-side are the later steps.

## Run it

```bash
node server/index.mjs           # defaults to port 5200
node server/index.mjs 8080      # or PORT=8080 node server/index.mjs
```

Then open `http://localhost:5200` — the server serves the game client too, so it
replaces the static dev server. Leave it running and the world keeps moving.

**Zero dependencies.** Node built-ins only (`http`, `fs`) — no npm, no build step,
matching the repo. Transport is HTTP + Server-Sent Events; a WebSocket upgrade is a
later transport swap behind the same messages.

## What it does

- **Runs the world loop** every 2s (`LOOP_MS`): drifts Grand Exchange guide prices
  (mean-revert toward each item's base value, biased by the live world event) — the
  same drift the client used at login, now running continuously.
- **Reuses the pure modules verbatim** — proof that keeping them DOM-free paid off:
  - `src/systems/grandExchange.js` — the `Market` matching engine
  - `src/engine/worldClock.js` — day/night as a pure function of time
  - `src/systems/worldEvents.js` — the deterministic event calendar
  Economy **data** is read straight off disk (`src/data/items.json`), so none of the
  browser's `fetch`/`gameData.js` chain is needed here.
- **Persists** guide prices + seq to `server/world-state.json` every ~16s and on
  shutdown, **atomically** (temp file + rename, so a crash mid-write never corrupts
  it). Reloaded on boot — the world remembers across restarts. (Git-ignored: it's
  runtime state, not source.)

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` (and any file) | serves the game client |
| GET | `/api/world` | snapshot: world clock, day/phase, active event, sample prices, uptime/loop |
| GET | `/api/quote?item=<id>` | `{ guide, bestBid, bestAsk, bidQty, askQty }` for one item |
| POST | `/api/order` | body `{ side:"buy"\|"sell", itemId, qty, limit, trader }` → places a GE order (the client→server **intent** seam) |
| GET | `/api/stream` | Server-Sent Events: pushes a world snapshot every tick |

Quick check that the world is running with nobody watching:

```bash
curl localhost:5200/api/world      # note the "loop"/"uptimeSec"/"clock"
sleep 6
curl localhost:5200/api/world      # they've advanced on their own
```

## How the client plugs in (next steps)

1. The GE call sites already have an async seam: `src/net/marketTransport.js`
   (`LocalMarketTransport` today). Add a `NetworkMarketTransport` that POSTs to
   `/api/order` and subscribes to `/api/stream` for guide/fill updates, and route
   `geActions.js` through it. Then the market a player sees is the shared one here.
2. Move player records server-side reusing the `save.js` `serialize()/applySave()`
   shapes (localStorage key → DB row). `session.js` login → real auth.
3. Move the world simulation (positions/combat/skilling) server-side with client
   prediction. The `Game.playerFrozen` rule becomes "disconnected → not simulated".

See `docs/MULTIPLAYER_ARCHITECTURE.md` for the full plan and the state→server mapping.
