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
also CI), `scripts/audit_world.mjs` (map invariants), `scripts/pacing_sim.mjs` (XP pacing).

## Done (playable today)

- 1000×1000 handcrafted world: geography-first generation, region progression rings,
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
- Interactive shortcut system (West Bridge wired + persisted)
- Interior dungeon **generator** (`src/world/interiors.js` — 4 validated dungeons)

## Next (open work, roughly in order)

1. **Interior enter/exit hook** — the generator is done; wire the scene-swap in
   `main.js` (contract documented at top of `src/world/interiors.js`), then place
   entrances (Deep Mine, Ruin Chapel, Witch Hut, Rival Camp) and author bosses/loot.
2. **Remaining shortcuts** — Grublake boat, Mine Cart, Troll Gate (gate-kind clears
   a WALL span) + elevation-based agility crossings. Data stubs in
   `worldData.js SHORTCUTS`; anchor to *generated* terrain (probe first).
3. **Verticality as gameplay** — steep elevation steps become impassable except at
   ramps/shortcuts; extend `audit_world.mjs` so no region soft-locks.
4. **Interactive wonders** — make the 14 authored landmarks do things (search
   graveyard, spring buff, fairy-ring teleports, lore).
5. **Living surface** — weather/season/day-night visuals + spawn shifts tied to the
   world clock and events.
6. **Map polish continuation** — chunk-by-chunk coherence walk
   (`scripts/chunk_inspect.mjs`), remaining decor tuning.
7. **Mobile/iPad QA** — touch fixes are in (canvas `touch-action`, modal `[hidden]`);
   needs a real-device pass.
8. **Cross-lane gaps** — DB world-nodes gatherable (item-id bridge), richer POI
   visuals (giant toadstools done; buildings could get distinct chest objects).

## Later / bigger

- Move the world server off the laptop to a paid host (change `PROD_API_BASE` in
  `src/net/config.js` + DNS only; see `docs/SERVER_DECISION.md`)
- Phase 4 completion: full server-side player state + simulation
  (`docs/MULTIPLAYER_ARCHITECTURE.md`)
- Ops migration into Voyra — see `docs/VOYRA_HANDOFF.md`
