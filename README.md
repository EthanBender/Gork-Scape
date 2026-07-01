# Goblin Empire

A browser-based 2D tile RPG in the spirit of Old School RuneScape, played as the
goblin **Gork**. Built with **Phaser 3** (loaded from CDN) and vanilla ES
modules — no build step. A small zero-dependency Node server (`server/index.mjs`)
provides accounts, live multiplayer, and the shared economy.

The world is **1000 × 1000 tiles** (1,000,000 tiles, 16×16 chunks) with a walled
goblin settlement at the centre (500,500) and progression rings outward: safe
home zone → beginner wilderness → mid frontier → hostile outer lands. Resources
and enemies get richer and deadlier the farther you roam.

## Running

The game now has a **backend** (accounts + login, live multiplayer presence,
shared chat, and the always-on economy), so the client needs the server running —
a plain static file server will just show the "server is resting" landing page.

Run the zero-dependency Node server (Node built-ins only, no `npm install`):

```bash
cd RGS
node server/index.mjs          # serves the client AND the /api on port 5200
# then open http://localhost:5200
```

Create an account on the login screen and you're in. The server writes accounts to
`server/accounts.json` and world state to `server/world-state.json` (both
git-ignored; override the paths with the `ACCOUNTS_FILE` / `STATE_FILE` env vars for
isolated test runs).

**Live deployment** (client on Cloudflare Pages at `gorkscape.ca`, server via a
Cloudflare Tunnel at `api.gorkscape.ca`) is documented in
[DEPLOY_SERVER.md](DEPLOY_SERVER.md). Agents: see `COORDINATION.md` → *HOW IT GOES
LIVE* before touching deploy or networking.

## Controls

- **Left-click a tile** — walk there (BFS pathfinding around obstacles; the path
  is highlighted).
- **Left-click a tree / rock / fishing spot** — walk up and skill it each tick
  (Woodcutting / Mining / Fishing). XP ticks up live in the Skills tab.
- **Left-click the campfire** — cook raw fish · **the anvil** — smith 2 ore into a
  bronze bar · **the crafting table** — craft with logs.
- **Left-click a goblin guard** — attack it (two-stage hit + damage roll each
  tick). **The goblin elder** gives dialog.
- **Right-click** anything — context menu of actions.
- **Inventory tab** — click an item to equip it (or select resources);
  right-click for Equip / Eat / Drop. **Equipment tab** — click a worn slot to
  remove it; see total stat bonuses. **Combat tab** — HP bar, attack-style
  selector, current target.

## How it works

- **Tick engine** (`src/engine/tick.js`): the simulation advances only on 600ms
  boundaries (movement, skilling, combat all resolve per tick). The Phaser render
  loop runs at ~60fps and just interpolates positions between ticks.
- **Skills** (`src/engine/skills.js`): exact OSRS XP curve
  (`L10=1154, L50=101,333, L99=13,034,431`) and the level-interpolated skilling
  success roll.
- **Combat** (`src/engine/combat.js`): accuracy roll
  `(lvl+9)*(atk_bonus+64)` vs `(def+9)*(def_bonus+64)`, then a uniform damage
  roll up to `floor(0.5 + str_eff*(str_bonus+64)/640)`. Combat XP: 4/dmg to the
  style skill, 4⁄3/dmg to Hitpoints. Combat level per the OSRS-style formula.
- **State** (`src/engine/state.js`): single source of truth — skills, 28-slot
  inventory, 13 equipment slots (2h weapons block the shield slot), HP, and the
  derived player combat profile.

## File structure

```
index.html               layout, CSS, loads Phaser + src/main.js
src/main.js               Phaser scene: world build, draw, input, per-tick sim
src/engine/tick.js        600ms tick loop
src/engine/skills.js      XP table + skilling success roll
src/engine/combat.js      hit/damage rolls, max hit, combat level
src/engine/state.js       game state + inventory/equipment/XP operations
src/engine/rng.js         shared random helpers
src/world/worldData.js    the 1000x1000 design as data (regions, landmarks,
                          resource tiers, gates, shortcuts, quests)
src/world/map.js          world generation (typed terrain+collision, biomes,
                          settlement, placement, chunk buckets, capped BFS)
src/world/loot.js         loot tables + roller
src/world/entities.js     Player and NPC data
src/items/equipment.js    item registry, 13 slots, stat-bonus helpers
src/ui/panels.js          Skills / Inventory / Equipment / Combat tabs + chat log
```

## World status (phase 1 — the foundation)

**Built and working:**
- **ONE authored world** (`generateWorld()` in `map.js`, ~120ms). Generation
  paints only terrain *texture* (grass, rock speckle inside highland polygons,
  mud/pools inside the bog). Everything that matters for gameplay is
  **hand-placed by coordinate** in the AUTHOR block at the top of `map.js`:
  the irregular Grublake polygon (+ island, beach, dock), meandering river
  waypoints, rocky-highland polygons, the bog basin, dense forest polygons,
  authored wide road routes (with bridges + a broken West Bridge), and every
  named location built out with real tiles + objects (walled town with plaza,
  ~18 buildings, houses, market stalls, training yard; 6-plot farm; quarry pit;
  lake dock; hunter/witch/swamp camps; a full rival camp with walls, watchtowers,
  tents, weapon racks, captured anvil and boss arena). ~24k trees form real
  forests with clearings; ambient decor (bushes, boulders, flowers, reeds) fills
  space along routes. Resources follow teaser/training/specialist placement;
  enemies are placed intentionally by region. Map overlay toggles: `SHOW_LABELS`,
  `SHOW_RESOURCE_MARKERS` (on), `SHOW_REGION_BOUNDS` (off — no region rectangles).
- Viewport-culled rendering (only visible tiles/objects/entities draw),
  chunk-bucketed object lookup, capped BFS pathfinding (far clicks + map-click
  travel re-path each tick to walk the whole way), NPC AI only runs near the
  player.
- A real walled town (palisade, 4 gates, road cross, ~17 buildings, market
  stalls, houses, fenced training yard) and physical camps (rival camp with
  fences/watchtowers/tents/captured anvil/boss arena, mining camp, fishing dock,
  witch hut, swamp shrine, ruins…).
- **Local zoomed minimap** centered on you + a **world-map overlay** (M / button)
  rendered from real tile data, with region-name labels and click-to-travel.
- Skill-gated and tool-gated resource progression (oak@WC10, willow@20,
  iron@Mining15, coal@30, gold@40, trout@Fishing10, pike@20, eel@30; axe /
  pickaxe / net / rod / harpoon / cage tool gates).
- Per-region enemy spawns with combat levels + loot tables; location name in the
  top bar updates as you cross regions.

**Designed as data, not yet wired (next phases):**
- Quests (`QUEST_ACTS`), shortcut unlocking (`SHORTCUTS`) — currently data only.
- Banking, shops, and the farming / herblore / prayer / firemaking / hunting
  skills referenced by the design (the engine has the original 10 skills).
- Sprite art (see `ASSETS.md`) — everything still draws as labeled rectangles.

## Notes / next steps

- Tiles and entities are drawn as colored rectangles (placeholder art).
- A weak level-1 goblin loses a straight fight with a level-5 guard — eat cooked
  fish (right-click → Eat) to heal, or train first. This is intended.
- `window.__GE` exposes `{ Game, startInteract, startAttack }` for console
  debugging.
