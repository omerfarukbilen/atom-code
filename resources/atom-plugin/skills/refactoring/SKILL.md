---
name: refactoring
description: Behaviour-preserving restructuring in small, verified steps under green tests - extract or inline functions and modules, rename, move, split phase, introduce parameter object, replace conditional with polymorphism, guard clauses, dead-code removal, and large-scale migrations via parallel change and codemods. Use when asked to refactor, clean up, restructure, simplify, rename, decouple or deduplicate code, or to prepare code for a new feature. Not for changing behaviour or fixing bugs in the same step.
---

# Refactoring

Refactoring changes the structure of code without changing what it does. The discipline that makes it safe is
simple: start from green tests, take one small step, verify, repeat. Small steps mean that when something
breaks, the cause is the last few lines you touched — and undoing them is trivial. Big-bang rewrites fail
because they skip exactly that feedback.

Keep two hats separate: while refactoring, you do not add features or fix bugs. Mixing them makes it impossible
to tell whether a test failure is an intended behaviour change or an accident, and makes the diff unreviewable.

## When to use

- The user asks to refactor, clean up, simplify, restructure, rename, split, decouple or deduplicate code.
- Preparing for a feature: "make the change easy, then make the easy change."
- Code you must work in is hard to understand or change, and the cleanup is within the task's scope.

## When not to use

- The behaviour must change — do that as a separate, explicit step (`atom:test-driven-development`).
- A hotfix under time pressure — fix minimally now, refactor later.
- Code that is about to be deleted or replaced.
- Unrelated files the task does not touch. Unrequested refactors across a codebase make reviews painful;
  suggest them instead.

## Preconditions: a green, trustworthy baseline

1. **Run the tests and the typecheck** for the area. Everything should be green. If something already fails,
   note it and do not "fix" it as part of the refactor.
2. **Check coverage of the code you will touch.** Read the tests. If behaviour you are about to restructure is
   untested, write **characterization tests** first: tests that pin down what the code does *today*,
   including odd behaviour.

```python
# Pin current behaviour before restructuring — including the surprising parts
@pytest.mark.parametrize("raw, expected", [
    ("  Ada Lovelace ", "ada-lovelace"),
    ("Ünïcödé", "unicode"),
    ("", "untitled"),   # surprising, but it is today's behaviour: preserve it, mention it to the user
])
def test_slugify_current_behaviour(raw, expected):
    assert slugify(raw) == expected
```

For large outputs (reports, rendered templates, API responses), use a golden master: run the code over a set of
representative inputs, save the outputs to files, and compare against them after each step.

3. **Agree on scope** for anything larger than a local cleanup: what will move, what stays, what the end state
   looks like. For multi-file refactors, write a short plan (`atom:writing-plans`) and track steps in TodoWrite.

## The loop

```
pick one refactoring → find every affected site → change → typecheck + tests → (commit) → next
```

- **One refactoring per step.** Rename *or* move *or* change a signature — not all three at once.
- **Verify after every step**, not at the end: typecheck plus the tests that cover the area, and
  `mcp__atom-ide__get_diagnostics` for the touched files.
- **Red means undo, not debug forward.** If a step breaks something and the cause is not obvious within a
  minute or two, revert that step and take a smaller one. You know the previous state was green.
- **Make undo cheap.** If commits are wanted, commit each green step; otherwise keep steps small enough to
  revert with Edit. Never run `git checkout -- .`, `git restore` or `git stash` over files that contain the
  user's uncommitted work.

### Verification commands

| Stack | After every step | Before you finish |
|---|---|---|
| TypeScript/JS | `npx tsc --noEmit` + related tests (`npx vitest run src/area`, `npx jest src/area`) | full test suite, lint (`npx eslint .`), build |
| Python | `ruff check` + `mypy`/`pyright` if configured + `pytest tests/area -x -q` | full `pytest`, formatter check |
| Go | `go build ./... && go vet ./...` + `go test ./area/...` | `go test ./...` (add `-race` if concurrency changed) |
| Rust | `cargo check --all-targets` + `cargo test area` | `cargo clippy --all-targets`, `cargo test` |

Prefer the project's own scripts (`npm run typecheck`, `make test`) when they exist.

