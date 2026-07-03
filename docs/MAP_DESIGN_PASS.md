# The Map Design Pass — a runbook for smaller models

*You are finishing the detail/decorating pass on the Goblin Empire map: fixing
collisions, dead tiles, building logic, and making each area read as a real
place. You do NOT need to understand the generator. You have three tools: a
scanner that finds every defect, a JSON patch file that fixes them, and gates
that verify you didn't break anything. Work the loop below; never edit
generator code (`src/world/map.js`, `geo2.js`) for a map fix.*

## Crawl order — center-out spiral, miss nothing

The map is a 10×10 grid of 100×100 chunks. Work them in a **center-out spiral**
(from the middle chunk `c5,r5` winding outward) so coverage is systematic and no
chunk is ever skipped. One command drives the whole crawl:

```
node scripts/map_crawl.mjs        # spiral worklist: defects + elevation per chunk, and the NEXT chunk to fix
```

It names the next unclean chunk. Fix it, re-run, repeat — the list shrinks until
`100/100 chunks clean`. (`map_defects.mjs spiral` / `elevation_audit.mjs spiral`
show the same order for one signal each.)

## The loop (repeat per chunk, one commit each)

```
1. node scripts/map_crawl.mjs                   # the NEXT chunk in the spiral (defects + elevation)
2. node scripts/map_defects.mjs <col> <row>     # list its defects (exact x,y)
   node scripts/elevation_audit.mjs <col> <row> # list any elevation violations too
3. node scripts/chunk_inspect.mjs <col> <row>   # see the terrain as ascii art
4. Edit src/data/map_patches.json               # add ONE patch entry (ops below)
5. node scripts/map_defects.mjs <col> <row>     # did the count drop? if it ROSE, revise
6. node scripts/audit_world.mjs && node scripts/map_defects.mjs && node scripts/elevation_audit.mjs   # all must PASS
7. Ratchet: if a class's total fell, LOWER its number in the BUDGET line of
   scripts/map_defects.mjs (and elevation_audit.mjs) to the new value.
8. git add -A && git commit -m "map pass: <chunk> <what you fixed>"
```

## Human-coherence — does it LOOK right?

Reachability isn't the whole story. `scripts/coherence_audit.mjs` catches things
that look **wrong to a person** even where everything is reachable: stray wall
fragments (`wall_stub`), walls standing in a lake (`wall_in_water`), a tree/ore
clipping through a wall (`obj_embedded`), two blockers stacked on one tile
(`obj_stack`), a lone cliff in a meadow (`orphan_cliff`), a shadow with no slope
to cast it (`orphan_shadow`), or a 1-tile elevation pillar/pit (`elev_spike`).
Run it alongside the others; fix stray walls by dissolving the WHOLE component
into its surroundings (never leave a fragment), and only where the result stays
reachable (a grassed wall in an enclosed spot makes a new pocket). **Unreachable
islands and walls that belong to authored ruins/camps are FINE** — a little
imperfection makes the world feel real; this audit skips anything within 5 tiles
of a labelled structure.

## Elevation — check it every chunk

Elevation (the 2.5D height field) must read like real terrain: **water sits
lowest** (valley floors, never above its own bank), **rock/mountains sit
highest**, grass rolls, settlement stands a little proud. The generator now
re-pins this from the FINAL terrain (`src/world/map.js`, geo2 branch), so a fresh
world is coherent — `elevation_audit.mjs` guards it at **budget 0**. You rarely
fix elevation by hand; but if a terrain patch you add creates water on a hill or
a mountain in a ditch, the audit will flag it — adjust the patch (e.g. don't
leave stray WATER terrain on high ground) until it reads 0 again. Elevation is
data-only and never changes movement/layout.

## Patch format (src/data/map_patches.json → "patches" array)

```json
{ "id": "c3r4-farm-fence-gap",
  "why": "one line: which defect(s) this fixes and the design intent",
  "ops": [
    { "op": "terrain", "rect": [x0, y0, x1, y1], "to": "GRASS" },
    { "op": "terrain", "cells": [[x, y], [x, y]], "to": "DIRT" },
    { "op": "trail",   "from": [x, y], "to": [x, y] },
    { "op": "remove_objects", "rect": [x0, y0, x1, y1], "types": ["decor"] },
    { "op": "object",  "x": 0, "y": 0, "label": "Old Cairn", "color": 9079434, "examine": "…" },
    { "op": "decor",   "x": 0, "y": 0, "color": 4157996, "size": 4, "shape": "circle" }
  ] }
```
- Terrain names: `GRASS WATER ROCK ROAD SWAMP SAND BRIDGE DIRT FIELD FLOOR WALL`
  (patches run before the texture pass, so use these base names only).
