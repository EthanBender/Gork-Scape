# Goblin Empire — Story Bible

*The world's mythology, and four quest lines that bake it into the ground. Written
2026-07-03 (economy/quest lane). This is a DESIGN doc — nothing here ships until
it's authored as data.*

## How to use this

Everything below is buildable on the **safe editing surface** — no engine changes:

- **Quests** are rows in [`src/data/quests.json`](../src/data/quests.json), validated
  end-to-end by `node scripts/quest_test.mjs`. Schema (confirmed from live quests):
  ```jsonc
  {
    "id": "kebab_id", "name": "Display Name", "act": 2,
    "giver": { "npc": "npc_id", "name": "NPC Name", "where": { "x": 500, "y": 455 } },
    "summary": "one-line board text", "intro": "giver's opening dialogue",
    "outro": "giver's turn-in dialogue",
    "requires": { "quests": ["prereq_id"], "level": { "skill": "Mining", "level": 20 } },
    "steps": [ /* ordered; only the current one is active */ ],
    "rewards": { "coins": 100, "xp": [{ "skill": "Attack", "amount": 300 }],
                 "items": [{ "id": "item_id" }], "bankSpace": 10,
                 "openShortcut": "shortcut_id", "unlock": "unlock_id" }
  }
  ```
  **Step types** (target + `text` label + `say` hint on each): `talk` {target npc,
  name}, `goto` {where:{x,y,name,radius}}, `obtain` {target item, count}, `kill`
  {target monster_id, count}, `boss` {target, where, boss:{name,combatLevel,hp,att,
  str,def,attackSpeed,weaponType,aggressive,color}}.
- **New creatures** → [`src/data/monsters.json`](../src/data/monsters.json).
  **New items** → [`src/data/items.json`](../src/data/items.json) (equipment/tools
  auto-hydrate stats from name/tier; see COORDINATION.md). Named unique gear →
  [`src/data/questItems.js`](../src/data/questItems.js).
- **Lore baked into the world** = examine text, NPC dialogue, region flavor, and the
  live **world events** (`src/systems/worldEvents.js`): *Blood Moon, Merchant Caravan,
  Goblin Festival, Ore Rush, Timber Glut, Wandering Horde*.
- **Anchor to region anchors / landmarks, never raw coordinates** — the world has been
  regenerated before; anchors survive. Region + landmark coords are in the Appendix.

Golden rule of tone: goblins are **scrappy, greedy, funny, and secretly brave**.
"Cabbage for Cowards", "Goblin Needs Pointy Stick", "machines that go BANG". Keep it.

---

# PART I — THE DEEP LORE

### *"The world is the Grub's leavings."*

Goblins don't believe the world was **made**. They believe it was **eaten, and left
behind.** The **Great Grub** chewed through the void before time, and everything we
stand on is its spoil-heap — which is why the good stuff is always *down.* Dig toward
the Grub, get richer. Priests read the **Ore Rush** (rich seams surfacing — a real
world event) as the Grub *turning over in its sleep*, and that makes them nervous,
because a thing that turns over is a thing that might **wake up**.

### The Two Ages

- **The Spirit Age** — the old way. You appease what's bigger than you: idols, altars,
  shrines, the drowned gods of the Bog, the guardians in the Ruins. Prayer, bones,
  offerings. Most of the world still lives here.
- **The Clank Age** — the new heresy. **Sprocket the Tinker** and his kind say you
  don't *appease* the world, you *out-engineer* it: blackpowder, gears, "machines that
  go BANG". Half the goblins think this is a miracle. The other half think it's a great
  way to wake the neighbors. **Both are right.**

### Gork the First *(already canon — `gorks_first_fang` drops in-game)*

The legendary progenitor the capital (**Gorkholm**) is named for. The oldest song says
Gork once **punched the Below shut** with his bare fist and a borrowed god's tooth, and
that his regalia scattered when he fell: a **Crown**, a **Cleaver**, and his petrified
**Eye**. Most goblins think he's a bedtime story. He is not. (The **Hollow Idol** already
coughs up *Gork's First Fang* and *the Hollow Crown* — the myth is leaking into the
present.)

