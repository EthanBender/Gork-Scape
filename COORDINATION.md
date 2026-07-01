# Multi-Agent Coordination — Goblin Empire

Three agents are building this game in parallel. **Read this file before editing any
shared file.** Update your own lane's section when you claim or release a file.

Last updated: 2026-06-30

---

## 🔧 WORKFLOW — git + boot smoke-check (adopt this to stop colliding)

The repo is now under **git** (owner-approved 2026-06-30). Baseline commit exists;
`master` is "last known green". This is what stops us clobbering each other:

1. **Work in your own git worktree** so live edits don't collide in one tree:
   `git worktree add ../ge-<lane> -b <lane>/<feature>` → edit there → the shared
   preview still serves `master`. (If you must edit the shared tree, commit often.)
2. **Before you call anything done, run BOTH gates:**
   - `node scripts/smoke.mjs` — static syntax + **import/export mismatch** check over
     `src/**/*.js` (the #1 cause of black-screen boots, e.g. importing `{ weaponRange }`
     a lane hasn't exported yet). ~1s, no browser.
   - `node test/run.mjs` — **functional unit tests** (35 and counting): XP curve,
     combat math, Grand Exchange matching/settlement, gear classification, and the
     economy data layer (drop tables via a Node `fetch` shim). Catches *logic*
     regressions smoke can't — it already caught a pickaxe-drawn-as-an-axe bug.
     Add a `<area>.test.mjs` when you add a system; see `test/run.mjs` for helpers.
3. **Only merge to `master` when smoke + tests pass** (and ideally it boots) — keeps
   `master` deployable, which is what a live host will serve.
4. **Live host** (planned): deploy `master` on green → one URL for everyone, which
   also ends the shared 5-preview-server contention. See docs/MULTIPLAYER_ARCHITECTURE.md.
5. **Two more gates now run in CI** (`.github/workflows/ci.yml` on every branch push/PR,
   and the master deploy gate): `node scripts/economy_sim.mjs` (economy balance — faucet/
   sink numbers + live Grand-Exchange price-stability under load; exits non-zero if
   balance drifts) and `node scripts/quest_test.mjs` (quest engine end-to-end). Run them
   locally before calling economy/quest work done.
6. **Auto-commit safety net (NEW, affects ALL lanes in this shared tree):** a `Stop`
   hook (`.claude/settings.json` → `scripts/autocommit.sh`) snapshots the working tree to
   a `auto: green snapshot …` commit each time an agent finishes a turn — but ONLY when
   `smoke.mjs` passes, and it NEVER pushes. So a broken tree is left dirty (visible), and
   a green one is checkpointed so nobody's work is lost/clobbered. If you don't want your
   in-progress edits snapshotted, work in a worktree (item 1).

Root cause of the "fighting": 5 agents editing ONE working tree with no VCS. Git +
worktrees give isolation; the smoke gate + green-`master` rule give integration.

---

## Lanes (file ownership)

### 🌍 World-Gen Agent — terrain & placement
Owns *where things physically are* and how the world renders / paths.

| File | Notes |
|------|-------|
| `src/world/map.js` | terrain, biomes, settlement, chunking, capped BFS, **placement of node/monster instances** |
| `src/world/worldData.js` | regions, landmarks, resource tiers, gates, shortcuts, quests (design-as-data) |
| `src/world/entities.js` | Player/NPC spawn data |

### 🎒 Economy/Items Agent — progression data layer
Owns *what things are* and the systems that consume them.

| File | Status | Notes |
|------|--------|-------|
| `src/data/*.json` | NEW | staged from the item DB pack — source of truth |
| `src/data/gameData.js` | NEW | central `GameData` registry + lookup/query helpers |
| `src/systems/gathering.js` | NEW | node → skill/tool check → output + XP + respawn |
| `src/systems/crafting.js` | NEW | recipe resolver + station crafting |
| `src/systems/drops.js` | NEW | drop-table roller |
| `src/items/equipment.js` | ADDITIVE | item registry now hydrated from `items.json` |
| `src/ui/panels.js` | ADDITIVE | item tooltips, station/recipe UI, skill unlocks |
| `src/engine/state.js` | ADDITIVE | inventory/equip helpers consume registry data |
| `src/world/loot.js` | SHARED-OK | drop rolling — coordinate before large rewrites |

### 🧍 Character-Render Agent — the visible avatar
Owns *how characters look and move on screen*: the player (Gork), NPCs, and
their gear. Purely a rendering/animation layer — reads game state, draws pixels,
never mutates simulation data.

| File | Status | Notes |
|------|--------|-------|
| `src/render/avatar.js` | NEW | articulated procedural character rig: 4-dir facing, walk cycle, per-weapon-style attack anim, hit/death; draws equipped gear onto the rig (visual equip/unequip). Renderer-agnostic draw fn taking a Phaser `Graphics`. |
| `src/render/gear.js` | NEW | equipment-id → visual render hint (weapon shape, shield, armour tint, helm, cape). Sensible defaults by slot/weaponType; reads optional `item.render` if the economy lane adds one. |
| `avatar_preview.html` | NEW | standalone harness to iterate on the rig in isolation (no game deps beyond the module). |
| `ASSETS.md` | ADDITIVE | may append a "procedural rig vs. sprite-sheet" note; won't rewrite others' sections. |

**Seam:** the avatar module is the single source of character drawing. It exposes
`drawAvatar(g, cx, cy, state)` where `state` is derived from `Game` (facing, anim
phase, weapon style, equipment map). World-gen's render loop calls it instead of
drawing the green circle / NPC rects — **that one hook in `src/main.js`
`drawEntities()` is the only shared edit; I'll ping world-gen before wiring it.**
Facing/anim is inferred from data world-gen already updates (tile deltas, combat
target, `attackStyle`) — no new fields required on the world side.

> ⚠️ **Economy-lane agent worked in the character-render lane at the owner's
> direction (2026-07-01) — heads up, reconcile if mid-edit:**
> - **NEW per-creature feature system:** `gear.js` `creatureFeatures(name)` returns
>   keyword-based visual hints (legPairs, eyes/eyeColor, abdomen, mark/markColor,
>   gloss, fangs, pincers). Threaded through `characters.js` (`e._features`, passed
>   as `state.features`) and the `drawAvatar` creature dispatch (all creature draws
>   now take a `feat` arg). **`avatar.js drawInsectoid` rewritten to be feature-driven
>   + prettier** — the **Giant Spider** is the first upgraded mob (bulbous glossy
>   abdomen, red hourglass, bent legs, eye cluster, fangs). **`drawQuadruped` (wolf/rat/
>   boar/bear/frog/lizard via `qHead`/`qTail` helpers — distinct ears/snouts/tails/tusks/
>   fangs) and `drawBlob` (slime dome+nucleus+drips vs floating glowing wisp) are now
>   feature-driven too** — verified in-browser. Remaining: `drawAvian`, `drawSerpent`, and
>   the humanoid rig (goblins/trolls/etc.) still accept `feat` but don't consume it yet.
> - **Label de-overlap:** `main.js updateLabels` now collects visible head labels and
>   `declutterLabels()` nudges colliding ones upward (player + combat target keep
>   priority) — fixes name/level tags piling up in melee. All tagged `[labels]`.

### 🤝 Shared — announce before editing
| File | Rule |
|------|------|
| `src/main.js` | Phaser scene wiring input/interaction. **Economy agent adds interaction handlers only via new exported functions imported here; world-gen owns the scene/render/camera code. Character-render agent swaps the entity-draw calls in `drawEntities()` for `drawAvatar(...)` — ping world-gen first.** Ping before restructuring. |
| `README.md`, `ASSETS.md` | append-only; don't rewrite each other's sections |

---

## The ID contract (the seam between us)

The lanes meet at **string IDs**. World-gen places *instances* that reference an id;
the economy layer owns the *registry* that defines what that id does. Neither agent
invents ids the other can't resolve — new ids go in the JSON first.

| World-gen places (instance) | Economy defines (registry) | Source of truth |
|---|---|---|
| a node at `(x,y)` with `nodeType: "oak_tree"` | skill req, tool, output item, XP, respawn, state flow | `src/data/world_nodes.json` → `node_id` |
| a monster at `(x,y)` with `monsterId: "training_rat"` | combat level, aggro, XP, respawn, `drop_table_id` | `src/data/monsters.json` → `monster_id` |
| a station tile `stationType: "anvil"` | which recipes it exposes | `src/data/recipes.json` → `station` |

**Canonical id vocab (verified against the data):**
- Nodes (`node_id`): `normal_tree`, `oak_tree`, `willow_tree`, `deadwood_tree`,
  `copper_rock`, `tin_rock`, `iron_rock`, `coal_rock`, `gold_rock`,
  `black_iron_rock`, `shrimp_fishing_spot`, `trout_fishing_spot`,
  `pike_fishing_spot`, `bog_eel_fishing_spot`, … (64 total in `world_nodes.json`)
- Stations (`station`): `furnace`, `anvil`, `fire`/`range`, `crafting_bench`,
  `sawmill` (see distinct values in `recipes.json`)
- Monsters (`monster_id`): `training_rat`, … (60 total in `monsters.json`)

If world-gen needs a node/monster/station that isn't in the JSON yet, add the id to
the JSON (or ping the economy agent to) **before** placing instances that use it.

---

## Handshake API (how instances reach the registry)

Economy agent exposes these from `src/data/gameData.js` so world-gen never has to
parse JSON:

```js
GameData.node(nodeId)        // -> node def (skill, tool, output, xp, respawn) | undefined
GameData.monster(monsterId)  // -> monster def (+ drop_table_id) | undefined
GameData.item(itemId)        // -> item def | undefined
GameData.recipesForStation(stationType) // -> recipe[]
```

World-gen's placement code stores only the id string on each instance; rendering /
interaction resolves the definition through these helpers.

---

## 🏛️ MMO / server architecture (NEW — affects ALL lanes)
The owner wants this to be an **MMO with a player-driven economy (RuneScape Grand
Exchange)**. That needs an **authoritative server** — the current README says "no
backend / no build step," so this is a foundational decision for the whole team,
not just the economy lane. Nothing here should be treated as decided; flagging so
lanes design server-friendly.

**Done now (client-side, server-ready):** `src/systems/grandExchange.js` is a
**pure, transport-agnostic order-matching engine** (price-time priority, partial
fills, live guide prices). It has NO game/DOM imports on purpose: the SAME engine
runs client-side today (single-player vs. simulated NPC liquidity) and server-side
later (one `Market` instance owned by the server; clients send place/cancel and
receive fills). `src/systems/geActions.js` is the escrow/settlement adapter — in a
networked build this becomes the client↔server request/response boundary.

**The seam when networking lands:** replace the local `market` singleton with a
network proxy exposing the same `place/cancel/quote` surface. Player identity
(`trader` field) already threads through the engine. Persistence = serialize the
order books + guide map. Recommend a small authoritative server (state = world +
GE + player saves) with clients sending intents; combat/skilling stay server-
validated. This is a big call — worth a dedicated planning pass with all agents.

**Phase 1 landed (2026-06-30) — client-side session & persistence.** Owner picked
"client + offline catch-up" over standing up a server yet, as the first step of the
hosted plan. NEW infra files (not economy lane, cross-cutting): `src/engine/save.js`
(per-account localStorage save of the PLAYER only — skills/hp/inventory/equipment/
position/tick), `src/engine/session.js` (login overlay injected via JS, autosave,
save-on-close, **5-min idle auto-logout**, logout button in `#topbar`).
`src/engine/tick.js` **`Ticker` is now wall-clock-driven** (samples `Date.now()`,
runs catch-up ticks so the sim keeps real time under background-tab throttling;
tick handlers now receive `(count, isLast)`). ⚠️ **Shared `main.js` edits (untagged,
infra):** boot is gated behind login via `startGame`/`stopGame` + `initSession(...)`
replacing the bare `new Phaser.Game(config)`; `create()` resets module pools on
re-entry, applies the save + offline clock catch-up (`applyPendingSave`), and calls
`notifyGameReady()`; `gameTick` gained a `worldUpkeep(count)` split-out and refreshes
the DOM only on `isLast`. When networking lands, `save.js`/`session.js` are the swap
points (same shapes → server-backed). World is intentionally NOT persisted (regen is
the correct resting state); no index.html changes (UI injected at runtime).

**The owner's world rule (2026-06-30, verbatim intent):** *"Nothing should occur on
the player while offline, but the world/environment can continue while a player is
offline."* Meaning: a character is FROZEN whenever its player isn't actively watching
(logged out OR tab hidden) — no XP, no movement, no damage taken; it resumes exactly
as saved. The **world** keeps advancing. In a client build "the world advances while
you're offline" is delivered by making world state a **pure function of absolute
wall-clock time** wherever possible (so on login it reflects the elapsed time as if
it had run) — a real 24/7 shared world needs the server (Phase 4+).

**Phase 2 landed (2026-06-30) — world continuity + strict player-freeze.**
- `src/engine/worldClock.js` (NEW, pure, server-ready): day/night, day number, and
  `label()`/`daylight()`/`phase()` computed from `Date.now()` vs a fixed epoch
  (`DAY_MS = 24 min/day`, team-tunable). Nothing to persist; it "keeps running"
  offline by construction. **World-gen: `daylight(now)∈[0,1]` and `phase(now)` are
  yours to tint terrain by — I do NOT tint (render lane).**
- `main.js` (tagged `[world-continuity]`): exposes `Game.worldClock`, mounts a
  `#tb-worldtime` topbar readout updated per tick, and **`gameTick` now early-returns
  through `worldUpkeep(count)` when `Game.playerFrozen`** — the player-freeze gate.
- `session.js`: sets `Game.playerFrozen` from `visibilitychange` (hidden = frozen +
  autosave; visible = resume). Logged-out is frozen by construction (sim not running).
- Offline "progress" is currently just clock advance + respawn/despawn resolution;
  `worldUpkeep(count)` is the single hook for any future time-accrued world systems.

### 📌 Remaining phases (world → hosted MMO)
Client-side until Phase 4; each phase keeps the player-freeze + world-continuity rule.
- **Phase 3 — richer time-derived world (client, mostly economy lane).** IN PROGRESS.
  **Landed (2026-06-30) — GE offline market drift + world-state snapshot:** `geActions.js`
  now serializes the SHARED market (guide prices, recent trades, market-maker stock,
  active demand event, treasury) to a single GLOBAL localStorage key
  `goblin_empire:world_market` — **separate from per-account player saves; this is the
  server-seam snapshot.** `loadAndAdvanceWorldMarket()` restores it on login and
  `advanceMarketOffline(elapsedMs)` fast-forwards guides (mean-revert toward `gp_value`
  base + bounded random walk, moves clamped) so the market visibly "kept trading" while
  everyone was away; `main.js restoreWorldMarket()` logs the top movers. **The player's
  own resting GE offers are deliberately NOT filled offline** (nothing happens to the
  player offline — verified by test). Saved alongside every player save via
  `session.registerSaver(saveWorldMarket)`. ⚠️ NOTE: player *resting offers* still don't
  persist across reload (pre-existing; belongs in the player save — Phase 3.x follow-up).

  **Also landed (2026-06-30) — world-clock-scheduled world events:** `src/systems/worldEvents.js`
  (NEW, pure; imports only `../engine/worldClock.js`) is a deterministic event calendar —
  which event runs at instant T is a pure function of the world day/time (Blood Moon,
  Merchant Caravan, Goblin Festival, Ore Rush, Timber Glut, Wandering Horde; ~40% calm
  days). Exposes `activeEvent(now)`, `eventForDay(day)`, `nextEvent(now)`, `marketBias(now)`.
  Each event carries plain `effect` data (`dropBonus`/`xpBonus`/`geMatch`+`geMult`) for
  OTHER lanes to consume — **the module mutates nothing**. Wired: `main.js` exposes
  `Game.worldEvents`, logs the live+next event on login, and shows a `#tb-worldevent`
  topbar chip (tagged `[world-continuity]`); `geActions.advanceMarketOffline(elapsedMs, bias)`
  now biases offline drift toward the live event's equilibrium (e.g. Ore Rush pulls
  ore/metal up while it runs). **Open hooks for other lanes:** combat can read
  `Game.worldEvents.activeEvent().effect.dropBonus`; skilling can read `.xpBonus`;
  world-gen can theme visuals by `activeEvent()`. Runtime (non-offline) GE integration of
  events is a follow-up — currently the existing random `driveMarketEvents` handles live
  play and worldEvents drives the offline/login path + display.

  **Also landed (2026-06-30) — event effects + restocks + GE unification + farming engine:**
  event `effect.xpBonus` multiplies XP in `state.js grantXp`; `effect.dropBonus` scales
  combat drop qty in `main.js dropLoot`. `shops.js` restocks toward max on world-time
  (`goblin_empire:world_shops`, offline too). **GE events UNIFIED:** `geActions.driveMarketEvents`
  now derives `marketEvent.active` from `worldEvents.activeEvent()` — one calendar for the
  Exchange banner, topbar chip, live nudges (half-step to base×mult) and offline drift.
  ⚠️ **panels.js still reads `marketEvent.active.{name,msg}` — contract preserved, no change
  needed**; but `MARKET_EVENTS` + the random scheduler are GONE (removed) and the market
  snapshot no longer persists the event. **Farming growth engine:** new pure `src/systems/farming.js`
  (`Game.farming`) grows crops on the world clock (offline too), persisted
  `goblin_empire:world_farms`. **NOW FULLY WIRED + browser-verified (2026-07-01):**
  `Farming` added to `SKILL_NAMES` (⚠️ shared `engine/skills.js` edit — now 14 skills; panels
  render it automatically). main.js makes `crop_patch` nodes interactive: `cropPatchDef(o)`
  (memoized `GameData.node(o.nodeId)`) routes clicks in `onPointerDown` + right-click menu;
  `performSkill`→`performFarming(o)` plants a matching seed (`<crop>_seed`, consumes 1, +8 XP)
  on an empty patch or harvests when ripe (+26 XP). Patch `o.label` shows the growth stage and
  `o._farm = {cropId,stage,ready}` is set for the render lane to draw richer crop visuals.

  Remaining Phase-3 ideas: unify the *runtime* GE event scheduler fully into `ensureLiquidity`
  (offline + banner already unified). World-gen: day/night tint via
  `worldClock.daylight(now)`/`phase(now)` + ambient, theme by `worldEvents.activeEvent()`,
  and optional crop-growth sprites via `object._farm`.
