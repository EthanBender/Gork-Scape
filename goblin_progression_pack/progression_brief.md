# Goblin Empire Progression + Economy Implementation Brief

## Purpose

Implement a connected old-school RPG progression system where no skill exists in a silo.

The player should feel that gathering, crafting, combat, exploration, shops, quests, and world unlocks all feed each other.

The current skills are:

- Woodcutting
- Fishing
- Mining
- Cooking
- Smithing
- Crafting
- Attack
- Strength
- Defence
- Ranged
- Hitpoints

## Core Design Rule

Every skill must do at least one of these:

1. Feed another skill.
2. Consume another skill's output.
3. Improve combat.
4. Improve travel or exploration.
5. Unlock a region, shortcut, or quest.
6. Produce useful items for the economy.

If an item, monster, or resource does not connect to another system, either remove it or make it cosmetic.

---

# Data Files

This pack includes:

```text
skills.json
items.json
recipes.json
monsters.json
drop_tables.json
progression_brief.md
```

Use these as the source of truth for the game systems.

---

# How To Use The Files

## skills.json

Use this to populate:

- Skill panel
- Level unlocks
- Tooltips
- Skill guide UI
- Level requirement checks
- Tutorial prompts

Each skill contains:

```text
purpose
level_unlocks
```

Implementation expectation:

When the player levels a skill, check the `level_unlocks` array and display newly unlocked content.

Example:

```js
if (player.skills.woodcutting.level >= 10) {
  allowInteraction("oak_tree")
}
```

---

## items.json

Use this to populate:

- Inventory
- Equipment
- Shops
- Tooltips
- Crafting requirements
- Combat stats
- Food effects
- Quest checks
- Gear requirements

Each item can include:

```text
id
name
category
sources
uses
skill_requirements
equip_slot
stats
heal
effects
stackable
```

Implementation expectation:

Inventory items should show:

- Name
- Category
- What it is used for
- Requirements if any
- Effects if consumable
- Stats if equippable

---

## recipes.json

Use this for:

- Furnace smelting
- Anvil smithing
- Cooking
- Crafting bench
- Quest repair recipes
- Future station upgrades

Each recipe includes:

```text
id
station
skill
level
inputs
outputs
burn_chance // optional for cooking
```

Implementation expectation:

A recipe is available only when:

1. Player is at the correct station.
2. Player has the required skill level.
3. Player has the required inputs.

Pseudo-code:

```js
function canCraft(player, recipe) {
  return player.skills[recipe.skill].level >= recipe.level
    && player.currentStation === recipe.station
    && hasItems(player.inventory, recipe.inputs)
}
```

---

## monsters.json

Use this for:

- Monster spawning
- Combat level display
- Enemy behaviour
- XP reward
- Respawn timing
- World placement

Each monster includes:

```text
id
name
combat_level
location
purpose
aggressive
respawn_seconds
xp
drop_table_id
```

Implementation expectation:

Monsters level 28+ are aggressive by default in this pass.

You can tune aggression by zone later.

---

## drop_tables.json

Use this for:

- Monster loot
- Economy balancing
- Crafting material supply
- Rare drops
- Quest items
- Unique gear drops

Each drop table includes:

```text
monster_id
rolls
drops
chance_percent
```

Important:

The current drop tables use simple independent-style chances. This is easiest for a first implementation.

Example:

```js
for (const drop of table.drops) {
  if (Math.random() * 100 < drop.chance_percent) {
    addItemToLoot(drop.item_id)
  }
}
```

Later, you can convert this to weighted buckets:

- Common
- Uncommon
- Rare
- Unique

---

# Skill Interconnection Targets

## Woodcutting

Woodcutting should not just produce logs.

It should feed:

- Cooking fires
- Bow crafting
- Arrow shafts
- Tool handles
- Bridge repairs
- Shrine fuel
- Town upgrades
- Shortcut unlocks

Required systems:

```text
tree interactions
log items
axe requirement
woodcutting level requirement
respawning tree stumps
```

---

## Fishing

Fishing should produce food and region prep items.

It should feed:

- Cooking
- Combat survival
- Boss preparation
- Swamp preparation
- Quest hand-ins
- Economy

Required systems:

```text
fishing spots
tool requirements
fishing level requirements
raw fish items
cooking recipes
```

---

## Mining

Mining should feed the entire gear economy.

It should feed:

- Smithing
- Tools
- Weapons
- Armour
- Arrowheads
- Nails
- Jewelry
- Quest repairs
- Station upgrades

Required systems:

```text
ore rocks
pickaxe requirement
mining level requirement
ore respawn
depleted rocks
```

---

## Cooking

Cooking should convert gathered resources into survival power.

It should feed:

- Healing
- Poison resistance
- Strength buffs
- Boss prep
- Travel prep
- Quest meals

Required systems:

```text
raw food
cooking stations
burn chance
food effects
healing
buff timers
```

---

## Smithing

Smithing is the bridge between mining and progression.

It should produce:

- Tools
- Weapons
- Armour
- Nails
- Arrowheads
- Quest repair parts
- Station upgrade parts

Required systems:

```text
furnace
anvil
bar recipes
gear recipes
level requirements
material consumption
```

---

## Crafting

Crafting is the glue skill.

It should consume:

- Hides
- Bones
- Gems
- Logs
- Bars
- Clay
- Silk
- Monster materials
- Swamp herbs
- Mushrooms

It should produce:

- Bows
- Bowstrings
- Charms
- Jewelry
- Bags
- Light armour
- Quest items
- Swamp protection items