### The First Diggers & the Seal

The **Old Forest Ruins** were not built by goblins. An earlier people — the **First
Diggers** — mined too greedily, woke something in the deep, and **sealed it** at the
cost of their civilization, then vanished. Their `old_guardian`s still pace the halls,
still ask a password no living tongue remembers. They also, quietly, had **clank-magic**
— the Clank Age is a *rerun*, and the last folk who ran it are the ones who had to build
the Seal to survive it.

### The Star & the Below

The **meteor** on **Troll Ridge** is either **Gork's lost Eye** fallen home, or the
**Grub's egg** — nobody agrees, and both camps have died over it. What's certain: when it
struck, it **cracked the Seal.** Its metal is the finest in the world (`meteor_*` tier)
and its light draws pilgrims and warlords alike. A `meteor_sprite` — a star-spirit, or the
Eye's caretaker — guards the crater.

### The Gnaw *(the thing under everything)*

Beneath the mines, beneath the imps, in the deepest dark, is the word the First Diggers
only ever wrote **once**: the **Gnaw**. If the Great Grub is the appetite that *made* the
world by eating the void, the Gnaw is the appetite that **got left inside** and never
stopped. It doesn't want to conquer the spoil-heap. It wants to **finish the meal.** The
imps rising from the fissures are just its teeth coming in.

> **The shape of it all:** The Grub made the world. The First Diggers woke the Gnaw and
> sealed it. Gork beat it back once and left his regalia. The Star cracked the Seal. Now
> the Ore Rush is the Seal failing, the imps are marching, and the only goblin who
> understood any of it — Sprocket — followed the truth underground and didn't come back.

---

# PART II — THE FOUR QUEST LINES

One per flavor, so no two play alike. They share the spine above; each cracks a
different piece of it.

| # | Line | Flavor | Core skills / mechanics | Capstone reward |
|---|---|---|---|---|
| 1 | A Recipe for Grubtastrophe | **Quirky & fun** | Cooking, Fishing, Farming, Alchemy | Grubmaster cape + world Feast buff |
| 2 | The Clockwork Heresy | **Mystery** | Tinkering, investigation, mining | Ancient gadget + moral fork |
| 3 | The Eye of Gork | **Legendary** | Combat, three legendary bosses | Regalia of Gork set |
| 4 | The Hunger Below | **Epic** | War across all regions, world boss | Re-forge the Seal (world fork) |

---

## LINE 1 — *A Recipe for Grubtastrophe*  ·  **QUIRKY & FUN**

**Logline:** The **Goblin Festival** needs its legendary Grand Feast, and you're the only
goblin dumb enough to be voluntold as head chef. Every ingredient is a small disaster.

**Lore it cracks:** the Feast is secretly an **appeasement rite** — a well-fed Grub is a
sleeping Grub. Nail it and the whole (shared) world gets a buff. Botch it and you
personally offend a god. And *one Feast in a hundred, the Grub asks for **seconds*** —
the first tremor of Line 4.

**Vibe:** an OSRS "Recipe for Disaster"-style chain — each course is its own tiny
adventure abusing a different skill, with a comedic **taste-test fail-state** (the Chief
spits it out; retry, +funny) and a **rival celebrity chef** NPC sabotaging you.

**New content:** NPCs *Head Cook Blump* (giver), *Chef Vindaloo the Insufferable* (rival);
items *king_carp*, *titan_pumpkin*, *weaponized_bog_cheese*, *secret_broth*,
*grand_feast_platter*; reward *grubmaster_cape* (+cooking, cosmetic) & title.

### Quests

**Q1 · `feast_head_cook`** — "You're the Cook Now"
- Giver: `elder` @ (492,448) · Requires: `tutorial_first_scrap`
- Steps: `talk` Blump @ Market Square → `goto` the Festival Kitchen (Cooking Range,
  ~540,462) → `obtain` `cooking_range_permit` (talk chain). Comedy: nobody wants the job.
