# Task Hopper — Board

*Human-readable view of `HOPPER.jsonl`. The curator keeps this in sync with the feed.
Last curated: 2026-07-03.*

**Counts:** 3 total · inbox 3 · ready 0 · picked 0 · done 0 · parked 0
**Overnight-ready right now (status `ready` + `overnight-safe`):** 0 — awaiting owner triage / new items.

> The three rows below are **seed examples** drawn from this session's own follow-ups,
> filed at `status: inbox` to demonstrate the schema end-to-end. They are safe to
> prune. Real items land as the owner voices them.

## Open

| id | title | kind | eligibility | P | effort | area / lane | status |
|---|---|---|---|---|---|---|---|
| GH-0001 | Replace run-energy weight heuristic with real per-item weight | audit | needs-strong-model | P3 | M | items / economy | inbox |
| GH-0002 | Trim wall-brick terrain detail to recover keep-view fps | perf | needs-strong-model | P2 | S | render / world-gen | inbox |
| GH-0003 | Add more discoverable Alchemy tonic recipes | content | review-then-overnight | P3 | S | content / economy | inbox |

## Done / parked

*(none yet)*

---

### Legend

- **kind** — `fix · tune · content · copy · art · audit · research · design-spike · perf · chore`
- **eligibility (routing)** — `overnight-safe` (Forge may auto-run) · `review-then-overnight` (owner decides, then it's overnight-safe) · `needs-strong-model` (engine/scene/render) · `needs-owner` (geo2 / server / save / policy)
- **P** — P0 live-broken/blocking · P1 important · P2 normal · P3 someday
- **status** — `inbox → triaged → ready → picked → done | parked | wontfix`

The overnight runner picks only **`status: ready` + `eligibility: overnight-safe`**,
highest priority first. Everything else waits for a human. Full schema, guardrails,
and the curator/runner protocols are in [README.md](README.md).
