# Decision needed: are we building an MMO, or a single-player game that looks like one?

**Status: OPEN — needs an owner decision. This is not a task any one lane can just do.**

This doc exists because there's a growing gap between the **vision** (an MMO with a
shared, player-driven Grand Exchange economy) and the **reality** of the code, and
that gap silently taxes every lane a little more each day it stays unresolved.

## The gap, stated plainly

What we're building toward (per `docs/MULTIPLAYER_ARCHITECTURE.md`, and the GE /
treasury / world-event systems): a shared world where many players trade in one
market, prices move from real supply/demand, and the world keeps turning offline.

What actually exists today:

- **No server.** The whole game is a static single-page client. `README` still says
  "no backend, no build step."
- **No real accounts / auth.** "Login" is *just a character name* — no password. Any
  name signs in; two people can be "Gork."
- **The "shared" economy isn't shared.** The Grand Exchange world state is one
  `localStorage` key **inside a single browser** (`geActions.js` → `WORLD_MARKET_KEY`).
  Two players on two machines have two separate universes. Clearing the browser wipes
  everything.
- **The network layer is a stub.** `src/net/marketTransport.js` throws
  `"server not implemented yet"`.

So every MMO-shaped feature — offline market drift, world events on a shared clock,
the treasury heist "everyone contributes" loop — is currently a **single-player
simulation cosplaying as multiplayer.** That's fine as a prototype. It is a problem
if we keep pouring effort into shared-world features that can't actually be shared.

## Why this is urgent-ish (not a someday)

The cost isn't "it doesn't work" — it demos great single-player. The cost is
**misdirected effort**: time spent tuning a shared economy, offline drift, or
anti-manipulation guards is only ~half-useful until there's a server to make them
real, and some of it will be redone. The longer we build both-ways, the bigger the
eventual reconciliation.

The *good* news, and the reason this is a cheap decision to act on: the economy
engine was written **server-ready on purpose**. `grandExchange.js` is a pure
`Market` class with no DOM/game imports; `crafting/drops/gathering/shops` are pure
rule evaluators; `src/data/*` is static rules. The migration is incremental, not a
rewrite — *if* we decide to do it.

## The three honest options

### A. Commit to the minimal authoritative server now
Stand up the smallest real backend: a Node/WS server that owns the world tick, the
one `Market`, and player saves in a real DB; clients send intents and render streamed
state. Real accounts (name + password or a token).
- **Pros:** the vision becomes real; all the shared-world work starts paying off;
  cheating becomes preventable (server validates).
- **Cons:** it's the big one — days of work, a hosting/DB decision, and it changes how
  *every* lane thinks (client predicts, server decides). Needs owner buy-in on infra.
- **First step:** implement `NetworkMarketTransport` against a tiny WS server that owns
  one `Market`; move GE settlement server-side; keep everything else local until it works.

### B. Scope to single-player (or single-browser co-op) and OWN it
Declare the game single-player for now. Keep the beautiful offline-drift / world-clock
illusion, but **stop building features whose whole point is cross-player sharing**
(shared GE liquidity from *other real people*, guild/treasury contributions, PvP).
- **Pros:** zero new infra; everything already works; effort goes to content/depth
  (quests, bosses, progression) that's valuable either way.
- **Cons:** the "player-driven economy" is simulated (NPC liquidity), not real; no
  social layer.
- **First step:** update `README`/vision to say "single-player RPG with a simulated
  living economy"; park `marketTransport.js` + the MMO doc as "future".

### C. Keep building client-side, but set a decision DEADLINE
Continue as-is, explicitly treating shared-world systems as prototypes, but pick a
date/milestone (e.g. "when combat + 3 skills + 5 quests are fun") at which we choose A
or B. Prevents indefinite drift.
- **Pros:** no pause now; keeps momentum.
- **Cons:** the tax keeps accruing until the deadline; risk of "temporary" becoming
  permanent.

## Recommendation

**B now, with A as the declared future (i.e. B→A).** Concretely: *stop* investing in
cross-player-only mechanics this week, put that effort into the thin-gameplay-loop
hole (quests, goals, boss content — the thing that makes it fun single-player), and
**keep the server-ready seams intact** so option A remains a localized change when the
game is actually fun enough to be worth hosting. Ship a fun single-player game first;
turn on the server when there's a reason for players to want each other there.

The one thing *not* to do is keep building deeper shared-economy machinery on
`localStorage` as if it were multiplayer — that's the effort most likely to be redone.

## What each lane does under the recommendation
- **Economy:** keep the pure engine (it's the crown jewel and stays server-ready); pause
  new *shared*-world features; help with single-player economy depth (shops, sinks).
- **World-Gen:** content and progression (quests, regions, bosses) — valuable in A or B.
- **Character-Render (me):** unaffected by the server question — the avatar reads client
  state either way. I keep polishing and can help build the test/quality backbone.

*Owner: please pick A, B, or C so the lanes can align. Until then I'll assume C
(keep going, no new cross-player-only features) as the safe default.*
