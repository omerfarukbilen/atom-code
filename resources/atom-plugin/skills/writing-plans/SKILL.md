---
name: writing-plans
description: Produce a written implementation plan before touching code - goal, success criteria, constraints, investigation notes, file-by-file change list, small ordered steps each with a verification command, risks, test plan and rollout. Use when a task spans several files or steps, requirements are ambiguous, the change is risky (data, auth, public APIs, migrations), the user asks for a plan, design or approach first, or the agent is in plan mode. Includes how to ask clarifying questions with AskUserQuestion. Skip for small, obvious fixes.
---

# Writing Plans

A plan is cheap to change; code is not. Writing the plan first forces you to investigate before you build,
surfaces assumptions while the user can still correct them, and breaks the work into steps small enough to
verify one at a time. The approved plan becomes the contract that `atom:executing-plans` follows.

## When to use

- The work touches several files, modules or layers, or will take more than a handful of edits.
- Requirements are ambiguous, or there are real design choices with trade-offs.
- The change is risky: data models and migrations, authentication/authorization, public APIs, payments,
  concurrency, deletion of anything.
- The user asks for a plan, an approach, a design, or "think before you code".
- The session is in plan mode (read-only until the plan is approved).

## When not to use

- A small, obvious change (rename, one-line fix, copy tweak). Just do it and verify.
- Pure investigation questions ("how does auth work here?") — answer them; no plan needed.
- Debugging an unknown failure — use `atom:systematic-debugging` first; plan the fix once the cause is known.

Scale the plan to the risk. A 40-line plan for a two-file change is noise; a five-line plan for a schema
migration is negligence.

## Process

### 1. Restate the goal

