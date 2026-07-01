# Elevation model & 2.5D relief — render-lane handoff

The world now ships a **coherent, rule-based heightfield**. World-gen (`src/world/map.js`)
produces it; the **render lane owns turning it into visible 2.5D**. This doc is the
contract between the two.

## What you get

`generateWorld()` returns an extra field:

```js
world.elevation   // Uint8Array(W*H), one height 0–255 per tile, row-major (y*W + x)
```

Read it exactly like `world.terrain` / `world.collision`:

```js
const h = world.elevation[y * world.W + x];   // 0 = valley floor … 255 = peak
```

It is **data only** — nothing in the sim reads it yet, so you can shade from it
however you like without breaking gameplay. Collision is unchanged: elevation does
**not** gate movement (a mob walks up a hill the same as across a plain).

## The rules baked into the numbers

Seeded per-terrain targets are relaxed (4 blur passes) into a continuous field, with
mountain peaks and water valleys re-pinned each pass so ramps form *around* them
instead of averaging flat. Net result, verified by `scripts/audit_world.mjs`:

| Feature                     | Height band | Rule |
|-----------------------------|-------------|------|
| Deep water / rivers         | ~6–20       | **Lowest** — valley floors; banks slope down into them |
| Swamp / mud                 | ~30         | Low, wet lowland |
| Sand / shore                | ~46–52      | Just above the waterline |
| Roads / dirt / fields       | ~66–68      | Worn flat |
| **Grassland**               | ~66–92      | **Rolling** — gentle fbm swell, ramps up toward hills |
| **Settlement floor / walls**| ~92–98      | **Built up** a little proud of the plain |
| Cliff faces                 | ~122–132    | Terrace lips / mountain flanks |
| Rock / mountain             | ~158–196    | **Highest** — foothills ramp up to the peaks |

Measured on seed 1337: water ≈7.5 < grass ≈79 (rolls 14–176 with the ramps) < rock ≈183;
settlements ≈86, above the surrounding plain.

## Relief already applied to `terrain` (no work needed)

Two visual passes already run *before* you get the world, using the elevation field:

- **Terrace lips** — on high rock, each drop to a lower elevation band becomes a
  `CLIFF` tile, so mountains read as stacked climbable terraces, not one smooth dome.
- **Drop shadows** — ground sitting well below its northern neighbour is recolored to
  a `*_SHADOW` variant (`GRASS_SHADOW`, `DIRT_SHADOW`, `SAND_SHADOW`), a soft ~2-tile
  band at real steps. Light reads from the south.

These are baked into `world.terrain` as ordinary variant ids (see `TERRAIN_DEFS` in
`worldData.js`), so they render for free with the existing color-by-id draw.

## Suggested next step for full 2.5D (render lane's call)

The cheap, high-impact move is a **per-tile vertical draw offset + top/side shading**:

```js
const h = world.elevation[i];
const yOffset = (h - 80) * 0.25;          // px; 80 ≈ plains baseline. tune the 0.25
// draw the tile sprite at (screenY - yOffset)
// optional: tint by slope — lighter when h > northNeighbourHeight (sunlit),
//           darker when lower (in addition to the baked *_SHADOW tiles)
```

Start subtle (0.2–0.3 px per height unit): plains barely move, mountains lift hard,
water sinks. Because the field is smooth, adjacent tiles won't tear. Keep the draw
order painter-style (top rows first) so raised tiles overlap the ones behind them.

Don't offset collision or hit-testing — those stay on the flat grid.
