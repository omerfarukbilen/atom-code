---
name: security-audit
description: Threat-model-first security review of code or a diff - traces untrusted input to dangerous sinks (SQL, shell, filesystem paths, templates, HTML), checks XSS, CSRF, SSRF, authentication and authorization flaws, secrets in code, crypto misuse, unsafe deserialization, vulnerable dependencies, and Electron hardening, then reports verified findings with severity and fixes. Use when asked for a security review or audit, before releasing code that handles user input, auth, files, payments or IPC, or when a scanner reports vulnerabilities.
---

# Security Audit

A useful security review finds the few vulnerabilities an attacker could actually exploit and explains how to
fix them. It does not dump a hundred scanner warnings. Work like an attacker with the source code: understand what
is valuable, find where untrusted data enters, follow it to where it can do damage, and prove each step.

## When to use

- The user asks for a security review, audit, pentest-style code review, or "is this safe?".
- A change touches authentication, sessions, permissions, file handling, shell commands, SQL, templates, HTML
  rendering, URL fetching, deserialization, cryptography, payments, secrets, or Electron main/preload/IPC code.
- `npm audit`, Dependabot, Snyk, CodeQL or similar reported findings that need triage.

Not for: actively attacking systems you do not own, testing against production, or writing working exploits for
third-party software. Keep testing local and non-destructive. A general review of a diff (correctness, tests,
readability) is `atom:code-review`, which covers security in one pass and hands deep cases to this skill.

For large codebases, parallelize: delegate independent areas (e.g. "auth and sessions", "file upload paths",
"Electron IPC surface") to the `atom:security-auditor` subagent via the Agent tool, then merge and de-duplicate.

## Step 1 - Scope and threat model (10 minutes, not a document)

Write down briefly (TodoWrite works well for tracking the areas):

1. **Scope**: the diff (`git --no-pager diff origin/main...HEAD`), a feature, or the whole repository.
2. **Assets**: what an attacker wants - user data, credentials and tokens, money movement, admin capabilities,
   the host machine (code execution), availability.
3. **Actors and trust boundaries**: anonymous internet user, authenticated user, other tenants, admins, the
   renderer process vs the Electron main process, third-party webhooks, CI. Every boundary crossing is a place where
   input must be validated and authorization checked.
4. **Entry points**: HTTP routes, GraphQL resolvers, IPC handlers, CLI arguments, environment/config, file uploads
   and parsers, message-queue consumers, webhooks, deep links / custom protocols, data read back from the database
   that users originally wrote (stored XSS).

A quick STRIDE pass over each boundary helps you not to miss whole classes: Spoofing (authn), Tampering (integrity,
injection), Repudiation (audit logs), Information disclosure, Denial of service, Elevation of privilege (authz).

## Step 2 - Map the attack surface

Use Grep/Glob to enumerate entry points and dangerous sinks. Ready-made patterns per language:
[references/grep-patterns.md](references/grep-patterns.md). Typical first searches:

- Routes/handlers: `app\.(get|post|put|patch|delete)\(`, `@(app|router)\.(get|post)`, `HandleFunc\(`, `#\[(get|post)`
- IPC: `ipcMain\.(handle|on)\(`, `contextBridge\.exposeInMainWorld`
- Sinks: `exec\(|execSync|spawn\(.*shell|subprocess\..*shell=True|os\.system|eval\(|new Function\(`,
  `innerHTML|dangerouslySetInnerHTML|v-html`, `\$\{.*\}.*(SELECT|INSERT|UPDATE|DELETE)`, `pickle\.loads|yaml\.load\(`,
  `fetch\(|axios\.|requests\.(get|post)|http\.Get\(` (SSRF candidates)

## Step 3 - Trace sources to sinks

For each sink, walk backwards with Read until you reach either a constant (safe) or an untrusted source. Ask:

- Is the value attacker-controlled (directly or via stored data)?
- Is there validation, and is it an **allowlist** applied **on the server** at the right layer?
- Is the sink used safely (parameterized query, argument array, encoded output) regardless of validation?
- Can an attacker reach this code path with their privileges?

A sink without a reachable attacker-controlled source is not a finding (maybe a hardening note). This verification
step is what separates a security review from noise.

## Step 4 - Check each vulnerability class

The full checklist with more items: [references/owasp-checklist.md](references/owasp-checklist.md). The classes
that matter most, with the safe pattern:

**SQL injection** - never build queries with string concatenation or interpolation.

```ts
// Bad
await db.query(`SELECT * FROM users WHERE email = '${email}'`);
// Good (node-postgres)
await db.query("SELECT * FROM users WHERE email = $1", [email]);
```

```python
# Bad
cur.execute(f"SELECT * FROM users WHERE email = '{email}'")
# Good (DB-API)
cur.execute("SELECT * FROM users WHERE email = %s", (email,))
```

ORMs are safe until someone uses raw fragments: check `$queryRawUnsafe`, `sequelize.literal`, `.raw(`, `text(f"...")`,
`extra(`/`RawSQL` with interpolated values. Identifiers (column names in `ORDER BY`) cannot be parameterized -
map them through an allowlist.

