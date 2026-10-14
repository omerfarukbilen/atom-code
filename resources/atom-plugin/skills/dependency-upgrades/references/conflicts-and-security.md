# Conflicts, overrides and security fixes

Read this when an install fails with a resolution error, when two versions of a package fight, or when you
are fixing a vulnerability advisory.

## Reading a peer dependency error (npm)

```text
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR! Found: react@19.0.0
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^16.8 || ^17 || ^18" from some-carousel@4.2.1
```

Translation: `some-carousel@4.2.1` declares it only works with React up to 18. Questions to answer, in order:

1. Is there a newer `some-carousel` whose peer range includes 19? `npm view some-carousel peerDependencies`
   and `npm view some-carousel@latest peerDependencies`. If yes, upgrade it in the same step as React.
2. Is the package maintained? Check the repository's issues for "React 19 support". An open PR with a
   release coming soon is a reason to wait; an abandoned package is a reason to plan a replacement.
3. Does it actually break, or is the range just stale? Only test this deliberately: override, run the
   relevant tests and exercise the feature, and record the result.
4. Only then consider an override.

pnpm reports unmet peers as warnings during install and can be configured with `pnpm.peerDependencyRules`
(`allowedVersions`, `ignoreMissing`); prefer fixing the cause over silencing the rule.

## Overrides: forcing a resolution

Use overrides to pin a transitive dependency (security fix, broken release) or to accept a stale peer range
you have verified. Always leave a comment trail - package.json has no comments, so record the reason in the
commit message and, if the team uses one, a `DEPENDENCIES.md` or ATOM.md note.

```jsonc
// Comments are for illustration only - package.json does not allow them.
// npm (package.json)
"overrides": {
  "semver": "7.6.3",                       // CVE fix; remove once eslint-plugin-x ships >= 3.1
  "some-carousel": { "react": "$react" }   // use the project's own react version for this package's peer
}
// pnpm (package.json)
"pnpm": { "overrides": { "semver": "7.6.3" } }
// Yarn (package.json)
"resolutions": { "semver": "7.6.3" }
```

```toml
# Cargo.toml - use a patched fork or git revision of a crate everywhere in the graph
[patch.crates-io]
some-crate = { git = "https://github.com/org/some-crate", rev = "abc1234" }
```

```text
// go.mod - replace a module (fork, local checkout for debugging, or a fixed version)
replace example.com/broken => example.com/broken v1.4.3
```

Python has no overrides in pip: pin the transitive package directly in your requirements (or a constraints
file passed with `pip install -c constraints.txt`), or `uv` `override-dependencies` in `[tool.uv]`.

Remove an override as soon as the upstream fix lands - a forgotten override silently blocks future updates.

## Duplicate versions

Two copies of the same library are wasteful at best and broken at worst (two Reacts break hooks; two copies
of a class break `instanceof`; two `@types/*` versions produce baffling type errors).

```bash
npm ls react                  # every copy and who pulled it in;  pnpm why react / yarn why react
npm dedupe                    # pnpm dedupe / yarn dedupe (Berry)
cargo tree -d                 # Rust duplicates
go mod graph | grep <module>  # Go uses one version per module path (minimal version selection)
```

If dedupe cannot merge them, a dependent pins an incompatible range - upgrade that dependent, or override.

## Lockfile conflicts during merge or rebase

Take the base branch's lockfile, then let the package manager re-apply your manifest changes:

```bash
git checkout --ours package-lock.json     # while rebasing onto main, "ours" is main
git checkout --theirs package-lock.json   # while running `git merge main` on your branch, "theirs" is main
npm install                               # re-resolves with your package.json changes applied on top
npm test
```

The same pattern works for `pnpm-lock.yaml` (`pnpm install`), `yarn.lock` (`yarn install`), `poetry.lock`
(`poetry lock`), `uv.lock` (`uv lock`), `Cargo.lock` (any `cargo check` or `cargo build`), `go.sum`
(`go mod tidy`). Confirm the resulting lockfile diff only touches what your branch intended.

## Security advisories

Work out four things before choosing a fix:

| Question | How |
| --- | --- |
| Which package and which versions are affected? | The advisory (GHSA / CVE / RustSec / Go vuln ID) - WebFetch it |
| Direct or transitive, and through which path? | `npm explain <pkg>`, `pnpm why`, `pipdeptree -r -p`, `go mod why -m`, `cargo tree -i` |
| Runtime or dev-only? | Is it under `devDependencies`, a test or build tool? Dev-only issues still matter in CI and supply chain, but are lower urgency |
| Is the vulnerable code reachable? | `govulncheck` reports this for Go; otherwise Grep for the affected function or feature |

Then choose the smallest fix:

1. Patch or minor upgrade of the vulnerable package (direct dependency).
2. Upgrade of the direct parent that pulls in a fixed version (transitive).
3. Override / pin of the transitive package to the fixed version, with a removal note.
4. No fix available: document the risk, mitigations (input validation, disabling the feature), and track it.
   Do not suppress the audit finding without the user's agreement.

Commands: `npm audit` / `pnpm audit` / `yarn npm audit`, `pip-audit`, `govulncheck ./...`, `cargo audit`,
`bundle audit`, `composer audit`. Re-run the audit after the fix and include before/after counts in the report.

For a broader review of how untrusted input reaches the vulnerable code, use `atom:security-audit`.
