<!--
Architecture Decision Record template (used by the atom:documentation skill).
Based on Michael Nygard's ADR format, extended with options considered.

File name: docs/adr/NNNN-short-kebab-title.md  (next sequential number; check existing ADRs first)
Keep it to 1-2 pages. Write for an engineer joining the team a year from now who asks "why is it like this?".
Once Accepted, do not rewrite the decision: supersede it with a new ADR and update only the Status line here.
Delete this comment block in the final document.
-->

# NNNN. <Decision title as a short noun phrase, e.g. "Use SQLite for local session storage">

- **Status:** Proposed <!-- Proposed | Accepted | Rejected | Deprecated | Superseded by [NNNN](NNNN-title.md) -->
- **Date:** YYYY-MM-DD
- **Deciders:** <!-- names or roles -->
- **Related:** <!-- issues, PRs, earlier ADRs, design docs -->

## Context

<!--
What situation forces a decision now? Describe the problem, constraints and forces neutrally:
requirements (functional and non-functional, with numbers where possible), technical constraints,
team skills, deadlines, cost, compliance. Facts, not advocacy.
-->

## Decision drivers

<!-- The criteria used to judge the options, most important first. -->

- <!-- e.g. Must work offline -->
- <!-- e.g. p95 query latency under 10 ms for 100k records -->
- <!-- e.g. No native dependencies that complicate cross-platform packaging -->

## Options considered

### Option A: <name>

<!-- One paragraph describing it. -->

- Good, because ...
- Bad, because ...

### Option B: <name>

- Good, because ...
- Bad, because ...

### Option C: Do nothing / keep the status quo

- Good, because ...
- Bad, because ...

## Decision

<!--
"We will ..." - state the chosen option and the core reason in one or two sentences,
then any important details of how it will be applied (scope, boundaries, exceptions).
-->

We will ...

## Consequences

<!-- Be honest about the costs; future readers trust ADRs that admit trade-offs. -->

- **Positive:** ...
- **Negative:** ... <!-- new risks, technical debt accepted, things that become harder -->
- **Neutral / follow-up work:** ... <!-- migrations, docs, monitoring, a date to revisit the decision -->

## Validation

<!-- How we will know the decision works: metrics, a spike result, a review date. Optional. -->
