---
description: Produce a step-by-step implementation plan for a feature or change without editing anything - ends with risks and open questions
argument-hint: "[feature, change or problem to plan]"
---

Produce an implementation plan. Do not modify files or run state-changing commands while planning - the plan
is for the user to approve before any code changes. Follow the `atom:writing-plans` skill (load it with the
Skill tool; its `templates/plan.md` is the full template).

What to plan: $ARGUMENTS

If the request above is empty, use the current selection or open editor (`mcp__atom-ide__get_selection`,
`mcp__atom-ide__get_open_editors`) as context and ask what the user wants to achieve with AskUserQuestion.

## 1. Restate the goal

One or two sentences, plus observable success criteria ("an admin can export orders as CSV; files with 100k
rows download in under 10 s"). If you cannot write success criteria, that is the first question to ask.

## 2. Investigate (read-only)

- Find where the change lands and the closest existing feature that solves a similar problem - reuse its
  patterns. For broad reconnaissance, delegate to the `atom:explorer` subagent with the Agent tool.
- Read the code you will change and its tests. Trace the callers of anything whose contract may change.
- Read project rules (`ATOM.md`, `CLAUDE.md`, `CONTRIBUTING.md`) and the commands used to test and build.
- Check installed versions of libraries you will rely on, and their docs for that version (WebFetch) when
  behaviour matters.
- Record findings as `path:line`. Verify every path you put in the plan with Glob - plans built on guessed
  paths fall apart in the first step.

## 3. Ask the questions that change the plan

Use AskUserQuestion for decisions you cannot infer and that would change the design (behaviour on edge cases,
compatibility requirements, which of two valid approaches the team prefers). Offer concrete options with your
recommendation first. Do not ask about things you can find in the code. For everything else, choose a sensible
default and list it under Assumptions.

## 4. Choose the approach

For non-trivial work, compare the chosen approach with at least one real alternative in a few lines (fit with
the codebase, size, risk, reversibility). When several designs are viable and the stakes are high, delegate
the comparison to the `atom:architect` subagent and fold its recommendation into the plan.

## 5. Write the plan

```markdown
# Plan: <title>
**Summary:** <goal> · <approach> · size S/M/L · risk low/medium/high

## Goal and success criteria
## Investigation notes
- path:line — relevant finding
## Assumptions and constraints
## Out of scope
## Approach
<chosen approach and the alternative(s) rejected, with reasons>
## Changes by file
- `path` — what changes and why (new files marked as new)
## Steps
1. <small step that leaves everything working> — verify: `<command or concrete check>`
2. ...
## Test plan
<unit, integration and manual checks, with commands; name the edge cases>
## Rollout and rollback
<migrations and their order, feature flags, compatibility, docs/changelog, how to undo>
## Risks
- <risk> — likelihood/impact — mitigation
## Open questions
- <question> — why it matters — the default you will assume if unanswered
```

Keep steps small enough that each has its own verification. A step like "implement the backend" is a project,
not a step - split it. List gold-plating ideas as optional follow-ups, not as steps.

## 6. Present it

Lead with the three-line summary so the user can approve quickly. If you are in plan mode, present the plan
with ExitPlanMode. Otherwise post it and wait for approval; once approved, execute it with the
`atom:executing-plans` skill. Always end with the **Risks** and **Open questions** sections, even if short -
they are what the user most needs to weigh before saying yes.
