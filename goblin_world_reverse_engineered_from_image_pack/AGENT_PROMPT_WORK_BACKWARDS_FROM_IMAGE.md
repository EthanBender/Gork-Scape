# Work Backwards From the Approved Goblin Empire Image

You are no longer generating a world from scratch.

Use the approved illustrated world map as the visual source of truth.

Your job is to reverse-engineer it into a playable tile world.

## Scale

World size: 1000 x 1000 tiles.

Coordinate system:
- X 0 to 1000 from left to right.
- Y 0 to 1000 from top to bottom.
- Goblin Settlement center is approximately X 500, Y 455.

The image is not a tile mask. It is art direction. Use the provided JSON coordinates as the gameplay source of truth.

## Required Workflow

1. Load `regions.json`.
2. Build the broad world layout using region centers and bounds.
3. Load `roads.json`.
4. Draw roads and paths using the provided polylines.
5. Load `landmarks.json`.
6. Place important POIs and stations.
7. Load `resource_distribution.json`.
8. Place teaser/training/specialist resource nodes.
9. Build local detailed maps from `local_maps_to_author.json`.
10. Render the world map preview from actual region/tile/local-map data.

## Do Not

- Do not make random terrain blobs.
- Do not draw giant transparent rectangles.
- Do not rely on labels to make locations real.
- Do not regenerate the world layout.
- Do not move major regions unless explicitly instructed.
- Do not treat the painted image as pixel-perfect tile data.

## Do

- Match the visual intent of the image.
- Use the image for terrain style, road feel, settlement density, and region identity.
- Build the actual game map from structured coordinates.
- Start with the Goblin Settlement local map first.

## First Task

Create `goblin_settlement_local`, a 128 x 128 tile local map.

It must include:
- palisade wall
- four gates
- main square
- bank
- general store
- weapon shop
- armour shop
- furnace
- anvil
- cooking range
- crafting bench
- inn
- chief hall
- quest board
- prayer idol
- training yard
- houses
- market stalls
- roads connecting outward

This local map should be stitched into the world at region `goblin_settlement`.
