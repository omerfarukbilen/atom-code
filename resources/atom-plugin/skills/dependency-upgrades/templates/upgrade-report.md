# Dependency upgrade report

<!-- Template for atom:dependency-upgrades. Fill every section; write "none" rather than deleting it. -->

## Summary

<One or two sentences: what was upgraded and why (routine hygiene, security advisory, framework major, EOL runtime).>

## Baseline

- Branch / commit: `<sha>`
- Runtime: <node 20.11 / python 3.12.2 / go 1.22.4 / rustc 1.80.0>
- Suite before: <all green | N failing (list) - pre-existing>

## Changes

| Package | From | To | Class | Commit | Notes |
| --- | --- | --- | --- | --- | --- |
| <pkg> | <1.2.3> | <1.2.9> | patch | `<sha>` | batch |
| <pkg> | <4.x> | <5.0.1> | major | `<sha>` | <migration guide link> |

## Code changes required

- `<path>:<line>` - <what changed and why, e.g. "replaced removed `findDOMNode` with a ref">
- Codemod run: `<command>` - <files touched, manual follow-ups>

## Conflicts and overrides

- <peer conflict and how it was resolved, or "none">
- Overrides added: <package -> version, reason, removal condition>

## Security

- Advisories before: <count / IDs>
- Advisories after: <count / IDs>
- Remaining: <ID, why not fixed, mitigation>

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `<cmd>` | <pass> |
| Lint | `<cmd>` | <pass> |
| Tests | `<cmd>` | <pass, N tests> |
| Build | `<cmd>` | <pass> |
| Smoke run | `<cmd / what was clicked>` | <ok> |

## Deferred

- <package> <current> -> <latest>: <why deferred - blocked by X, needs product decision, large migration>