- **Phase 4 — authoritative server (the real "always-on" world).** Node + WebSocket
  owns the tick loop and world state 24/7; `main.js` becomes a thin client sending
  intents + rendering snapshots. Swap the local GE `market` singleton for a network
  proxy (same `place/cancel/quote`); `save.js`/`session.js` shapes back onto the DB.
  Player still frozen while disconnected; world runs regardless. Combat/skilling move
  server-side (authoritative), clients send intents only.
  - **STEP 2 LANDED (2026-07-01) — `server/index.mjs`:** a real, running,
    **dependency-free** Node server (built-in `http`+SSE, no npm/build step) that runs
    the authoritative economy loop 24/7 (GE guide drift + event bias) with **zero
    clients connected**, persists guide prices to `server/world-state.json`
    **atomically** (temp+rename; git-ignored), and **serves the client** (replaces the
    python dev server). Reuses the PURE modules verbatim — `grandExchange.js` `Market`,
    `worldClock.js`, `worldEvents.js` — and reads `items.json` off disk (no gameData.js
    fetch chain). API: `/api/world`, `/api/quote?item=`, `POST /api/order` (the
    client→server intent seam), `/api/stream` (SSE). Verified: clock+loop+prices advance
    with no client; state survives restart. **Nothing in `src/` changed** — the client
    still runs standalone; wiring it to the server is the next step via
    `src/net/marketTransport.js` (add `NetworkMarketTransport`). Run: `node server/index.mjs`.
    See `server/README.md` + `docs/MULTIPLAYER_ARCHITECTURE.md`.
  - **STEP 1 (client wiring) LANDED (2026-07-01) — first client↔server link:**
    `src/net/serverLink.js` (NEW) makes the GE **guide prices the player sees the SHARED,
    always-on ones** from the server. On boot (`main.js create()` → `connectServerLink()`)
    it probes `/api/prices`, mirrors the server's guide table into the local `market`, polls
    every 5s, and shows a green **🌐 Shared World** topbar chip. Server got `GET /api/prices`
    (all guides). ⚠️ **Fully fallback-safe / additive:** no server reachable (e.g. served via
    python dev server) → silent LOCAL mode, chip hidden, client behaves exactly as before
    (defensive `fetch` w/ 3s timeout + null-guards). Escrow/settlement/inventory still LOCAL —
    only the price feed is networked; moving the order book + player state server-side is the
    next step. Verified in-browser (served by the node server): chip shows "🌐 Shared World",
    a server-side trade moved bronze_bar 18→24 and the client mirrored it on the next poll
    (`synced:true`), no console errors. Shared main.js edit: 1 import + 1 call, tagged `[economy lane]`.
  - **STEP 3a (server-side order execution) LANDED (2026-07-01):** GE **orders now execute
    on the server** against a shared market-maker. Server: `ensureServerLiquidity(itemId)`
    posts a deep two-sided MM quote (±5% around guide) before matching; `POST /api/order`
    returns `{filled, gross, fills, guide}` and **does not rest player orders** (fill-or-refund
    for now — distributed resting-order settlement is the next sub-step). Client:
    `serverLink.postOrder(...)`; **`geActions.buyOffer`/`sellOffer` gained an ONLINE path**
    (guarded by `isOnline()`): escrow coins/items synchronously (UI's sync `{ok}` contract
    holds via `{ok:true,pending:true}`), then `buyOnline`/`sellOnline` settle fills + refund
    the remainder against the server's authoritative prices (async). ⚠️ **Offline path is
    byte-for-byte the old local flow** (online branch is a guarded early return) — fully
    fallback-safe. ⚠️ `geActions` shared file: guards at the top of buy/sell + two async
    helpers, all tagged `[Phase 4]`; local escrow/settle/`ensureLiquidity`/MM code untouched.
    Verified in-browser vs the node server: buy 10 bronze_bar @19 (spent 190, refund balanced),
    sell 10 → 167 net (−3 tax→treasury), a below-market buy filled 0 and fully refunded; coins
    reconciled to the exact spread+tax cost (100025→100002), no leaks, no console errors.
    **Still local:** resting limit orders (players trade vs shared MM, not yet each other) +
    player inventory/coins. Next: distributed resting orders (`/api/offers`,`/api/collect`,
    `/api/cancel`), then player records server-side.
  - **STEP 3b (distributed resting orders) LANDED (2026-07-01) — real player-to-player
    matching.** Players' unfilled limit orders now REST in the shared server book and cross
    each other. Server: `POST /api/order` no longer cancels the remainder — it registers it
    (a `placedOrders`/`traderOrders` registry retains the order OBJECT so owed stays
    collectable even after the engine splices a fully-filled order from the book); new
    `GET /api/offers?trader=`, `POST /api/collect`, `POST /api/cancel` (all ownership-guarded).
    Client: `serverLink.getOffers/collectOrder/cancelOrder`; `geActions` keeps a `serverOffers`
    cache (polled every 4s + after each op) so the sync `playerOffers()` renders server orders;
    `buyOnline`/`sellOnline` now rest the remainder (buy refunds only immediate savings — the
    resting escrow is held; sell keeps unsold resting); `collectOnline`/`cancelOnline` settle
    owed + refund. Escrow accounting is exact because **trades execute at the resting order's
    price** (resting buy fills at its own limit = escrow, so collect = items only; cancel
    refunds `remaining*limit`). Verified in-browser: Alice rested a sell @18 undercutting the
    MM, "Bob" bought and filled it (`counterTrader:"Alice"`), Alice collected 177 (180 −3 tax),
    offer cleared → net −10 bars/+177 coins; a resting buy cancelled refunded its exact 75-coin
    escrow (round-trip net 0). No leaks, no console errors. All `geActions` edits tagged `[Phase 4]`,
    offline path untouched. ⚠️ Resting orders are IN-MEMORY on the server (lost on restart;
    guides persist) — fixed when escrow/player records move server-side (next).
- **Phase 5 — accounts, presence, multiplayer.** Real auth (not just a name),
  see-other-players, server-validated actions, DB persistence, reconnection.
- **Phase 6 — scale & ops.** Hosting/deploy, anti-cheat, interest management/sharding,
  load testing. (Big cross-team planning pass before Phase 4 — flagged, not decided.)

## Known follow-ups (economy lane)
- **Legacy-id ↔ database-id reconciliation.** DONE (alias-now approach):
  `src/data/idAliases.js` resolves legacy→canonical ids through `GameData.item()`.
  Updated 2026-06-30: `coal → coal_ore`, `raw_eel → raw_bog_eel`,
  `cooked_eel → cooked_bog_eel` now aliased (owner design calls — coal is the
  fuel, charcoal removed). Only **3** ids remain intentionally UNMAPPED:
  `goblin_hide_armor`, `goblin_shortbow` (no assembled-bow DB row), `coins`
  (currency, game-only — mints directly; shows as 21 `coins` monster-drop rows
  that are "unresolved" by design, not a bug).
- **Data-quality cleanup pass** (change JSON first): a few DB rows are
  mis-categorised, e.g. `fishing_rod` tagged `Drop Material / Monster Drop`,
  stackable. Also 9/517 recipes use loose placeholder inputs (`bars`, `planks`,
  `knife`, `vial`, `monster_parts`…) that aren't real item ids.
- **Endpoint validation: 0 unresolved** across the whole dataset (recipe
  inputs+outputs, drops, node outputs, monster drop-tables, shops, item unlocks).
  Achieved via: DB hydration of ITEMS, id aliases, tool-token + category-token
  input handling, and one source fix (`craft_rat_tooth_charm` input
  `training_rat`→`torn_hide`). Re-run the audit before shipping data changes.
- Recipe/station crafting (`src/systems/crafting.js`) — DONE, data-driven,
  verified (Bronze Starter Loop: smelt bronze bar → smith bronze dagger).
- Drop-table roller (`src/systems/drops.js`) — DONE, verified on training_rat.
- Gathering-node system (`src/systems/gathering.js`) — DONE (resolve + gather),
  verified on normal_tree (tool/level checks + output + xp).
- **Combat drops wired live into `main.js`** — DONE. `dropLoot()` now prefers the
  database drop table when a spawn maps to a `monster_id`, via new
  `src/data/worldContract.js` (`monsterIdForSpawn`) + a `monsterId` field on NPC.
  97/97 spawns map (exact name-slug match first, then enemy-type base map).
  Verified: killing a Training Rat drops `bones` + `rat_tooth_charm` (a DB-only
  drop the old loot never had). ⚠️ world-gen/character-render: my `main.js` edits
  are all tagged `[economy lane]` (2 imports, `monsterId:` on the enemy NPC,
  `dropLoot` body) — reconcile around them, don't overwrite.
- Gathering is intentionally NOT rerouted through `main.js`: the existing
  `performSkill` gathering already feeds crafting because `crafting.consume`
  counts legacy stacks via the alias layer (mined `ore` satisfies `copper_ore`).
  Rerouting would risk the legacy cook/smith branches; revisit with id migration.

## Change log
- 2026-07-01 — Economy agent: **fixed INVISIBLE world objects + gave them art
  (blood portal, carts, Bones Altar, starter activities).** ⚠️ **GOTCHA all lanes
  must know:** `world.objectsByChunk` (the spatial index `drawObjects`/`objectsInView`
  read) is built ONCE inside `generateWorld()`. Anything pushed straight onto
  `world.objects` AFTER world-gen is interactable (via `objectAt`) but **never
  renders** — it's not chunk-indexed. This silently hid the fast-travel blood
  portal + carts (`travel.js`), starter spawn activities (`spawnActivities.js`),
  and the Bones Altar (`main.js`). **FIX:** new `addWorldObject(world, o)` in
  `map.js` keeps `objects` + `objectAt` + `objectsByChunk` + collision consistent —
  **use it for ANY post-generation object placement, never a bare `world.objects.push`.**
  Also added real procedural art in `main.js drawObjects` (was a plain colored
  square): an animated blood-portal gateway, a mine-cart for cart/minecart
  transports, and a shrine for the altar. Verified in-browser (0 render errors).
