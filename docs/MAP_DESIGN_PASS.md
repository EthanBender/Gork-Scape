# The Map Design Pass — a runbook for smaller models

*You are finishing the detail/decorating pass on the Goblin Empire map: fixing
collisions, dead tiles, building logic, and making each area read as a real
place. You do NOT need to understand the generator. You have three tools: a
scanner that finds every defect, a JSON patch file that fixes them, and gates
that verify you didn't break anything. Work the loop below; never edit
generator code (`src/world/map.js`, `geo2.js`) for a map fix.*

## The loop (repeat per chunk, one commit each)

```
1. node scripts/map_defects.mjs                 # pick the worst chunk
2. node scripts/map_defects.mjs <col> <row>     # list its defects (exact x,y)
3. node scripts/chunk_inspect.mjs <col> <row>   # see the terrain as ascii art
4. Edit src/data/map_patches.json               # add ONE patch entry (ops below)
5. node scripts/map_defects.mjs <col> <row>     # did the count drop? if it ROSE, revise
6. node scripts/audit_world.mjs && node scripts/map_defects.mjs   # both must PASS
7. Ratchet: if a class's total fell, LOWER its number in the BUDGET line of
   scripts/map_defects.mjs to the new value (so it can never regress).
8. git add -A && git commit -m "map pass: <chunk> <what you fixed>"
```

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

## Guardrails
- One patch entry per problem; small ops; commit per chunk.
- NEVER lower a budget you didn't earn, never raise one.
- `node scripts/smoke.mjs` + `audit_world` + `map_defects` green before commit
  (the Stop-hook only auto-publishes green trees, but check anyway).
- If a defect seems intentional (a gated region, a shrine post), leave it and
  note it in the patch file's `_readme` instead of forcing the count down.
