# Upgrade commands per ecosystem

Detect the package manager from the lockfile before running anything, and use only that manager. Interactive
modes (`ncu -i`, `yarn upgrade-interactive`, `pnpm update -i`) need a TTY the Bash tool does not have; use the
non-interactive forms below. Commands marked *(third-party)* exist only if the tool is installed - check with
`command -v <tool>` or ask before installing it.

## npm (`package-lock.json`)

| Goal | Command |
| --- | --- |
| List outdated (Current / Wanted / Latest) | `npm outdated` |
| Update within existing semver ranges | `npm update <pkg>` (omit `<pkg>` only if the user wants everything) |
| Move to a specific version or major | `npm install <pkg>@<version>` (`-D` for devDependencies) |
| Why is this installed? | `npm explain <pkg>` (alias `npm why`), `npm ls <pkg>` |
| Available versions / metadata | `npm view <pkg> versions --json`, `npm view <pkg>@<v> peerDependencies engines` |
| Clean install exactly from lockfile | `npm ci` |
| Remove duplicate transitive copies | `npm dedupe` |
| Security | `npm audit`, `npm audit --omit=dev`, `npm audit fix` (never `--force` without review) |
| Force a transitive version | `"overrides": { "<pkg>": "<version>" }` in package.json, then `npm install` |

**npm-check-updates** (`npx npm-check-updates`, binary `ncu`) rewrites ranges in package.json; follow with an install:

```bash
npx npm-check-updates                      # list what could change (dry run)
npx npm-check-updates --target patch -u    # or --target minor; then npm install
npx npm-check-updates --filter "eslint*" -u
npx npm-check-updates --doctor -u          # installs upgrades one by one, runs tests, reports which break
```

## pnpm (`pnpm-lock.yaml`)

| Goal | Command |
| --- | --- |
| List outdated | `pnpm outdated` (`-r` for all workspace packages) |
| Update within ranges | `pnpm update <pkg>` |
| Update to latest, ignoring ranges | `pnpm update --latest <pkg>` |
| Specific version | `pnpm add <pkg>@<version>` (in a workspace package: `pnpm --filter <name> add ...`) |
| Why | `pnpm why <pkg>` |
| Frozen install (CI) | `pnpm install --frozen-lockfile` |
| Dedupe | `pnpm dedupe` |
| Security | `pnpm audit` |
| Force a transitive version | `"pnpm": { "overrides": { "<pkg>": "<version>" } }` in the root package.json (newer pnpm also reads `overrides` from `pnpm-workspace.yaml`) |

## Yarn

Check `packageManager` in package.json or `.yarnrc.yml` to tell Classic (1.x) from Berry (2+).

| Goal | Yarn Classic | Yarn Berry |
| --- | --- | --- |
| List outdated | `yarn outdated` | No built-in non-interactive command (`yarn upgrade-interactive` needs a TTY); check versions with `yarn npm info <pkg> --fields versions` |
| Upgrade a package | `yarn upgrade <pkg>@<version>` | `yarn up <pkg>@<version>` |
| Why | `yarn why <pkg>` | `yarn why <pkg>` |
| Frozen install | `yarn install --frozen-lockfile` | `yarn install --immutable` |
| Dedupe | n/a | `yarn dedupe` |
| Security | `yarn audit` | `yarn npm audit` |
| Force a transitive version | `"resolutions"` in package.json | `"resolutions"` in package.json |

## Bun (`bun.lock` / `bun.lockb`)

`bun outdated`, `bun update <pkg>`, `bun update --latest <pkg>`, `bun add <pkg>@<version>`,
`bun install --frozen-lockfile`.

## Python

### pip + requirements files

```bash
pip list --outdated
pip install -U "<pkg>"                     # or a bounded range: pip install "django>=5.0,<5.1"
pip check                                  # verifies installed packages have compatible dependencies
pip-audit                                  # (third-party, PyPA) known vulnerabilities
pipdeptree -r -p <pkg>                     # (third-party) who depends on <pkg>
```

### pip-tools (`requirements.in` compiled to `requirements.txt`)

