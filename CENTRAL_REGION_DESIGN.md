# Gorkholm — Central Region Design (the Goblin Settlement, made coherent)

Design spine for rebuilding the central town from a sparse cluster of huts into a
**believable goblin keep-town where nothing is placed at random**. Every district
sits at the gate facing the road that supplies it. Authored by the economy lane
as a shared blueprint; the physical tile build lives in world-gen's
`src/world/map.js` PASS 3 (`buildTown()`), the economy fixtures in `src/data/shops.json`.

Town footprint: bounds **450,405 → 555,510**, centre **500,455**, player spawn ~500,462.

---

## The narrative

**Gorkholm** began as a defensive warren at the great crossroads — the one place
every road in the goblin lands meets. Grubs dragged in salvage, ore, timber, and
fish from the four roads, and the camp hardened into a walled keep. The Chief rules
from the stone hall at the heart; the tribe crowds the alleys around the square;
and each of the four **gate-wards** grew up around the trade that came through its
gate. It is cramped, scavenged, and alive — not a grid of identical huts.

## The organizing rule (why nothing is random)

Roads out of Gorkholm (from `worldData.js ROADS`), and what each carries:

| Gate | Road → source | Ward | Fixtures (placed here because the goods arrive here) |
|------|---------------|------|------|
| **N** | quarry → mines → troll ridge (**ore/metal**) | **Forge Ward** | Furnace, Anvil, Smith, Weapon Shop, Armour Shop, Miner's Supply |
| **E** | Grublake dock → lake → oakwoods (**water/fish**) | **The Wharf** | Fishing Shack, Cooking Range, Fishmonger, Bait & Tackle |
| **S** | farmlands → bog (**crops/food**) | **Greengate** | Farming Shed, Grocer (General Store), Herbalist/Witch stall |
| **W** | Chopper's Hollow → willow (**timber**) | **Timber Row** | Sawmill, Crafting Bench, Fletcher, Lumber stall |
| **Centre** | the crossroads itself (**power & trade**) | **The Keep + Market Square** | Chief's Hall (multi-room keep), Bank, Quest Board, Grand Exchange, Fountain plaza, Market stalls, Inn |

## Physical features to build (map.js buildTown)

1. **The Keep (centre-north of the square).** The Chief's Hall becomes a small
   **walled keep with 3 interior rooms**: the hall (Chief + Quest Board), the vault
   (Bank — guarded, reached through the hall), and a side chamber. Its own inner
   wall with a single gate onto the square. Goblins guard their loot behind stone.
2. **Fountain plaza (the square).** A central **fountain** (WATER tiles ringed by
   FLOOR + decor rim) on the FLOOR square where the two avenues cross — the tribe's
   prized water. Market stalls and the GE merchant ring it.
3. **Four gate-wards.** Cluster each ward's buildings just inside its themed gate
   (table above), fronting the avenue that leads to that gate, so a player walking
   in from the mines lands in the Forge Ward, etc.
4. **The Warren (back alleys).** Fill the ward gaps with **cramped goblin housing +
   narrow 1-tile DIRT alleys** threading between buildings — passages, not open
   lawn. This is what kills the "sparse and boring" feel.
5. **Walls & gatehouses.** Keep the perimeter wall; make each of the 4 gates a
   proper **gatehouse** (short wall towers flanking the road gap). Add a few inner
   wall segments to define ward edges and alley walls.
6. **Green touches.** Scatter **trees, shrubs, and a couple of small fountains/wells**
   through the plaza and ward corners so it reads as lived-in, not paved.

## Economy tie-in (shops.json, economy lane)

Each ward's shop stocks what its road supplies — a fishmonger by the water, a
herbalist by the farms, a fletcher by the lumber. New/retuned shops: `fishmonger`,
`bait_tackle` (Wharf), `grocer` (Greengate), `fletcher`, `lumber_stall` (Timber Row),
`tavern` (Inn). Existing `weapon_shop`/`armour_shop`/`miner_camp` → Forge Ward.

## Build order

1. ✅ This doc (the spine).
2. Economy content — themed shops per ward (`shops.json`).
3. Physical build in `map.js buildTown()` — keep rooms → fountain → wards → warren
   alleys → gatehouses → greenery. Coordinate with world-gen (their file).
4. Verify in-browser (spawn is inside the town — a load screenshot shows it).
