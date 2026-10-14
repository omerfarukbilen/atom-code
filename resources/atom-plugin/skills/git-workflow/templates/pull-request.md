<!--
Pull request description template used by the atom:git-workflow skill.

How to fill it in:
- Base every statement on the full branch diff (git diff origin/main...HEAD) and the commit list
  (git log origin/main..HEAD), not on the original task text. Describe what the code actually does now.
- Delete sections that genuinely do not apply instead of writing "N/A" everywhere.
- Keep it scannable: a reviewer should understand the change in 30 seconds from Summary + Changes.
- Title: Conventional Commits style, <= 72 characters, e.g. "feat(reports): add CSV export".
- Remove this comment block before submitting.
-->

## Summary

<!-- One to three sentences: what this PR does and why it is needed. Lead with the user-visible effect. -->

Closes #<!-- issue number, or remove -->

## Changes

<!-- Bullet list grouped by area. Mention files only when it helps the reviewer navigate. -->

-
-

## Why this approach

<!-- The key decision(s) and alternatives you rejected, briefly. Link an ADR if one exists. -->

## How to test

<!-- Exact, copy-pasteable steps a reviewer can follow. Include commands and expected results. -->

1.
2.

Automated checks run locally:

- [ ] Unit/integration tests: `<command>` <!-- e.g. npm test, pytest, go test ./..., cargo test -->
- [ ] Lint / type check: `<command>`
- [ ] Manual verification: <!-- what you clicked or ran -->

## Screenshots / recordings

<!-- Required for UI changes: before and after, light and dark mode if relevant. Remove for non-UI changes. -->

| Before | After |
| ------ | ----- |
|        |       |

## Risk and rollout

<!--
- Breaking changes (API, config, data format, CLI flags)? How are consumers migrated?
- Database migrations? Are they reversible and safe to run on a live system?
- Feature flag? Default state?
- Performance or security implications?
- How to roll back if something goes wrong.
-->

- Breaking changes:
- Migrations:
- Rollback plan:

## Reviewer notes

<!-- Where to focus, known limitations, follow-up work deliberately left out of scope (with issue links). -->
