# World Bible — the north star

*The guiding philosophy for building a living RPG world. It governs future quests,
regions, peoples, NPCs, mysteries, and stories. This doc is prose for humans — it is
not referenced by code. Its **principles are enforced** by `scripts/world_coherence.mjs`
(a gate in the chain) and its **canon lives as data** in `src/data/peoples.json`,
`regions.json`, `npcs.json`, `lore.json`, `mysteries.json`. Write lore into the canon
files, not inline into quest prose — one source of truth, or regions start to contradict.*

## A living world, not a story
The world does not exist to tell the player a story. It exists independently of the
player — people have jobs, rivalries, festivals, traditions, myths, and problems whether
the player shows up or not. The player is just an adventurer who keeps stumbling into
increasingly ridiculous situations by choosing to help. **The player's identity is
intentionally undefined** so every player can project themselves into the world.

## The 30 / 70 rule  *(enforced: `thread` ratio)*
~30% of quests connect to the larger mysteries or main narrative. The other ~70% simply
make the world feel alive — local conflicts, festivals, strange creatures, absurd
inventions, sporting events, everyday life, memorable side adventures. Tag each quest
`thread: main | local`; the gate holds the ratio.

## Every region needs an identity  *(enforced: region-identity completeness)*
Players should remember places for their **culture before their monsters** — traditions,
architecture, food, folklore, professions, festivals, humor, visual identity. Every
`REGION_ANCHOR` gets a full record in `regions.json`.

## Cultures before races  *(enforced: every people has a `worldview`)*
New peoples exist to introduce a unique **worldview**, not to fill a fantasy checklist.

## Background mysteries & the Rule of Wonder  *(enforced: mysteries stay unanswered)*
Not every mystery needs an answer. Strange landmarks, impossible places, and unexplained
phenomena should exist simply because they inspire wonder. If something *immediately*
needs an explanation, it was probably over-explained. If players wonder about it for
years, it belongs. Some mysteries carry `answered: never` — forever.

## Ancient civilizations, discovered not narrated
History is found through **ruins, not exposition**. Dwarves never appear directly, but
their abandoned engineering — mines, elevators, machines, pumps, stoneworks — constantly
reminds players that powerful civilizations came before.

## Campfire stories  *(canon: `lore.json`, tagged `true | exaggerated | nonsense`)*
Every settlement has stories, legends, rumors, ghost tales. Some true, some exaggerated,
some complete nonsense. Players should never immediately know which is which.

## Recurring characters  *(canon: `npcs.json`, appear in ≥2 regions)*
NPCs reappear across the world, growing alongside the player, building long-term
familiarity.

## Long-term design principles
- Build a **World Bible before a Story Bible**.
- **Every quest should teach the player something about the world** *(enforced: `teaches`)*.
- Reward curiosity as much as combat.
- Hide environmental storytelling everywhere.
- Mix heartfelt moments with absurd humor.
- Let players speculate instead of answering every mystery.
- Make revisiting old places rewarding through recurring NPCs and evolving events.

---

## Suggested peoples  *(seeded in `peoples.json`; `status: active` = in the game today)*
| People | Worldview (one line) |
|---|---|
| **Goblins** | Inventive, optimistic tinkerers who turn everyday life into adventure. |
| Ember Imps | Friendly, enthusiastic, and accidentally set everything on fire. |
| Forest Sprites | Tiny caretakers of old forests who treat nature like family. |
| Moss Folk | Grow moss instead of hair, sleep for years, think everyone else is impatient. |
| Boglings | Amphibious collectors who treasure polished junk and consider rust sacred. |
| Pebblers | Living stone beings who speak slowly and measure time in seasons. |
| Lantern Moths | Nocturnal mothfolk who navigate by stars and find darkness comforting. |
| Root Keepers | Grow homes instead of building them; negotiate with forests rather than cut them. |

## Biome culture seeds  *(fold into `regions.json` identity)*
- **Marshes** → `bog` / `willow`: snail racing, lucky-frog traditions, bogling traders, ancient dwarf pumps.
- **Mushroom Forest** → `mushroom`: fashion capital, the Great Cap Festival, mushrooms believed to record memories.
- **Ash Hills** *(future biome)*: natural hot stones for cooking, volcanic-glass jewelry, playful ember imps.
