# Task Hopper — Board

*Human-readable view of `HOPPER.jsonl`. The curator keeps this in sync with the feed.
Last curated: 2026-07-03.*

**Totals:** 17 · **owner-raised 7** · agent/auto-raised 10 · (gate-raised 0)
**By status:** inbox 17 · ready 0 · picked 0 · done 0 · parked 0
**Overnight-ready now (`ready` + `overnight-safe`):** 0

> **Avatar art overhaul (GH-0010 → GH-0017)** is filed as one program: a code enabler
> (GH-0010), a style kit (GH-0011), the owner's **pilot** (GH-0012, 6 assets), then the
> art batches. None are `overnight-safe` — asset generation is a manual/AI pipeline and
> the render wiring needs a strong model.

> **Owner-raised items always list first, in their own section, and are never outranked
> by agent/auto items of equal priority.** Agent/gate items stay `inbox` until you
> triage one to `ready` — so the auto pile can grow without ever crowding your live
> overnight queue.

---

## 🧑 Owner-raised

| id | title | kind | eligibility | P | effort | area / lane | status |
|---|---|---|---|---|---|---|---|
| GH-0006 | Players don't see the same monsters (mobs aren't shared) | design-spike | needs-owner | P1 | L | server / ops | inbox |
| GH-0012 | PILOT — 6 high-impact avatar assets for the first manual test | art | needs-owner | P1 | S | render / character-render | inbox |
| GH-0004 | Click-to-pick-up doesn't auto-walk to the ground item | fix | needs-strong-model | P1 | S | net / shared | inbox |
| GH-0005 | Remote players lag/snap + clip through walls | fix | needs-strong-model | P2 | M | net / shared | inbox |
| GH-0008 | Night tint only covers the game view, not the whole screen | design-spike | needs-strong-model | P2 | S | render / shared | inbox |
| GH-0009 | Minimap: many unclear arrows → keep one tracked-quest arrow | fix | needs-strong-model | P2 | S | ui / shared | inbox |
| GH-0007 | Right-click a monster to view its drop table | content | needs-strong-model | P3 | M | ui / shared | inbox |

---

## 🤖 Agent / auto-raised

> Seed examples from this session's own follow-ups, filed `inbox` to demonstrate the
> schema. Safe to prune. These do **not** compete with owner items for attention.

| id | title | kind | eligibility | P | effort | area / lane | source | status |
|---|---|---|---|---|---|---|---|---|
| GH-0001 | Replace run-energy weight heuristic with real per-item weight | audit | needs-strong-model | P3 | M | items / economy | agent | inbox |
| GH-0002 | Trim wall-brick terrain detail to recover keep-view fps | perf | needs-strong-model | P2 | S | render / world-gen | agent | inbox |
| GH-0003 | Add more discoverable Alchemy tonic recipes | content | review-then-overnight | P3 | S | content / economy | agent | inbox |

**Avatar art overhaul** (character-render lane · none overnight-safe):

| id | title | kind | eligibility | P | effort | area / lane | source | status |
|---|---|---|---|---|---|---|---|---|
| GH-0010 | Scaffold avatar art-mode loader + PNG manifest + pivot schema | chore | needs-strong-model | P2 | M | render / character-render | agent | inbox |
| GH-0011 | Avatar art STYLE KIT — palette, ref sheet, projection + pivot schema | art | needs-owner | P2 | M | render / character-render | agent | inbox |
| GH-0013 | Full player body part set (all parts × 3 facings) | art | needs-owner | P2 | M | render / character-render | agent | inbox |
| GH-0014 | Weapon set (tinted base shapes + hero uniques) | art | needs-owner | P2 | L | render / character-render | agent | inbox |
| GH-0015 | Armour overlays (helm/body/legs/shield/cape × 3 facings) | art | needs-owner | P2 | L | render / character-render | agent | inbox |
| GH-0016 | FX/juice pack (swing trails, impacts, skill particles) | art | needs-owner | P2 | M | render / character-render | agent | inbox |
| GH-0017 | Bestiary (5 silhouette rigs + features + boss uniques) | art | needs-owner | P3 | L | render / character-render | agent | inbox |

> Dependency spine: **GH-0010 (loader)** + **GH-0011 (style kit)** → **GH-0012 (pilot)** → GH-0013 → GH-0014/0015; GH-0016 needs only the loader; GH-0017 is the long tail.

---

## Done / parked

*(none yet)*

---

### Legend

- **source** — `owner` (a human voiced it) · `agent` (an AI noticed/derived it) · `gate` (a validator surfaced it). Owner items are prioritized on ties and never buried.
- **kind** — `fix · tune · content · copy · art · audit · research · design-spike · perf · chore`
- **eligibility (routing)** — `overnight-safe` (Forge may auto-run) · `review-then-overnight` (owner decides, then overnight-safe) · `needs-strong-model` (engine/scene/render) · `needs-owner` (geo2 / server / save / policy)
- **P** — P0 live-broken/blocking · P1 important · P2 normal · P3 someday
- **status** — `inbox → triaged → ready → picked → done | parked | wontfix`

The overnight runner picks only **`ready` + `overnight-safe`**, highest priority first,
ties toward `owner`. Full schema, guardrails, provenance rule, and protocols are in
[README.md](README.md).