## Finding every affected site

Missing a call site is the classic refactoring bug. Search wider than feels necessary:

1. **Size it first:** Grep with `output_mode: "count"` for the symbol with word boundaries
   (`\bcalculateTotal\b`), then list files with `files_with_matches`.
2. **Search spelling variants:** `calculateTotal|calculate_total|CalculateTotal|calculate-total` — serializers,
   routes, CSS classes, env vars and database columns often use a different case style.
3. **Search string references:** dynamic access (`obj[name]`, `getattr`, reflection), dependency-injection
   registrations, route tables, i18n keys, analytics event names, feature-flag names, test mocks
   (`vi.mock('./cart')`, `patch("app.cart.calculate_total")`), templates, SQL, YAML/JSON config, OpenAPI specs.
4. **Search re-exports:** barrel files (`export * from './cart'`, `export { x } from`), Python `__init__.py` and
   `__all__`, Rust `pub use`, Go packages imported under an alias.
5. **Search beyond code:** docs, READMEs, examples, scripts, CI config, Dockerfiles.
6. **Let the compiler help:** change the definition, then run the typecheck — every error is a call site. This
   catches static references only; steps 2–5 still matter.
7. **Use semantic tools where available:** `gopls rename -w path/file.go:42:6 NewName` renames a Go identifier
   across the module; the IDE's rename (language server) is precise for TypeScript, Rust and Python. Do not
   assume these exist in the shell — check first.
8. **Public API?** If the symbol is exported from a published library or consumed by other services, a rename is
   a breaking change. Keep a deprecated alias that forwards to the new name and tell the user.

## Catalog (summary)

Mechanics, before/after examples in several languages, and the specific traps of each refactoring are in
[references/catalog.md](references/catalog.md). Read the entry before applying an unfamiliar one.

| Refactoring | Use when | Key safety point |
|---|---|---|
| Extract function | A block needs a name, is duplicated, or hides the main flow | Pass in everything it reads; return everything it changes |
| Inline function / variable | The indirection adds no meaning | Check every caller and any overriding implementations |
| Rename | A name misleads or is vague | Search strings and variants too; alias for public APIs |
| Move function / extract module | Code lives with the wrong neighbours; a file does several jobs | Avoid import cycles; temporary re-export eases migration |
| Introduce parameter object | The same group of parameters travels together | Migrate callers incrementally behind the old signature |
| Replace conditional with polymorphism | The same `switch` on a type appears in several places | Move one case at a time; keep exhaustiveness checks |
| Split phase | One function does two sequential jobs (parse then compute) | Define the intermediate data structure first |
| Guard clauses | Deep nesting obscures the happy path | Preserve evaluation order and side effects |
| Replace magic literal with constant | Unexplained numbers/strings repeat | Only merge literals that mean the same thing |
| Separate query from modifier | A function returns a value *and* has side effects | Callers relying on the side effect must call the modifier |
| Remove dead code | Code is unreachable or unused | Prove it: Grep strings/reflection, check external consumers |

### Example: extract function (TypeScript)

```ts
// Before — calculation and presentation tangled
function printInvoice(invoice: Invoice) {
  let outstanding = 0;
  for (const order of invoice.orders) {
    outstanding += order.amountCents;
  }
  console.log(`Customer: ${invoice.customer}`);
  console.log(`Outstanding: ${formatCents(outstanding)}`);
}

// After — one step: the loop moves verbatim into a named function
function printInvoice(invoice: Invoice) {
  const outstanding = totalOutstandingCents(invoice.orders);
  console.log(`Customer: ${invoice.customer}`);
  console.log(`Outstanding: ${formatCents(outstanding)}`);
}

function totalOutstandingCents(orders: readonly Order[]): number {
  let total = 0;
  for (const order of orders) {
    total += order.amountCents;
  }
  return total;
}
```

Notice what did *not* happen in this step: the loop was not rewritten as `reduce`, and `printInvoice` was not
renamed. Those are separate steps, each verified on its own, if they are worth doing at all.

## Large-scale refactors

Changes that touch dozens of files or cross module boundaries need a strategy that keeps every intermediate
state shippable:

