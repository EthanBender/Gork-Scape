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
