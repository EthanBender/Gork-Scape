# Goblin Empire Item / Economy Database

## What this is

A data-driven database for the Goblin Empire RPG economy.

It connects:

- Items
- Levels
- Skill requirements
- Sources
- Stackability
- GP values
- Shops
- Recipes
- World nodes
- Inventory interactions
- World interactions
- Monsters
- Drop tables
- Progression loops

## Counts

- Items: 1072
- Recipes: 517
- World nodes: 64
- Interactions: 2612
- Monsters: 60
- Drop table entries: 302
- Level unlock records: 838
- Shop rows: 43

## Main tables

### Items Master

Canonical item data.

Important fields:

- `item_id`
- `display_name`
- `category`
- `subcategory`
- `stackable`
- `related_skill`
- `level_requirement`
- `source_type`
- `primary_source`
- `source_region`
- `gp_value`
- `shop_buy_price`
- `shop_sell_price`
- `inventory_actions`
- `use_on`
- `used_in_recipes`
- `dropped_by`
- `unlocks_or_supports`

### Recipes

Station-based and inventory-based crafting.

Important fields:

- `recipe_id`
- `output_item_id`
- `station`
- `related_skill`
- `level_requirement`
- `inputs`
- `output_qty`
- `xp_reward`
- `gp_cost`

### World Nodes

Interactable resource nodes in the tile world.

Examples:

- trees
- ore rocks
- fishing spots
- farming patches
- herb patches
- mushroom clusters

Important fields:

- `node_id`
- `node_type`
- `related_skill`
- `level_requirement`
- `region`
- `outputs`
- `required_tool`
- `respawn_seconds`
- `interaction`

### Interactions

Game-facing action list.

This table tells the engine what happens when:

- an item is clicked in inventory
- an item is used
- a world node is clicked
- a station is opened

Important fields:

- `interaction_id`
- `target_type`
- `target_id`
- `action`
- `required_item`
- `required_skill`
- `level_requirement`
- `result`

### Monsters and Drop Tables

Combat connects back into the economy through drops.

Monsters provide:

- meat
- hides
- bones
- shells
- ore
- herbs
- quest pieces
- unique crafting components
- cosmetics

## Implementation rule

Use the JSON or SQLite as the source of truth.

The spreadsheet is for design review and balancing.

If a value changes, change it in the database/export first, then have the game consume that updated data.

## Cross-skill principle

The economy should avoid siloed skills.

Example:

Woodcutting -> logs -> bow staves  
Combat -> spider silk -> bowstring  
Mining -> ore -> arrowheads  
Smithing -> arrows  
Ranged -> combat  
Combat -> monster materials -> crafting  

This is the intended structure.
