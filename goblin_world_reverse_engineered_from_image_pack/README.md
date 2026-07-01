# Goblin Empire — Reverse Engineered From Approved Image

This pack turns the approved illustrated map into implementation data.

## What this is

This is not a procedural generation prompt.

This is a fixed world plan derived from the approved image.

## World scale

- World size: 1000 x 1000 tiles
- Coordinates are normalized to the illustrated image:
  - X 0 = far left
  - X 1000 = far right
  - Y 0 = top
  - Y 1000 = bottom

## Files

- `goblin_world_image_with_1000x1000_coordinate_grid.png`
- `world_scale.json`
- `regions.json`
- `roads.json`
- `landmarks.json`
- `resource_distribution.json`
- `local_maps_to_author.json`
- `AGENT_PROMPT_WORK_BACKWARDS_FROM_IMAGE.md`

## How to use

Give the agent:
1. The approved image.
2. This entire pack.
3. The prompt in `AGENT_PROMPT_WORK_BACKWARDS_FROM_IMAGE.md`.

Tell it:

> Do not regenerate the world. Implement this world.

## Important

The next step is local detail, not another macro map.

Start with:
`goblin_settlement_local`, 128 x 128 tiles.
