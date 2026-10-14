---
name: dependency-upgrades
description: Upgrade dependencies safely - inventory outdated packages, read changelogs and migration guides, batch patch and minor bumps, take majors one at a time with codemods, keep lockfiles clean, resolve peer dependency conflicts, apply security patches, and prove each step with the full test suite. Use when asked to update, bump or upgrade packages, frameworks, runtimes or toolchains, fix npm audit, pip-audit, govulncheck or Dependabot alerts, resolve peer dependency or version conflicts, or migrate to a new major version.
---

# Dependency Upgrades

An upgrade is a code change whose diff you did not write. The risk is not the version bump itself; it is the
behavior change hidden inside it, discovered in production. The process below turns one big, unexplainable
change into a series of small ones, each with a known cause, a migration guide you actually read, and a
green test run - so when something breaks, you know exactly which bump did it.

## When to use

- "Update dependencies", "bump X to the latest", "upgrade to React 19 / Django 5 / Go 1.23 / Rust 2024 edition".
- Security alerts: `npm audit`, `pip-audit`, `govulncheck`, `cargo audit`, Dependabot or Renovate PRs.
- Install errors about peer dependencies, conflicting versions, or an unsupported runtime.
- A deprecated or end-of-life dependency or runtime must be replaced.

## When not to use

- Adding a brand-new dependency (that is a design decision - check with the user, prefer what is already installed).
- A single patch bump the user asked for in a well-tested project - just do it and run the tests.
- Replacing one library with a different library - plan it with `atom:writing-plans` and migrate with
  `atom:refactoring` (parallel change), then come back here for the version mechanics.

## Ground rules

- **Use the project's package manager and its commands, never hand-edit lockfiles.** The lockfile is generated
  state; hand edits produce checksums and resolution graphs that do not match. Detect the manager from the
  lockfile (see [references/ecosystem-commands.md](references/ecosystem-commands.md)).
- **One major at a time.** Migration guides and codemods are written for adjacent versions (N to N+1). Jumping
  N to N+3 means applying three guides at once with no way to tell which one broke what.
- **Green before, green after.** You cannot judge an upgrade against a suite that was already failing.
- **Ask before** upgrading a runtime or toolchain (Node, Python, Go, Rust), a framework major, or anything
  that changes production behavior broadly - and before running installs if the user has not asked for an upgrade.

## Process

Put the upgrade queue in TodoWrite: one item per batch or major upgrade, plus "baseline" and "report".

### 1. Baseline

```bash
git status --short                 # start from a clean tree so the upgrade diff is isolated
node -v; npm -v                    # record runtime versions (python --version, go version, rustc --version)
npm test && npm run build          # or the project's real commands from CI
```

Record pre-existing failures and warnings verbatim. If the suite is red before you start, tell the user and
agree on how to proceed instead of upgrading on top of it.

### 2. Inventory and classify

```bash
npm outdated                       # pnpm outdated | yarn outdated (classic) | bun outdated
pip list --outdated                # uv pip list --outdated | poetry show --outdated
go list -m -u all                  # modules with available updates shown in [brackets]
cargo update --dry-run             # compatible updates; cargo-outdated (if installed) shows majors too
```

Sort every candidate into:

| Class | Example | Risk | How |
| --- | --- | --- | --- |
| Patch | 4.17.20 -> 4.17.21 | Low | Batch together |
| Minor | 5.2.0 -> 5.4.1 | Low-medium (0.x minors are majors in semver) | Batch, skim changelogs |
| Major | 18.x -> 19.x | High | Alone, with migration guide |
| Runtime / toolchain | Node 18 -> 20, Python 3.10 -> 3.12 | High, broad | Alone, ask first |

Group packages that must move together: `react` + `react-dom` + `@types/react` + `@types/react-dom`;
`eslint` + its plugins and configs; `@aws-sdk/*`; `@babel/*`; `typescript` + `typescript-eslint`;
`django` + `djangorestframework`; Go modules sharing a repository; `tokio` + `tokio-*`. A group is one unit.

### 3. Research each major (and any risky minor)

Read the changelog from your current version to the target - every intermediate release, not just the
latest one. Find it with:

```bash
npm view <pkg> repository.url homepage     # then WebFetch CHANGELOG.md or GitHub releases
npm view <pkg>@<target> peerDependencies engines
pip index versions <pkg>                   # available versions (pip marks this command experimental)
```

Use WebFetch on the release notes or migration guide and WebSearch for "<pkg> <version> migration guide"
or "<pkg> <version> breaking changes". Extract, per upgrade:

- Breaking changes and removed or renamed APIs, new required peer dependencies, new minimum runtime version.
- Behavior changes with the same API (defaults flipped, stricter validation, different serialization).
- Official codemods or upgrade commands.
- Deprecations you can fix now so the next major is easier.

Then measure the blast radius with Grep for each affected API (`Grep "componentWillMount|findDOMNode"`,
`Grep "from 'lodash'"`). Twenty call sites in one module is a short task; four hundred across the repo is a
plan to show the user before you start.

### 4. Upgrade in order

Each numbered unit below is one commit when the user wants commits (ask once at the start - committing is
their call, see `atom:git-workflow`); otherwise finish each unit green before starting the next and report the
boundaries so they can commit them separately.

1. Patch and minor batch first, as one unit. If tests fail, bisect the batch (half the packages back) rather
   than guessing.
2. Prerequisites before dependents: runtime before framework, `typescript` before `typescript-eslint`,
   framework before its plugins.