- **Parallel change (expand → migrate → contract).** Add the new form alongside the old one, make the old form
  delegate to the new one, move callers over in batches, then delete the old form once Grep finds no users.
  ```ts
  // Expand: the new API
  export function registerUser(input: NewUser): Promise<User> { /* the real implementation moves here */ }

  /** @deprecated Use registerUser({ name, email, role }). Removed once all callers have migrated. */
  export function createUser(name: string, email: string, role: Role): Promise<User> {
    return registerUser({ name, email, role });
  }
  ```
- **Branch by abstraction.** Put an interface in front of the component being replaced, switch callers to the
  interface, build the new implementation behind it, flip over (optionally behind a flag), remove the old one.
- **Strangler fig.** Route a growing share of traffic or features to the new implementation until the old one
  serves nothing and can be deleted.
- **Codemods for mechanical changes**, when available in the project — always review the resulting diff and run
  the verification afterwards:
  - `ast-grep run --pattern 'oldFn($$$ARGS)' --rewrite 'newFn($$$ARGS)' --lang ts src/` (add `--update-all`
    to apply)
  - `npx jscodeshift -t transform.ts src --extensions=ts,tsx --parser=tsx`
  - `gofmt -r 'bytes.Compare(a, b) == 0 -> bytes.Equal(a, b)' -w .`
- **Batch the migration** by directory or module. Each batch: change, verify, (commit). Track the batches in
  TodoWrite so progress survives a long session.
- **Parallelize carefully.** Independent batches can go to `atom:refactorer` subagents via the Agent tool; give
  each a disjoint set of files and the exact transformation, then run the verification centrally — subagents
  editing overlapping files will clobber each other.

## Keeping behaviour identical

Refactorings that look mechanical can still change behaviour. Check for:

- **Evaluation order and side effects** — reordering calls, extracting an expression that was evaluated lazily
  or conditionally (`a && expensive()`), turning a single evaluation into several.
- **`this` binding** in JavaScript when extracting methods or passing them as callbacks.
- **Aliasing and mutation** — a copied object vs a shared reference; default arguments evaluated once
  (Python mutable defaults).
- **Sync vs async** — making a function `async` changes when its effects happen and what callers receive.
- **Exceptions** — different error types or messages that callers or tests match on; errors now thrown
  earlier or later.
- **Public surface** — exported names, serialized field names, log/metric/event names, HTTP routes and CLI flags
  that something outside the code depends on.
- **Import-time side effects** — moving code between modules changes when Python module-level code or
  JavaScript top-level code runs.
- **Performance characteristics** — an extracted helper called in a loop that now repeats a query; O(n) becoming
  O(n²).
- **Floating-point order** — reassociating arithmetic can change results in the last digits.

## Pitfalls

- **Big-bang rewrites.** Hundreds of lines changed before the first test run; when it fails, nobody knows why.
- **Sneaking in behaviour changes** ("while I was there I fixed…"). Do them in a separate step and call them out.
- **Renaming without searching strings** — dynamic references fail only at runtime.
- **Deleting "dead" code that is used reflectively** or by another repository.
- **Reformatting whole files** — buries the real change in noise. Format only what you touched, or do a
  separate formatting-only commit.
- **Editing tests to match new behaviour.** In a pure refactor, test *expectations* should not change; only
  test code that references renamed or moved symbols should. If an assertion must change, behaviour changed.
- **Abstracting too early.** Two similar blocks are not always duplication; wait for the third use or a clear
  shared concept before introducing an abstraction.

## Definition of done

- [ ] Tests and typecheck were green before starting (or pre-existing failures are documented).
- [ ] Untested behaviour that was restructured is now pinned by characterization tests.
- [ ] Each step was a single refactoring, verified before the next one.
- [ ] Every reference was found: code, strings, re-exports, mocks, config and docs.
- [ ] Test expectations are unchanged (or every change is explained as an intentional, approved behaviour change).
- [ ] Full suite, typecheck, lint and build pass; diagnostics clean.
- [ ] Report summarizes the structural change, lists anything notable that was preserved on purpose (odd
      behaviour, deprecated aliases), and suggests follow-ups instead of doing them unasked.
