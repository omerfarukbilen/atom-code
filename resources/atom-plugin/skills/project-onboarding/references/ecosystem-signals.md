# Ecosystem signals: what each file tells you

Read this when identifying a stack from its manifests. Each row says what the file proves and where to look
next. Lockfiles are the strongest signal for *which* package manager is in use - using a different one
rewrites the lockfile and causes churn.

## JavaScript / TypeScript

| File | Tells you | Look next at |
| --- | --- | --- |
| `package.json` | Scripts, entry (`main`, `bin`, `exports`), `engines`, `type: module`, `workspaces` | `scripts` - the real commands |
| `package-lock.json` | npm | `npm ci` for clean installs |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | pnpm (workspace packages listed in the yaml) | `pnpm --filter <pkg> <script>` |
| `yarn.lock` + `.yarnrc.yml` | Yarn Berry (2+); `yarn.lock` alone usually Yarn Classic (1.x) | `packageManager` field in package.json |
| `bun.lock` / `bun.lockb` | Bun | `bun run <script>` |
| `packageManager` field | Exact package manager and version (Corepack) | Use exactly that tool |
| `tsconfig*.json` | Strictness, `paths` aliases, project references | `paths` explains `@/...` imports |
| `turbo.json`, `nx.json`, `lerna.json` | Monorepo task runner, pipeline dependencies | Task graph, cache outputs |
| `vite.config.*`, `next.config.*`, `webpack.config.*`, `electron.vite.config.*` | Bundler / framework, aliases, env handling | Build entry points |
| `vitest.config.*`, `jest.config.*`, `playwright.config.*` | Test runner, setup files, test globs | Setup files often mock globals |
| `eslint.config.*` / `.eslintrc*`, `biome.json`, `.prettierrc*` | Lint and format rules | Whether lint runs in CI |
| `.nvmrc`, `.node-version`, `engines.node` | Required Node version | Compare with `node -v` |

## Python

| File | Tells you | Look next at |
| --- | --- | --- |
| `pyproject.toml` | Build backend, deps, `[project.scripts]` entry points, tool config (`[tool.ruff]`, `[tool.pytest.ini_options]`, `[tool.mypy]`) | Which tool manages envs |
| `uv.lock` | uv | `uv run pytest`, `uv sync` |
| `poetry.lock` | Poetry | `poetry run pytest`, `poetry install` |
| `Pipfile.lock` | Pipenv | `pipenv run ...` |
| `requirements*.txt`, `requirements*.in` | pip / pip-tools (`.in` compiled to `.txt` by `pip-compile`) | Never hand-edit compiled `.txt` |
| `setup.py`, `setup.cfg` | Legacy packaging | `entry_points` |
| `manage.py`, `settings.py` | Django | `INSTALLED_APPS`, `urls.py` |
| `alembic.ini`, `migrations/` | SQLAlchemy + Alembic | `env.py` for DB URL |
| `tox.ini`, `noxfile.py` | Test matrix / task automation | Sessions = real commands |
| `.python-version` | Required Python version | pyenv / uv |

## Go

| File | Tells you | Look next at |
| --- | --- | --- |
| `go.mod` | Module path, `go` version, `toolchain`, dependencies | Module path prefixes internal imports |
| `go.work` | Multi-module workspace | Each `use` directory is a module |
| `cmd/<name>/main.go` | One binary per directory | Wiring of each binary |
| `internal/` | Packages importable only within this module | Core domain logic |
| `Makefile`, `magefile.go`, `Taskfile.yml` | Build/test/generate targets | `go generate` directives (`//go:generate`) |
| `.golangci.yml` | Enabled linters | Run `golangci-lint run` if installed |

## Rust

| File | Tells you | Look next at |
| --- | --- | --- |
| `Cargo.toml` | Crate type, `[[bin]]`, features, `[workspace] members` | Feature flags change what compiles |
| `Cargo.lock` | Pinned versions (always committed for binaries) | `cargo tree` |
| `rust-toolchain.toml` | Pinned toolchain / components | `rustup show` |
| `build.rs` | Build-time codegen or native linking | Generated code locations |
| `.cargo/config.toml` | Aliases, target settings, env | Custom `cargo xtask` style commands |
| `xtask/` | Project automation written in Rust | `cargo xtask <cmd>` |

## Other ecosystems (brief)

| File | Stack | Commands usually |
| --- | --- | --- |
| `Gemfile`, `Gemfile.lock`, `config/routes.rb` | Ruby / Rails | `bin/rails test`, `bundle exec rspec` |
| `composer.json`, `artisan` | PHP / Laravel | `composer test`, `php artisan test` |
| `pom.xml`, `build.gradle(.kts)`, `gradlew` | JVM (Maven / Gradle) | `./mvnw test`, `./gradlew test` |
| `*.csproj`, `*.sln` | .NET | `dotnet build`, `dotnet test` |
| `mix.exs` | Elixir | `mix test` |
| `Package.swift` | Swift | `swift build`, `swift test` |
| `CMakeLists.txt`, `meson.build` | C / C++ | `cmake -S . -B build && cmake --build build && ctest --test-dir build` |

## Infrastructure and environment

| File | Tells you |
| --- | --- |
| `Dockerfile` | Production runtime, `CMD`/`ENTRYPOINT` = real entry point, build steps |
| `docker-compose.yml` / `compose.yaml` | Services needed locally (DB, cache, queue) and their ports |
| `.devcontainer/` | Canonical dev environment, post-create commands |
| `.env.example`, `.env.sample` | Required environment variables (never read or print a real `.env` into the chat unless asked) |
| `.github/workflows/*.yml` | The commands that must pass to merge; matrix of versions |
| `terraform/`, `*.tf`, `k8s/`, `helm/`, `fly.toml`, `vercel.json`, `serverless.yml` | How and where it is deployed |
| `.github/CODEOWNERS` | Who owns which area - who to ask |

## Monorepo orientation

1. List the packages: `pnpm-workspace.yaml`, `package.json` `workspaces`, `Cargo.toml` `[workspace] members`,
   `go.work`, `nx.json` / `project.json` files.
2. For each package, note its name, purpose and whether it is an app (deployable) or a library (consumed).
3. Find the dependency graph between internal packages (internal package names in each manifest's deps).
4. Find how to run a task for one package only (`pnpm --filter`, `npm -w <pkg>`, `yarn workspace <pkg>`,
   `turbo run test --filter=<pkg>`, `nx test <project>`, `cargo test -p <crate>`, `go test ./<module>/...`).
5. For a full map, spawn one `atom:explorer` subagent per app or major library and merge their reports.
