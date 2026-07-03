# Task Hopper — Board

*Human-readable view of `HOPPER.jsonl`. The curator keeps this in sync with the feed.
Last curated: 2026-07-03.*

**Totals:** 3 · **owner-raised 0** · agent/auto-raised 3 · (gate-raised 0)
**By status:** inbox 3 · ready 0 · picked 0 · done 0 · parked 0
**Overnight-ready now (`ready` + `overnight-safe`):** 0

> **Owner-raised items always list first, in their own section, and are never outranked
> by agent/auto items of equal priority.** Agent/gate items stay `inbox` until you
> triage one to `ready` — so the auto pile can grow without ever crowding your live
> overnight queue.

---

## 🧑 Owner-raised

*(none yet — send me feedback and it lands here, at the top)*

| id | title | kind | eligibility | P | effort | area / lane | status |
|---|---|---|---|---|---|---|---|

---

## 🤖 Agent / auto-raised

> Seed examples from this session's own follow-ups, filed `inbox` to demonstrate the
> schema. Safe to prune. These do **not** compete with owner items for attention.

| id | title | kind | eligibility | P | effort | area / lane | source | status |
|---|---|---|---|---|---|---|---|---|
| GH-0001 | Replace run-energy weight heuristic with real per-item weight | audit | needs-strong-model | P3 | M | items / economy | agent | inbox |
| GH-0002 | Trim wall-brick terrain detail to recover keep-view fps | perf | needs-strong-model | P2 | S | render / world-gen | agent | inbox |
| GH-0003 | Add more discoverable Alchemy tonic recipes | content | review-then-overnight | P3 | S | content / economy | agent | inbox |

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
