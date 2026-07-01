# Goblin Empire — Multiplayer / MMO Architecture (sketch)

Status: **design sketch**, not built. The game is currently a single-page client
with no backend. This doc proposes the smallest authoritative-server design that
turns it into an MMO with a shared player economy (Grand Exchange), and — crucially
— shows that the economy engine already written is **server-ready** so the
migration is incremental, not a rewrite.

## Guiding principle: authoritative server, dumb-ish clients

In an MMO you cannot trust the client. The server owns the truth (positions,
inventories, skills, the GE order books) and validates every action. Clients send
**intents** ("move here", "attack that", "post this GE offer") and render the
**state** the server streams back.

```
        ┌────────── Client (browser) ──────────┐         ┌──── Server (authoritative) ────┐
        │  Phaser render + input                │  WS/HTTP │  world sim (tick)              │
        │  local interpolation (smooth)         │◄────────►│  combat/skilling validation   │
        │  optimistic UI (predict, reconcile)   │  intents │  Grand Exchange (Market)      │
        │                                       │  + state │  persistence (DB)             │
        └───────────────────────────────────────┘         └────────────────────────────────┘
```

## What's already server-ready (no rewrite needed)

- **`src/systems/grandExchange.js`** — the `Market` class is **pure** (no game/DOM
  imports): order books, price-time matching, partial fills, guide prices. On the
  server you construct **one** `Market`, feed it `place/cancel`, and broadcast the
  resulting fills. Player identity already threads through as the `trader` field.
- **`src/data/*`** — the item/recipe/node/monster/drop registry is static data the
  server loads once and treats as read-only rules. Same files, no duplication.
- **`src/systems/{crafting,drops,gathering,shops}.js`** — pure rule evaluators.
  They currently mutate `Game` via the state helpers; server-side they'd mutate the
  authoritative player record instead (see "the seam" below).

## The seam: swap the local singleton for a transport

Today the client calls the market **directly**:

```js
// geActions.js (today)
import { market } from './grandExchange.js';
const { order, fills } = market.place('buy', itemId, qty, limit, 'player');
```

Tomorrow it calls through a **transport** with the same shape, async:

```js
// geActions.js (networked) — same call sites, awaited
const { order, fills } = await marketTransport.place('buy', itemId, qty, limit);
```

`marketTransport` has two implementations behind one interface (see
`src/net/marketTransport.js`):
- **LocalMarketTransport** — wraps the in-process `Market` (single-player / today).
- **NetworkMarketTransport** — sends the request over WebSocket to the server's
  `Market` and resolves when the server replies. Server pushes async fills (when a
  *resting* order fills later because another player crossed it) via a subscription.

Because the interface is identical, the UI (`panels.js` Exchange tab) and
`geActions.js` escrow logic don't change shape — only `market.foo(...)` becomes
`await transport.foo(...)`.

## Migration path (incremental, each step shippable)

1. **Extract the transport interface** (done as a sketch: `src/net/marketTransport.js`).
   Route `geActions` through `LocalMarketTransport`. Behaviour identical; now async-ready.
2. **Stand up a Node server** owning the `Market` + a player registry. Start with
   just the GE over WebSocket (the highest-value shared system). Clients still run
   the world locally.
3. **Move player state server-side** (inventory, coins, skills) so trades/persist
   are authoritative. Add accounts + a DB (Postgres/SQLite). Escrow lives on the server.
4. **Move the world sim server-side** (positions, combat, skilling, drops) with
   client prediction + reconciliation. This is the big lift; do it last.
5. **Persistence & sharding** — serialize order books + guide map + player saves;
   shard by region if population demands.

## Tech choices (recommended, not decided)

- **Transport:** WebSocket (low-latency, bidirectional) for world + GE; HTTP for
  auth/persistence. A binary protocol later if bandwidth matters.
- **Server:** Node + `ws` (shares the JS rules code verbatim — no reimplementation),
  or Colyseus/Nakama if we want a room/matchmaking framework off the shelf.
- **DB:** Postgres for players + GE history; Redis for hot order-book state.
- **Build step:** MMO likely ends the "no build step" rule — expect to add bundling
  + a server package. Flag to all lanes.

## Economy levers that become server-side dials

- **GE 2% sell tax** (already implemented) is the main money-supply control.
- NPC liquidity seeding (`geActions.ensureLiquidity`) becomes optional once real
  players provide depth — keep it as a price floor/ceiling backstop for thin markets.
- Drop rates / coin faucets (see `docs/ECONOMY_BALANCE.md`) tune inflation.

## Anti-cheat notes (why authoritative matters)

- Never trust client-reported inventory, coins, or trade prices.
- The server re-runs `crafting.resolve` / `shops.buyFromShop` / GE matching itself;
  the client version is only a **prediction** for responsiveness.
- Rate-limit GE spam; the order-id counter + `trader` identity are server-owned.

---

# Phase 4 concrete plan — updated after world-continuity (phases 1–3, 2026-06-30)

The sketch above still holds. Since it was written, phases 1–3 shipped the
**client-side** half of "hosted", which turns out to have built most of the seams
Phase 4 needs. This section maps what exists to the server design so the migration
is mechanical, and pins down what a real always-on server adds that the client
version fundamentally cannot.