- Rewards: 40 gp, Cooking xp, unlock the feast board.

**Q2 · `feast_the_king_carp`** — "A Fish Worth a Fable"
- Giver: `shopkeeper_fishmonger` @ (547,455) · Requires: `feast_head_cook`
- Steps: `goto` Grublake Dock (645,440) → `talk` `crazed_fisher_gob` (he's the only one
  who's seen the one-eyed **King Carp**; he speaks in riddles) → `obtain` `king_carp`
  (special Fishing spot on Lake Island approach) → `talk` Blump.
- Rewards: Fishing xp, `king_carp`. New: `king_carp` item + a named fishing spot.

**Q3 · `feast_titan_pumpkin`** — "Big Veg, Bigger Problem"
- Giver: `shopkeeper_farming_shed` @ (485,499) · Requires: `feast_head_cook`
- Steps: `obtain` `giant_pumpkin_seed` → plant in Main Farmlands (goto 510,640) → wait
  (real-time farming) → `obtain` `titan_pumpkin` → `build` a cart to haul it
  (`minecart_axle` + `oak_beam`) → deliver. Comedy: it won't fit through the gate.
- Rewards: Farming + Construction xp, coins.

**Q4 · `feast_the_cheese`** — "The Cheese That Walks"
- Giver: Head Cook Blump @ Kitchen · Requires: `feast_head_cook`
- Steps: `goto` Bog of Grub edge (685,710) → `obtain` `bog_curd` (from a foul node) →
  `talk` the Witch-Goblin @ Mushroom Forest hut (250,800) to ferment it (Alchemy
  cauldron) → `obtain` `weaponized_bog_cheese` (so pungent it's flagged as a weapon).
- Rewards: Alchemy xp. Running gag: everyone in a 3-tile radius gags.

**Q5 · `feast_grubtastrophe`** — "Serve the Grub" *(finale)*
- Giver: Head Cook Blump · Requires: Q2 + Q3 + Q4
- Steps: `obtain` `secret_broth` (Vindaloo stole it — `kill`/`obtain` from him) →
  craft `grand_feast_platter` at the Cooking Range → `goto` the Festival plaza during a
  live **Goblin Festival** event → serve.
- **Fork:** perfect platter → world **Feast Blessing** buff; botched → the Grub grumbles
  (harmless debuff + funniest outro). Either way you're an accidental folk hero.
- Rewards: 250 gp, big Cooking xp, **`grubmaster_cape`** + "Grubmaster" title.
- **Seed for Line 4:** on a perfect serve, a stray line — *"…it's still hungry."*

---

## LINE 2 — *The Clockwork Heresy*  ·  **MYSTERY**

**Logline:** **Sprocket the Tinker** is gone. Cold workshop, half-burned notes, and a
last line not in his handwriting: *"it's not ore — it's a door, and it's already open."*

**Lore it cracks:** the **First Diggers had clank-magic too.** Sprocket found a still-
running **Ancient machine** deep below and it *invited him in.* The Clank Age is a rerun.
And the machine is wired to the **Seal** — the first hard proof of the Below (arms Line 4).

**Vibe:** true detective — a **case-board** you assemble from clues, **contradictory
witnesses**, a **cipher** decoded from torn journal pages, a **red herring** pointing at
the Red-Ears, and a real twist: Sprocket didn't vanish. He's alive, *changed*, and not
sure he wants rescuing.

**New content:** items `journal_page` ×5, `sprockets_cipher_wheel`, `resonance_probe`
(reward — pings hidden ruins on the world map, a lovely tie to the new map);
mob `ancient_automaton` (a *guardian*, not an aggressor); NPC state for Sprocket "below".

### Quests

**Q1 · `heresy_cold_workshop`** — "The Tinker's Gone"
- Giver: `elder` @ (492,448) · Requires: `sprocket_*` (his existing blackpowder quest)
- Steps: `goto` Sprocket's Workshop (near settlement) → `obtain` `journal_page` ×3 from
  the wreckage → `talk` `banker` & `shopkeeper_general_store` (witnesses — their stories
  *don't match*). Establish the case-board.
- Rewards: Tinkering xp; the mystery opens.

**Q2 · `heresy_the_cipher`** — "He Wrote It in Gears"
- Giver: self (journal) · Requires: `heresy_cold_workshop`
- Steps: `obtain` remaining `journal_page` ×2 (one pawned at the Captured Anvil black
  market — the **red herring** implicating the Red-Ears) → craft `sprockets_cipher_wheel`
  at the Workbench → `talk` the Exchange Merchant to decode a purchase trail.
- Rewards: coins, Tinkering xp. Reveals: Sprocket bought *rope, lamp oil, and a very long
  fuse* and went to the **Deep Mine Entrance** (640,170).

**Q3 · `heresy_the_descent`** — "Follow the Fuse"
- Giver: self · Requires: `heresy_the_cipher` · Level: Mining 20
- Steps: `goto` Deep Mine Entrance → `kill` `deep_cave_crawler` ×5 (clear the shaft) →
  `obtain` `ancient_gear` from `black_iron_crab` → `goto` a sealed door of First-Diggers
  make (new landmark in Deep Mines) that his fuse leads to.
- Rewards: Mining + Tinkering xp.

**Q4 · `heresy_the_machine`** — "It's Already Open" *(finale)*
- Giver: self · Requires: `heresy_the_descent`
- Steps: `goto` the **Hum** (the Ancient machine chamber) → `boss` `ancient_automaton`
  (cl ~40, *defends* Sprocket rather than attacking — beat it or solve its glyph) →
  `talk` **Sprocket, below** — alive, half-clockwork now, calling himself a *prophet of
  the Clank*.
- **Moral fork:** *haul him out* (he's rattled, grateful, back in his shop but haunted)
  **or** *let him stay* (he keeps decoding the machine and feeds you deeper secrets — and
  a hook straight into Line 4).
- Rewards: 200 gp, big Tinkering xp, **`resonance_probe`** (reveals hidden ruins/fissures
  on the world map), and the truth: the machine is a **Seal monitor**, and the needle is
  in the red.

---

## LINE 3 — *The Eye of Gork*  ·  **LEGENDARY**

**Logline:** A dying oracle swears Gork the First was real, the Below is real, and the
only thing that ever shut it was Gork's regalia — now scattered across the world's
deadliest corners. Go make a bedtime story true.

**Lore it cracks:** you **personally verify the founding myth.** Each relic recovered
rewrites a "legend" NPCs half-believed into confirmed history — and proves the **meteor
is literally Gork's petrified Eye**, which is why it's holy, why it's the best metal, and
why the Star's fall woke the Below.

**Vibe:** a **three-relic myth-hunt**, each a set-piece against an existing legendary boss,
each gated behind a trial and a stanza of the **Song of Gork** that unfurls as you go.
Reuses gear the game already has as loot, reframed as *regalia*.

**New content:** NPC *Oracle Mother Snerk* (giver); lore items `song_of_gork` ×3
(stanzas); set logic *Regalia of Gork* (Crown + Cleaver + Eye → set bonus + throne
cutscene). Existing reward tie-ins: `the_hollow_crown`, `warlords_cleaver`,
`starfall_longbow`, `gorks_first_fang`.

### Quests

**Q1 · `gork_the_oracle`** — "A Bedtime Story, Sworn True"
- Giver: Oracle Mother Snerk @ Old Ruin Chapel (245,150) · Requires: `the_hollow_idol`
  (you already hold `gorks_first_fang` — she recognizes it)
- Steps: `talk` Snerk → `obtain` `song_of_gork` stanza I (`ruin_wisp` drop) → `goto` the
  three shrine-points she names.
- Rewards: Prayer xp; the hunt is set.

**Q2 · `gork_the_crown`** — "The Crown in the Ruins"
- Requires: `gork_the_oracle` · Level: Defence 30
- Steps: `goto` Old Forest Ruins depths → `kill` `old_guardian` ×2 (answer their glyph or
  fight) → `boss`-flavored fight for the **Crown** → reframe existing `the_hollow_crown`
  as *Gork's Crown*.
- Rewards: `the_hollow_crown` (Regalia piece 1), Song stanza II.

**Q3 · `gork_the_cleaver`** — "The Pretender's Blade"
- Requires: `gork_the_oracle` · Level: Attack 45
- Steps: `goto` Rival Goblin Territory (850,825) → the **Red-Ear Warlord** claims to be
  Gork's *true heir* and wields the Cleaver → `kill` clan guards (`red_ear_captain`,
  `rival_goblin_brute`) → `boss` **Red-Ear Warlord** → take `warlords_cleaver` as *Gork's
  Cleaver* (Regalia piece 2).
- Rewards: `warlords_cleaver`, Song stanza III. **Woven thread:** this is the flashpoint
  that lights the Red-Ear war in Line 4.

**Q4 · `gork_the_eye`** — "The Eye That Fell" *(finale)*
- Requires: `gork_the_crown` + `gork_the_cleaver` · Level: Ranged 55 or Strength 60
- Steps: `goto` Troll Ridge crater (835,80) → survive the pilgrim-cult (talk/kill choice)
  → `boss` `meteor_sprite` (cl 78) → claim the **Eye** and unlock **meteor-tier forging**.
- Rewards: `starfall_longbow` (or Eye relic), the **Regalia of Gork** set completes →
  throne-room cutscene, transmog set, and the dread payoff: *the regalia is exactly what
  you'd need to shut the Below again… and the Below is about to open* (hands to Line 4).

---

## LINE 4 — *The Hunger Below*  ·  **EPIC**

**Logline:** The Seal fails. Imps don't raid anymore — they **march**, in ranks — and
beneath them the thing the First Diggers named once is waking: the **Gnaw**, the world's
hunger given a mouth.

**Lore it cracks:** the capstone. The Grub made the world; the Gnaw is the appetite left
inside it; and **every other line is a weapon here** — the Feast that kept it asleep, the
machine Sprocket woke, the regalia that can re-seal it.

**Vibe:** a **world-scale war** driven by the **Wandering Horde / Blood Moon** events —
fissures open across the map (great use of the new world map's live objective markers),
settlements need defending, and you must **broker an alliance with the Red-Ears** (who
else knows war?) — or watch them cut a deal with the Below. Climaxes in a descent through
a **new sub-region, the Riven Deep**, to the Gnaw: a multi-phase world-boss where your win
conditions are *spent* from the other three lines.

**New content:** region **The Riven Deep** (dungeon interior below the mines); mobs
`imp_warband` grunts, `imp_herald` (lieutenant), **`the_gnaw`** (multi-phase world boss);
faction reputation *Red-Ear Accord*; items `seal_ward` (built from First-Digger relics),
`gnaw_tooth` (capstone material).

### Quests

**Q1 · `below_the_first_fissure`** — "The Ground Coughs"
- Giver: `elder` @ (492,448) · Requires: `heresy_the_machine` **and** `gork_the_oracle`
  (you need both "the Seal is failing" proofs)
- Steps: during an **Ore Rush** event, `goto` a new fissure in Grubpit Quarry (455,285) →
  `kill` `quarry_imp` ×8 (now organized) → `obtain` `imp_iron_tag` (they wear rank-marks
  — someone's *drilling* them).
- Rewards: combat xp; the war begins.

**Q2 · `below_the_warbands`** — "They March in Ranks"
- Requires: `below_the_first_fissure`
- Steps: defend three settlements as fissures open (multi-region `kill` objectives keyed
  to **Wandering Horde**) → `build` `seal_ward` ×3 to cap lesser fissures (First-Digger
  relics + tinker charges — pulls Lines 2 & 3 materials).
- Rewards: coins, xp, reputation.

**Q3 · `below_the_red_ear_accord`** — "Enemy of My Enemy"
- Requires: `below_the_warbands` · Ties to `gork_the_cleaver`
- Steps: `goto` Rival Territory → `talk` the surviving Red-Ear leadership → a **fork**:
  broker the **Accord** (they fight beside you at the end) **or** they spurn you (harder
  finale, they raid your rear). Prove yourself via a joint `kill` sortie.
- Rewards: *Red-Ear Accord* reputation; alliance state persisted.

**Q4 · `below_the_riven_deep`** — "Down Where It Chews" *(finale)*
- Requires: Q2 + Q3 · Level: high combat · Strongly rewards finishing Lines 1–3
- Steps: `goto` the **Riven Deep** (new dungeon under Deep Mines) → fight down past
  `imp_herald` lieutenants → `boss` **The Gnaw** (multi-phase world boss). Phases consume
  your cross-line assets: the **Feast Blessing** (Line 1) blunts a starve-phase;
  **Sprocket's machine / resonance_probe** (Line 2) exposes its heart; the **Regalia of
  Gork** (Line 3) lets you strike the killing seal.
- **World fork:** **re-forge the Seal** (Ore Rush ends, the world calms, a monument rises)
  **or** you *can't hold it* (the map keeps a permanent scar; the Riven Deep stays open as
  endgame content).
- Rewards: top-tier legendary (e.g. `gnaw_slayer` weapon from `gnaw_tooth` + meteor bars),
  a world-state change, and the title **Seal-Warden of Gorkholm**.

---

# PART III — THE WEB

The four lines are separate to *play* but one story to *learn*. Each answers a question
another raises:

- **The Feast (1)** keeps the Below asleep → **The Heresy (2)** proves it's stirring →
  **The Eye (3)** finds the only thing that can shut it → **The Hunger (4)** spends all
  three to end it.
- **Recommended order & gating:** 1 (any time, low level) → 2 (mid, needs Sprocket's intro
  quest) → 3 (high, needs Hollow Idol done) → 4 (endgame, needs 2 **and** 3). Lines 1–3 are
  independently satisfying; 4 is the convergence.

**Woven threads (no extra quest lines — just recurring texture):**
- **The Red-Ear clan** is the human-scale antagonist across the whole bible: a pretender to
  Gork's legend (Line 3), a red-herring suspect (Line 2), and a rival-turned-maybe-ally
  (Line 4). Their `warlords_cleaver` is literally a stolen relic.
- **World events are the live triggers:** *Goblin Festival* → Line 1; *Ore Rush* → the Seal
  failing, Lines 2 & 4; *Wandering Horde / Blood Moon* → Line 4 war phases; *Merchant
  Caravan* → optional lore-vendor selling `song_of_gork` fragments.
- **Cross-line easter eggs:** the Feast's *"still hungry"* line; the cipher that spells the
  Gnaw; the oracle who references *"a clockwork prophet in the dark"*; Sprocket's machine
  that's revealed to be a **Seal monitor**.
- **Sprocket's fork echoes:** if you left him below in Line 2, he's your guide in Line 4's
  descent; if you pulled him out, he builds your `seal_ward`s from the surface.

---

# PART IV — NEW CONTENT MANIFEST

Everything the four lines need that doesn't exist yet, consolidated for batch authoring.

**New NPCs:** Head Cook Blump, Chef Vindaloo (L1); Sprocket-"below" state (L2); Oracle
Mother Snerk (L3); Red-Ear leadership speaker (L4).

**New regions / interiors:** the **Hum** (Ancient machine chamber, Deep Mines, L2); the
**Riven Deep** (dungeon below Deep Mines, L4); a First-Diggers **sealed door** landmark.

**New creatures** (`monsters.json`): `ancient_automaton` (cl ~40, guardian, L2);
`imp_warband` grunt tiers + `imp_herald` lieutenant (L4); **`the_gnaw`** multi-phase world
boss (L4). *(Reuses existing: `quarry_imp`, `deep_cave_crawler`, `black_iron_crab`,
`old_guardian`, `ruin_wisp`, `meteor_sprite`, `red_ear_*`, `crazed_fisher_gob`.)*

**New items** (`items.json` / `questItems.js`):
- L1: `king_carp`, `giant_pumpkin_seed`, `titan_pumpkin`, `bog_curd`,
  `weaponized_bog_cheese`, `secret_broth`, `grand_feast_platter`, `grubmaster_cape`.
- L2: `journal_page`, `sprockets_cipher_wheel`, `ancient_gear`, `resonance_probe`.
- L3: `song_of_gork` (×3 stanzas), *Regalia of Gork* set logic over `the_hollow_crown` +
  `warlords_cleaver` + Eye/`starfall_longbow`.
- L4: `imp_iron_tag`, `seal_ward`, `gnaw_tooth`, `gnaw_slayer`.

**Systems touchpoints (all data, no engine work):** farming real-time growth (exists),
Alchemy cauldron fermenting (exists), Tinkering build-recipes (exists), boss steps
(exists), world-event gating on quest availability (exists), world map objective markers
(exists — the new `worldMap.js`).

**Validator note:** every new quest must pass `node scripts/quest_test.mjs` (it simulates
each quest start→finish headlessly). Every new item must stay sourced-and-consumed for
`node scripts/chain_audit.mjs`. New mobs auto-become Slayer contracts (`contracts.js`
reads `monsters.json`).

---

# APPENDIX — QUICK REFERENCE

**Region anchors** (`worldData.js REGION_ANCHORS`): settlement/Goblin Settlement
(500,455); choppers/Chopper's Hollow (335,370); willow/Willow Riverlands (285,610);
mushroom/Mushroom Forest (250,800); grubpit/Grubpit Quarry (455,285); minehills/Northern
Mine Hills (610,190); troll/Troll Ridge (835,80); grublake/Grublake (735,495);
oakwoods/Eastern Oakwoods (820,330); farmlands/Main Farmlands (510,640); bog/Bog of Grub
(685,710); rival/Rival Goblin Territory (850,825); ruins/Old Forest Ruins (245,150).

**Landmarks** (`worldData.js LANDMARKS`): Bank (485,455); Town Furnace (515,465); Town
Anvil (525,465); Training Yard (515,485); Deep Mine Entrance (640,170); Swamp Shrine
(725,775); Witch-Goblin Hut (250,800); Captured Anvil (840,810); Troll Ridge Gate
(800,120); Old Ruin Chapel (245,150); Grublake Dock (645,440); Lake Island (745,520).

**Key existing NPCs:** `elder` (Goblin Elder, 492,448); `sprocket` (Sprocket the Tinker,
near settlement); `banker`; Exchange Merchant; Sergeant Grimjaw; shopkeeper_* (fishmonger
547,455 · weapon_shop 476,412 · general_store 499,501 · grocer 471,499 · farming_shed
485,499 · miner_camp 606,206).

**Legendary bosses & unique rewards already in-game** (reuse as loot): Grukk the Hollow →
`gorks_first_fang`, `the_hollow_crown`, `hollow_idol_shard`; Red-Ear Warlord →
`warlords_cleaver`; Meteor Sprite → `starfall_longbow`; Bog King → `bog_king_heart`,
`grubmaw_maul`; Rockjaw → `rockjaw_pick`; The Pale Priest → `pale_veil`.

**Meteor tier** (top materials, Line 3/4 rewards): `meteor_ore`→`meteor_bar`,
`meteor_bloom`, `meteor_diamond`, plus full `meteor_*` tool/weapon/armor set.

**Construction / build items** (Line 1 & 4 build steps): `bronze_nails`, `iron_nails`,
`steel_nails`, `oak_beam`, `willow_rope_bridge_kit`, `minecart_axle`,
`swamp_boardwalk_kit`.

*— End of bible. Pick a line, author its quests as data, run the gates, ship it.*