3. Each major alone: bump, codemod, fix, verify.

For a single major:

```bash
npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19   # exact manager commands per ecosystem in the reference
```

- Run the official codemod if the guide offers one (examples: `ng update @angular/core@<v> @angular/cli@<v>`,
  `npx storybook@latest upgrade`, `npx @eslint/migrate-config .eslintrc.json`, `django-upgrade --target-version <v>`,
  `ruff check --select UP --fix` for Python syntax upgrades, `go fix ./...`, `cargo fix --edition`). Review the codemod's
  diff like any other change - codemods handle the common 90% and silently skip the rest.
- Fix compile errors: run the typecheck, and check `mcp__atom-ide__get_diagnostics` for edited files.
- Grep for every deprecated API the changelog lists; fix them now while the context is fresh.
- Run the **full** suite, lint and build - upgrades break things far from where you edited. If the app has a
  UI or server, smoke-run it; type-safe code can still change behavior at runtime.
- If committing, use a message that links the migration guide, e.g. `chore(deps): upgrade react to 19` with a
  body listing the code changes the upgrade required. Separate commits make `git bisect` and reverts trivial.

### 5. Lockfile hygiene

- Manifest, lockfile and the code changes the upgrade required belong together in one commit.
- One package manager per project. A second lockfile (`package-lock.json` next to `pnpm-lock.yaml`) is a bug - remove the stray one only after confirming with the user which manager is canonical.
- Do not delete the lockfile to "fix" an install error: that silently upgrades every transitive dependency
  at once, which is exactly the uncontrolled change this skill exists to avoid.
- Lockfile merge conflict: take the base branch's lockfile, then re-run the install so the package manager
  re-applies your manifest changes - never merge lockfile hunks by hand.
- CI should install with frozen lockfiles (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`,
  `uv sync --locked`, `poetry install` with a committed lock, `cargo build --locked`) so drift fails loudly.

### 6. Peer dependency and version conflicts

Read the error to find *who* requires *what*, then resolve in this order of preference:

1. Upgrade the package that declares the outdated peer range to a version that supports the new peer.
2. Hold the upgrade until the ecosystem catches up - and tell the user which package is blocking.
3. Override the resolution (`overrides` in npm, `pnpm.overrides`, `resolutions` in Yarn, a direct pin in
   Python, a `replace` directive in Go, `[patch]` in Cargo) with a comment explaining why and when to remove it.
4. `--legacy-peer-deps` / `--force` only as a last resort, never silently - it hides a real incompatibility.

Details, commands and common conflict patterns: [references/conflicts-and-security.md](references/conflicts-and-security.md).

### 7. Security patches

- Prefer the smallest version that fixes the advisory over the latest major.
- Check reachability: is the vulnerable package a dev-only dependency, and is the vulnerable function used?
  (`govulncheck` reports reachability for Go; for others, Grep for the affected API.) Unreachable dev-only
  issues still get fixed, but they do not justify a risky major bump under time pressure.
- Transitive vulnerability: upgrade the direct parent that pulls it in first; override only if no fixed parent exists.
- Avoid `npm audit fix --force`: it applies semver-major upgrades across the tree without review.

### 8. Report

Use [templates/upgrade-report.md](templates/upgrade-report.md): what moved from which version to which,
code changes required, migration notes, verification results, anything deferred and why.

## Example: good vs bad

```bash
# Bad: 40 packages, 6 majors, one commit. Tests fail; nobody knows which bump caused it.
npx npm-check-updates -u && rm package-lock.json && npm install

# Good: controlled units, each verified (and committed, if the user wants commits).
npx npm-check-updates --target minor -u && npm install && npm test        # unit 1: patch+minor batch
npx npm-check-updates --filter typescript -u && npm install && npm run typecheck && npm test   # unit 2
# read the vitest 2 -> 3 migration guide, then:
npm install -D vitest@3 @vitest/coverage-v8@3 && npm test                 # unit 3
```

## Common pitfalls

- **Upgrading on top of a red suite.** You cannot tell new failures from old ones.
- **Reading only the latest release notes.** Breaking changes live in the intermediate majors you skipped.
- **Trusting types alone.** Defaults and runtime behavior change without type errors; run the app.
- **Forgetting peer and type packages** (`@types/*`, ESLint plugins) - they cause confusing errors later.
- **Global rewrites by the package manager**, e.g. `npm update` across everything when asked for one package.
- **Treating 0.x minors as safe.** In semver, `0.4 -> 0.5` may break anything.
- **Leaving overrides forever.** Every override needs a reason and a removal condition in a comment.
- **Runtime engines drift.** Raising a dependency may raise the minimum Node/Python version; update `.nvmrc`,
  `engines`, CI matrices and Docker base images consistently, or the upgrade only works on your machine.

## Definition of done

- [ ] Baseline recorded; tree was clean and suite green (or pre-existing failures documented).
- [ ] Each major upgraded alone, after reading its migration guide; codemod diffs reviewed.
- [ ] Manifest and lockfile changed only via the package manager and kept together with the code they need.
- [ ] Typecheck, lint, full test suite and build pass; app smoke-tested where applicable.
- [ ] No new peer-dependency warnings left unexplained; any override is commented.
- [ ] Security advisories re-checked after the upgrade (`npm audit`, `pip-audit`, `govulncheck`, `cargo audit`).
- [ ] Report delivered with versions, required code changes and deferred items.