- `trail` lays a dirt path and automatically bridges water it crosses.
- Patches apply AFTER the automatic sanity pass — your word is final; the
  scanner is your reviewer.

## How to fix each defect class

| class | what it is | the fix |
|---|---|---|
| `dead_pocket` | walkable tiles nobody can reach | small sliver in mountains/water → `terrain` fill with `ROCK`/`WATER` (**fill a rectangle LARGER than the fragment margin** — see the lesson below); a legitimate area → `trail` from inside it to a nearby road |
| `sealed_obj` | an object no player can reach | usually sits in a dead pocket — fix the pocket; or `remove_objects` if it's decorative |
| `sealed_room` | a building floor with no door | `terrain` one wall cell to `FLOOR` on the side facing open ground |
| `wall_orphan` | a floating 1-tile wall | `terrain` it to `GRASS`; add a `decor` boulder if it should stay visible |
| `speckle` | one lone tile of the wrong biome | `terrain` it to match its neighbours |
| `obj_water` / `fish_dry` | object in water / fishing spot on land | `remove_objects` on that cell |

**Lesson from a real failed patch** (`c0r2-west-shoulder-slivers`): filling a
rect that only covers the defect cells can CREATE new slivers at the rect's
edge, because the fragment continues past it. Always re-run the scanner after
every patch — if the chunk count went UP, widen the fill to cover the whole
fragmented margin, not just the reported cells.

## Beyond defects: the decorating brief

Once a chunk scans clean, make it read as a real place (this is the judgment
half — use `chunk_inspect` ascii + your understanding of the region's identity
from ROADMAP.md):
- Farms: fences with gates, crop rows, a scarecrow (`object` + `decor` ops)
- Buildings: a dirt path from every door to the nearest road (`trail`)
- Shores: reeds/rocks at water edges; bridges where trails meet rivers
- Wilds: cluster decor into patches (a camp, a grove), never even sprinkles

## POI build-out (a later, dedicated pass)

Most landmarks (~740/957) already get an authored scene from the generator. The
rest read as bare markers or thin scenes. `node scripts/poi_inventory.mjs`
lists them — **24 BARE (build), 193 THIN (enrich)** — grouped by type; that is
the build-out worklist. This is AUTHORING (judged by eye, not a gate), so it's
its own pass after the mechanical cleanup is done. Per-type templates:

- **Collapsed / ruined / overgrown things** (Collapsed Watchtower, Toppled
  Idol, Charred Homestead ruin): tumbled-stone rubble decor (`decor` op,
  stone `0x8a7a60` + mossy `0x557a34`, sizes 2-5) on empty grass around the
  marker. Decor-only is safest — no walls to clip neighbours or seal a room.
- **Standing structures** (Tent, Pilgrim's Rest, Watchtower keep): a small
  FLOOR footprint ringed by WALL **with a doorway** (one wall cell left as
  FLOOR to the outside, or the room is a `sealed_room` defect), plus a `trail`
  spur to the nearest path and a little decor. Check `map_defects` after.
- **Camps / caches** (Hunter's Cache, Looted Cart): a firepit + crates/barrels
  decor + trampled `DIRT` ground + a fence line (short WALL run near a labelled
  object is furniture-exempt).

Rules: place decor only on empty GRASS (no object, not water/rock) so you never
make `obj_water`/`obj_stack`; keep a doorway on anything walled; re-run
`coherence_audit` + `map_defects` after — the build must stay green.

## Guardrails
- One patch entry per problem; small ops; commit per chunk.
- NEVER lower a budget you didn't earn, never raise one.
- `node scripts/smoke.mjs` + `audit_world` + `map_defects` green before commit
  (the Stop-hook only auto-publishes green trees, but check anyway).
- If a defect seems intentional (a gated region, a shrine post), leave it and
  note it in the patch file's `_readme` instead of forcing the count down.