## What phases 1–3 already gave us (the seams)

| Client system (shipped) | What it becomes on the server |
|---|---|
| `engine/save.js` `serialize()/applySave()` | The player-record schema. localStorage key `goblin_empire:save:<acct>` → a DB row per account. Same shape over the wire. |
| `engine/session.js` login/logout/idle/autosave | Connection lifecycle + real auth. `registerSaver()` hooks → server persistence cadence. 5-min idle logout → server disconnect/park. |
| `engine/worldClock.js` (pure, absolute-time) | **Runs identically on server and every client with zero sync.** Day/night is a function of `Date.now()`, so nobody has to broadcast it — clients and server agree for free. |
| `systems/worldEvents.js` (pure, deterministic calendar) | Same — the event schedule is a pure function of time. The server only broadcasts *stateful* consequences (a spawned boss), never "it's night now". |
| `geActions.js` `serializeMarket()/restoreMarket()` + `goblin_empire:world_market` | **This is already the authoritative GE-state serialization.** The server loads it on boot, owns the one `Market`, and persists it. Clients stop saving it. |
| `shops.js` `serializeShops()/restoreShops()` + `goblin_empire:world_shops` | Authoritative shop-stock state, same story. |
| `advanceMarketOffline(elapsedMs)` / `restockShops(nowMs)` | **These ARE the server tick loop.** Today they fast-forward once at login; the server runs the same elapsed-time math continuously. No new economy code — just call it on an interval instead of on catch-up. |
| `Game.playerFrozen` gate in `gameTick` | The server-side rule verbatim: a **disconnected player is frozen** (server stops simulating that character) while the world keeps ticking. Reconnect resumes from the saved record. |

The upshot: the owner's rule — *nothing happens to the player offline, the world
keeps going* — is already the architecture. Phase 4 moves **where** the world tick
runs (a server that's always on) so it's genuinely shared and 24/7, instead of
each client fast-forwarding its own copy at login.

## What only the server delivers (why Phase 4 is real, not cosmetic)

- **One shared world.** Two players see the same market, the same prices, each
  other. The client version is single-world-per-browser.
- **Actually always-on.** The world ticks even when *zero* players are connected
  (a cron/daemon), not just "simulated on next login". Resting GE orders fill
  against other real players while you sleep.
- **Trust.** Prices, coins, drops are server-computed; the client is a prediction.

## Server module layout (Node + `ws`, reuses the JS rules verbatim)

```
server/
  index.js          // ws server, connection registry, auth handshake
  worldLoop.js      // setInterval tick: market drift, restocks, spawns, event effects
                    //   → calls the SAME advanceMarketOffline/restockShops/worldEvents
  players.js        // account registry; load/save player records (save.js schema)
  market.js         // owns the single Market (grandExchange.js), routes place/cancel
  persistence.js    // DB adapter; boots world state from world_market/world_shops shapes
  protocol.js       // intent + snapshot message contracts (shared with client/net/)
```
Client side: flip `marketTransport` from `LocalMarketTransport` to
`NetworkMarketTransport` (already stubbed), and `session.js` swaps its localStorage
calls for authenticated HTTP/WS. `worldClock`/`worldEvents` need **no** client change.

## Refined migration path (each step shippable)

1. **Route `geActions` through `marketTransport`** (await the calls) — already
   sketched; makes the GE call sites async/server-shaped with no behaviour change.
2. **Stand up `server/` with the world loop only** — no clients yet. It owns
   `Market` + shop stock, ticks `advanceMarketOffline`/`restockShops` on a real
   interval, and persists the `world_market`/`world_shops` snapshots. Proves the
   "world runs with nobody watching" claim on real infra.
3. **Connect clients to the server's GE** over WS (`NetworkMarketTransport`).
   World still simulated locally; the *market* is now shared + authoritative.
4. **Move player records server-side** — accounts + DB, `save.js` schema becomes
   the row. Escrow/settlement authoritative. `session.js` → real auth.
5. **Move the world sim** (positions/combat/skilling/drops) server-side with client
   prediction + reconciliation. The big lift; the freeze rule + deterministic clock
   make disconnect/reconnect clean.
6. **Persistence & sharding** — as the original sketch.

## Open decisions for the cross-team planning pass

- **Hosting/runtime:** bare Node + `ws` (max code reuse) vs. Colyseus/Nakama
  (rooms/matchmaking off the shelf). Ends the "no build step" rule either way.
- **DB:** Postgres (players + GE history) + Redis (hot order books) vs. SQLite to
  start. Snapshot cadence + crash recovery.
- **World-day length** (`worldClock.DAY_MS`, currently 24 min) is a shared constant
  that must be **server-authoritative** once networked — bake it into `protocol.js`.
- **Instancing vs. one world:** single shard to start (population is tiny); region
  sharding only if needed. GE stays global even if the map shards.
- **Tick rate:** world-economy loop can be slow (seconds); combat/movement needs
  the 600ms sim tick — decide whether they’re the same loop or separate.
