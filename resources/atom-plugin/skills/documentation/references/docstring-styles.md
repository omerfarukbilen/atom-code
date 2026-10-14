# Docstring and doc-comment conventions by language

Always match the style already used in the codebase (Grep a few existing docstrings first). If there is none, use
the defaults below. In every language the content is the same: **what it does, the contract (inputs, outputs,
errors, side effects), and an example when usage is not obvious**. Do not repeat information the type system
already states unless you add meaning (units, ranges, ownership, nullability semantics).

## TypeScript / JavaScript - TSDoc / JSDoc

TSDoc syntax (works with TypeDoc and editor hovers). In plain JavaScript, JSDoc type annotations (`@param {string}`)
also provide type checking under `// @ts-check`.

```ts
/**
 * Creates a signed, time-limited download URL for a stored file.
 *
 * The URL grants read access to anyone who has it until it expires, so do not log it.
 *
 * @param fileId - ID of a file owned by the current workspace.
 * @param options - Optional settings.
 * @param options.expiresInSec - Lifetime in seconds, 60 to 86_400. Defaults to 900 (15 minutes).
 * @returns An absolute HTTPS URL.
 * @throws {NotFoundError} If the file does not exist or belongs to another workspace.
 *
 * @example
 * ```ts
 * const url = await createDownloadUrl("file_123", { expiresInSec: 300 });
 * ```
 */
export async function createDownloadUrl(
  fileId: string,
  options: { expiresInSec?: number } = {},
): Promise<string> { /* ... */ }
```

Useful tags: `@param`, `@returns`, `@throws`, `@example`, `@remarks` (longer discussion), `@deprecated` (with the
replacement - editors strike through usages), `@see`, `{@link Symbol}`, `@internal` (exclude from public docs),
`@defaultValue` (TSDoc) for documented defaults.

Document React components on the props type, so each prop shows in editor hovers:

```tsx
interface FileTreeProps {
  /** Absolute workspace root; all node paths are relative to it. */
  root: string;
  /** Called with the relative path when the user opens a file (Enter or double-click). */
  onOpen: (relPath: string) => void;
  /** Paths matching these globs are hidden. Defaults to `[".git", "node_modules"]`. */
  exclude?: string[];
}
```

## Python - Google style (default), NumPy style, or reST

Follow PEP 257: a one-line summary in the imperative mood ending with a period, a blank line, then details. Type
hints carry the types; the docstring carries meaning.

```python
def resample(series: pd.Series, rule: str, *, how: str = "mean") -> pd.Series:
    """Resample a time-indexed series to a new frequency.

    Missing intervals are filled with NaN rather than dropped, so the result has a
    regular index even when the input has gaps.

    Args:
        series: Values indexed by a timezone-aware DatetimeIndex.
        rule: Pandas offset alias such as "15min", "1h" or "1D".
        how: Aggregation applied per interval: "mean", "sum", "min" or "max".

    Returns:
        A new series at the requested frequency; the input is not modified.

    Raises:
        ValueError: If the index is not a DatetimeIndex or ``how`` is unknown.

    Example:
        >>> idx = pd.date_range("2026-01-01", periods=4, freq="30min", tz="UTC")
        >>> resample(pd.Series([1, 3, 5, 7], index=idx), "1h").tolist()
        [2.0, 6.0]
    """
```

- Examples written as `>>>` sessions double as tests: `python -m doctest -v module.py` or
  `pytest --doctest-modules`.
- NumPy style (`Parameters\n----------`) is common in scientific code; Sphinx reST style (`:param x:`) in older
  projects. Keep whichever the project uses; `sphinx.ext.napoleon` understands Google and NumPy styles.
- Class docstrings describe the object's purpose and invariants; document `__init__` arguments in the class docstring
  or `__init__`, consistently.
- Module docstrings (top of file) summarize the module's responsibility.

## Go - doc comments

Go doc comments are plain comments directly above the declaration, starting with the identifier's name, in full
sentences. Since Go 1.19 they support headings (`# Heading`), lists, links (`[pkg.Symbol]`) and code blocks
(indented lines).

```go
// Package ratelimit implements a token-bucket limiter safe for concurrent use.
package ratelimit

// Limiter allows events up to a sustained rate with bursts up to a fixed size.
// The zero value is not usable; create one with [New].
type Limiter struct { /* ... */ }

// New returns a Limiter that refills ratePerSec tokens per second and holds at
// most burst tokens. It panics if ratePerSec <= 0 or burst < 1.
func New(ratePerSec float64, burst int) *Limiter { /* ... */ }

// Wait blocks until a token is available or ctx is done. It returns ctx.Err()
// if the context is canceled first; no token is consumed in that case.
func (l *Limiter) Wait(ctx context.Context) error { /* ... */ }
```

Runnable examples live in `example_test.go`, appear in the docs, and are verified by `go test` when they end with an
`// Output:` comment:

```go
func ExampleLimiter_Wait() {
	l := ratelimit.New(10, 1)
	if err := l.Wait(context.Background()); err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println("acquired")
	// Output: acquired
}
```

Every exported identifier should have a doc comment (`go vet` does not enforce it, but linters such as `revive`
do). View rendered docs with `go doc ./ratelimit Limiter.Wait`.

## Rust - rustdoc

`///` documents the next item, `//!` documents the enclosing module or crate. Markdown is supported. Conventional
sections: `# Examples`, `# Errors` (for `Result`-returning functions), `# Panics`, `# Safety` (required for `unsafe fn`).

```rust
/// Parses a duration such as `"1h30m"` or `"45s"` into a [`std::time::Duration`].
///
/// Units: `h`, `m`, `s`, `ms`. Components must appear from largest to smallest.
///
/// # Errors
///
/// Returns [`ParseError::InvalidUnit`] for unknown units and [`ParseError::Empty`]
/// for an empty string.
///
/// # Examples
///
/// ```
/// use mycrate::parse_duration;
/// use std::time::Duration;
///
/// assert_eq!(parse_duration("1m30s")?, Duration::from_secs(90));
/// # Ok::<(), mycrate::ParseError>(())
/// ```
pub fn parse_duration(input: &str) -> Result<Duration, ParseError> { /* ... */ }
```

- Code blocks in doc comments are compiled and run by `cargo test --doc`; lines starting with `# ` are hidden from
  the rendered docs but still compiled (useful for setup and `?` support).
- Mark examples that should not run with ```` ```no_run ```` (compile only) or ```` ```ignore ````, sparingly.
- `#![warn(missing_docs)]` at the crate root enforces docs on public items. Build docs with `cargo doc --open`.

## Shell scripts, config files, SQL

- Scripts: a header comment with purpose, usage line, required environment variables and exit codes; `--help`
  output that matches.
- Config files (YAML/TOML/JSON with comments): comment non-obvious keys with units and allowed values; keep a fully
  commented example file (`config.example.toml`, `.env.example`) in sync with what the code reads.
- SQL migrations: a top comment explaining why the change is needed and whether it is reversible.

## What not to write

```ts
/**
 * Gets the user.
 * @param id - The id.
 * @returns The user.
 */
function getUser(id: string): Promise<User> {}
```

This adds nothing the signature does not say. Either say something useful (what happens when the user does not
exist? is the result cached? which permissions are checked?) or write no docstring.
