# Refactoring catalog

Reference for the `refactoring` skill. Each entry: **motivation**, **mechanics** (the small, safe steps), an
**example**, and **watch out** (how this particular refactoring tends to change behaviour by accident).
Examples rotate between TypeScript, Python, Go and Rust; the mechanics are language-agnostic.

After every mechanical step: typecheck and run the covering tests. Names follow the classic catalog (Fowler,
*Refactoring*, 2nd ed.) so you can look up more detail.

1. [Extract function](#1-extract-function)
2. [Inline function](#2-inline-function)
3. [Extract variable / decompose conditional](#3-extract-variable--decompose-conditional)
4. [Rename](#4-rename)
5. [Move function / extract module](#5-move-function--extract-module)
6. [Introduce parameter object](#6-introduce-parameter-object)
7. [Replace conditional with polymorphism](#7-replace-conditional-with-polymorphism)
8. [Split phase](#8-split-phase)
9. [Replace nested conditional with guard clauses](#9-replace-nested-conditional-with-guard-clauses)
10. [Replace magic literal with named constant](#10-replace-magic-literal-with-named-constant)
11. [Encapsulate variable](#11-encapsulate-variable)
12. [Separate query from modifier](#12-separate-query-from-modifier)
13. [Replace primitive with value type](#13-replace-primitive-with-value-type)
14. [Remove dead code](#14-remove-dead-code)
15. [Large-scale patterns](#15-large-scale-patterns)

---

## 1. Extract function

**Motivation:** a block of code needs a name to be understood, is duplicated, or buries the main flow of a
function. Name it after *what* it does (intent), not *how*.

**Mechanics:**
1. Create the new function with an intention-revealing name.
2. Copy the block into it. Variables the block only reads become parameters; variables it assigns that are used
   afterwards become return values. More than one such output suggests extracting a smaller block, or returning
   a small record.
3. Replace the original block with a call. Typecheck and test.
4. Search for other copies of the same logic and replace them one at a time, verifying after each.

**Example (Python)** — the end state after three extract steps, each verified on its own:

```python
# Before
def send_overdue_reminders(invoices, mailer, today):
    for invoice in invoices:
        if invoice.paid_at is None and invoice.due_date < today and not invoice.customer.opted_out:
            days = (today - invoice.due_date).days
            fee = min(days * 50, 2_000)
            mailer.send(invoice.customer.email,
                        f"Invoice {invoice.number} is {days} days overdue. Late fee: {fee / 100:.2f}")

# After
def send_overdue_reminders(invoices, mailer, today):
    for invoice in invoices:
        if is_remindable(invoice, today):
            days = (today - invoice.due_date).days
            mailer.send(invoice.customer.email, reminder_text(invoice, days, late_fee_cents(days)))

def is_remindable(invoice, today):
    return invoice.paid_at is None and invoice.due_date < today and not invoice.customer.opted_out

def late_fee_cents(days_overdue):
    return min(days_overdue * 50, 2_000)

def reminder_text(invoice, days, fee_cents):
    return f"Invoice {invoice.number} is {days} days overdue. Late fee: {fee_cents / 100:.2f}"
```

**Watch out:**
- `return`, `break`, `continue` or `yield` inside the block change meaning once moved into a function.
- `await` inside the block makes the new function `async` — and the call must be awaited.
- Go: a `defer` inside the extracted block now runs when the *new* function returns, not the original — this
  changes when files close and locks release.
- JavaScript: methods extracted as standalone functions lose `this`.
- Rust: the borrow checker may force `&mut` parameters or splitting borrows; that is a hint about ownership,
  not a reason to `clone()`.

## 2. Inline function

**Motivation:** the function's body is as clear as its name, or the indirection hides what is going on. Also a
useful first step before re-extracting a better-shaped function.

**Mechanics:**
1. Check it is not polymorphic: not overridden in a subclass, not an interface/trait implementation, not passed
   as a callback where identity matters.
2. Find every caller (Grep, including string references and mocks).
3. Replace each call with the body, substituting arguments. Verify after each caller in risky code.
4. Delete the function.

**Example (TypeScript):**

```ts
// Before
function hasManyLateDeliveries(driver: Driver) {
  return driver.lateDeliveries > 5;
}
function rating(driver: Driver) {
  return hasManyLateDeliveries(driver) ? 2 : 1;
}

// After
function rating(driver: Driver) {
  return driver.lateDeliveries > 5 ? 2 : 1;
}
```

**Watch out:** an argument with side effects (`inc(i++)`) or an expensive argument that the body uses several
times — substituting it textually evaluates it more than once. Bind it to a local first.

## 3. Extract variable / decompose conditional

**Motivation:** a complex expression or condition is hard to read. Give its parts names.

**Example (TypeScript):**

```ts
// Before
if (date >= plan.summerStart && date <= plan.summerEnd) {
  charge = quantity * plan.summerRate;
} else {
  charge = quantity * plan.regularRate + plan.regularServiceCharge;
}

// After
const isSummer = date >= plan.summerStart && date <= plan.summerEnd;
charge = isSummer ? summerCharge(quantity) : regularCharge(quantity);
```

**Watch out:** extracting a sub-expression out of a short-circuit (`a && b()`, `x ?? compute()`) into a variable
evaluates it unconditionally. Keep it lazy (a function) when the evaluation has cost or side effects.

## 4. Rename

**Motivation:** a name misleads, is vague (`data`, `handle`, `mgr`), or no longer matches what the thing does.
Renames are the cheapest high-value refactoring.

**Mechanics:**
1. **Local variable or private symbol:** rename within its scope; typecheck.
2. **Shared symbol:** Grep for every reference — word-boundary search, case variants (`userId`, `user_id`,
   `UserID`), string references, mocks, docs, config. Use semantic rename tools when available:
   `gopls rename -w internal/billing/invoice.go:42:6 TotalCents` for Go; the IDE's language-server rename for
   TypeScript, Rust and Python.
3. **Published API:** keep the old name as a deprecated alias that delegates to the new one, then remove it
   in a later, announced release.
4. **Files:** use `git mv` so history follows; on case-insensitive file systems (macOS, Windows), a case-only
   rename needs `git mv` to be recorded. Update imports and any path strings (configs, globs, tests).

**Deprecated aliases by language:**

```ts
/** @deprecated Use `totalCents` instead. */
export const total = totalCents;
```
```python
def total(*args, **kwargs):
    warnings.warn("total() is deprecated; use total_cents()", DeprecationWarning, stacklevel=2)
    return total_cents(*args, **kwargs)
```
```go
// Deprecated: Use TotalCents.
func Total(inv Invoice) int { return TotalCents(inv) }

// Bill is the old name of Invoice; the alias keeps both names interchangeable.
//
// Deprecated: Use Invoice.
type Bill = Invoice
```
```rust
#[deprecated(note = "use `total_cents`")]
pub fn total(inv: &Invoice) -> i64 { total_cents(inv) }
```

**Watch out:** names that leave the process — JSON fields, database columns, event names, metrics, env vars,
CLI flags, URL paths. Renaming those is a data or API migration, not a refactor (see section 15).

## 5. Move function / extract module

**Motivation:** code lives far from the data it uses, a module has several unrelated responsibilities, or a
file has grown too large to navigate.

**Mechanics:**
1. Create the destination module. Move the function and any private helpers only it uses.
2. In the original module, re-export the moved symbol so every importer keeps working. Typecheck and test.
3. Update importers to the new location in batches (Grep for imports of the old path), verifying per batch.
4. Remove the temporary re-export once nothing imports it.

**Example (TypeScript):**

```ts
// src/utils.ts — step 2: temporary re-export keeps old imports working
export { parseDuration, formatDuration } from './time/duration';

// step 3: callers move from
import { parseDuration } from '../utils';
// to
import { parseDuration } from '../time/duration';
```

In Python the equivalent is importing the moved name in the old module (`from .time.duration import
parse_duration  # noqa: F401  (re-export, remove after migration)`).

**Watch out:**
- **Import cycles.** In JavaScript a cycle yields `undefined` bindings at import time; in Python a partially
  initialized module raises `ImportError`; Go refuses to compile. Move code in the direction of dependencies:
  low-level modules must not import high-level ones.
- **Import-time side effects** run at a different time or not at all after the move.
- Go: moving across packages changes visibility — unexported identifiers are not reachable from the new package.

## 6. Introduce parameter object

**Motivation:** the same group of parameters travels together through several functions (a date range,
query options, coordinates). A named type documents the concept, shortens signatures and gives behaviour a home.

**Mechanics:**
1. Define the type with the same field names, types and defaults as the current parameters.
2. Add a new function that takes the object; move the body there.
3. Make the old function build the object and delegate. Typecheck and test.
4. Migrate callers in batches; delete the old function when Grep finds none.

**Example (Python):**

```python
# Before
def search_flights(origin, destination, depart_on, return_on=None, adults=1, children=0, cabin="economy"):
    ...

# After
@dataclass(frozen=True)
class FlightQuery:
    origin: str
    destination: str
    depart_on: date
    return_on: date | None = None
    adults: int = 1
    children: int = 0
    cabin: str = "economy"

def search(query: FlightQuery) -> list[Flight]:
    ...  # body moved here, reading query.origin etc.

def search_flights(origin, destination, depart_on, return_on=None, adults=1, children=0, cabin="economy"):
    return search(FlightQuery(origin, destination, depart_on, return_on, adults, children, cabin))
```

**Watch out:** defaults must match exactly; callers passing arguments positionally vs by keyword; mutability —
a shared mutable options object modified by a callee affects the caller (prefer immutable: `frozen=True`,
`readonly`, value types).

## 7. Replace conditional with polymorphism

**Motivation:** the same `switch`/`if` chain on a type code appears in several places, and every new variant
means editing all of them. Moving each variant's behaviour into its own implementation localizes change.

**Choose deliberately.** In TypeScript and Rust, a discriminated union / `enum` with an exhaustive
`switch`/`match` is often the idiomatic answer — the compiler tells you every place to update when a variant is
added. Polymorphism (interfaces, traits, classes) pays off when variants carry substantial, independently
evolving behaviour, or when new variants are added more often than new operations. A lookup table is enough when
the variants differ only in data.

**Mechanics:**
1. Define the interface (or trait/base class) with the operation(s) the conditional performs.
2. Create one implementation per variant, initially empty.
3. Move one case at a time from the conditional into its implementation; dispatch that case through the
   interface; test.
4. When every case has moved, replace the conditional with dispatch. Keep the default/unknown branch behaviour
   identical.

**Example (Go):**

```go
// Before
func Send(n Notification) error {
    switch n.Channel {
    case "email":
        return smtpSend(n.To, n.Subject, n.Body)
    case "sms":
        return smsSend(n.To, truncate(n.Body, 160))
    case "push":
        return pushSend(n.DeviceToken, n.Body)
    default:
        return fmt.Errorf("unknown channel %q", n.Channel)
    }
}

// After
type Sender interface {
    Send(n Notification) error
}

type emailSender struct{}
type smsSender struct{}
type pushSender struct{}

func (emailSender) Send(n Notification) error { return smtpSend(n.To, n.Subject, n.Body) }
func (smsSender) Send(n Notification) error   { return smsSend(n.To, truncate(n.Body, 160)) }
func (pushSender) Send(n Notification) error  { return pushSend(n.DeviceToken, n.Body) }

var senders = map[string]Sender{"email": emailSender{}, "sms": smsSender{}, "push": pushSender{}}

func Send(n Notification) error {
    s, ok := senders[n.Channel]
    if !ok {
        return fmt.Errorf("unknown channel %q", n.Channel) // identical error to before
    }
    return s.Send(n)
}
```

**Watch out:** fall-through cases and shared code between cases; the order of `if/else if` checks when
conditions overlap (the first match won before — make sure it still does); exhaustiveness checks lost when moving
from a `switch` over a union to an open interface.

## 8. Split phase

**Motivation:** one function does two different jobs in sequence — typically parse/validate input, then compute
or render. Splitting at an explicit intermediate data structure makes each phase testable and reusable.

**Mechanics:**
1. Define the intermediate data structure the second phase needs.
2. Extract the second phase into a function that takes that structure.
3. Extract the first phase into a function that produces it.
4. Make the original function compose the two. Test after each step.

**Example (Python):**

```python
# Before
def price_order(order_text: str, catalog) -> int:
    total = 0
    for line in order_text.strip().splitlines():
        sku, qty = line.split(",")
        product = catalog[sku.strip()]
        total += product.price_cents * int(qty)
    return total

# After
@dataclass(frozen=True)
class OrderLine:
    sku: str
    qty: int

def parse_order(order_text: str) -> list[OrderLine]:
    lines = []
    for line in order_text.strip().splitlines():
        sku, qty = line.split(",")
        lines.append(OrderLine(sku.strip(), int(qty)))
    return lines

def price_lines(lines: list[OrderLine], catalog) -> int:
    return sum(catalog[line.sku].price_cents * line.qty for line in lines)

def price_order(order_text: str, catalog) -> int:
    return price_lines(parse_order(order_text), catalog)
```

**Watch out:** **error timing changes.** Before, an unknown SKU on line 1 raised `KeyError` before a malformed
line 3 was parsed; after, the parse error on line 3 is raised first. If callers or tests depend on which error
surfaces, that is a behaviour change — check, and mention it. Memory use can also change (all lines are
materialized before pricing).

## 9. Replace nested conditional with guard clauses

**Motivation:** deep nesting hides the normal path. Handle special cases first and return early.

**Example (Go):**

```go
// Before
func payAmount(e Employee) Money {
    var result Money
    if e.IsSeparated {
        result = Money{}
    } else {
        if e.IsRetired {
            result = retiredAmount(e)
        } else {
            result = normalPayAmount(e)
        }
    }
    return result
}

// After
func payAmount(e Employee) Money {
    if e.IsSeparated {
        return Money{}
    }
    if e.IsRetired {
        return retiredAmount(e)
    }
    return normalPayAmount(e)
}
```

**Watch out:** code *after* the conditional in the original (logging, cleanup, metrics) that early returns now
skip — move it into `defer`/`finally` or keep it on every path. Keep the order of checks when conditions can
overlap.

## 10. Replace magic literal with named constant

**Motivation:** unexplained numbers and strings (`86400`, `"admin"`, `0.2`) hide meaning and get out of sync
when repeated.

**Example (Rust):**

```rust
// Before
if attempts > 5 {
    lock_account(&user);
}
sleep(Duration::from_millis(250 * 2u64.pow(attempts)));

// After
const MAX_LOGIN_ATTEMPTS: u32 = 5;
const BACKOFF_BASE_MS: u64 = 250;

if attempts > MAX_LOGIN_ATTEMPTS {
    lock_account(&user);
}
sleep(Duration::from_millis(BACKOFF_BASE_MS * 2u64.pow(attempts)));
```

**Watch out:** the same literal can mean different things (`5` attempts vs `5` retries). Only literals with the
same *meaning* share a constant; otherwise you couple unrelated rules.

## 11. Encapsulate variable

**Motivation:** widely shared mutable data (module-level objects, global config, public fields) is changed from
many places, making every change risky. Route access through functions so you can validate, observe or later
restructure it.

**Example (TypeScript):**

```ts
// Before — mutated directly from many modules
export let defaultOwner: Owner = { firstName: 'Ada', lastName: 'Example' };

// After
let defaultOwnerData: Owner = { firstName: 'Ada', lastName: 'Example' };

export function getDefaultOwner(): Owner {
  return { ...defaultOwnerData };
}
export function setDefaultOwner(owner: Owner): void {
  defaultOwnerData = owner;
}
```

**Watch out:** returning a copy changes semantics for callers that mutated the returned object on purpose. Grep
for writes (`defaultOwner.firstName =`) and convert those to `setDefaultOwner` calls *before* switching the
getter to return a copy.

## 12. Separate query from modifier

**Motivation:** a function that returns a value *and* changes state is surprising — callers who only want the
value trigger the side effect. Split it so queries are safe to call anywhere.

**Example (Python):**

```python
# Before — a "find" that also sends alerts
def find_intruder(people):
    for person in people:
        if person in BLOCKLIST:
            send_alert(person)
            return person
    return None

# After
def find_intruder(people):
    return next((p for p in people if p in BLOCKLIST), None)

def alert_on_intruder(people):
    intruder = find_intruder(people)
    if intruder is not None:
        send_alert(intruder)
    return intruder
```

**Watch out:** every existing caller relied on the side effect. Point them at `alert_on_intruder` first (same
behaviour), then switch only the callers that truly want a pure query.

## 13. Replace primitive with value type

**Motivation:** primitives with meaning — ids, money, email addresses, units — are easy to mix up and validate
inconsistently. A small type makes invalid combinations a compile error and gives validation one home.

**Example (Rust):**

```rust
// Before — easy to swap `from` and `to`, or pass dollars as cents
fn transfer(from: u64, to: u64, amount: i64) -> Result<(), TransferError>

// After
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AccountId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Cents(pub i64);

fn transfer(from: AccountId, to: AccountId, amount: Cents) -> Result<(), TransferError>
```

TypeScript equivalent: branded types (`type UserId = string & { readonly __brand: 'UserId' }`); Python:
`typing.NewType` for static checking or a frozen dataclass when validation is needed; Go: defined types
(`type UserID string`).

**Watch out:** serialization formats must not change — keep the wire representation identical
(`#[serde(transparent)]`, custom `toJSON`, `MarshalJSON`) unless the change is intended.

## 14. Remove dead code

**Motivation:** unused code costs reading time, misleads searches and keeps dependencies alive. Version control
remembers it if it is ever needed again.

**Mechanics:**
1. **Prove it is unused.** Grep for the name, its string forms and its file path. Check dynamic entry points:
   `package.json` `bin`/`exports`/scripts, Python entry points and plugin registries, framework conventions
   (routes discovered by file name, Django apps, DI containers), reflection, feature flags, cron/job configs,
   other repositories or services that call it.
2. Use tooling where the project has it: `npx knip` (unused files, exports and dependencies in JS/TS), `vulture`
   (Python), `deadcode` from `golang.org/x/tools/cmd/deadcode` (Go), and compiler warnings (`dead_code` in
   Rust, `noUnusedLocals` in TypeScript).
3. Delete it in its own step (and commit, if committing) so it is trivially revertible.
4. Remove now-unused imports, helpers, tests that only exercised the dead code, and dependencies.

**Watch out:** public library APIs are never "dead" just because the repository does not call them — removing
them is a breaking change.

## 15. Large-scale patterns

### Parallel change (expand → migrate → contract)

For changes with many call sites or external consumers. Every intermediate state builds, passes tests and can be
deployed.

1. **Expand:** introduce the new form next to the old one; make the old one delegate to the new one.
2. **Migrate:** move callers in batches (by directory/module/service). Verify and, if committing, commit per batch.
   Track batches in TodoWrite.
3. **Contract:** when Grep (and, for external consumers, usage metrics or deprecation warnings) shows no users,
   delete the old form.

The same pattern applies to data. Renaming a database column safely:

1. Add the new column; write to both columns.
2. Backfill the new column in batches.
3. Switch reads to the new column (deploy).
4. Stop writing the old column (deploy).
5. Drop the old column in a later migration.

See `atom:database-migrations` for the details of each step.

### Branch by abstraction

To replace a component (an ORM, an HTTP client, a payment provider) without a long-lived branch:

1. Introduce an interface capturing how callers use the component.
2. Route all callers through the interface, backed by the existing implementation.
3. Build the new implementation behind the same interface, with its own tests.
4. Switch over — optionally per call site or behind a feature flag — and remove the old implementation.

### Strangler fig

For replacing a whole subsystem: put a routing layer in front, send one feature or endpoint at a time to the new
implementation, and delete the old one when it no longer serves anything.

### Codemods

Mechanical, repetitive edits across many files are faster and more consistent with a structural tool — when the
project has one or the user agrees to use it:

```bash
# ast-grep: structural search and rewrite ($$$ matches any number of arguments)
ast-grep run --pattern 'logger.warn($$$ARGS)' --rewrite 'logger.warning($$$ARGS)' --lang python src/
ast-grep run --pattern 'logger.warn($$$ARGS)' --rewrite 'logger.warning($$$ARGS)' --lang python --update-all src/

# jscodeshift with a custom transform
npx jscodeshift -t scripts/codemods/rename-prop.ts src --extensions=ts,tsx --parser=tsx

# gofmt rewrite rules (pattern -> replacement, single-letter identifiers are wildcards)
gofmt -r 'bytes.Compare(a, b) == 0 -> bytes.Equal(a, b)' -w .
```

Run the codemod without applying first where the tool supports a preview, review a sample of the diff, then
apply, then run the full verification. Hand-fix the leftovers the pattern could not express, and Grep to confirm
nothing was missed.