Write the goal in two or three sentences from the user's point of view, followed by **success criteria** —
observable statements that will be true when you are done ("an owner can download all orders as CSV within
10 s for 50k orders"; "existing `/orders` responses are unchanged"). If you cannot write success criteria,
you do not understand the task yet: investigate or ask.

### 2. Investigate (read-only)

Plans built on assumptions about the code fail on contact. Before deciding anything:

- **Map the area.** Glob and Grep for the relevant modules, entry points, and names from the request. Read the
  files you expect to change, and the tests around them.
- **Find the precedent.** Is there an existing feature that does something similar (another export, another
  endpoint, another migration)? Following it is usually the right call and keeps the codebase consistent.
- **Know the rules.** Read `ATOM.md` / `CLAUDE.md` / `CONTRIBUTING.md`, lint and test configs, CI workflows.
- **Check history.** `git log --oneline -20 -- path/` shows recent work and conventions; `git log -S 'symbol'`
  finds when something was introduced.
- **Check versions before relying on an API.** Look up the installed version in the lockfile
  (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `go.sum`, `Cargo.lock`), then read the docs for that
  version (WebFetch) or the package source in `node_modules` / site-packages.
- **Delegate broad exploration.** For "where is X handled across the codebase", send an `atom:explorer` subagent
  via the Agent tool so your own context stays focused; ask it for `path:line` references.

Record what you learn as **investigation notes** with `path:line` citations. They justify the plan and save the
executor from re-discovering everything.

### 3. Ask the questions that change the plan

Ask only questions whose answers would change what you build — scope, behaviour, trade-offs, constraints you
cannot discover from the code. Never ask what you can find out by reading the repository.

Use AskUserQuestion for decisions with discrete options:

- Up to four questions per call; batch related decisions instead of asking one at a time.
- Each question gets a short `header` (a chip label of at most 12 characters) and two to four options, each with
  a `label` and a `description` that states the trade-off.
- Put your recommendation first and append "(Recommended)" to its label.
- Use `multiSelect: true` only when choices are not mutually exclusive.
- Do not add an "Other" option — the user can always type a free-form answer.

```json
{
  "questions": [
    {
      "question": "Where should generated CSV exports live?",
      "header": "Storage",
      "multiSelect": false,
      "options": [
        { "label": "Uploads bucket (Recommended)", "description": "Reuses the S3 bucket and signed-URL helper in src/lib/storage.ts; files expire after 24 h." },
        { "label": "Stream response", "description": "No storage needed, but exports over ~30 s will hit the load balancer timeout." },
        { "label": "Local disk", "description": "Simplest, but breaks with more than one app instance." }
      ]
    },
    {
      "question": "Which columns should the export include?",
      "header": "Columns",
      "multiSelect": true,
      "options": [
        { "label": "Order basics", "description": "id, date, status, total" },
        { "label": "Customer", "description": "name and email (PII — export is limited to account owners)" },
        { "label": "Line items", "description": "one row per item instead of per order" }
      ]
    }
  ]
}
```

If a decision is low-risk and easy to reverse, do not block on it: pick the sensible default and list it under
**Assumptions** in the plan so the user can veto it during review.

### 4. Choose an approach

Sketch two or three viable approaches in a sentence or two each, then pick one and say why (consistency with
existing code, risk, effort, reversibility). Recording the rejected alternatives prevents re-litigating them
later and shows the user you considered their likely objection.

### 5. List changes file by file

For each file: create / modify / delete, and what changes in one line. Verify every path you list with Glob —
invented paths are the most common planning error. Include tests, migrations, config, docs and fixtures, not
just source files.

### 6. Break the work into ordered steps

Each step should be:

- **Small** — roughly one commit; one coherent change you could review in a few minutes.
- **Verifiable** — it names the command or check that proves it works (a test, typecheck, a curl, a screenshot).
- **Safe to stop after** — the build and tests stay green, so the work can pause between any two steps.

Order steps so every intermediate state works: types and schemas before implementations, implementations before
callers, new paths before removal of old ones (expand → migrate → contract), tests alongside each step rather
than all at the end.

```
Bad
1. Implement the export feature
2. Write tests
3. Fix any issues

Good
3. Add `toCsvRow(fields: string[]): string` with RFC 4180 quoting in src/lib/csv.ts.
   Verify: npx vitest run src/lib/csv.test.ts — new cases for commas, quotes, newlines, unicode.
4. Add GET /api/orders/export in src/api/orders/export.ts; exports only the session user's orders.
   Verify: route test returns 200 text/csv for the owner and 403 for another user.
```

### 7. Risks, test plan, rollout

- **Risks** — what could go wrong, how likely, and the mitigation (feature flag, batch size, backup, extra test).
- **Test plan** — unit, integration and manual checks, with commands. Name the edge cases explicitly.
- **Rollout** — migrations and their order relative to the deploy, feature flags, backwards compatibility,
  docs/changelog, and how to roll back.

Pull in the specialised skill for the risky parts rather than improvising: schema changes and backfills follow
`atom:database-migrations` (expand/contract across deploys), endpoint and schema changes `atom:api-design`,
anything touching auth, input handling or secrets the threat-model step of `atom:security-audit`.

### 8. Present for approval

- In plan mode, present the finished plan with ExitPlanMode (follow the plan-mode instructions in your context
  for where the plan text goes). The user approves, edits or rejects it — do not start editing files before that.
- Outside plan mode, post the plan in the chat and wait for a go-ahead before making changes.
- Save it as a file only when the user asks or the repository has a convention for plans (for example a
  `docs/plans/` directory); otherwise the chat is the right place.
- Lead with a three-line summary (goal, approach, size/risk) so the user can approve quickly, then the details.

Use the full template at [templates/plan.md](templates/plan.md). Skeleton:

```markdown
# Plan: CSV export for orders
**Goal** … **Success criteria** …
**Investigation notes** (path:line) … **Constraints & assumptions** … **Out of scope** …
**Approach** (chosen + alternatives) … **Changes by file** …
**Steps** (each with Verify) … **Risks** … **Test plan** … **Rollout & rollback** … **Open questions** …
```

## Pitfalls

- **Planning without reading.** Plans that guess at structure ("probably in `services/`") fall apart in the
  first step. Investigate first; cite `path:line`.
- **Steps that are really projects.** "Implement the backend" is not a step. If you cannot name its
  verification command, split it.
- **Verification deferred to the end.** A plan whose only test step is last guarantees a painful debugging
  session. Verify per step.
- **Hidden assumptions.** Anything you decided without the user (library choice, behaviour on edge cases)
  belongs in Assumptions, visibly.
- **Ignoring existing patterns.** A new way to do something the codebase already does needs a reason.
- **Gold-plating.** Extra abstraction, configuration and "while we're here" refactors inflate risk. List them as
  optional follow-ups instead.
- **No out-of-scope list.** Without one, scope silently grows during execution.

## Definition of done

- [ ] Goal and observable success criteria are stated.
- [ ] Investigation notes cite real `path:line` locations; every file path in the plan was verified with Glob.
- [ ] Questions that change the plan were asked (or defaults recorded as assumptions).
- [ ] The chosen approach is justified against at least one alternative (for non-trivial work).
- [ ] Steps are small, ordered so every intermediate state works, and each has a verification.
- [ ] Risks, test plan and rollout/rollback are covered in proportion to the change's risk.
- [ ] The plan was presented for approval (ExitPlanMode in plan mode) and no code was changed before approval.