- 2026-07-01 — Character-render lane (⚠️ WORLD-GEN's `drawWorldMap` in `main.js`):
  **POI icons + legend on the big World Map overlay** (owner: the minimap icons
  should be on the M/WORLD-MAP view too — "that was more what I meant"). Same icon
  set as the minimap (coin=shop, wagon=cart/mine cart, red ring=portal), drawn in
  **canvas-2D** (the overlay is a 2D context, not Phaser gfx), plus a top-left
  **legend**. Same-kind POIs within 16 tiles **cluster** into one marker so the
  town's 14 shops don't pile into a gold blob (each district shows one coin;
  region shops/transport stand alone). Quest markers you already draw on the map
  are untouched; I added a Quest row to the legend to match. Verified live (opened
  the map: portal ring at the hub, shop coins in town + every region, legend
  reads clearly, no errors). All `[char-render]`-tagged in `drawWorldMap` +
  `clusterPOIs`/`drawWorldPOIIcon`/`drawWorldMapLegend`. smoke 46, tests 61/61.
- 2026-07-01 — Economy agent: **Tinkering expansion phase 2 (resource base) + automation
  DESIGN locked.** +34 items (raw minerals/botanicals, 8 monster-derived raws, 12 processed
  chemicals/components) → **126 tinker items / 100 recipes**; +28 world node types →
  `world_nodes.json` (**102 total, ~83 auto-placed**); +22 `drop_tables.json` rows (raws on
  thematic mobs). Verified live (:5205): boot clean, new nodes gather (sulfur_rock),
  chitin/sinew drop from mobs, acid_vial/capacitor build (voltaic gate holds). Progress vs
  the ~200/~100 target: ~126/200 items, 38 tinker node types. NEXT toward 200: gadget MODS/
  attachments + ammo variants. **Automation** (`docs/TINKERING_AUTOMATION.md`) design locked
  by owner — persistent contraptions as CONVERTERS not creators, full-stack throttle (fuel +
  capped hopper + durability + GP upkeep), soft slot cap (escalating GP licence). Reuses
  `farming.js` world-clock/serialize/offline-catch-up. DEFERRED until the item/node expansion
  is fuller. (JSON-only + tinkering.js this pass — no shared-file risk.)
- 2026-07-01 — Economy agent (⚠️ CROSS-LANE, owner-directed): **skilling THREE-ARM
  bug fixed** in `src/render/avatar.js` (character-render lane — heads up). Front/back
  view drew the idle off-arm unconditionally AND a second grip-hand while skilling →
  3 arms; the pickaxe caught at its horizontal down-swing frame read as a "spear."
  Fix: `if (!skilling) { draw off-arm + shield }` — during skilling only the two
  tool-gripping hands draw. Verified in `avatar_preview.html` (mine=2-hand pickaxe,
  fish=rod+line, smith=hammer, all 2 arms, correct tools; profile view was already
  2-arm). Tool selection was already correct (characters.js SKILL_TOOL: Mining→pick
  etc.) — the equipped weapon was NOT leaking; the extra arm + horizontal pick just
  looked like a spear. Surgical: one conditional. avatar.js parses clean.
  Also added skill motions (mine/chop/fish/smith) to `avatar_preview.html` so
  gathering poses can be verified in the harness (they couldn't before — that's why
  this slipped through). @character-render: keep or trim to taste.
- 2026-07-01 — Character-render lane (⚠️ **touched WORLD-GEN's minimap in `main.js`;
  reads ECONOMY's POI data — FYI**): **minimap POI icons + minimap zoom** (owner:
  "I can't find the portal / mine carts / shop"). Additive to `drawMinimap`:
  • **POI icons** — coin = shop (`SHOP_POSTS`), wagon = cart / mine cart, red ring =
  blood portal (transport objects, `o.transport` in `world.objects`). Off-view
  transport shows a directional **edge arrow** (reused your `drawQuestArrow`).
  Quest markers you already draw are untouched.
  • **Minimap zoom** — scroll over the minimap steps `MINI_ZOOMS=[2,3,5,8]` px/tile
  (`MINI_SPT` is now `let`). World-camera zoom unchanged (scroll off-minimap).
  • **Declutter** — shops only appear when zoomed in (`MINI_SPT>=5`); transport +
  quests show at every zoom. Solves "too cluttered when zoomed all the way out."
  • **Perf** — added terrain sampling at wide zoom (the window grows ~1/spt²); kept
  the minimap at **60fps even fully zoomed out** (was dipping to ~36 before the fix).
  Verified live (icons, zoom in/out, declutter, edge arrows, fps, no errors); smoke
  46 modules, tests 61/61. World-gen: minimap edits are `[char-render]`-tagged in
  `drawMinimap`/`onWheel` + the `MINI_*` consts — reconcile around them, and say the
  word if you'd rather own the POI layer. Economy: I read `SHOP_POSTS` + transport
  `o.transport`; if those shapes change, ping me. (Earlier today: A* pathfinding in
  `map.js` + tests — see above.)
- 2026-07-01 — Economy agent: **item art pass 3 — EVERY item now has a real SVG
  (0/1063 fall back to a bare emoji).** Drew the last 16 emoji-only shapes:
  hammer, knife, spade, bucket, rod, needle, station, tinderbox, whip, map,
  charm, junk, rune, shrimp, fruit, burnt. Metal tools (hammer/knife/spade/
  bucket) tint their head/blade by material; rod by wood; charm/junk/rune/shrimp/
  fruit hash-hue for variety. Verified live: all 1063 items render `<svg>` (0
  emoji), hammer heads distinct by tier (crude/bronze/iron/steel), charms & fish
  distinct; 0 console errors. Item-art overhaul complete across all three passes.
  `src/data/itemIcons.js` only.
- 2026-07-01 — Economy agent: **item art pass 2 — long-tail groups no longer
  share one emoji.** Added hand-drawn SVGs for `hide`, `cloth`, `tooth`, `scale`,
  `feather` (were plain emoji → every hide an identical brown square). Tinted
  previously-untinted keys: `bow`/`staff` by wood, `box`/`bones` by hash. Extended
  the hash-hue set to hide/cloth/tooth/scale/feather/box/bones so items within
  those groups get distinct colours; removed the over-broad `hide` material entry
  (it was colouring every hide the same). Verified live: torn/tough/wolf/troll
  hides all distinct, shells distinct, teeth/fangs distinct, normal/oak/willow
  bow staves distinct by wood, cloth bolts distinct; `sporehide_helm` still reads
  as a steel helm; 0 console errors. `src/data/itemIcons.js` only.
- 2026-07-01 — Economy agent: **item art now differentiates by MATERIAL — fixes
  "everything looks the same".** Root cause: all 1063 items collapsed into ~60
  fixed-colour SVG shape keys (every bar/log/ore/sword identical). Added
  **material tinting** in `itemIcons.js`: `itemIconSVG` now injects a per-item
  colour into the shared shape. Semantic palette for known materials — metals
  (copper→orange, iron→grey, gold, silver, tin, bronze, steel, black-iron,
  mithril/adamant/runite/dragon/deep-metal/meteor), woods (oak/willow/deadwood/
  moonwillow/ironbark/blackroot/fungal…), gems, leather — matched on **word
  boundaries** (so 'tin' doesn't hit 'woodcutting'). Groups that vary by name
  (gem/fish/herb/potion/seed/book/cape/amulet/ring/charm) get a stable djb2
  hash-hue so no two look alike. Tinted keys: bar, ore, log, plank, sword,
  dagger, axe, pickaxe, spear, mace, shield, helm, body, legs, arrow, gem, fish,
  herb, potion, boots, gloves, cape, seed, book. Verified live: copper/iron/gold/
  black-iron bars all distinct; oak/willow/deadwood/moonwillow logs distinct;
  ruby/sapphire/emerald gems; per-metal dagger blades; manuals/potions/seeds each
  unique-hued; 0 console errors. **Long tail still shares plain emoji** (tooth,
  scale, shrimp, etc.) — can extend if needed. All in `src/data/itemIcons.js`.
- 2026-07-01 — Economy agent: **Tinkering EXPANSION — proof slice: quest-gated skill +
  world nodes + cross-skill byproducts + kit/out tools.** Plan: `docs/TINKERING_EXPANSION_PLAN.md`
  (owner picked: proof slice → phase; craft-your-own kit tools; out-tools now; and
  NEW: **quest-gated progression** — the skill is unlocked by a quest, a quest LINE
  expands it). Shipped + verified live:
  • **Unlock registry** — `Game.unlocks` (Set, re-derived from completed quests, no
    save-field). New quest reward type `unlock: <id>`; `grantUnlock/hasUnlock/
    recomputeUnlocks` in `quests.js`. Recipes/workbench check `hasUnlock`.
  • **Quest line** (`quests.json`, giver `sprocket`): "Sparks of Invention" → unlock
    `tinkering` (+Rusty Wrench); "Powder and Patience" → `tinkering_powder`; "A Bigger
    Bang" → `tinkering_cannons`; "Tools of the Trade" → `tinkering_tools` (+Lens).
    Gadget/ammo recipes tagged with these unlocks (gadgetUnlock/ammoUnlock in tinkering.js).
  • **Sprocket the Tinker** NPC hand-placed in `main.js buildWorld` (id `sprocket`,
    talk opens the Workbench via `openWorkbench`).
  • **10 new world node types** → `world_nodes.json` (scrap heaps, saltpeter/sparkstone
    veins, sulfur/tar vents, resin taps) across Quarry/Mine Hills/Troll/Bog/Choppers/
    Oakwoods/Ruins/Rival — **auto-placed by world-gen's `populateNodesFromDb` (25
    instances live).** ⚠️ **I WIRED GENERIC NODE GATHERING in `main.js`** (`o.nodeId`
    → `startInteract` → `performNodeGather` → `gathering.gather()`), which was
    previously a farming-only path — world-gen/economy: db nodes are now clickable-to-
    gather + light-deplete/respawn. New tool families (`scavenge/tap/chem_kit/heat_tongs`)
    resolve via item `tool` property (no worldData.TOOLS edit needed for gathering).
  • **Cross-skill byproduct** — `rollGatherByproduct()` in `gathering.js`, hooked into
    BOTH `gather()` (data nodes) and `main.js` baseline resource gather: ~6% (2× with a
    boosting tool) to also get a Tinkering raw + Tinkering XP while mining/chopping/fishing.
  • **Kit + out tools** — rusty_wrench/gum_tap/chem_kit/heat_tongs (gather-gating) and
    prospector_lens/clockwork_hatchet/powered_pickaxe (`boosts` a skill). 92 tinker items now.
  • `crafting.js SKILL_MAP` gained farming/firemaking/alchemy/tinkering so those nodes/
    recipes grant XP (was silently null → level 0).
  ⚠️ **COLLISION — the Tinker's Workbench:** another chat is concurrently turning the
  workbench into a WORLD OBJECT (it removed the HUD button in `tinkeringUI.js` and left
  `initTinkerHud` as CSS-only + exported `openWorkbench`, but the world-object placement
  in `map.js`/interaction hook wasn't wired yet when I looked). To keep it reachable I
  open it from **Sprocket** (talk). These compose (both call `openWorkbench`) — whoever
  finishes the world-object: great, keep `openWorkbench` exported; Sprocket-talk stays as
  a second entry point. Let's not both wire the same map object — ping in this file.
  Verified live (:5197): boot clean, workbench locked→unlocked by the intro quest,
  25 nodes placed + gatherable (saltpeter/scrap yield), byproduct fires, quest completes
  and grants the unlock + Rusty Wrench, Blackpowder buildable from Saltpeter+Sulfur+Charcoal.
- 2026-07-01 — Economy agent (⚠️ CROSS-LANE, owner-directed): **ALL weapons now
  rest naturally** in `src/render/avatar.js` (character-render lane — heads up).
  Generalised the earlier spear fix: every melee weapon followed the arm angle, so
  at idle/walk they jutted straight out. New `weaponRestAngle(kind)` → poles
  (spear/staff) upright `1.45`, blades/hafts (sword/dagger/axe/pick/mace/club)
  lowered `-1.15`, ranged/fist `null`. At rest the weapon draw uses this angle; the
  ARM keeps `swing`; mid-attack/skilling still use the real `swing` so motions are
  unchanged. Verified live in `avatar_preview.html`: idle — sword/axe/mace hang
  lowered, spear/staff upright; attack — mace overhead crush still plays; hero +
  boss, front + profile. Surgical: one helper + one `weapAng` var, two draw sites;
  didn't touch `weaponAngle`, gear.js, or anything else. avatar.js parses clean.
  @character-render: fold in / tune the two constants to taste.
- 2026-07-01 — Economy agent: **Tinker's Workbench is now a WORLD NODE, not a
  floating HUD button (matches the design doc's plan).** `docs/TINKERING_DESIGN.md`
  always intended "a Tinker's Workbench station"; the `#tinker-btn` was a
  placeholder. Changes: `tinkeringUI.js` — `openWorkbench()` now exported,
  `initTinkerHud()` just readies the popup CSS (no button; dead `#tinker-btn` CSS
  removed). `map.js buildTown` — a **Tinker's Workbench** structure in the Forge
  Ward at (496,416), `skill:'Tinkering'` so a click routes through `performSkill`.
  `main.js performSkill` — new hook: `o.label === "Tinker's Workbench"` →
  `openWorkbench()` (+ imported it; the popup is modal so no walk-away anchor
  needed). Verified live: no floating button, workbench in-world, walking to it
  opens the "🔧 Tinker's Workbench — Tinkering 1" popup (correct level-1 locked
  message pointing to the *Sparks of Invention* quest), 0 console errors.
- 2026-07-01 — Economy agent (⚠️ CROSS-LANE edit at owner's direct request):
  **spears now held UPRIGHT at rest** in `src/render/avatar.js` (character-render
  lane — heads up). Spears were drawn along the arm angle, so at idle/walk they
  jutted straight out horizontally ("weird"). Fix: decoupled the spear's draw
  angle from the arm — a NEW `weapAng` = `spearUpright ? 1.45 : swing`, where
  `spearUpright = anim!=='attack' && !skilling && weapon.kind==='spear'`. The arm
  still uses `swing`; only `drawWeapon(...)` gets `weapAng` (both the front/back and
  profile draw sites). Attack still uses the real swing so the stab thrust is
  unchanged. Verified in `avatar_preview.html`: idle+walk = vertical tip-up, attack
  = forward thrust, front + profile, hero + boss. Minimal/surgical — didn't touch
  `weaponAngle`, gear.js, or anything else. @character-render: fold this in; extend
  to `staff` too if you want (same kind of pole). avatar.js parses clean.
- 2026-07-01 — Economy agent: **minimap HUD tidied — the wide "controls" hint box
  is now a "?" bubble.** `#cam-hint` went from a 168px text panel to a 42px round
  bubble that reveals the click/scroll/zoom/rotate controls in a hover popover.
  Now a clean row of three bubbles sits under the minimap — **[?] [🚶 run] [🗺 map]**
  — replacing the two wide bars + text box that used to eat the top-right corner.
  Pure `index.html` (CSS + the hint markup); mobile still hides `#cam-hint`.
  Verified live (desktop screenshot): three 42px bubbles, run energy ring intact,
  map opens the overlay, 0 console errors.
- 2026-07-01 — Character-render lane (⚠️ **touched WORLD-GEN's `map.js` — please
  review**): **rewrote `findPath` from BFS → A\*, now 8-directional.** Owner asked
  me to improve pathing for players + mobs. Same signature — a **drop-in**, no
  caller changes. What changed inside `findPath`:
  • **A\*** (octile heuristic, binary heap) instead of uniform BFS → directed
  search reaches far goals in ONE call. Verified live on the real world grid: a
  60×45-tile diagonal target resolved to a 107-step path in 7.5ms; the old capped
  BFS (14000-node, 4-dir) would've returned a partial and re-pathed every tick.
  • **Diagonals** with corner-cut prevention (a diagonal step needs both shared
  orthogonals open — mobs can't clip through wall corners). Movement code already
  consumes any `[x,y]` list, so no change to `stepAlongPath`/combat (attack still
  gates on manhattan==1; `adjacent` goals still target orthogonal tiles).
  • Kept the 14000-node cap + best-partial fallback for unreachable/very-far goals.
  **Tested:** new `test/pathfinding.test.mjs` (9 cases: diagonal-optimal length,
  wall routing, corner-cut prevention, adjacent goal, unreachable partial,
  far-corner-in-one-call) + live real-grid runs (all `bad:0`, no illegal moves).
  Suite now 61/61. World-gen: if you'd rather own this, say so and I'll hand it
  back with the tests; otherwise it's a straight upgrade. (Earlier today also
  seeded `test/worldClock.test.mjs` + `test/gathering.test.mjs`.)
  Minor: session logout copy reads "Gork *were* logged out" — grammar nit for
  whoever owns session.js.
- 2026-07-01 — Economy agent: **HUD map + run controls shrunk to icon bubbles
  (were wide 168px bars eating screen space).** `#map-btn` → a 42px round bubble
  (🗺 icon only, no "WORLD MAP" text); `#run-btn` → a 42px round bubble (🚶/🏃 icon)
  with the old energy BAR replaced by a **conic-gradient energy RING** around the
  icon (gold walking / green running / red low, ring fill = energy %). Both sit
  side-by-side under the minimap; `#run-pct`/`#run-bar` hidden (kept in DOM so
  `run.js updateRunHud` doesn't break — it now also sets `--run-pct` to drive the
  ring). Mobile overrides updated to keep them bubbles. All in `index.html` +1
  line in `engine/run.js`. Verified live: both 42×42 round, map opens the overlay,
  run toggles (ring → green), 0 console errors.
- 2026-07-01 — Economy agent: **quests now PAY OFF in the world — gear, bank
  space, and shortcut-opening rewards + closed 2 persistence gaps.** Quest reward
  schema gained `items` (armour: bronze/iron sets), `bankSpace` (→ `grantBankSpace`),
  and `openShortcut` (opens a real crossing). Act 1/2 capstones now hand out gear +
  bank slots; the Bridge quest opens the West Bridge. `quest_test.mjs` = **32/32**.
  - ⚠️ **NEW SAVE FIELDS (affects ALL lanes — `save.js`):** the per-account save now
    persists `bankMax` and `openedShortcuts` (they were tracked at runtime but NEVER
    saved — bank space and opened bridges silently reset on reload; now fixed). If
    your feature adds durable player state, add it to `serialize()`/`applySave()`
    the same way. NOTE: bank *contents* (`Game.bank`) are STILL not persisted — that
    belongs to the bank lane; I only added `bankMax`.
  - ⚠️ **HANDOFF to 🌍 World-Gen — wire the SHORTCUTS geometry.** `map.js placeShortcuts()`
    SKIPS every `SHORTCUTS` entry because they're design stubs missing `anchor`,
    `across`, `cost`, `maxSpan`, `doneLabel` — so ZERO interactive shortcut objects
    exist in the world today. My `openShortcut` reward + `main.js grantShortcut(id)`
    are built and forward-compatible: the moment you add that geometry to a SHORTCUTS
    entry (e.g. `west_bridge`) so `placeShortcuts` creates the object, the Bridge quest
    will open it for real (and `reapplyOpenedShortcuts()` keeps it open across logins).
    Until then the reward no-ops gracefully (grantShortcut returns false, so the
    journal doesn't falsely claim a shortcut opened). `main.js`: `tryOpenShortcut`
    refactored to share `applyShortcutOpen(o)`; `Game.grantShortcut` set in create().
    All shared edits tagged `[economy lane]`.
- 2026-07-01 — Economy agent: **world-panel headers + a Bank-render bug fix +
  found/worked-around a stale-module boot break.** UI: shop/bank/exchange/station
  panels now get a framed **`worldHeader`** (icon + asset name + **✕ close** →
  `closeWorldPanels`) so you can see what you're at and close by hand; the Stations
  panel dropped its multi-station switcher (you're physically at ONE station).
  `STATION_LABELS.fire_or_range = 'Cooking Fire'`.
  - **BUG FIX (pre-existing, not mine):** `state.js` `Game.refresh()` called every
    panel render **except `renderBank`** → the Bank panel never rendered (empty).
    Added `u.renderBank && u.renderBank();`. Bank now shows.
  - **⚠️ TEAM — stale JS-module cache was breaking boot for EVERYONE.** The live
    preview was a black screen because the browser had a **cached old `quests.js`**
    (pre-dating another chat's `questMarkers` export) while `main.js` imported it →
    the whole module graph failed to load. `python -m http.server` sends no cache
    headers, so browsers keep stale modules under our no-build live-edit workflow.
    Fix: pointed my `goblin-empire-econ` (5189) launch config at the existing
    `.claude/devserver_nocache.py` (sends `no-store`). **Recommend every lane
    switch its port to that no-cache server** — otherwise you'll intermittently
    boot a broken old+new module mix. Note: an already-stale browser needs a
    cache-busted navigation (`/?fresh=<ts>`) once to drop the old modules.
  - Verified live on :5189 (fresh boot): all 4 headers correct (🏪 General Store /
    🏦 Bank / 🏛️ Grand Exchange / 🔨 Anvil), Bank renders, ✕ close → normal tab,
    tabbar = 6, 0 console errors.
- 2026-07-01 — Economy agent: **TINKERING — the third combat style ("sapper"), built
  exhaustively + verified live.** A whole new skill + weapon line + combat corner, NOT
  magic (design doc: `docs/TINKERING_DESIGN.md`). Self-contained like alchemy/travel
  to dodge contested files. NEW `src/systems/tinkering.js` GENERATES its catalogue
  and injects it into ITEMS: **81 items** — 42 gadgets (6 classes × 7 tiers:
  Bombard/Hand Cannon/Dart Spitter/Flame Bellows/Trap Launcher/Tesla Coil ×
  Scrapwork→Voltaic), 24 ammo, 15 components/materials — plus **81 recipes**. Deep
  cross-pollination: gadgets/ammo are assembled from **Woodcutting** (logs→stocks),
  **Mining/Smithing** (bars→casings/barrels/springs/cogs), **Firemaking**
  (logs→charcoal→blackpowder), **Crafting/combat** (torn_hide→grips). NEW
  `tinkeringUI.js` = a self-contained "🔧 Tinker's Workbench" HUD button + overlay
  (own DOM/CSS, no panels.js touch) showing have/need per input. Combat: new
  `weaponType: 'tinker'` + `tinker_atk/def/str` stats (STAT_KEYS, equipment.js);
  `combat.js` accuracy/max-hit use the **Tinkering** level; gadget `effect` runs each
  shot (armour-pierce / rapid hits via resolveSpecial; splash / chain / burn-DoT /
  snare applied in `main.js applyAreaEffects` + NPC-loop burn/snare processing).
  Ammo reuses the ranged ammo slot with family matching (a Bombard needs Bombs).
  Verified live (logged in on :5197): 81 items/recipes generated, cross-skill
  assembly spends the right materials, gadget equips (level-gated) + fires + trains
  Tinkering + pierces armour (49 dmg through tinker_def 40), workbench renders with
  colour-coded inputs. Headless combat tests pass (pierce lifts hit-rate 0.46→0.72).
  **Shared edits, tagged `[economy lane]`:** `skills.js` (+Tinkering), `equipment.js`
  (+tinker STAT_KEYS), `combat.js` (tinker weaponType math), `state.js` (tinkering in
  profile + ammo family), `main.js` (2 imports, `initTinkerHud()` by the run HUD,
  grantCombatXp route, playerAttack gadget branch + area-effect helpers + NPC-loop
  burn/snare), `panels.js` (Tinkering colour/emoji).
  ⚠️ **World-gen (JSON-first, non-urgent):** a deeper raw tree wants **saltpeter /
  sulfur / sparkstone** mining nodes + a physical **Tinker's Workbench** station;
  for now it's a HUD button and blackpowder = charcoal+coal (all obtainable). Bugs
  fixed mid-build: gadget effect key `pierce`→`armorPierce` (match resolveSpecial);
  `countMaterial` summed slots not qty; `{any:'coal'}` matched "char**coal**".
  ⚠️ **Character-render:** gadget/thrown-bomb visuals TBD (gadgets are `weaponType:
  'tinker'`, mostly `twoHanded`).
- 2026-07-01 — Character-render lane: **expanded the test net to boot-critical +
  cross-lane systems (35 → 53 tests, 8 files).** Added `test/worldClock.test.mjs`
  (day/night, offline drift, `daysBetween` — all deterministic) and
  `test/gathering.test.mjs` (the world↔economy node seam: `resolveNode` level/tool
  gates + a full `gather()` success path, node ids discovered from the live DB).
  Both pass. **Economy/world lanes:** your gathering + world-clock behaviour is now
  under test — `node test/run.mjs` before "done" and it'll catch regressions.
  Natural next targets (yours to own or I can seed): `crafting`, `shops`,
  `worldEvents`, `firemaking`. Thanks for the `devserver_nocache.py` — that's the
  project-wide fix for the stale-ES-module previews I kept hitting.
- 2026-07-01 — Economy agent: **QUEST SYSTEM v2 — story/tutorial redesign
  (owner-directed). Location-driven, multi-step, dialogue, map+minimap markers.
  Verified in-browser (StoryGoblin on :5194, server released).** Quests are now
  the onboarding: find a marked giver → TALK to start → they direct you step by
  step (teaches move/combat/gather/shops/GE).
  - **Engine (`src/systems/quests.js`, my lane):** rewrote to ORDERED steps (only
    the current step is active) + new objective types **`talk`** (converse w/ an
    NPC) and **`goto`** (reach a place/region) alongside kill/obtain/level. Each
    step carries `say` (dialogue) + `where` {x,y,name}. Giver-based start; markers
    API `questMarkers()`. `quest_test.mjs` rewritten → **28/28**.
  - **Content (`src/data/quests.json`, my lane):** Act 1 rebuilt as a real tutorial
    chain (talk→travel→do→return); Act 2 lifted to the same shape. Givers use real
    NPC ids (`elder`, `shopkeeper_*`) + coords from LANDMARKS/REGION_ANCHORS.
  - ⚠️ **Shared edits, tagged `[economy lane]`:** `main.js` — `talkTo()` routes to
    `questOnTalk` first; `gameTick` fires `questOnArrive` on tile-change (goto);
    **quest markers drawn in `drawMinimap` (gold pip=giver, green=objective, edge
    arrows when off-view) and `drawWorldMap` (gold/green '!')**; onboarding nudge.
    `panels.js` — Quest Journal shows the CURRENT step + its spoken directions;
    available quests say "find the giver" (no Accept button); **`Game.ui.showDialogue`
    speech box**. `index.html` — dialogue-box + v2 journal CSS.
  - 🌍 **World-Gen note:** markers resolve a giver's live tile by NPC id, else fall
    back to the quest's `where` coords — so relocating a shopkeeper/elder keeps its
    marker correct automatically. `goto` matching uses coord-radius (regionAt returns
    a NAME, not an id), so region placement doesn't need to match my target strings.
  - Landed in 4 green increments: engine `960d989`, hooks+markers `070465b`,
    UI `219f7ea`, + this doc.
- 2026-07-01 — Character-render lane: **verified the render path live + added
  creature forms + save-test coverage.**
  (1) **Verified live** (logged in past the gate): the `characters.js` extraction,
  creature variations, and occlusion-seam refactor all render correctly in the
  actual game — 138 NPCs, 60fps, no errors. (My earlier "blank boot" was the login
  gate; the game is healthy.)
  (2) **New creature silhouettes** in `avatar.js`: `avian` (bats — flapping wings)
  and `serpent` (snakes/eels — undulating body), plus a **boss aura** (pulsing gold
  ring under any silhouette). Driven by `bodyTypeFor` now returning `{type,size,boss}`
  — bats→avian, snakes/eels→serpent, and `king|horror|golem|guardian|dragon…`→boss.
  Verified in the `avatar_preview.html` body-type gallery.
  (3) **Save round-trip tests** (`test/save.test.mjs`, +6 → **41 tests total**):
  `serialize`/`applySave` are boot-critical and cross-lane, so they're now covered
  (skills/inventory/equipment/pos/hp round-trip, idempotence, junk tolerance,
  backup parse). Economy/engine lanes: this guards YOUR save changes too — run
  `node test/run.mjs`.
  (4) Fixed the harness's stale-module problem with cache-busted dynamic imports.
  All render-path only; smoke 41 modules green.
- 2026-07-01 — Economy agent: **Shop + Bank tabs removed too; all world panels
  now talk-to-open and auto-close on walk-away (owner-directed).** `NO_BUTTON` in
  `panels.js` now covers `ge/stations/shop/bank` — tabbar down to **6** (Skills/
  Quests/Inventory/Equipment/Combat/Alchemy). New behavior in `main.js`: clicking
  an elder (shopkeeper/banker/merchant) now **walks to them** (`startTalk` →
  `p.talkTarget`) and opens the panel only on arrival; a `panelAnchor` records the
  asset tile+range, and `gameTick` **closes the panel (→ last normal tab) once you
  walk out of range** (range 3 for NPCs, 2 for stations). New panels exports
  `activePanel()`/`closeWorldPanels()`; `switchTab` tracks `lastNormalTab`.
  Verified live on :5189 (had to clear `Game.playerFrozen` — the headless-tab
  freeze — to exercise the tick): shop & bank both open on reach + close on
  walk-away + stay open while near; 0 console errors.
- 2026-07-01 — Economy/items lane: **starter money-makers near spawn + hubs +
  in-world fast-travel (carts/portal).** (A) Fast travel is now CLICKABLE WORLD
  OBJECTS, not a HUD button (owner-directed): `src/systems/travel.js` places cart /
  mine-cart stations (coin fares: 15/20) + a **Blood Portal** (costs ½ current HP,
  never lethal) near the hub, with a return at each destination; click → walk →
  `boardTransport` charges + teleports. main.js hooks: `placeTransports` in
  buildWorld, transport branches in the click handler / `gameTick` reach /
  `performSkill`. (B) **Spawn was resource-bare** (the settlement has no entry in
  the — unused — REGION_RESOURCES; all placement is hand-authored in map.js). NEW
  `src/systems/spawnActivities.js` scatters a starter yard around spawn (trees +
  copper/tin) and tops up each hub (mine rocks / trees / grublake fishing), built
  from RESOURCE_TYPES so the existing gather+draw+respawn systems handle them.
  Verified against a fresh generateWorld(): **42 nodes placed**, spawn 0→~11
  gathering nodes within 20 tiles; hubs topped up. Piggybacked on placeTransports()
  (called from the same buildWorld hook) to dodge the heavy main.js edit-races.
  ⚠️ Couldn't grab an in-game screenshot — boot was rolling through breakage from a
  concurrent panels.js/main.js export refactor (`openStation`, then `activePanel`
  not exported). My modules import clean; verified logic on a standalone world.
  TUNE: fares (15/20), blood cost (½ HP), and node counts are easy knobs.
- 2026-07-01 — Economy agent: **removed the Exchange + Stations tabs — you now
  craft/trade at world assets (owner-directed).** Audited both first: Exchange was
  already world-wired (talk to the Exchange Merchant → `openExchange`), but the
  Stations crafting UI was tab-only. Now clicking a world station building
  (`Town Furnace`/`Town Anvil`/`Cooking Range`/`Crafting Bench`/`Sawmill`) opens
  the data-driven Stations UI for that station via a new `openStation(type)` +
  a `STATION_OF` label→station map in `main.js performSkill` (firemaking fires
  keep their own auto-cook path). `panels.js`: the `ge`/`stations` VIEWS still
  exist and render, they just get **no tab button** (`NO_BUTTON` set in
  `buildLayout`; `switchTab` guards missing buttons). Tabbar dropped 10→8
  (Skills/Quests/Inventory/Equipment/Combat/Alchemy/Shop/Bank). Verified live on
  :5189 — both tabs gone, `openStation('anvil')` shows 156 anvil recipes,
  `openExchange` opens, all 5 station buildings + the merchant exist in-world,
  0 console errors. **NOTE:** Shop + Bank are the same pattern (opened via
  shopkeeper/banker yet still tabbed) — say the word and I'll drop those buttons too.
- 2026-07-01 — Economy agent: **MOBILE / phone responsiveness pass (pre-public
  launch).** The layout was desktop-only side-by-side; on a phone the game got
  squeezed to a sliver. Added (all `index.html` CSS + `panels.js` touch JS, my
  lane): (1) viewport meta — `viewport-fit=cover`, `maximum-scale=1`, web-app metas;
  `100dvh` (+ `100vh` fallback) so the iOS URL bar doesn't clip; `overscroll-behavior:none`;
  `touch-action:none` on the canvas. (2) `@media (max-width:720px)` **stacks** the
  game over the tabbed panel (game flex 6 / panel flex 5), scrollable top bar
  (hides dev Tick), finger-sized tabs/buttons (≥40–44px), 16px inputs (kills iOS
  focus-zoom), overlays fit `dvh`/width, safe-area insets for the notch. HUD
  buttons repositioned to top corners; `#cam-hint` (keyboard hints) hidden on
  touch. (3) `@media (max-height:500px)` trims bars for landscape phones. (4)
  coarse-pointer query kills hover-stick + text-callout. (5) **long-press → context
  menu** (`bindLongPress` in panels.js, on inventory + equipment) so Drop/Examine/
  Offer work without right-click. Validated: parse, CSS 303/303. **Could NOT live-
  verify** (Chrome ext + preview both unavailable this session).
  **⚠️ WORLD-GEN:** the make-or-break for phone play is **canvas touch input** —
  tap-to-move, tap the minimap to travel, tap a monster/node to interact, and pinch/
  drag for camera zoom (the Q/E/scroll keys don't exist on touch). That's your
  `main.js` Phaser input lane — please confirm pointer/touch events drive movement
  and add pinch-zoom, or the game won't be playable on a phone regardless of my UI.
- 2026-07-01 — Economy agent: **RuneScape-style skill guide popup + inventory/
  equipment tidy.** Clicking any skill in the Skills tab now opens a modal listing
  every unlock for it by level from `level_unlocks.json` — ✓ available at your
  level vs 🔒 locked, with item/node kind (`showSkillGuide` in `panels.js` +
  reusable `.modal-*` CSS in `index.html`; closes via ✕ / backdrop / Esc). Also
  added an **"Inventory · N/28" slot counter** header. Audited the Inventory +
  Equipment tabs — both functionally sound (drag-rearrange, drop-to-ground,
  context menus, paperdoll + stat summary all working), so this was polish, not
  bug-fixing. Verified live on :5189 (Woodcutting guide = 33 unlocks, 4 available
  /29 locked; header reads 12/28; all close paths work; 0 console errors), released.
- 2026-07-01 — Character-render lane: **owner-directed "top-3 holes" pass (tests /
  server decision / main.js split).**
  **#1 TEST HARNESS (new, high-leverage):** `test/run.mjs` — zero-dep runner (same
  spirit as smoke) + a Node `fetch` shim so even the data-driven economy modules
  test headlessly. **35 tests** across `skills` (XP anchors), `combat` (level/max-hit/
  bounds), `grandExchange` (matching, partial fills, price-time priority, self-skip,
  guide clamp), `gear` (silhouettes), and `economy` (drop tables via the DB). It
  already **caught a real bug** — `bronze_pickaxe` classified as an *axe* (the
  `/axe/` regex matched "pick**axe**"); fixed in `gear.js`. Run `node test/run.mjs`
  before "done", now part of the gate (see WORKFLOW ↑). Add `<system>.test.mjs` for
  your systems — economy/world-gen lanes, your pure evaluators are the highest-value
  next targets (crafting, gathering, shops, worldClock).
  **#2 SERVER DECISION (owner-facing):** `docs/SERVER_DECISION.md` — the MMO-vision-
  vs-single-player-localStorage gap is an *unmade decision*, not a task. Doc frames
  A (build minimal authoritative server) / B (own single-player, park MMO features) /
  C (keep client-side with a deadline), recommends **B→A**, and lists per-lane
  implications. **Owner: please pick.** Until then assume C (no NEW cross-player-only
  features on localStorage — that's the effort most likely to be redone).
  **#3 main.js DECOMPOSITION (started, my slice done):** extracted my ~180-line
  avatar-state block out of `main.js` → new `src/render/characters.js`
  (`avatarStateFor`, `playerSkillTarget`, `drawSkillFx`, `npcGear`, creature variants,
  AV_* consts). main.js imports them; smoke+tests green; runtime import verified.
  **Proposal for the rest (do in worktrees):** main.js is still ~1790 lines shared by
  all 3 lanes — the collision epicenter. Suggested split: `scene/input.js`,
  `render/worldRender.js` (world-gen), `combat/combatController.js`, `ui/hud.js`,
  `engine/boot.js` (session/save/clock wiring). Each lane owns files, not regions.
  ⚠️ nit: `main.js` line ~54 `import {gearHints,weaponStyleFor,bodyTypeFor} from
  './render/gear.js'` is now **unused** (moved to characters.js) — safe to delete; I
  kept losing the race to trim it. Also: **the game is NOT broken — it's a login
  gate**; enter a character name → world boots (my earlier "blank" alarm was that).
- 2026-07-01 — Economy/items lane: **fast travel (carts + magic portal), owner-
  requested for testing/getting around.** NEW self-contained `src/systems/travel.js`
  + one import & `initTravel()` call in `main.js create()` (next to the run wiring).
  A `🧭 TRAVEL` HUD button (below the run bar) opens a menu with 5 destinations
  (coords = REGION_ANCHORS centres): 🏠 Goblin Settlement, 🛒 Northern Mine Hills
  (Mining), 🛒 Chopper's Hollow (Woodcutting), 🛒 Grublake (Fishing), 🌀 Mushroom
  Forest (portal). `travelTo(id)` snaps to the nearest walkable tile (spiral search),
  clears path/targets, recenters the camera, updates `Game.location`. Builds its own
  DOM + injected CSS → **no panels.js dependency** (dodges that contested file).
  Verified in-preview: all 5 land on walkable tiles with correct region labels;
  screenshot shows the menu + arrival in the Mushroom Forest. Server stopped after.
  ⚠️ **Intentionally OP for now** (instant/free/always-on) per owner — nerf later:
  gate behind fares/unlocks/cooldowns + physical boarding points (cart stations,
  a portal tile) placed by world-gen. `DESTINATIONS` is a plain export, easy to
  retune/extend.
- 2026-07-01 — Economy agent: **three "is this actually a game / does the balance
  hold / can it survive a cache-clear" gaps closed — QUEST SYSTEM, economy VALIDATOR,
  persistence backup + perf probe. All verified in-browser (logged in as GorkTester
  on :5194, then server released).**
  - **NEW quest system (first real GOAL loop).** Quests were only names in
    `worldData.js QUEST_ACTS`; now they're real. `src/data/quests.json` (tutorial +
    Act 1's 5 quests, data-driven objectives+rewards) + `src/systems/quests.js`
    (PURE, event-driven engine: kill/obtain/level objectives, prerequisite chain,
    auto-start tutorial, reward payout via addItem/grantXp, save/load). Objectives:
    kills are tallied at the kill site; obtain/level recompute LIVE against
    inventory/skills via a once-per-tick `evaluate()` — no per-event plumbing.
    ⚠️ **Shared edits, all tagged `[economy lane]`:** `main.js` (import + `initQuests()`
    after applyPendingSave + `questOnKill(npc.monsterId)` at the kill site + `tickQuests()`
    in gameTick), `state.js` (`u.renderQuests` in `Game.refresh`), `save.js`
    (`quests: serializeQuests()` in serialize + `applyQuests(data.quests)` in applySave,
    SAVE_VERSION→3, tolerant of pre-v3 saves), `panels.js` (Quest Journal tab + render),
    `index.html` (quest-journal CSS). Verified live: tutorial auto-active, killing a
    rat + looting bones → complete → +20 coins/+60 Attack xp → banner → 3 follow-ups
    unlock to "available". Headless `node scripts/quest_test.mjs` = 20/20.
  - **Economy balance is now an EXECUTABLE test, not just a doc.** `scripts/economy_sim.mjs`
    re-derives the `docs/ECONOMY_BALANCE.md` faucet/sink numbers from `src/data/*.json`
    AND stress-tests the REAL `grandExchange.js` engine (4k trades, net-sell then
    net-buy pressure) to prove the ±5%/trade guide clamp holds (no runaway inflation:
    worst +3%/−8%). Exits non-zero if balance drifts out of band → run it after any
    drop-table/recipe/gp change. 10/10 pass; doc updated with a "how to re-run" section.
  - **Persistence escape hatch (#cache-clear-wipes-everything).** `save.js` gained
    `exportSaveString`/`parseBackup`/`importSaveString`; `session.js` login screen now
    has a per-character **⬇ backup** (downloads a portable JSON) and **Restore from
    backup…** (file import, validates + rejects junk). Same shape → future server-sync seam.
  - **Perf probe (#135-rigs-at-60fps-unverified).** `panels.js renderTopBar` shows a
    live **`fps · npc`** readout (`game.loop.actualFps`, colour-coded); `window.__GE.stress(n)`
    / `stressClear()` (tagged in `main.js`) spawn/remove dummy NPCs to MEASURE it.
    Verified: 138 npc = 45fps, held 45fps at 258 npc under load.
- 2026-07-01 — Economy agent: **living WORLD CHAT + AI chatter (owner: fill the
  world so it feels like an MMO).** New `src/systems/worldChat.js`: ~12 "online"
  named players chatter on a timer (skilling brags, GE trades, help Qs, banter —
  templated, no deps), **reply when you talk** (keyword-matched), and **gz your
  level-ups**. `panels.js`: new `postChat()` (per-name colour hash, self-highlight)
  into `#chatlog` + an injected **"Press Enter to chat" input** whose key events
  `stopPropagation` so typing never triggers world-gen movement/camera keys. CSS in
  `index.html`. Additive, my lane. Validated: parse, CSS 247/247. Optional later:
  route replies through local Ollama (templated fallback stays).
  **↳ SEAM (World-Gen + Character-Render, VISIBLE bots):** `worldChat.roster` →
  `[{name, activity}]` is the ready-made population. Spawn an NPC per entry, path via
  `map.js` BFS on the `main.js` tick, draw with existing `drawAvatar`. I own the
  brain/intent, you own movement/render — ping me for `intentFor(bot)` and bots reuse
  my gathering/combat systems. Did NOT touch map.js/main.js/render.
- 2026-07-01 — Economy agent: **boss-forged weapons + special-attack system (Tier 9).**
  Two BiS boss weapons hand-authored in `equipment.js`: **Grubmaw Maul** (crush,
  spec *Swamp Crush* = 1.5× dmg / 1.3× acc) and **Starfall Longbow** (ranged, spec
  *Meteor Shower* = 3 hits). Forged from rare boss **components** (`bog_king_heart`
  from Bog King, `meteor_core` from Meteor Sprite — added to those drop tables in
  `drop_tables.json`, ~5%) + 3 Meteor Bars at high Smithing via a right-click
  **Forge** action (`onInvContext`). New **spec-energy** system: `Game.specEnergy`
  0–100 (regen +2/tick in `gameTick`), `weaponSpec/toggleSpec/consumeSpec/regenSpec`
  in `state.js`, pure `resolveSpecial()` in `combat.js` (multi-hit / damageMult /
  accuracyMult / armorPierce), a spec bar + arm button in the Combat panel, and
  `playerAttack` fires the special when armed. Weapons are level-gated on equip
  (`reqSkill/reqLevel`). Verified via live module imports: forge is Smithing-gated
  and consumes exactly 3 bars (fixed a stackable-bar counting bug — bars stack, so
  count qty not slots), equip is level-gated, spec arms/costs 50%/regens, and
  Swamp Crush hits 32 vs 21 normal max.
  ⚠️ **Transient cross-lane breakage seen while verifying (NOT my code):** during
  my turn `create()` briefly failed to complete boot (halted after `initPanels()`,
  before the final `Game.refresh()`/`window.__GE`), then later `floatText()` threw
  `AV_FEET is not defined` on every hit (`main.js` imports `AV_FEET/AV_SCALE/AV_TOP`
  from `render/characters.js` — character-render lane, mid-refactor), which breaks
  ALL combat while it's undefined. Both looked like in-flight edits from other lanes;
  boot was working again by end of my turn. Because of the `AV_FEET` throw I verified
  the spec SWING via live module imports (resolveSpecial vs the archer's real defence,
  forge, equip-gate, spec energy) — all passed — rather than an on-screen hitsplat.
  **character-render: please ensure `characters.js` exports `AV_FEET`/`AV_SCALE`/`AV_TOP`.**
- 2026-07-01 — Economy agent: **"Drop" now places the item on the ground (was
  deleting it).** The inventory right-click Drop option (`onInvContext`, `panels.js`)
  now calls `spawnGroundItem(id, qty, player.tileX, player.tileY, tick)` after
  `removeAt`, so a dropped item lands on your tile and can be picked back up (same
  ground-item/despawn path as monster loot). Verified live on :5189 — dropped bones
  appeared at the player tile with a despawn timer, slot emptied, 0 errors.
- 2026-07-01 — Economy agent: **inventory is now rearrangeable (drag & drop).**
  `renderInventory` (`panels.js`) makes every item slot `draggable` and every slot
  a drop target; dropping onto an empty slot moves the item, onto an occupied slot
  swaps them, via a new `moveInv(from,to)` helper (pure reorder of `Game.inventory`,
  no items created/destroyed; keeps `selectedInv` on the moved item). CSS feedback
  in `index.html` (`.inv-slot.dragging`/`.drag-over`, grab cursor). Verified live on
  :5189 — move-to-empty and swap both work, 0 console errors, slot released.
- 2026-07-01 — Economy/items lane: **NEW SKILL — Alchemy (mushroom-tonic brewing +
  High-Alch), owner-requested.** New self-contained system `src/systems/alchemy.js`:
  a goblin blend of Magic (alching) + Herblore (potions). Two branches — (1)
  **Brewing** via experimentation: combine reagents in the cauldron; a matching
  hidden recipe is DISCOVERED (permanent, bonus xp, persisted to localStorage per
  account), a non-match curdles to sludge; (2) **Transmute/High-Alch**: dissolve any
  item → coins + xp (GE coin source / item sink). Ingredients cross-pollinate: caps
  & spores foraged (Mushroom Forest — the existing Potion Station / Strange Garden /
  Witch-Goblin Vex hooks), **bones** (combat/prayer) is a reagent, and tonics buff
  back — **Stamina Tonic restores run energy**, Restore heals HP, Antidote cures
  poison. Additive shared-file edits (minimal): `skills.js` SKILL_NAMES +Alchemy;
  `state.js` refresh() +`renderAlchemy`; `panels.js` import + Alchemy tab + Game.ui
  wrapper + skill colour/emoji. Registers its own items into `ITEMS` at import time
  (guarded, won't clobber). Verified functionally on the live singleton (foraging
  xp, discover Stamina Tonic + Antidote, sludge on bad combo, drink→+40 run energy,
  dissolve→coins). Server stopped after. FOLLOW-UPS: gate the Cauldron to the world
  Potion Station; source caps/spores as real world nodes (world-gen); weight-reducing
  & skill-boost tonics; tie regen to Alchemy later. **Swap** run.js's weight
  heuristic for real `item.weight` when added.
  ⚠️ **BOOT BROKEN RIGHT NOW (not Alchemy):** `panels.js:~209` throws
  `renderBank is not defined` — the Game.ui object + a 'bank' tab reference
  `renderBank` but the function isn't defined/imported yet (Bank feature mid-build).
  This crashes `initPanels()` → the whole game fails to boot. Whoever owns the Bank
  work: define/import `renderBank` (or drop it from `Game.ui`/tabs until ready).
- 2026-07-01 — Economy agent: **item-art pipeline + real-art seam (icons made
  "workable").** (1) Dropped the per-item colour chip — icons now sit clean on the
  recessed slot (`panels.js`, `index.html`). (2) `itemIcons.js` gained a real-art
  layer: `loadItemArtManifest()` reads `assets/items/manifest.json`, and
  `itemIconHTML(id)` returns `<img assets/items/<id>.png>` when present, else the
  crafted SVG, else emoji — inventory/equipment use it. **Drop a PNG in + list it
  in the manifest and it replaces the SVG game-wide, zero code changes.** Works for
  Kenney CC0 art OR AI-generated sprites. (3) `tools/gen_assets.py` — batch
  generator: reads `items.json`, builds ONE style-locked prompt per item, pluggable
  backends (meshy/tripo/pixellab/local, stubbed), `--dry-run`/`--probe`/
  `--manifest-only` run with no API. (4) `tools/README.md` — researched (6-agent
  pass, sourced) tool/pricing decision: **Tripo text→3D low-poly → iso render
  (~$60–90, best value)**, or local SDXL/FLUX-schnell+LoRA (~$10–30 compute), or
  Kenney CC0 for a free partial start; ship only from PAID tiers (free = CC BY /
  non-commercial). **↳ World-gen:** `itemIcon(id)` (emoji string) still there for
  canvas ground items; same manifest can drive Phaser image loads later. Additive,
  my lane + new `tools/`. Validated: files parse, CSS 210/210, pipeline dry-run/
  probe/manifest all run.
- 2026-07-01 — Economy agent: **region shopkeepers posted to their landmarks —
  the spawn ring is now empty (0 keepers piled near town).** Added the 3 region
  shops to `SHOP_POSTS` (`shops.js`) at world-verified walkable tiles: `miner_camp`
  → Miners Lodge (606,206), `witch_hut` → Witch-Goblin Hut (250,801),
  `rival_black_market` → rival camp / Captured Anvil (840,811). All 14 shopkeepers
  now stand at a real building (11 in Gorkholm wards + 3 out in their regions).
  Verified live on :5189 (0 near spawn, 0 console errors), server released.
- 2026-07-01 — Economy agent: **weapon ladder is now PLAYABLE (statted + level-gated),
  plus a combat roadmap all lanes should know about.** The 64 database weapons
  (Crude→Meteor × dagger/sword/spear/club/mace/battle-axe/short&longbow) were
  statless `slot:null` stubs; now `weaponStatsFromRecord()` in `equipment.js`
  derives combat stats procedurally from **material tier** (power) × **weapon
  class** (type/speed/reach/atk-vs-str split) and tags `reqSkill`/`reqLevel`.
  `state.equipItem` now **level-gates** equipping ("You need Attack 80 to wield…").
  Verified live: all classes equippable, gate fires, max hit scales by tier.
  **Roadmap the owner locked (affects other lanes — heads up):**
  • **Boss-forged weapons (next, my lane):** a strict-BiS capstone above Meteor.
    Boss drops a rare *component* → smith with a top-tier bar → named weapon with
    a **special attack** (needs a shared spec-energy bar). ⚠️ **World-gen:** I'll
    need those components on boss `drop_table`s (Bog King / Meteor Sprite / Deep
    Metal Golem / Cave Troll / Red-Ear Captain) — will add ids JSON-first and
    ping before touching placement.
  • **THIRD combat style = "Sapper / Tinkering"** (owner-chosen, NOT magic —
    Alchemy is a separate skill another contributor owns, don't conflate). Goblin
    bombs/hand-cannons/contraptions: armor-piercing burst/AoE fed by crafted
    "charges" (a new ammo type). Completes the triangle (Sapper > armored Melee,
    Ranged > slow Sapper, Melee > Ranged). Adds a new weapon-class line + a
    combat-resolution branch; **JSON-first, will flag before shared edits.**
- 2026-06-30 — Economy agent: **Gorkholm — central region rebuilt coherently
  (owner: "narrative style, nothing random"). Verified in-browser.** Design spine
  in **`CENTRAL_REGION_DESIGN.md`**. Every fixture now sits where its road/trade
  supplies it: **N gate = Forge Ward** (furnace/anvil/weapon/armour, ore road),
  **E gate = The Wharf** (fishing/cooking/fishmonger/bait, water road), **S gate =
  Greengate** (farming/grocer/herbalist/general, farm road), **W gate = Timber
  Row** (sawmill/crafting/fletcher/lumber, lumber road), **centre = the Keep**
  (Chief's gatehouse w/ Bank vault + War Table rooms, the N avenue runs through
  its passage) **+ fountain plaza + market stalls + Grand Exchange + Tavern**, with
  a **Warren of back-alley goblin housing**, gatehouse towers, wells, and trees/
  shrubs filling the gaps.
  - `map.js buildTown()` rebuilt (tagged `[economy lane]` — **world-gen: this is
    your file; ping me to rebalance**). Preserved spawn (500,462), the 4 gates,
    and the training yard + its kept rats.
  - **Shopkeeper placement fixed:** `shops.js` now exports `SHOP_POSTS` (shop→
    building tile) and `shopkeeperSpawns()` returns a `post`; `main.js` stands each
    ward keeper in its building instead of piling all 14 on the ring near spawn.
    11 keepers relocated; 3 region shops (miner/witch/rival) still ring-fallback
    (they belong in their regions — world-gen can post those later).
  - **Economy content:** 6 new ward shops in `shops.json` (fishmonger, bait_tackle,
    fletcher, lumber_stall, grocer, tavern), stock themed to each ward's trade.
  - Verified live (logged in as BOB on :5189, server released after): new town +
    all wards load, 11 keepers in buildings, fountain is water (5 tiles, off the
    road origin), 0 console errors. **Also confirmed world-gen placed the higher
    trees** — Dense Oak→Moonwillow (Lv 30–75) are live nodes, so the Firemaking
    log ladder now has an in-world source.
- 2026-06-30 — Economy agent: **item ICONS upgraded to hand-drawn SVG.**
  `itemIcons.js` now classifies to a canonical icon KEY, then renders: **34
  crafted inline `<svg>` icons** (weapons/armour/valuables/food/resources) via new
  `itemIconSVG(id)`, with EMOJI as the long-tail fallback. Inventory + equipment
  in `panels.js` switched to `itemIconSVG` (innerHTML); the SVG fills the slot.
  `itemIcon(id)` still returns the emoji glyph — **use that for canvas ground
  items** (world-gen) since it's a plain string; DOM surfaces use `itemIconSVG`.
  Adding art = add keys to `ICON_SVG` (single seam). Validated: parses, CSS
  210/210. Showed the full set to the owner via a render widget.
- 2026-06-30 — Economy agent: **item ICONS — every item now has a glyph, not
  initials.** New `src/data/itemIcons.js` exports `itemIcon(idOrItem)` → a glyph,
  resolved by keyword → subcategory → category rules over the 1063-item DB.
  Coverage measured: **79% keyword-specific, 16% subcategory, 3% category, 0%
  fall to the default box** — every item gets a meaningful icon (🧪 potions, 🐟
  fish, 📖 manuals, ⚔️ weapons, 🪖 helms, 💎 gems, 🪵 logs, 🪙 coins…). Wired into
  the inventory + equipment squares in `panels.js` (replaced the 2-letter
  initials; the item's colour stays as the tinted chip behind the glyph), font
  sizes bumped in `index.html`. No per-item art exists (asset pack has only UI
  chrome + chars), and 1063 hand-drawn sprites isn't feasible — glyphs are the
  pragmatic v1. Additive, my lane. Validated: files parse, CSS 208/208, resolver
  coverage sim, no leftover initials.

  **↳ SEAM for 🌍 World-Gen (ground items):** the resolver is the single icon
  seam — please render dropped/ground items with the SAME glyph. Import
  `itemIcon` from `src/data/itemIcons.js` and draw it as a Phaser `Text` at the
  tile (or over your ground-item marker) instead of a bare dot. Keeps inventory
  and world visuals consistent, and when real sprite art lands we swap ONLY
  `itemIcon()` (return a sprite key) and both surfaces upgrade at once — no call-
  site changes anywhere.
- 2026-06-30 — Economy agent: **ammo polish — equipped-arrow qty badge + level-based
  arrow recovery.** (1) Equipped stackable ammo now shows its remaining quantity on
  the equipment paperdoll (reused the inventory `.item-qty` badge; added
  `position:relative` to `.doll-slot` in `index.html` so it anchors). (2) Fired
  arrows now land **recoverable on the ground at the target's tile**, a portion
  scaling with Ranged level via new pure `ammoRecoveryChance()` in `state.js`
  (~55% at Lv1 → ~90% at Lv99). New `dropRecoveredAmmo()` in `main.js` merges a
  volley into a single ground stack per tile; pick them up with the existing
  ground-item system. Verified live (logged in past `session.js`, unfroze
  `Game.playerFrozen` which the headless preview sets true): equipped ammo shows
  a "60" badge on the BA slot, and a "Bronze Arrow x56" pile accumulated at the
  archer's tile mid-fight. All `main.js` edits tagged `[economy lane]`; `index.html`
  change is a one-line additive CSS tweak. Headless recovery tests pass (chance
  curve + stack merge + empirical L1 vs L99 portion).
- 2026-06-30 — World-gen lane (movement): **run mechanics (OSRS-style).** NEW file
  `src/engine/run.js` (sim rule + HUD sync): run energy 0–100%, drains while running
  (weight-scaled, OSRS-ish `min(weight,64)/100 + 0.60` %/tick), regenerates 0.45%/
  tick while walking/idle, auto-reverts to walk at 0%. No Agility skill here, so
  regen is a flat tunable constant; weight is a heuristic (equipped gear heavy,
  non-stackable inv items light) — **swap for a sum of real `item.weight` when the
  economy lane adds that field.** `main.js`: player now moves **2 tiles/tick running
  vs 1 walking** (in `gameTick`, right where the single `stepAlongPath(p)` was), and
  the render interp doubles the player's approach speed on a run tick (`p._ranTick`).
  Toggle via a HUD **run button** (`#run-btn` in `index.html`, below the minimap) or
  the **R** key. Verified in-preview (deterministic tick-pump, since the tab-hidden
  `playerFrozen` rule stops movement in a headless preview): walk=1/run=2 tiles/tick,
  drain 0.635%/tick w/ starter gear, regen 0.45%/tick, exhaustion→auto-walk. Additive;
  only added an import + the run block to `main.js`. Server stopped after verifying.
- 2026-06-30 — Character-render agent: **occlusion seam prepped + per-enemy variety.**
  (1) **Occlusion seam ready for World-Gen:** `drawEntities` split into
  `collectCharacters(time)` → `[{ent,y}]` (y-sorted), `drawCharacter(g,ent,time)`
  (self-contained), `drawProjectiles(g,time)`. To get characters passing *behind*
  trees, merge my character items with your object items by feet-y in one pass —
  full recipe in the banner comment above `collectCharacters` in `main.js`.
  Behaviour unchanged until you wire it. (2) **Creature variation:** enemies get a
  stable tint+size variant (low lvl→6 looks, mid→4, high→3) — verified in
  `avatar_preview.html`. All render-path only, `[character-render lane]` tagged.
  ✅ **CORRECTION (later same day):** my earlier "game boots BLANK" was a FALSE
  ALARM — I was landing on the new **login gate** (session.js) and checking
  `window.__GE`, which by design only exists *after* you enter a character name
  and click **Enter World**. Logged in as "Gork" → world boots fine, 135 NPCs,
  my avatars + creature variations render, day/night + world events all live. No
  crash, nothing for the boot chain to fix. Apologies for the noise. (The genuine
  blank boots earlier in the day were the real `combat.js` import race, which the
  new git + `scripts/smoke.mjs` gate now catches.)
- 2026-06-30 — Economy agent: **NEW FEATURE — Goblin Treasury dragon-heist cycle
  (owner-designed). Economy core built; world + render seams open for the other
  lanes.** The GE 2% tax already pools into `geTax.balance` (the Treasury). New
  `src/systems/treasuryHeist.js` turns it into a loop: hoard grows → past a
  threshold a **dragon raids and steals the whole pile** → players hunt it to its
  lair, slay it, and **reclaim 60% of the gold (rest burns = sink) + its item
  drops**; on a **team the reclaimed gold splits evenly**; then the cycle resets
  with a higher threshold + tougher boss. State machine + reward/split math
  verified via mirror sim (raid at threshold, solo 60%/40%-sink, team/3 even
  split, threshold 2500→4000→6400). UI: GE panel shows a hoard meter filling
  toward a 🐉 and a raid alert (with a **temporary** "Confront the Dragon" button
  — remove once the real fight is wired). Boss `HOARD_DRAGON` (Goldscale) + its
  drop table live INSIDE `treasuryHeist.js` for now (all 5 drop ids verified in
  items.json) to avoid clobbering the concurrent `monsters.json`/`drop_tables.json`
  edits — promote them JSON-first when placement lands. Additive, my lane
  (`treasuryHeist.js` NEW, `panels.js` GE render, `index.html` CSS). Validated:
  files parse, CSS 208/208, drop ids resolve, sim passes.

  **↳ SEAM / hand-off (please build your piece):**
  - **🌍 World-Gen:** own the **Dragon's Lair** location (a landmark/region). Read
    `heistView().dragonActive` (true while `phase==='raided'`) → spawn the boss at
    the lair; `heistView().bossLevel` gives the scaled combat level. When ready to
    place the dragon as a real world monster, **ping me to promote `HOARD_DRAGON`
    → `monsters.json` + `drop_tables.json`** (JSON-first; I keep the ids).
  - **🧍 Character-Render:** read `heistView().ratio` (0..1) to draw a **growing
    gold pile** at the treasury spot; on `phase==='raided'` show the **dragon
    flying off with the loot / perched at the lair**. Wants a
    `render.bodyType:'dragon'` silhouette (new hint — graceful fallback expected).
  - **⚔️ Combat/main.js:** when the dragon dies, call
    `resolveHeistVictory(partyTraderIds)` from `treasuryHeist.js` (solo →
    `['player']`). It awards the split + drops and resets the cycle — the ONLY
    integration point.
  - Debug: `window.__HEIST.force()` triggers a raid; `window.__HEIST.slay()`
    resolves it — stand-ins until the encounter is wired.
- 2026-06-30 — Economy agent: **Prayer skill + bones/altar training + combat prayers.**
  New `Prayer` skill (added to `SKILL_NAMES`), trained by **burying bones**
  (inventory "Bury" action, +4.5 xp) or **offering at a Bones Altar** (2.5× xp +
  full point recharge). New pure `src/engine/prayer.js` (prayer defs + helpers).
  `state.js`: prayer points (cap = Prayer level), `togglePrayer`/`prayerBoost`/
  `isProtecting`/`drainPrayer`/`restorePrayer`; active boost prayers raise the
  *effective* combat levels in `playerProfile()` (accuracy/max-hit/defence all
  scale), protection prayers halve incoming damage of the matching style (wired
  in `main.js npcAttack`). Points drain per tick (`drainPrayer` in `gameTick`),
  reset on death. `equipment.js`: `bones` gains `buryXp`; added `big_bones`.
  Combat panel gained a Prayer section (points bar + per-prayer toggles). A
  **Bones Altar** world-object is hand-placed near spawn in `buildWorld`
  (`altar: true`) — ⚠️ **world-gen: relocate to a proper shrine/temple, keep
  `altar:true`.** All `main.js`/`loot.js`/`skills.js` edits tagged/additive.
  Verified live in-game (had to log in past `session.js`'s new gate first):
  bury/altar train Prayer, points scale with level, Superhuman Strength raised
  max hit 5→6, Protect-from-Melee halved a 10→5, drain empties + auto-disables.
  15/15 headless prayer unit tests pass.
  • **Dev-server note for all lanes:** plain `python3 -m http.server` sends no
    cache headers, so Chrome heuristically caches stale ES modules and your edits
    silently don't show up on reload (cost me a long debugging detour). Added
    `.claude/devserver_nocache.py` + a `goblin-empire-nocache` launch config
    (port 5194) that sends `Cache-Control: no-store`. Recommend using a no-cache
    config for preview to avoid stale-module confusion.
  • **Weapon specials** (the other half of the ask) are deferred: they should be
    high-tier-weapon-only, and the game has no tier weapons yet — needs those +
    a spec-energy bar first. Flagging as a follow-up.
- 2026-06-30 — Economy agent: **higher-tier trees so the whole Firemaking ladder
  is reachable (edits WORLD-GEN's `worldData.js` — tagged, please rebalance).**
  Firemaking had 10 log tiers but the world only grew 4 trees, capping the skill
  ~lvl 35. Added 6 `RESOURCE_TYPES` — `tree_dense_oak` (wc30) `tree_fungal` (40)
  `tree_blackroot` (50) `tree_ironbark` (60) `tree_rotwood` (70) `tree_moonwillow`
  (75) — levels/outputs/regions mirror the existing `world_nodes.json` nodes
  (`dense_oak_tree`…`moonwillow_tree`), which already existed. Placed them in
  `REGION_RESOURCES` by theme (oakwoods/mushroom/bog/troll/ruins/grublake). All
  edits tagged `[economy lane]`; **world-gen owns density/placement balance —
  tune counts as you see fit.** Verified: `node --check` clean + a static
  cross-ref (imported `worldData.js` in Node) → every `REGION_RESOURCES` type is
  in `RESOURCE_TYPES`, every `REGION_ENEMIES` type is in `ENEMY_TYPES`, every tree
  drop resolves to a real item — **0 problems**. (Caught + fixed a self-inflicted
  bug mid-edit: my first script also appended trees to `REGION_ENEMIES`, which the
  cross-ref check flagged before it shipped.) Not click-tested in-browser: the top
  trees are wc60–75, and chopping is a level gate I can't reach in a quick session;
  the gather code path (`performSkill` resource branch) is unchanged + already
  proven on existing trees.
- 2026-06-30 — Economy agent: **Firemaking verified end-to-end IN-BROWSER + a
  shared cache fix that affects everyone.**
  - **Firemaking works live** (screenshotted on :5189, logged in as BOB): lit
    `normal_logs` → flame renders beside Gork → **+40 Firemaking xp** (skill shows
    in the panel) → the fire cooked 3 raw fish via the existing `performSkill`
    Cooking path (**+60 Cooking xp**, one burn) → **fire burned out on the global
    tick** (~50 ticks; `activeFires()` emptied and the interaction auto-cleared).
    Zero console errors across ~140 ticks of 60fps flame drawing. The whole
    light→render→cook→expire loop is confirmed, not just logic-tested.
  - **⚠️ ALL LANES — `gameData.js` now fetches JSON with `cache: 'no-store'`.**
    Found while verifying: the browser was serving a **stale cached `items.json`**
    (old 1072-item version, missing `flint_and_steel`, still had charcoal), so the
    game booted against outdated data even though the file on disk was correct.
    Under our no-build "edit JSON, refresh" workflow this is a real trap — you
    change a pack, refresh, and silently get the OLD table. The one-line
    `{ cache: 'no-store' }` on the loader fixes it for every lane. (Note: a browser
    that already cached the old `gameData.js` needs one hard-reload to pick up the
    new loader; after that it self-heals.)
- 2026-06-30 — Economy agent: **shopkeepers ×8 + multiplayer server seam + cooking payoff.**
  (1) `main.js` now spawns a Shopkeeper per shop via `shops.shopkeeperSpawns()`
  (8: general/weapon/armour/fishing/farming/miner/witch/black-market), each gating
  its Shop panel + carrying its `region` for world-gen to relocate. (2) Server seam
  sketched: `docs/MULTIPLAYER_ARCHITECTURE.md` + `src/net/marketTransport.js`
  (Local/Network transports, same async surface — the GE goes networked with a
  1-line swap). (3) Cooking payoff = food heal (done earlier) + verified craft path.
  All my code verified in isolation (node --check + isolated fn tests: shopkeeperSpawns
  → 8 correct spawns; all modules import; generateWorld ok).
  ⚠️ **BOOT BREAK (not economy lane):** at time of writing the app fails to finish
  `create()` — `Game.world` and the tab bar stay unset, so no `window.__GE`. It is
  UPSTREAM of buildWorld's economy code (my shopkeeper loop runs after
  `Game.world = world`, which never gets set) and `generateWorld()` works standalone,
  so the fault is in the create()/init/Phaser-config path (world-gen / shared main.js
  mid-edit). Flagging so whoever owns that reconciles — my changes are downstream and
  isolated-verified.
- 2026-06-30 — Economy agent: **GE economy overhaul (owner: "green light all").**
  Reworked the Grand Exchange trading logic in `grandExchange.js` (pure engine) +
  `geActions.js` (adapter). **(1) Matching bug fixed:** `place()` used to `break`
  when the best counter was the trader's own order — walling a flipper off from
  the rest of the book. Now it index-scans and *skips* self-orders, preserving
  price-time priority (verified in Node: fills against the market past its own
  cheaper sell; still won't self-trade). **(2) Guide guardrail:** per-trade guide
  move clamped to ±5% (EMA then clamp) — a sim caught a blow-up where the maker
  sold into a high-limit resting buy and exploded the guide 100→47k; now capped.
  **(3) Finite market-maker:** replaced infinite NPC liquidity with a per-item
  maker holding *finite, tick-replenishing* stock (`MM_TARGET=240`), spread
  widening 5%→25% as stock depletes; heavy buying now drains it and creates real
  shortages that recover. `mmInfo()` exposes depth. **(4) Goblin Treasury:** the
  2% sell tax now pools in `geTax.balance` (spendable via `spendTreasury()`) to
  fund events, not just vanish (`totalSunk` kept for back-compat). **(5) Market
  events:** `driveMarketEvents()` fires demand shocks (Goblin War / Feast / Timber
  Glut / Ore Rush) that nudge affected-item guides ±25–35% for ~180 ticks, logged
  to chat. **(6) `stats().vol`** now = real units traded (was trade count);
  trade buffer 500→2000. UI: GE panel shows Treasury balance, active-event banner,
  and a market-supply depth bar. Additive, my lane (`grandExchange.js`,
  `geActions.js`, `panels.js` GE render, `index.html` GE CSS). Validated: engine
  unit tests + economics sim pass, all files parse, CSS 186/186. In-game (browser)
  spot-check still pending on my side.
- 2026-06-30 — Economy agent: **Firemaking is now END-TO-END playable in-game
  (owner: "build it all + tie lifespan to the global tick").** The seam flagged
  in my earlier entry is BUILT — all shared edits tagged `[economy lane]`:
  - **`main.js` (5 tagged hooks):** (1) import `activeFires/tickFires/fireAt/
    fireLifeRatio`; (2) `onPointerDown` resolves a fire on the clicked tile and
    left-click → `startInteract(fire)`; (3) `rightClickMenu` gains a "Cook at
    Fire" entry; (4) the skilling-reach check allows cooking while standing ON a
    fire (`o.fire ? dist<=1 : dist===1`) since fires are non-blocking; (5)
    `gameTick(count)` reaps burned-out fires via `tickFires(count)` — **lifespan
    is driven by the global 600ms tick**, same mechanism as ground-item despawn —
    logs "Your fire burns out" and clears any interaction on it. Plus a procedural
    flame in `drawObjects()` that flickers + shrinks as life runs out.
  - **`panels.js` (additive):** burnable logs get a **"Light a fire"** inventory
    context option → `lightFireAt(player.tileX, player.tileY, logId, ticker.count)`.
  - **How a fire cooks:** the fire is shaped `{x,y,label:'Fire',skill:'Cooking',
    fire:true,station:'fire_or_range'}`, so it drops straight into the EXISTING
    `performSkill` `case 'Cooking'` (same path as a Range) — no new cook code.
  - **Verified:** full Node integration test against real modules+data (polyfilled
    `fetch` for file://): light→spend 1 log→+40 fm xp→fire `fire_or_range`,
    `expiresTick`=lit+ceil(fire_seconds/0.6), `tickFires` reaps exactly at the
    deadline, `fireLifeRatio` 0.60 mid-burn, flint/level gating, legacy `logs`
    stack decrements. All touched JS `node --check` clean; served live on :5190.
    (Couldn't attach my own preview server — folder's 5-server cap held by other
    chats — so in-browser click-through is unverified; logic + wiring are.)
  - **Other lanes:** character-render may swap the placeholder flame for a nicer
    FX (reads the same `activeFires()`); a `firemaking` flint-strike player anim
    would be a nice touch. Reconcile around my `[economy lane]` main.js tags.
- 2026-06-30 — Economy agent: **GE made a physical place + Shops + food heal + balance.**
  (1) **Grand Exchange gated** to the Grand Bazaar: new `exchange_merchant` NPC
  (main.js, tagged); Exchange panel proximity-gates (≤3 tiles) with a "go to the
  Bazaar" prompt otherwise; talking opens the tab (`openExchange`). World-gen:
  relocate the merchant to the real bazaar, keep the id.
  (2) **Shops** (`src/systems/shops.js` + Shop tab, gated behind a `shopkeeper_*`
  NPC): 8 stores from shops.json, buy>sell (no arbitrage), stock depletes,
  sell-from-inventory. `shopkeeper_general_store` placed near spawn (tagged).
  (3) **Food heals**: all DB cooked food edible, heal derived from cooking tier at
  hydration (`foodHealFromRecord`); eat handler generalized. Verified bog eel +12 HP.
  (4) **Balance report** → `docs/ECONOMY_BALANCE.md`. Verified in-game (fresh port
  to dodge module cache). NPC placements are the only main.js touches, all tagged.
- 2026-06-30 — Character-render agent: **Phase 6 (depth/perf/readability) — my-lane
  parts done, verified.** `drawEntities` now y-sorts the whole draw set (nearby
  NPCs + player) by feet, so nearer characters overlap farther ones correctly
  (kept your `upright()` wrapper intact); added a red "!" aggro marker over NPCs
  targeting the player. All render-side, `[character-render lane]` tagged.
  🤝 **World-Gen ask — the one thing I can't do from my side:** *entity↔object
  occlusion* (characters passing BEHIND trees/walls). Entities draw on
  `entitiesGfx` (depth 2), objects on `objectsGfx` (depth 1), each wholesale — so
  a character always paints over a tree even when "behind" it. Fixing it needs
  the object + entity draws **interleaved by feet-y in one pass** (or per-object
  depth). That's your render structure — happy to pair on it: I can expose a
  `drawAvatar(g, x, y, state)` call you invoke inline at the right y, or hand you
  a per-entity draw list. No rush; flagging it as the last visual-polish item.
  This closes my roadmap (Phase 5 sprite-sheets deferred — procedural rig is the
  agreed look). Full status in `src/render/ROADMAP.md`.
- 2026-06-30 — Economy agent: **UI round 7 — inventory→GE shortcut + combat summary.**
  (1) Inventory right-click now has **Offer on Exchange** (non-coins): sets the
  module `geSelected` and `switchTab('ge')` so you jump straight from an item to
  its GE market. (2) Combat panel gained a **Combat summary** card (Max hit /
  Accuracy rating / Combat level) computed via `maxHit`/`maxAttackRoll` imported
  from `engine/combat.js` + `playerProfile` — reuses the exact live combat
  formulas, no duplicated math. Fills the empty space under the weapon block.
  Additive, my lane; validated (JS parses, imports resolve to real exports).
- 2026-06-30 — Economy agent: **UI round 6 — context menus + status-color fix.**
  (1) Inventory right-click gains **Examine** (`examineText` reads item `notes`,
  falls back to category + gp value) and `hideTip()` now fires on Equip/Eat/Drop.
  (2) Filled equipment slots get a right-click menu (**Remove / Examine**).
  (3) Fixed a latent bug in the ammo indicator another agent added to
  `renderCombat`: it used `.tip-good`/`.tip-req`, which my CSS had scoped to
  `#item-tip` only — so the ammo line rendered in plain text. Added **global**
  `.tip-good`/`.tip-req` utility rules so the green/red ammo status actually shows.
  Preserved their generalized `item.heal` Eat logic. Additive, my lane; validated
  (JS parses, CSS 173/173).
- 2026-06-30 — Economy agent: **NEW SKILL: Firemaking + coal/eel reconciliation
  (owner-greenlit).** Flint & Steel + logs → a *temporary ground fire* that acts
  as a cooking station. Data+system+registry done & audited; the world-placement,
  flame render, and inventory "Light" UI are a **cross-lane seam (see below)**.
  - **Firemaking skill** added to `SKILL_NAMES` (`engine/skills.js`) → now 11
    trainable skills; `initState` auto-creates it at level 1.
  - **New data:** `src/data/firemaking.json` — 10 burnable log tiers
    (`normal_logs` fm1 … `moonwillow_logs` fm75), each `{level_requirement,
    xp_reward, fire_seconds, station:'fire_or_range'}`. Exposed via
    `GameData.firemaking(logId)` / `GameData.firemakingList()` (alias-aware, so a
    held legacy `logs` resolves). `flint_and_steel` tool added to `items.json` +
    stocked at `general_store`; 11 Firemaking `level_unlocks`; 10 log "light"
    `interactions`.
  - **New system:** `src/systems/firemaking.js` — pure sim + a transient
    active-fire registry (same shape as the GE `market`). API:
    `canLight(logId)`, `lightFireAt(x,y,logId,nowTick)` (validates flint+level,
    spends ONE log — stack-decrement, not stack-nuke — grants Firemaking XP,
    registers a fire with `expiresTick`), `activeFires(nowTick)` (auto-prunes
    expired), `fireAt(x,y,nowTick)`, `fireStation()`.
  - **"Coal, not charcoal" (owner call):** removed the charcoal-from-logs flow
    entirely — 10 `make_*_charcoal` recipes (the whole `charcoal_pit` station),
    10 charcoal items, 11 charcoal interactions gone; 6 roast items' charcoal
    text cleaned. `coal` is now the fuel, aliased `coal → coal_ore` (DB's mined
    "Coal Ore"). Firemaking replaces charcoal as what-you-do-with-logs.
  - **Eels:** `raw_eel → raw_bog_eel`, `cooked_eel → cooked_bog_eel` (the world's
    lone eel spot is in the bog). `UNMAPPED_LEGACY` now just
    `goblin_hide_armor, goblin_shortbow, coins`.
  - **Verified:** all JS `node --check` clean; served live on 5189; full re-audit
    → the ONLY unresolved refs dataset-wide are the 21 `coins` monster-drop rows
    (intentional game-only currency — the game mints coins directly). All 60
    drop tables, every recipe/node/shop/unlock, all 10 firemaking logs, coal, and
    both eels resolve. 0 charcoal remaining.
  - **⚠️ SEAM — needs world-gen + character-render + a UI hook:**
    1. **World-gen:** render/lifecycle of temp fires. Read `activeFires(tick)`
       each frame (fires carry `{x,y,station,litTick,expiresTick}`); draw them on
       the object layer and let them expire. A fire tile should count as "at a
       range" for the cook UI. `lightFireAt` needs the *current tick* passed in
       (same as `spawnGroundItem(id,qty,x,y,tick)`).
    2. **Character-render:** a flame FX at the fire tile (grows on `litTick`,
       gutters near `expiresTick`) + a flint-strike player anim (reuse the
       skilling motion; `SKILL_TOOL` could gain a `firemaking` entry). Optional
       `render.firemaking` hint — ping me and I'll add it JSON-first.
    3. **UI (panels/main.js):** inventory "Light" action on a log → call
       `lightFireAt(player.x, player.y, logId, tick)`; when the player stands on/
       next to an `activeFires()` tile, open the existing `fire_or_range` cook
       list (`crafting.recipesForStation('fire_or_range')`). I can add the
       panels.js "Light" action + cook-near-fire trigger next (my additive file)
       — held off this pass to avoid clashing with the in-flight UI-chrome edits
       and because it's unverifiable until fires render.
- 2026-06-30 — Economy agent: **combat polish — line-of-sight, ammo, ranged enemy.**
  Builds on the weapon-range work below. (1) **Line-of-sight**: ranged attacks
  (reach > 1) now require a clear Bresenham line — no shooting through walls.
  New pure `lineOfSight()`/`canAttackFrom()` in `main.js` replace the raw
  distance checks in the player-combat, player-attack, and NPC-AI blocks (a
  blocked ranged attacker keeps closing, routing around cover). Melee (reach 1)
  is unaffected. (2) **Ammunition**: ranged weapons consume equipped `ammo`;
  empty quiver disengages with "out of ammunition". New `needsAmmo`/`ammoCount`/
  `hasAmmoForRanged`/`consumeAmmo` in `state.js`; new `bronze_arrow` item
  (`ammo` slot, +2 range_str) in `equipment.js`; 150 arrows added to the starting
  kit; Combat panel shows the equipped ammo + count. (3) **Goblin Archer** — a
  hand-placed, non-aggressive ranged sparring partner near spawn (Combat Lv 8,
  reach 5), drops arrows + a rare shortbow via a new `goblin_archer` loot table
  in `world/loot.js`. New `findOpenTileNear()` helper places it on valid ground.
  All `main.js`/`loot.js` edits tagged `[economy lane]`. ⚠️ **character-render
  lane:** verified live — your arrow-projectile anim fires for the new ranged
  attacks (screenshot: Gork's arrow in flight + hitsplat). Note your Phase-4
  `npcLoadout` gives "archer" a bow — my `goblin_archer` (name contains
  "Archer") should pick that up automatically. Verified in the running game
  (port 5189): player fired from reach 4 with arrows depleting 1/shot, archer
  traded damage back, hide-armor `range_def` measurably reduced incoming hits;
  LOS + ammo unit tests all pass.
- 2026-06-30 — Character-render agent: **Phase 4 (NPC variety) done, verified.**
  NPCs now carry role-appropriate kit: `npcLoadout(name,type)` → gear (witch/
  shaman/elder = staff+hood, prospector = pickaxe, hunter/archer = bow, warrior/
  captain = sword+helm, etc.); NPCs face the player when addressed/in combat;
  per-NPC time offset so crowds don't animate in lockstep. Verified a 7-NPC
  lineup — all distinct, all facing Gork. Render-side only (`[character-render
  lane]` tags in `main.js`).
  ⚠️ **Team tip:** during a window today the game booted BLANK — cause was a
  browser module cache holding a stale `combat.js` while the engine agent was
  mid-edit on the `state.js → weaponRange` import (an ESM link error halts the
  whole graph). Fix if you hit it: **restart the dev server** (stale in-tab module
  cache; a plain reload won't bust nested import URLs). Not a code bug — the seam
  is correct on disk.
- 2026-06-30 — Economy agent: **UI round 5 — equipment panel readability (from a
  live screenshot).** Empty paperdoll slots now show a faint slot glyph
  (`SLOT_ICON`: 🪖🧣📿🎯⚔️🛡️👕👖🧤🥾💍) instead of `slot.slice(0,3)`
  ("hea"/"amm"/"fee"); equipment-bonus rows use readable labels (`STAT_LABELS`:
  `slash_atk` → "Slash attack") and **negative bonuses render red**
  (`.stat-row.neg`). `panels.js` renderEquipment + CSS in `index.html`. Rest of
  the UI (xp drops, level-up banner, icon tabs, coin color) confirmed rendering
  correctly in the shared screenshot. Additive, my lane; validated (JS parses,
  CSS 170/170).
- 2026-06-30 — Economy agent: **UI round 4 — always-on coin counter, HP feedback,
  panel texture.** (1) Added a gp counter to the top bar (`#tb-gp` span in
  `index.html` markup; `renderTopBar` fills it from `playerCoins()` with OSRS stack
  coloring) so gold is visible everywhere, not just the GE tab. (2) HP bar in the
  Combat panel now **flashes on damage** (`.hpfill.hurt`, one-shot — `renderCombat`
  compares `Game.hp` to a module `lastHp`) and **pulses red when ≤25%**
  (`.hpbar.low`). Panel-only feedback; does not touch the avatar hitsplats
  (character-render lane owns those). (3) Subtle leather/parchment texture on
  `#side-panel` via layered `repeating-linear-gradient` background layers (behind
  content, no overlay). Additive CSS + `panels.js` render tweaks, my lane;
  validated (JS parses, CSS 169/169). ⚠️ note: I added `#tb-gp` to the shared
  `#topbar` markup in `index.html` — additive span only, didn't touch existing ids.
- 2026-06-30 — World-gen lane (camera/HUD): **minimap compass.** Added a small
  compass dial in the minimap's top-left corner (`src/main.js`: `compassGeom`/
  `pointerOnCompass`/`drawCompass` + a `compassN` HUD text). Its red needle points
  where world-north appears in the main view (angle = `+cam.rotation`, same fact
  the label counter-rotation uses), so it spins as you rotate. Clicking it snaps
  the camera to north (`targetRot` → nearest full-turn multiple, so it eases the
  short way). Drawn on `miniGfx`/`uiCam` so it stays upright; click is intercepted
  in `onPointerDown` before the minimap-travel check. Additive. ⚠️ Not yet
  visually verified (all 5 preview slots held by other chats); JS parses clean.
- 2026-06-30 — World-gen lane (camera/HUD): **arrow-key camera + zoom-out floor.**
  `src/main.js` `onCameraKey` now maps ←/→ to rotate and ↑/↓ to zoom (Q/E and
  scroll/`+`/`−` still work; arrows `preventDefault` so the page doesn't scroll).
  `ZOOM_MIN` raised 0.6→1 so the native starting view is the furthest-out — you can
  only zoom IN from there (up to 2.6×). Hint text in `index.html` updated. Owner
  confirmed working in-browser (upright avatars + new controls). Additive only.
- 2026-06-30 — World-gen lane (camera/HUD): **billboard characters upright under
  camera rotation.** Follow-up to the camera work below — rotating a 2D top-down
  camera was turning the avatar rigs sideways/upside-down. Added an `upright(g,
  px, py, fn)` helper in `src/main.js` `drawEntities()` that counter-rotates the
  entities `Graphics` about each character's feet (Phaser
  `save/translateCanvas/rotateCanvas/restore`), so the player + all NPCs (and their
  HP bars) stay screen-upright at any camera angle — same net effect as the name
  labels' `setRotation(-camRot)`. The rig's own death-topple pose is preserved
  (only camera rotation is cancelled). Skill FX + projectiles stay world-space on
  purpose. ⚠️ This edits the character-render `drawEntities()` hook — additive
  wrapper around the existing `drawAvatar(...)` calls, no rig/gear logic changed.
  ⚠️ Couldn't grab a fresh in-preview screenshot (5/5 dev-server slots held by other
  chats); JS parses clean and it's the same proven technique as the labels.
- 2026-06-30 — World-gen lane (camera/HUD): **minimap click-to-navigate + camera
  zoom & rotation.** Touched `src/main.js` (scene/render/camera — world-gen lane)
  and `index.html` (HUD hint). (1) The local **minimap is now clickable**:
  `onPointerDown` intercepts clicks landing on the minimap rect (shared
  `miniGeom()`/`pointerOnMinimap()`/`minimapToTile()` helpers keep the hit-test and
  the draw in lockstep) and `walkTo()`s the world tile under the cursor instead of
  falling through to the tile behind it. (2) **Camera controls**: mouse wheel and
  `+`/`-` zoom (clamp 0.6–2.6), `Q`/`E` rotate around the player, `0` resets; both
  ease smoothly in `update()` toward `targetZoom`/`targetRot`. (3) To keep the HUD
  sane under zoom/rotation I added a **dedicated `uiCam`** that renders ONLY the
  minimap (main cam `ignore`s `miniGfx`; `uiCam` ignores all world gfx + labels,
  incl. the dynamically-pooled object/ground labels), and world-space name labels
  **counter-rotate** so text stays upright at any angle. `viewRange()` now inflates
  the cull rect by the rotated bounding box so nothing pops at the corners.
  Verified in-preview (my server, port 5192): minimap click sets the travel target
  in the clicked direction + logs it; wheel/keys drive zoom to the 2.6 clamp and
  rotation to −π/2; minimap + name label stay upright while the world rotates. No
  console errors. ⚠️ Shared-file edit in `main.js` — additive, no restructuring of
  the character-render `[character-render lane]` blocks. NOTE: transiently the game
  wouldn't boot because `src/systems/*` had a same-dir import of `gameData.js`/
  `idAliases.js` (they live in `src/data/`); that's since been corrected on disk.
- 2026-06-30 — Economy agent: **UI juice — level-up banners + XP drops + stack
  coloring.** (1) New `Game.ui.onXp(skill, amount, leveledTo)` hook fired from
  `state.grantXp` (the single XP chokepoint; additive, `amount>0` only) so every
  gain triggers UI exactly once regardless of which renderer runs. (2) `panels.js`
  registers `onXp` → floating OSRS **xp drops** (`showXpDrop`, colored by skill,
  rise+fade) and a centered gold **level-up banner** (`showLevelUp`), both in a new
  lazily-created `#fx-layer` overlay pinned over `#game-panel` (pointer-events:none,
  so it never eats clicks — does NOT touch world-gen's canvas/JS, purely a sibling
  DOM overlay). (3) OSRS **stack coloring** on inventory quantities (`qtyStyle`:
  yellow <100k / white <10M / green ≥10M). CSS `#fx-layer`/`.xp-drop`/
  `.levelup-banner` + keyframes in `index.html`. Additive, my lane; validated
  (both JS files parse, CSS 155/155). ⚠️ world-gen: `#fx-layer` is a
  pointer-events:none child of `#game-panel` — harmless, but noting since it lives
  in your DOM container.
- 2026-06-30 — Economy agent: **re-ran the full endpoint + cross-lane-seam audit
  after the recent parallel churn — data layer is coherent.** (A) Internal
  dataset = **0 unresolved**: every recipe input/output, drop item, node output,
  shop item, and item-unlock resolves; all **60/60 monster→drop_table links**
  resolve (`GameData.dropTable`). (B) Cross-lane seam (world-gen's legacy vocab
  in `worldData.js` RESOURCE_TYPES/TOOLS/ENEMY_TYPES → my registry): every tool
  id (`fishing_rod`, `bronze_hatchet`, …) and all **11/11 enemy→monster_id**
  mappings resolve; the only unresolved ids are the **3 already-parked design
  gaps** — `coal`, `raw_eel`, `coins` — i.e. **no new breakage** introduced by
  the parallel edits, and my new `render.bodyType` field disturbed nothing.
  Low-risk quick win available: the world's `fish_eel` sits in the **bog** region,
  so `raw_eel → bog_eel` is a defensible alias (closes 1 of 3). `coal` still needs
  the fuel-model decision (DB is charcoal-based); `coins` is game-only by design.
  Read-only pass — no files changed.
- 2026-06-30 — Economy agent: **weapon-driven attack range (melee 1 tile / ranged 3–4+).**
  Combat previously hard-coded `manhattan === 1` everywhere; now range is
  determined by the equipped weapon, OSRS-style. New pure helper
  `weaponRange(weapon)` + `DEFAULT_MELEE_RANGE`/`DEFAULT_RANGED_RANGE` in
  `src/engine/combat.js` (melee 1, ranged 4, overridable per-weapon via
  `attackRange`). `state.js` exports `playerAttackRange()`. `equipment.js`:
  `goblin_shortbow` → range 4, `goblin_spear` → reach 2 (additive, my lane).
  **Shared `main.js` touched (tagged `[economy lane]`, sim logic):** the two
  player combat checks and the NPC-AI attack check now use `<= range` instead of
  `=== 1`; the per-tick re-check means a ranged attacker halts at max range
  instead of walking into melee. `entities.js` NPC gained an optional
  `attackRange` passthrough so spawns can define ranged/reach enemies (default
  derives from `weaponType`). `goblin_shortbow` added to the starting kit so
  ranged is testable. ⚠️ **character-render lane:** this changes *when/where*
  attacks fire (targets can now be >1 tile away) — your `projectiles`/arrow anim
  already handles ranged; flag if the topple/hitsplat sync assumes adjacency.
  Note: no line-of-sight check yet (range is pure distance) — reasonable
  follow-up. Verified headless (weaponRange + distance-gating + stat/item
  scaling all pass); couldn't drive the browser preview (folder's 5-server cap
  hit by other chats).
- 2026-06-30 — Economy agent: **UI: custom item hover tooltips + OSRS chrome polish.**
  (1) Replaced native `title=` tooltips on inventory + equipment slots with a
  styled floating card (`#item-tip`): name in gold, category, level req (orange),
  equip slot, heal, "used for", gp-value footer. New `itemTooltipHTML`/`showTip`/
  `moveTip`/`hideTip`/`bindTip` in `panels.js` (`itemTooltip` plain-text kept);
  follows cursor, clamps to viewport, hides on tab switch + equip/unequip.
  (2) Earlier: chrome polish across the side panel — `--raise`/`--sink` bevel
  tokens, gradient top bar, recessed inv/equip slots, sheened bars, glossy
  press-state buttons, inset chatbox, themed scrollbars, icon+label stacked tabs.
  All additive CSS in `index.html` + `panels.js` render/tab tweaks; no GE logic,
  world-map markup, or render/world files touched. Validated (JS parses, CSS 133/133).
- 2026-06-30 — Economy agent: **economy depth — GE sink + price discovery.**
  Added an OSRS-style 2% GE **sell tax** (coin SINK, so the economy has a faucet
  *and* a sink) tracked in `geActions.geTax`, plus **price history** in the engine
  (`market.history`/`stats`) and an SVG **price sparkline** + last/hi/lo/vol +
  tax-sunk line in the Exchange panel. Verified: 14 trades → guide moved 5→7,
  chart renders, "8 coins removed from circulation". Economy-lane + panels only.
- 2026-06-30 — Economy agent: **fulfilled the character-render lane's JSON-first
  ask — authoritative `render.bodyType` (+ `render.size`) on all 60
  `monsters.json` rows.** Shape matches their request exactly:
  `"render": { "bodyType": "humanoid|quadruped|insectoid|amorphous", "size": <mult> }`.
  Distribution: 32 humanoid / 12 insectoid / 11 quadruped / 5 amorphous. Values
  seeded from their `bodyTypeFor(name)` guess, then hand-corrected where the
  keyword regex was wrong or coarse: `lake_snapper` insectoid→**quadruped** (it's
  a snapping turtle, the "snapper" rule mis-fired); `troll_whelp` 1.4→**1.15** and
  `red_ear_captain` 1.4→**1.2** (neither is troll-scale); `quarry_imp` 1.0→**0.9**
  (small); `grub_bog_horror` 1.05→**1.25** (big). `GameData.monster(id)` returns
  the raw row, so `render` passes straight through — no registry change needed.
  Verified: valid JSON, all 60 covered, served fresh over HTTP (5189).
  **➡️ Character-render:** you can now read `GameData.monster(id).render.bodyType`
  / `.size` in `avatarStateFor` and drop the `bodyTypeFor(name)` keyword fallback
  (keep it as the default for any row lacking `render`). Only touched
  `src/data/monsters.json` (my lane) — no `main.js`/render-lane files.
- 2026-06-30 — Economy agent: **UI polish pass (OSRS-style chrome).** All in my
  additive lane — CSS in `index.html` `<style>` + one small `panels.js` tab tweak.
  Reworked the flat 1px-border look into carved/beveled chrome: new palette +
  reusable `--raise`/`--sink` bevel tokens, themed scrollbars, gradient top bar
  with divider ticks, recessed inventory/equipment slots + glossy item tiles,
  sheened XP/HP bars, glossy press-state buttons (style/station/craft/GE/map),
  inset chatbox, and **icon+label stacked tabs** (`panels.js buildLayout` now
  emits `.tab-icon`/`.tab-label`; fixes the 6-tab width crunch). Only touched CSS
  blocks + the tab-build loop — **did NOT alter GE logic, world-map overlay
  markup, or any render/world file.** Validated: JS parses, CSS braces balanced
  (124/124), every `panels.js` class is styled. Couldn't grab a live screenshot
  (preview-server slot cap + Chrome access denied) — visual review still pending.
- 2026-06-30 — Character-render agent: **Phase 3 (creature identity) done,
  verified in-game.** Monsters now draw as distinct silhouettes, not goblins:
  `bodyTypeFor(name)` in `render/gear.js` classifies by keyword → quadruped /
  insectoid / amorphous / humanoid (+size); three new rig forms in `avatar.js`.
  Verified: rat, cave bug, giant spider, bog slime, oak boar all distinct.
  **Economy ask (JSON-first, non-urgent):** an authoritative `render.bodyType`
  (+ optional `render.size`) on `monsters.json` rows would let me drop the
  keyword guess — happy to consume it whenever you add it. Only my tagged
  `main.js` lines changed (`bodyTypeFor` import + `bodyType`/`scale` in
  `avatarStateFor`).
- 2026-06-30 — Economy agent: **Grand Exchange (player economy) built + verified.**
  New `src/systems/grandExchange.js` (pure order-matching engine — price-time
  priority, partial fills, EMA guide prices) + `src/systems/geActions.js`
  (escrow/settlement + NPC liquidity seeded from DB `gp_value`) + an **Exchange**
  panel tab (`panels.js`) with buy/sell forms, live quotes, and an active-offers
  list (collect/cancel). Verified: sold 20 copper_ore → +100c; bought 10 @ max18
  → filled at ask 7 (savings refunded); lowball buy correctly rests as a pending
  offer. **No `main.js` touch.** See the new "MMO / server architecture" section
  above — the engine is deliberately transport-agnostic for a future server.
- 2026-06-30 — Character-render agent: **Phase 1 (combat loop) + Phase 2
  (skilling) done, verified in-game.** Combat: NPC death topple before cull,
  swing synced to the damage tick, OSRS-style diamond hitsplats (procedural — no
  asset-load needed; `floatText` reworked, call-sites untouched), ranged arrow
  projectile. Skilling: Gork now mimes the tool — axe overhead-chop (+chips),
  pickaxe mine (+sparks), rod+line+ripple for fishing, hammer/work motion at
  stations — via `playerSkillTarget()`/`SKILL_TOOL`/`drawSkillFx` + a new `skill`
  anim in `avatar.js`. All `main.js` edits stay tagged `[character-render lane]`
  (floatText, `projectiles`, `drawEntities`, the skill helpers). No sim/combat/
  tick logic changed. Roadmap in `src/render/ROADMAP.md`; **Phase 3 next
  (per-monster body types)** will need a `render.bodyType` hint on `monsters.json`
  — will open that with the economy lane (JSON-first) before relying on it.
- 2026-06-30 — Economy agent: **wired combat drops to the database, verified
  live in-game.** New `src/data/worldContract.js` maps world enemy spawns →
  `monster_id`; `entities.js` NPC gained a `monsterId` field; `main.js`
  `dropLoot()` now rolls the DB drop table (fallback to legacy loot). 97/97
  spawns mapped. Manual-tick kill test: Training Rat → `bones` + `rat_tooth_charm`
  on the ground with correct log lines. All `main.js`/`entities.js` edits tagged
  `[economy lane]`. (Note: preview tab throttles the 600ms ticker in background;
  drove verification by pumping `Game.ticker.handlers` manually.)
- 2026-06-30 — Economy agent: **built the economy systems + Bronze Starter Loop,
  all verified.** (1) Hydrated `ITEMS` from the database so all 1072 items are
  addable/renderable. (2) New `src/systems/{crafting,drops,gathering}.js` —
  data-driven from recipes/drop_tables/world_nodes, handling engine-vs-DB skill
  casing, id aliases, tool-tokens (knife/clay_bowl held not consumed), and
  category-tokens (planks/bars/…). (3) **Full endpoint validation → 0 unresolved**
  across the dataset; fixed one source bug in `recipes.json`. (4) New **Stations**
  tab in `panels.js` (data-driven crafting UI) + skill-panel next-unlock line +
  DB-backed item tooltips. Verified on my server (5189): smelt bronze bar → smith
  bronze dagger, training_rat drops roll, normal_tree gather, no console errors.
  Only touched economy-lane + additive files — **did NOT touch `main.js`.**
  Noted for later: character-render wants a `render`/`bodyType` hint on
  `monsters.json` for per-monster silhouettes — will add when wiring monsters.
- 2026-06-30 — Character-render agent: **wired the avatar rig into the live
  game.** Touched `src/main.js` (world-gen's render lane) in three spots, all
  marked `[character-render lane]`: (1) two import lines; (2) `drawEntities()`
  now calls `drawAvatar(...)` for the player + NPCs instead of the circle/rects,
  via a new render-side `avatarStateFor()` helper + `npcGear()` (added just above
  `drawEntities`); (3) `updateLabels()` name-label Y nudged up to clear the taller
  rig. Facing/walk/attack/hit are **inferred from data the sim already keeps**
  (tile deltas, interpolation, `lastAttackTick` bumps, HP drops) — **no combat/
  tick code changed.** Verified in-game on my server (5190): player walks + turns
  4-dir, spear/hide show, NPCs render, combat targets. No console errors.
  ⚠️ **World-gen:** this is the shared-file hook I flagged. No VCS here, so if you
  have `main.js` open, please reconcile around the `[character-render lane]`
  blocks rather than overwrite. NPCs currently all use a generic goblin rig
  (rats look like goblins) — per-monster silhouettes are a later pass and would
  want a `render`/`bodyType` hint on `monsters.json` (economy lane).
- 2026-06-30 — Character-render agent: joined as third lane; claimed
  `src/render/avatar.js` + `src/render/gear.js` (new) for the visible player/NPC
  avatar — 4-dir facing, walk cycle, per-weapon-style attack anim, and visual
  equip/unequip via an articulated procedural rig (no sprite-sheet art needed).
  Building + verifying in `avatar_preview.html` in isolation first; the only
  planned shared edit is swapping the entity draws in `main.js drawEntities()`
  for `drawAvatar(...)` — will ping world-gen before that hook. No shared files
  edited yet besides this coordination note.
- 2026-06-30 — Economy agent: created this file; staged `src/data/*.json`;
  built `src/data/gameData.js` registry (1072 items / 517 recipes / 64 nodes /
  60 monsters / 302 drops loaded & verified); added `itemView`/`itemTooltip`
  overlay so inventory tooltips read from `items.json`. No world-gen files
  touched. Verified booting on my own server (port 5189).
- 2026-06-30 — Economy agent: full read pass over every data pack. Fixed a bug
  in `nextSkillUnlock()` — `level_unlocks.json` uses fields `skill`/`level`,
  not `related_skill`/`level_requirement` (helper had silently returned null).
  Verified: woodcutting@1 → Bronze Hatchet@5, mining@12 → Mining Manual@15.
  Pack map: `item_database_pack` = economy core (staged in src/data);
  `full_asset_database_pack` = art/asset + 4 bosses + station/multi-state defs
  ({headers,rows} format, mostly art/world-gen lane); `progression_pack` +
  `economy_design_pack` = design contracts (skill loops, per-skill unlock tables).
