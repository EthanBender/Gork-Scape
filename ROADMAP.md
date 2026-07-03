# Goblin Empire — Roadmap

*Last updated 2026-07-02. The single place to see what's done, what's next, and how
work ships. New here? Read [README.md](README.md) first, then
[COORDINATION.md](COORDINATION.md) → "HOW IT GOES LIVE" (the pipeline) — the rest of
COORDINATION.md is the historical multi-agent build log, useful as an architecture
reference.*

## How work ships (the whole pipeline)

`edit → node scripts/smoke.mjs green → Stop-hook auto-commits + pushes origin/main →
Cloudflare Pages deploys gorkscape.ca (~1 min)`. The Node world server is separate:
it runs on the owner's machine (`node server/index.mjs`) behind a Cloudflare Tunnel
at `api.gorkscape.ca`. **Green tree = live site. Red gate = nothing ships.**

Gates to run before calling work done: `scripts/smoke.mjs` (boot), `test/run.mjs`
(unit, 61 tests), `scripts/economy_sim.mjs` + `scripts/quest_test.mjs` (economy/quests,
also CI), `scripts/audit_world.mjs` (map invariants), `scripts/chain_audit.mjs` (economy chains: every item sourced + consumed), `scripts/pacing_sim.mjs` (XP pacing).

## Done (playable today)

- **Geography 2.0 (flipped live 2026-07-03)**: process-derived continent — heightfield →
  priority-flood hydrology (rivers provably drain, emergent lake + delta bog, fractal
  coast) → moisture biomes; town translated to a river ford, slope-aware roads that
  bridge rivers, all hubs/regions relocated geographically (`src/world/geo2.js`;
  legacy map still reachable via `?geo2=0`). Plus region progression rings,
  authored hubs (settlement, quarry, farmlands, lake dock, bog, mushroom forest…)
- Terrain texture variants, ecotones, coherent elevation model + 2.5D render
  (terraces, cliff shadows, per-tile lift; `docs/ELEVATION_MODEL.md`)
- ~890 unique wilderness POIs from a 150-entry catalog (`src/world/wilderness.js`),
  placed as multi-tile authored scenes (buildings w/ doors + path spurs, camps,
  shrines, dens, caches) at ~22-tile encounter spacing
- Scalable NPC culling (active-set + pooled labels — 2000+ mobs at 60fps)
- Skills/XP, combat (3 styles), quests, Grand Exchange, shops, bank, farming,
  firemaking, tinkering; server-authoritative accounts, presence, chat, economy,
  and Stage-1 server-authoritative mobs
- Interactive shortcut system (West Bridge + Troll Gate wired + persisted)
- **4 open dungeons** — enter/exit world-swap in `main.js`, authored interiors with
  telegraphed bosses (slam windup + dodge), style weaknesses, unique trophy drops
- **M1–M3 loops**: keep-3 death drops + runback, goal chip, Grimjaw slayer
  contracts (streak ×2), DB-driven aggression, deep-wilds drop bonuses
- **XP pacing is measured, not vibes**: `pacing_sim.mjs` Part E simulates
  hours-to-level from the live formulas (19/19 checks). Gathering rolls once per
  3 ticks (1.8s OSRS cadence). Curve: L20 in 0.5–1.5h, L50 in 3–12h per skill —
  deliberately ~4× faster than OSRS.
- **Juice**: day/night light cycle, animated water shimmer, synth SFX
  (`src/engine/sfx.js`, M mutes)

## Next (open work, roughly in order)

1. **Remaining shortcuts** — Grublake boat, Mine Cart + elevation-based agility
   crossings. Data stubs in `worldData.js SHORTCUTS`; anchor to *generated*
   terrain (probe first).
2. **Verticality as gameplay** — steep elevation steps become impassable except at
   ramps/shortcuts; extend `audit_world.mjs` so no region soft-locks.
3. **Interactive wonders** — make the 14 authored landmarks do things (search
   graveyard, spring buff, fairy-ring teleports, lore).
4. **Weather/season spawn shifts** — tie spawns/events to the world clock
   (day/night *visuals* are in).
5. **Map design pass** — the chunk-by-chunk detail/decorating pass, fully tooled
   for smaller models: `scripts/map_defects.mjs` finds every defect,
   `src/data/map_patches.json` fixes them (typed ops, no code), and
   **docs/MAP_DESIGN_PASS.md is the runbook**. The automatic sanity pass already
   cut defects 5,993 → ~475; the remaining tail is the work queue. Gorkholm
   (town chunk) is the finished reference: zero defects.
6. **Mobile/iPad QA** — touch fixes are in (canvas `touch-action`, modal `[hidden]`);
   needs a real-device pass.
7. **Cross-lane gaps** — DB world-nodes gatherable (item-id bridge), richer POI
   visuals (giant toadstools done; buildings could get distinct chest objects);
   `TOOLS` whitelist in `worldData.js` only accepts 2 axes/pickaxes while
   `items.json` has a full tool ladder — sync them.

## Later / bigger

- Move the world server off the laptop to a paid host (change `PROD_API_BASE` in
  `src/net/config.js` + DNS only; see `docs/SERVER_DECISION.md`)
- Phase 4 completion: full server-side player state + simulation
  (`docs/MULTIPLAYER_ARCHITECTURE.md`)
- Ops migration into Voyra — see `docs/VOYRA_HANDOFF.md`
