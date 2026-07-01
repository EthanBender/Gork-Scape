# Tinkering — the third combat style (Sapper / goblin engineering)

Goblins don't cast spells; they **build machines that explode**. Tinkering is the
third corner of the combat triangle, deliberately *not* magic. It punishes heavy
armour (explosions don't care about plate) — the role Magic plays in OSRS — while
being out-paced by nimble Ranged and closed down by Melee.

```
        Melee ──beats──▶ Ranged
          ▲                 │
          │                 beats
        beats               │
          │                 ▼
        Tinkering ◀──beats── (armoured foes)
```

## Two ways to train (a HUB skill by design)

1. **Fabrication** — assembling gadgets, ammo, and components grants Tinkering XP.
   This is where the cross-skill web lives (below).
2. **Detonation** — dealing damage with a gadget grants Tinkering XP (like Ranged
   from a bow).

## The gadget classes (6)

| Class | Damage shape | Ammo family | Speed | Signature |
|-------|--------------|-------------|-------|-----------|
| **Bombard** | AoE (hits a cluster) | bombs | slow | splash damage to everything adjacent to the target |
| **Hand Cannon** | single, armour-piercing | slugs | slow | ignores a big % of the target's defence |
| **Dart Spitter** | rapid, low | darts | fast | many small hits, out-DPS on light targets |
| **Flame Bellows** | short cone, damage-over-time | fuel | medium | burns for several ticks |
| **Trapper** | area-denial | traps | slow | deploys a hazard the enemy walks onto |
| **Tesla Coil** | chain, ignores armour | cells | medium | arcs to a second nearby foe |

## The material/power ladder (7 tiers)

Scrapwork → Copperclock → Bronzegear → Ironpress → Steelsteam → Blackpowder → Voltaic.
Each tier raises power and gates on Tinkering level (1 / 8 / 18 / 30 / 42 / 55 / 70).

**6 classes × 7 tiers = 42 gadget weapons.** Plus tiered ammo, components, and raws
(below) — well over 100 items total, all recipe-linked.

## The cross-skill web (the whole point)

Every gadget is an assembly of parts that come from *other* skills:

```
Woodcutting ─logs─▶ (Crafting) ─▶ Stock / Grip / Handle ─┐
Mining ─ore─▶ (Smithing) ─bars─▶ Casing / Barrel / Spring / Cog / Piston ─┤
Firemaking ─logs─▶ Charcoal ─┐                                              ├─▶ (Tinkering) GADGET
Mining ─▶ Saltpeter + Sulfur ─┴─▶ Blackpowder ─┐                            │
Crafting ─fibre─▶ Fuse ; ─leather─▶ Grip ───────┼──────▶ (Tinkering) AMMO ──┘
Mining ─▶ Sparkstone ─▶ (Smithing) Voltaic Cell ┘
Alchemy (other contributor) ─▶ volatile reagents ─▶ incendiary/acid ammo  [future hook]
```

Concretely, one gadget recipe (Bronzegear Hand Cannon) needs:
`bronze_barrel (Smithing) + hardwood_stock (Woodcutting+Crafting) + coil_spring
(Smithing) + brass_trigger (Tinkering) + leather_grip (Crafting)`. You cannot make
a Tinkering weapon without touching four other skills.

## Ammo (charges) — consumed on use, recoverable like arrows

Bombs, slugs, darts, fuel canisters, traps, cells — each tiered. Blackpowder is the
keystone consumable (mine saltpeter + sulfur, burn charcoal, combine). Darts fletch
from wood (Woodcutting/Crafting cross-over). Higher Tinkering level recovers a
larger portion of spent traps/slugs off the ground (reuses the ammo-recovery system).

## Combat integration

- New weaponType `tinker`; new stat bonuses `tinker_atk` / `tinker_str` (+`tinker_def`
  so armour can resist gadgets). Accuracy/max-hit use the **Tinkering** level, exactly
  like the OSRS formulas already in `combat.js`.
- `resolveTinker()` extends the special-attack resolver: `splash` (AoE to neighbours),
  `pierce` (armour ignore), `burn` (DoT), `chain` (second target).
- Boss-forged Tinkering capstones later (e.g. **Meteor Mortar** from a boss core).

## Build phases

1. **Data + fabrication** (this pass): all items generated, the full recipe web, the
   Tinkering skill, the workbench, assembly with real cross-skill material spend.
2. **Detonation/combat**: `tinker` weaponType in combat, AoE/pierce/burn effects.
3. **World**: material nodes (saltpeter/sulfur/sparkstone) placed by world-gen; a
   Tinker's Workbench station; gadget visuals (character-render).
