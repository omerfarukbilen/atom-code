# Plan: [short title]

> **Summary** — [one line: what changes] · **Approach:** [one line] · **Size/risk:** [e.g. ~6 files, medium —
> touches the orders table]

Delete any section that does not apply, and keep each one as short as the change allows. Bracketed text is
guidance; replace it.

## Goal

[Two or three sentences from the user's point of view: what they will be able to do, and why it matters.]

### Success criteria

- [Observable statement that will be true when done — behaviour, performance, compatibility]
- [Existing behaviour that must remain unchanged]

## Investigation notes

[What exists today, with `path:line` citations. Precedents to follow. Surprises found while reading.]

- `src/api/orders/index.ts:12` — [existing route registration pattern]
- `src/lib/storage.ts:40` — [signed URL helper to reuse]
- [Installed versions that matter, e.g. "zod 4.1 (package-lock.json) — use `z.iso.datetime()`"]

## Constraints and assumptions

- **Constraint:** [hard requirement — compatibility, performance budget, deadline, platform, policy]
- **Assumption:** [decision made without the user; low-risk and reversible — veto here]

## Out of scope

- [Related work deliberately not done now — candidate follow-ups]

## Approach

**Chosen:** [the approach in a few sentences]

**Alternatives considered:**
- [Alternative A] — rejected because [reason]
- [Alternative B] — rejected because [reason]

## Changes by file

| File | Action | Change |
|---|---|---|
| `src/lib/csv.ts` | modify | [add `toCsvRow` with RFC 4180 quoting] |
| `src/lib/csv.test.ts` | create | [quoting edge cases] |
| `src/api/orders/export.ts` | create | [export endpoint] |
| `migrations/20261014_add_exports.sql` | create | [exports table] |
| `docs/api.md` | modify | [document the endpoint] |

## Steps

Each step leaves the build and tests green and names how it is verified.

1. **[Step title]** — [what changes, in which files]
   - Verify: `[command]` — [expected result]
2. **[Step title]** — [...]
   - Verify: `[command]` — [expected result]
3. **Checkpoint** — [pause and report to the user before an irreversible or high-risk step, if any]
4. **[Step title]** — [...]
   - Verify: `[command]` — [expected result]
5. **Final verification** — full test suite, typecheck, lint, build; review `git diff --stat` against this plan.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| [e.g. export of 500k rows exceeds memory] | medium | high | [stream rows in batches of 1,000; load test with seeded data] |
| [e.g. migration locks the orders table] | low | high | [create index concurrently; run off-peak] |

## Test plan

- **Unit:** [functions and edge cases — name them]
- **Integration:** [routes/jobs/DB interactions — name them]
- **Manual:** [steps a human (or the agent) runs to see it working]
- **Commands:** `[test command]`, `[typecheck command]`, `[lint command]`

## Rollout and rollback

- **Order of operations:** [migration before/after deploy; backfill; flag flip]
- **Feature flag:** [name, default, who enables]
- **Compatibility:** [old clients, old data, mixed-version deploys]
- **Docs/changelog:** [what to update]
- **Rollback:** [how to undo safely — revert, flag off, down migration, data repair]

## Open questions

- [Question that does not block starting but must be answered before step N]