```bash
pip-compile --upgrade-package "<pkg>==<version>" requirements.in   # one package
pip-compile --upgrade requirements.in                               # everything (rarely what you want)
pip-sync requirements.txt
```

Edit `.in` files, never the compiled `.txt`.

### uv (`uv.lock`)

```bash
uv tree --outdated                         # dependency tree with available upgrades
uv lock --upgrade-package <pkg>            # one package (optionally <pkg>==<version>)
uv add "<pkg>>=2,<3"                       # change the declared range in pyproject.toml
uv sync                                    # apply to the environment; CI: uv sync --locked
```

### Poetry (`poetry.lock`)

```bash
poetry show --outdated                     # add --top-level to hide transitive packages
poetry show --tree
poetry update <pkg>                        # within the declared constraint
poetry add "<pkg>@^2.0"                    # change the constraint (new major)
```

### Python runtime upgrades

Update `requires-python`, `.python-version`, CI matrices, Docker base images and tool targets
(`[tool.ruff] target-version`, `[tool.mypy] python_version`) together. `ruff check --select UP --fix`
modernizes syntax for the new minimum version.

## Go (`go.mod`, `go.sum`)

```bash
go list -m -u all                          # available updates in [brackets]
go get example.com/mod@latest              # one module to its latest version
go get example.com/mod@v1.8.2              # a specific version
go get -u=patch ./...                      # patch-level updates for dependencies of the main module's packages
go get -u ./...                            # minor+patch updates (broad - prefer targeted upgrades)
go mod tidy                                # prune and add missing requirements; always run after go get
go mod why -m example.com/mod              # why a module is needed
go mod graph | grep example.com/mod        # who requires which version
go mod verify
govulncheck ./...                          # (golang.org/x/vuln/cmd/govulncheck) reachable vulnerabilities
```

**Go majors change the import path.** `v2+` lives at `example.com/mod/v2`: run `go get example.com/mod/v2@latest`,
then update every import (Grep `"example.com/mod"` and `"example.com/mod/`), then `go mod tidy`. Both majors
can coexist during a gradual migration. Go version upgrades: change the `go` line (and `toolchain` if present)
in `go.mod` with `go mod edit -go=1.23`, update CI and Docker images, run `go vet ./...` and the tests. `go fix ./...`
applies automated rewrites for API changes.

## Rust (`Cargo.toml`, `Cargo.lock`)

```bash
cargo update --dry-run                     # what compatible (semver) updates would change in Cargo.lock
cargo update -p serde                      # update one crate within the Cargo.toml requirement
cargo update -p serde --precise 1.0.210    # pin to an exact version
cargo add <crate>@<version>                # change the requirement in Cargo.toml (use this for a new major)
cargo tree -i <crate>                      # who depends on <crate> (inverted tree)
cargo tree -d                              # crates compiled in more than one version
cargo outdated                             # (third-party: cargo-outdated) shows majors
cargo upgrade --incompatible               # (third-party: cargo-edit) bumps requirements across majors
cargo audit                                # (third-party: cargo-audit) RustSec advisories
cargo deny check                           # (third-party: cargo-deny) advisories, licenses, duplicates
cargo build --locked                       # CI: fail if Cargo.lock would change
```

Edition migration: update `rust-toolchain.toml` if pinned, run `cargo fix --edition`, set `edition` in
Cargo.toml, then `cargo build`, `cargo clippy` and `cargo test`.

## Ruby and PHP (brief)

| Goal | Bundler | Composer |
| --- | --- | --- |
| List outdated | `bundle outdated` | `composer outdated --direct` |
| Upgrade one, minimal churn | `bundle update --conservative <gem>` | `composer update <vendor/pkg> --with-dependencies` |
| Why | `bundle exec gem dependency <gem> --reverse-dependencies` | `composer why <vendor/pkg>` |
| Security | `bundle audit` (third-party: bundler-audit) | `composer audit` |

## Automated update bots

If the repository uses Dependabot (`.github/dependabot.yml`) or Renovate (`renovate.json`), prefer grouping
rules there for routine patch/minor updates, and handle majors manually with this skill. When reviewing a bot
PR, still read the changelog it links and run the full suite locally if CI coverage is thin.