**Command injection** - avoid the shell; pass arguments as an array.

```ts
// Bad: the shell interprets `; rm -rf ~` or `$(curl ...)` inside filePath
exec(`git log --oneline ${filePath}`);
// Good: no shell; "--" ends option parsing, so a value like "--output=/tmp/x" is treated as a path
execFile("git", ["log", "--oneline", "--", filePath]);
```

```python
# Good: argument list, no shell=True with a formatted string
subprocess.run(["git", "log", "--oneline", "--", file_path], check=True)
```

Go's `exec.Command(name, args...)` does not use a shell - unless someone calls `exec.Command("sh", "-c", userString)`.

**Path traversal** - resolve, then verify containment.

```ts
const root = path.resolve(uploadsDir);
const target = path.resolve(root, userPath);
if (target !== root && !target.startsWith(root + path.sep)) throw new ForbiddenError();
// Also consider symlinks inside root: compare fs.realpathSync(target) when files can be linked.
```

```python
root = Path(uploads_dir).resolve()
target = (root / user_path).resolve()
if not target.is_relative_to(root):   # Python 3.9+
    raise PermissionError
```

Zip/tar extraction ("zip slip") needs the same check for every entry name.

**Template injection (SSTI)** - never compile user input as a template (`render_template_string(user_input)`,
`new Function`, `_.template(userInput)`, `Handlebars.compile(userInput)`). Pass user data as template *variables*.

**XSS** - encode on output, by context. Frameworks escape by default; findings live where escaping is bypassed:
`dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`, `innerHTML =`, `document.write`, `insertAdjacentHTML`,
`href={userUrl}` (allows `javascript:` URLs - allow only `http:`/`https:`), Markdown renderers with HTML enabled.
If HTML must be rendered, sanitize with DOMPurify (or an equivalent maintained sanitizer), and add a strict
Content-Security-Policy as defense in depth.

**CSRF** - relevant when authentication is cookie-based. Require `SameSite=Lax` or `Strict` cookies plus a CSRF token
or an `Origin`/`Sec-Fetch-Site` check on state-changing requests; never change state on GET. Bearer tokens in an
`Authorization` header are not CSRF-prone.

**SSRF** - server fetches a user-supplied URL (webhooks, link previews, image import). Allowlist schemes and hosts
where possible; otherwise resolve DNS and block private, loopback, link-local and metadata addresses
(`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`),
connect to the resolved IP (to defeat DNS rebinding), disable or re-validate redirects, and set timeouts and size
limits.

**Authentication** - passwords hashed with argon2id, scrypt or bcrypt (never MD5/SHA-x alone); rate-limited
login and reset endpoints; session ID rotated on login; cookies `HttpOnly`, `Secure`, `SameSite`; reset tokens
random, single-use, short-lived; JWTs verified with an explicit algorithm allowlist, issuer, audience and expiry
(`jwt.verify(token, key, { algorithms: ["RS256"], issuer, audience })`) - never `jwt.decode` for trust decisions.

**Authorization** - the most common serious bug in real applications (OWASP API #1, BOLA/IDOR). For every handler
that takes an ID, confirm the query is scoped to the caller:

```ts
// Bad: any logged-in user can read any invoice by guessing IDs
const invoice = await db.invoice.findUnique({ where: { id: req.params.id } });
// Good
const invoice = await db.invoice.findFirst({ where: { id: req.params.id, orgId: req.user.orgId } });
if (!invoice) throw new NotFoundError();
```

Also check: role checks enforced server-side (not only hidden buttons), mass assignment (`Object.assign(user, req.body)`
setting `role`), admin routes protected, multi-tenant isolation in background jobs and exports.

**Secrets in code** - Grep for keys and tokens (patterns in grep-patterns.md), check `.env` files are gitignored,
and scan history: `gitleaks detect --source .` or `trufflehog git file://.` if installed. A committed secret must be
**rotated**; deleting the line does not remove it from Git history. When reporting, show only a prefix
(`sk_live_51H...`), never the full secret.

**Cryptography misuse** - tokens from `Math.random()`/`random.random()` (use `crypto.randomBytes`,
`crypto.randomUUID()`, Python `secrets`, Go `crypto/rand`); ECB mode, static or reused IVs/nonces, unauthenticated
encryption (prefer AES-GCM or libsodium/age); homemade crypto; non-constant-time comparison of secrets (use
`crypto.timingSafeEqual`, `hmac.compare_digest`, `subtle.ConstantTimeCompare`); disabled TLS verification
(`rejectUnauthorized: false`, `verify=False`, `InsecureSkipVerify: true`).

**Unsafe deserialization** - `pickle.loads`, `yaml.load` without `SafeLoader` (use `yaml.safe_load`), `marshal`,
Java `ObjectInputStream`, PHP `unserialize`, .NET `BinaryFormatter`, `node-serialize` on untrusted data. In
JavaScript, also prototype pollution: deep-merging user JSON into objects (`__proto__`, `constructor.prototype`
keys) - validate with a schema (zod, ajv) and use `Object.create(null)` or `Map` for dictionaries.

**Dependencies** - run the ecosystem's auditor and triage results (is the vulnerable function reachable? is it a
dev-only dependency?):