Required systems:

```text
crafting bench
material recipes
equipment recipes
utility recipes
jewelry
```

---

## Combat Skills

Combat should consume the output of the economy.

Attack uses:

- Weapons from smithing
- Unique monster-drop upgrades

Strength uses:

- Weapon damage
- Food buffs
- Heavy weapons

Defence uses:

- Armour from smithing
- Hides/shells from crafting
- Monster-drop materials

Ranged uses:

- Logs from woodcutting
- Bowstrings from crafting
- Arrowheads from smithing
- Poison glands from monsters

Hitpoints uses:

- Food from cooking
- Gear from crafting/smithing
- Region prep items

---

# Early Game Loop

The first 30 minutes should teach the whole loop.

1. Spawn in Goblin Settlement.
2. Talk to the Goblin Chief.
3. Chop normal trees.
4. Catch shrimp.
5. Cook shrimp.
6. Mine copper and tin.
7. Smelt bronze.
8. Smith a bronze dagger or spear.
9. Fight training rats.
10. Bank materials.
11. Accept quests pointing north, west, east, and south.

The player should see locked or dangerous content early:

- Oak trees needing Woodcutting 10.
- Iron rocks needing Mining 15.
- Trout spots needing Fishing 10.
- Swamp path requiring preparation.
- Rival goblin territory being too dangerous.

---

# Region Progression

## Ring 1: Safe Home Zone

Level range:

```text
1-10
```

Content:

- Normal trees
- Shrimp
- Copper/tin
- Training rats
- Cave bugs
- Basic farming
- Bank
- Shops
- Furnace
- Anvil
- Cooking range
- Crafting bench

## Ring 2: Beginner Wilderness

Level range:

```text
10-25
```

Content:

- Oak trees
- Trout
- Iron
- River bandits
- Mud bugs
- Grublake shore
- Bridge repair

## Ring 3: Mid-Level Frontier

Level range:

```text
25-45
```

Content:

- Willow trees
- Pike
- Coal
- Gold
- Bog edge
- Mushroom forest
- Oakwoods
- Mine cart
- Lake dock

## Ring 4: Hostile Outer Lands

Level range:

```text
45-70+
```

Content:

- Black iron
- Rival goblin camp
- Deep bog
- Troll ridge
- Bosses
- Rare resources
- Unique drops
- Captured anvil

---

# Required First Implementation Tasks

## 1. Load JSON Data

Add a data loader that imports:

```text
skills.json
items.json
recipes.json
monsters.json
drop_tables.json
```

Store them in a central registry:

```js
GameData.skills
GameData.items
GameData.recipes
GameData.monsters
GameData.dropTables
```

## 2. Update Skill UI

The skill UI should show:

- Skill name
- Current level
- XP
- Next unlock
- Next unlock level
- Tooltip explaining what the skill is for

## 3. Update Item Tooltips

Item tooltip should show:

- Name
- Category
- Requirements
- Uses
- Stats
- Healing/effects
- Source if known

## 4. Add Recipe Stations

Create interactable stations:

- Furnace
- Anvil
- Cooking fire
- Cooking range
- Crafting bench

Each station should open recipes filtered by station type.

## 5. Add Gathering Interactions

Implement:

- Trees
- Ore rocks
- Fishing spots

Each needs:

- Required tool
- Required level
- XP reward
- Output item
- Respawn/depleted state where applicable

## 6. Add Monster Loot

When monster dies:

1. Read monster's `drop_table_id`.
2. Load table from `drop_tables.json`.
3. Roll each drop.
4. Create ground loot or add to player inventory.
5. Award XP from `monsters.json`.

## 7. Connect Combat To Economy

Monsters should drop materials used by recipes.

Do not make enemies only drop coins.

Examples:

- Spiders drop silk for bowstrings.
- Boars drop hide and meat.
- Swamp enemies drop poison materials.
- Cave enemies drop ores.
- Rival goblins drop gear pieces.
- Bosses drop unique crafting components.

---

# Balancing Notes

## Drop Rates

Current drop rates are first-pass values.

They should feel generous during prototyping.

Later tuning can reduce rare drops and increase resource sinks.

## XP

XP values should initially be simple.

Recommended first implementation:

```text
Gathering XP = resource level * 5
Crafting XP = recipe level * 8
Combat XP = monster level * 2 for active combat style
Hitpoints XP = monster level * 1.5
```

## Resource Sinks

The economy needs item sinks.

Use these:

- Food consumed in combat
- Arrows consumed by ranged
- Tools upgrade but old tools remain sellable
- Quests consume materials
- Bridges consume logs/nails
- Station upgrades consume bars/planks
- Shrine offerings consume gold/bones/herbs
- Crafting consumes monster materials

---

# Important Design Warnings

Do not make every skill a separate minigame.

The point is not:

```text
Woodcutting area
Fishing area
Mining area
Combat area
```

The point is:

```text
I need wood to make a bow.
I need spider silk for string.
I need ore for arrowheads.
I need poison glands for poison arrows.
I need cooked fish to survive the swamp.
I need swamp herbs to make the charm.
I need the charm to reach the rival camp.
```

That is the correct game loop.

---

# Success Criteria

This system is working when the player naturally says:

```text
I want to fight stronger monsters.
So I need better food.
To get better food I need better fishing.
To use better fishing spots I need to repair the dock.
To repair the dock I need oak logs and iron nails.
So I need woodcutting, mining, and smithing.
```

That is the whole design.
