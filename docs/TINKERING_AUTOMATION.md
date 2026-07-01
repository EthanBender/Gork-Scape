# Tinkering Automation — persistent contraptions (DESIGN)

The payoff of a maxed Tinkerer: **contraptions you deploy in the world that keep
working while you're away** — a harvester on your farm plot, a drill on a vein, a
powder mill grinding blackpowder. They persist, they run on the world clock, and
they save you *time*.

The danger the owner flagged is real: a machine that makes items for free is an
**infinite faucet → inflation**. So the whole design is built around one principle
and five throttles, plus an explicit sink strategy.

## Core principle: contraptions are CONVERTERS, not CREATORS

A contraption never makes wealth from nothing. It **converts an input + fuel into
an output at a capped rate**. The player's net wealth barely moves; what they buy
is *convenience* (not standing on the node). Tuned right, running a contraption is
roughly break-even in resources and only wins you time.

```
   fuel (consumable)  +  input (seed/node/ore)  ──▶ [contraption] ──▶ output (raw) → hopper (capped)
        ↑ you must keep making/buying fuel                 ↑ wears out, needs repair; costs upkeep GP
```

## The five throttles (anti-inflation)

1. **Fuel burn — the primary lever.** Every production cycle burns a consumable
   (fuel cell / drill bit / chain-oil). No fuel → idle. Fuel is itself crafted from
   other skills (a sink), so a contraption's real output is bounded by how much fuel
   you feed it. This turns "infinite" into "conversion you paid for."
2. **Capped hopper.** Output goes into an on-board buffer (e.g. 20–50 items). When
   full, the contraption **idles** — it does NOT run unbounded while you're offline.
   Offline gain ≤ min(hopper cap, fuel loaded). You must return, collect, refuel.
3. **Durability / maintenance.** Contraptions wear each cycle and need a **Repair
   Kit** (a Tinkering item = a sink) periodically, or they break and must be
   rebuilt. Ties generation to ongoing investment.
4. **Upkeep.** A small **GP-per-world-day licence/rent** (coin sink), routed into
   the existing GE treasury war-chest. Unpaid → the contraption is impounded/idles.
5. **Hard slot cap.** You can run only a few at once — gated by Tinkering level +
   quest-line blueprints (e.g. 1 slot at Lv 50, +1 per tier/quest, max ~4). No
   goblin builds a factory of 100 harvesters.

Plus **placement rules**: only on *your* claimed plot/node, one contraption per
tile, and output is **raw materials** (things you'd gather anyway) — never finished
high-value goods. It saves time, not creates a new wealth tier.

## Where the items go — the sink ledger (the other half)

For the economy to hold, sinks must roughly match the faucet the contraptions add.

| Faucet (items IN) | Sink (items/coins OUT) |
|-------------------|------------------------|
| Contraption output (throttled) | **Build cost** — rare components + bars + GP (huge one-time) |
| Gathering / drops (existing) | **Fuel** every cycle (burns crafted consumables) |
| | **Repair Kits** (durability) |
| | **Upkeep GP/day** → GE treasury (coin sink) |
| | **GE 2% sell tax** (existing coin sink) |
| | **Decay / rebuild** when a contraption dies |
| | **Alchemy High-Alch** (existing item→coin sink) |
| | Higher-tier crafting consuming the raws the contraptions make |

Net design target: **value(output) ≲ value(fuel + repair + upkeep + amortized
build)**. A contraption should feel like paying for a hired hand, not printing money.

## Contraption taxonomy (build on the gadget ladder + tiers)

| Contraption | Sits on | Input | Fuel | Output → hopper | Tinker req |
|-------------|---------|-------|------|-----------------|-----------|
| **Auto-Harvester** | a farm plot | seeds | machine oil | the crop | ~40 |
| **Drill Rig** | a mineral node | — | drill bits (wear) | ore/saltpeter | ~50 |
| **Lumber/Resin Harvester** | a tree/resin tap | — | chain-oil | logs/resin | ~45 |
| **Powder Mill** | anywhere (owned) | saltpeter+sulfur+charcoal | (slow, no extra fuel) | blackpowder | ~55 |
| **Fishing Trawler** | a water tile | bait | fuel cell | fish | ~50 |

Each tier improves rate / hopper size / fuel-efficiency (a real reason to level).

## Persistence (reuse the farming/world-clock engine)

`src/systems/farming.js` is the template: a `plots` Map keyed by tile, growth
computed from world-time (`nowMs`), `serializeFarms`/`restoreFarms`, and offline
catch-up on login. Automation copies this exactly:

- `contraptions` Map keyed by tile → `{ type, owner, tier, fuel, hopper[], durability, lastMs }`.
- On tick / login: advance by elapsed world-time, but **bounded** — produce only
  while `fuel > 0` and `hopper < cap`; each cycle burns fuel + durability + accrues
  upkeep debt. This makes offline gain deterministic and capped (no runaway).
- Serialize with the save (like farms). The world clock + offline catch-up already
  exist, so this is a well-worn path, not new infra.

## Progression & MMO fit

- **Blueprints** unlock via the Tinkerer quest line (`unlock: automation_*`) + a
  high Tinkering level — extends the quest-gating we just built.
- Building/running/repairing contraptions grants Tinkering XP (a real end-game
  training method).
- MMO angle (optional, later): an **unattended** contraption with a full hopper is
  raidable — ties into the existing treasury-heist system. Adds risk/engagement and
  another sink (stolen goods), discouraging pure AFK.

## Implementation sketch (when we build)

- NEW `src/systems/automation.js` (mirrors farming.js): the Map, tick/catch-up,
  fuel/hopper/durability/upkeep, serialize/restore. **[economy lane]**
- Contraption items in `tinkering.js` (deployable "kit" item → placed device) +
  fuel/repair-kit items + recipes (expensive, quest+level gated). **[economy]**
- Place on a claimed tile (reuse farm-plot ownership / a claim action); a small
  self-contained collect/refuel overlay (like the workbench, dodges panels.js). **[economy]**
- Save hook: `automation: serialize()` (coordinate the one line in `save.js`). **[economy]**
- world-gen: nothing required (devices are placed by the player), but they may want
  a visual for a deployed contraption. **[character-render/world-gen heads-up]**

## Balance knobs to tune (all data, easy to retune)

hopper cap · fuel per cycle · cycle time (world-seconds) · durability per cycle ·
repair-kit cost · upkeep GP/day · slot cap per tier · build cost. Start conservative
(low hopper, real fuel cost, few slots) and loosen only if it feels too grindy.

## DECISIONS (owner, 2026-07-01)

- **Balance model = FULL STACK.** Every contraption runs on fuel burn + a capped
  hopper + durability (repair kits) + GP upkeep. Most inflation-proof; all four are
  data-tunable knobs.
- **Slot cap = SOFT (escalating GP licence).** No hard maximum — each additional
  contraption costs escalating GP to licence/run (mirrors the bank-space cost curve
  in state.js: `nextBankSpaceCost` doubles per purchase). The licence GP is itself a
  scaling coin sink, so wealthier players pay more to automate more.
- **Scope order:** build automation AFTER the item/node expansion is fuller (so
  contraptions convert a real, deep resource base). Automation is **deferred**;
  finish the ~200-item / ~100-node expansion first.

Implementation note for later: model each contraption as `{ type, owner, tier,
fuel, hopperCap, hopper[], durability, upkeepDebt, licenceTier, lastMs }`; the soft
slot licence reuses the `nextBankSpaceCost`-style doubling curve.