```bash
npm audit --omit=dev        # or: pnpm audit --prod | yarn npm audit (Yarn 2+) | yarn audit (Yarn 1)
pip-audit                   # Python (pip install pip-audit)
cargo audit                 # Rust (cargo install cargo-audit)
govulncheck ./...           # Go - reports only vulnerabilities in code you actually call
osv-scanner -r .            # multi-ecosystem, if installed
```

Do not run `npm audit fix --force` - it can apply breaking major upgrades. Propose targeted upgrades instead and carry
them out with `atom:dependency-upgrades`.

**Electron** - the renderer must be treated as untrusted (it renders web content, and any XSS becomes code execution
if the renderer has Node access). Check `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a narrow
`contextBridge` API (never expose `ipcRenderer` itself), every `ipcMain.handle` validating sender and arguments,
`shell.openExternal` restricted to `https:` URLs, navigation and `window.open` locked down, and a CSP. Full
checklist with code: [references/electron-hardening.md](references/electron-hardening.md).

## Step 5 - Score severity

Rate each verified finding by **impact x exploitability** in this codebase's real deployment:

| Severity | Typical meaning | Examples |
| --- | --- | --- |
| Critical | Remote, unauthenticated or low-privilege attacker gets code execution, full data access or account takeover; trivial to exploit | SQLi on a public endpoint, RCE via command injection, Electron renderer XSS with nodeIntegration, leaked production credentials |
| High | Significant data exposure or privilege escalation; requires an account or some conditions | IDOR exposing other tenants' data, auth bypass on admin routes, stored XSS, SSRF reaching cloud metadata |
| Medium | Limited impact or harder preconditions | Reflected XSS requiring user interaction, CSRF on non-critical actions, missing rate limit on login, verbose errors leaking internals |
| Low | Defense-in-depth gaps, minor info leaks | Missing security headers, weak but non-exploitable config, outdated dependency without a reachable vuln |
| Info | Observations and hardening suggestions | Code patterns that are safe today but fragile |

When the findings feed a code review, map Critical/High to blocker, Medium to major and Low/Info to minor
(the `atom:code-review` scale).

Optionally attach a CVSS v4.0 vector and the CWE ID (e.g. CWE-89 SQL injection, CWE-78 OS command injection, CWE-22
path traversal, CWE-79 XSS, CWE-352 CSRF, CWE-918 SSRF, CWE-639 IDOR, CWE-798 hard-coded credentials, CWE-502
deserialization).

## Step 6 - Report

Lead with a summary (scope, method, counts by severity, the top risk in one sentence), then one block per finding,
most severe first:

```markdown
### [High] IDOR: any user can read other organizations' invoices
- **Location:** src/api/invoices.ts:42 (`GET /invoices/:id`)
- **CWE:** CWE-639
- **Description:** The handler loads the invoice by `id` only; `orgId` from the session is never checked.
- **Exploit scenario:** A user of org A requests `/invoices/inv_123` belonging to org B and receives it. IDs are
  sequential, so all invoices can be enumerated.
- **Fix:** Scope the query by `orgId` and return 404 when not found (code below). Add a test with two orgs.
- **Confidence:** Confirmed (traced from route to query; no middleware adds tenant scoping).
```

Rules for the report:

- Cite every location as `path:line` so the user can click through in ATOM.
- Only report what you verified; label anything unverified as "Needs confirmation" with what would confirm it.
- Give a concrete fix (code), not "sanitize input". Prefer fixes at the sink (parameterize, encode, avoid shell) over
  input blocklists, which are always incomplete.
- Note what you reviewed and found **no** issues in, so coverage is clear.
- Do not modify code during an audit unless the user asked for fixes; if they did, fix one finding at a time and add
  a regression test for each (`atom:test-driven-development`).

## Common pitfalls

- Reporting scanner output verbatim without checking reachability or context.
- Missing authorization bugs because each handler "looks fine" in isolation - always ask "whose object is this?".
- Trusting client-side validation, hidden form fields, or the `Referer` header.
- Blocklist "fixes" (stripping `../` once, escaping `'` manually, filtering `<script>`).
- Forgetting second-order flows: data stored safely, later used unsafely (stored XSS, SQL built from DB values).
- Printing discovered secrets in full in the chat or report.
- Running destructive or network-attacking commands; a review is static analysis plus safe local tests.

## Definition of done

- [ ] Scope, assets, trust boundaries and entry points written down.
- [ ] Every entry point checked for authentication, authorization and input validation.
- [ ] Every dangerous sink found by search traced to its sources; each finding verified as reachable.
- [ ] Secrets, crypto, deserialization, dependency audit and (if applicable) Electron checks completed.
- [ ] Findings reported with severity, `path:line`, exploit scenario, concrete fix and confidence; clean areas listed.
- [ ] If fixes were made: each has a regression test, diagnostics are clean (`mcp__atom-ide__get_diagnostics`), and
      the test suite passes.
