# Security review checklist (OWASP-aligned)

Organized by the OWASP Top 10 (2021) web categories, with the OWASP API Security Top 10 (2023) items folded in
where they apply. Use it as a coverage map: tick an item only after checking the code, and record the `path:line`
evidence for both problems and "verified OK" items.

## A01 Broken access control (API1 BOLA, API3 BOPLA, API5 BFLA)

- [ ] Every handler that accepts an object ID scopes the lookup to the caller (owner / tenant / org), or performs an
      explicit policy check before returning or mutating the object.
- [ ] Collection endpoints filter by tenant; search, export, report and bulk endpoints too.
- [ ] Function-level authorization: admin/staff routes and actions check roles server-side; no reliance on hidden UI.
- [ ] Property-level authorization: responses do not include fields the caller should not see (password hashes,
      internal notes, other users' emails); writes cannot set privileged fields (mass assignment of `role`,
      `isAdmin`, `ownerId`, `price`, `status`).
- [ ] Default deny: new routes are protected unless explicitly public (middleware applied globally, not per route).
- [ ] CORS: no reflection of arbitrary `Origin` together with `Access-Control-Allow-Credentials: true`.
- [ ] Directory listing disabled; static file serving cannot reach source, `.git`, `.env`, backups.
- [ ] Path traversal: file paths derived from input are resolved and checked for containment (including archive
      extraction and symlinks).
- [ ] Background jobs, webhooks and queue consumers re-check authorization for the acting principal.

## A02 Cryptographic failures

- [ ] Sensitive data encrypted in transit (TLS everywhere, HSTS on web apps) and, where required, at rest.
- [ ] TLS certificate verification never disabled (`rejectUnauthorized: false`, `verify=False`,
      `InsecureSkipVerify: true`, `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- [ ] Passwords hashed with argon2id, scrypt or bcrypt with appropriate cost; no MD5/SHA-1/SHA-256-only hashing.
- [ ] Security tokens (session IDs, reset tokens, API keys, CSRF tokens) generated with a CSPRNG and sufficient
      length (>= 128 bits).
- [ ] Symmetric encryption uses AEAD (AES-GCM, ChaCha20-Poly1305) with unique nonces; no ECB; no static IVs; keys
      not hard-coded.
- [ ] Secret comparison is constant-time.
- [ ] No custom cryptographic algorithms or protocols.
- [ ] Sensitive data not logged (passwords, tokens, full card numbers, personal data beyond need).

## A03 Injection

- [ ] SQL: parameterized queries everywhere; raw ORM fragments reviewed; dynamic identifiers allowlisted.
- [ ] NoSQL: query objects not built from raw user JSON (MongoDB operator injection like `{"$ne": null}`); cast
      inputs to expected types.
- [ ] OS command: no shell invocation with user data; argument arrays; `--` before user-supplied positional args.
- [ ] Code: no `eval`, `new Function`, `vm.runInContext` (not a security boundary), Python `eval`/`exec` on input.
- [ ] Template: user input never compiled as a template (SSTI).
- [ ] LDAP, XPath, header (CRLF), log injection: values encoded for their context; newlines stripped from header
      values and single-line log fields.
- [ ] XSS: output encoded by context; `dangerouslySetInnerHTML` / `v-html` / `innerHTML` only with sanitized HTML;
      user-controlled URLs restricted to `http(s):`; JSON embedded in HTML is escaped (`<` as `<`).
- [ ] Regex: user input not used to build regexes without escaping; no catastrophic-backtracking patterns on
      untrusted input (ReDoS).

## A04 Insecure design

- [ ] Business-logic abuse considered: negative quantities, coupon stacking, race conditions on balance/stock
      (use transactions with proper isolation or atomic updates), replaying one-time actions.
- [ ] Rate limits / quotas on expensive or abusable operations (login, signup, password reset, OTP, search,
      exports, AI calls, emails/SMS sent).
- [ ] Resource limits: max body size, upload size and type, pagination maximums, query depth/complexity (GraphQL),
      timeouts on outbound calls (API4 unrestricted resource consumption).
- [ ] Sensitive business flows protected against automation where needed (API6).

## A05 Security misconfiguration

- [ ] Debug mode, verbose errors and stack traces disabled in production; error responses generic.
- [ ] Security headers on web responses: `Content-Security-Policy`, `Strict-Transport-Security`,
      `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame protection (`frame-ancestors` or `X-Frame-Options`).
- [ ] Cookies: `HttpOnly`, `Secure`, `SameSite=Lax|Strict`, narrow `Path`/`Domain`.
- [ ] Default credentials, sample apps, admin consoles and unused endpoints removed.
- [ ] Cloud/storage buckets not public unless intended; least-privilege IAM for the app's credentials.
- [ ] Containers do not run as root unnecessarily; secrets not baked into images.
- [ ] XML parsers have external entities disabled (XXE).

## A06 Vulnerable and outdated components

- [ ] Ecosystem audit run and triaged: `npm audit --omit=dev` / `pnpm audit --prod`, `pip-audit`, `cargo audit`,
      `govulncheck ./...`, `osv-scanner -r .`.
- [ ] Lockfiles committed; dependencies pinned via lockfile; no install from arbitrary Git URLs without pinning.
- [ ] Unmaintained or typo-squatted packages flagged (check names carefully, download counts, repository links).
- [ ] Runtime versions (Node, Python, Electron, base images) still receive security updates.

## A07 Identification and authentication failures

- [ ] Login, reset and MFA endpoints rate-limited and resistant to user enumeration (same response and similar
      timing for existing and non-existing accounts).
- [ ] Session ID regenerated at login and privilege change; sessions invalidated at logout and password change.
- [ ] Reset tokens: random, single-use, expire quickly, bound to the user, invalidated after use.
- [ ] JWT: signature verified with explicit algorithm allowlist; `exp`, `iss`, `aud` validated; no secrets in the
      payload; `none` algorithm rejected; key rotation possible.
- [ ] OAuth/OIDC: `state` (and PKCE for public clients) validated; redirect URIs exact-match allowlisted; ID token
      validated.
- [ ] API keys stored hashed server-side; transmitted only in headers; scoped and revocable.

## A08 Software and data integrity failures

- [ ] No unsafe deserialization of untrusted data (pickle, yaml.load, Java/PHP/.NET native serialization).
- [ ] JavaScript prototype pollution: deep merges and path-setters reject `__proto__`, `constructor`, `prototype`.
- [ ] Webhooks verify signatures (HMAC over raw body + timestamp) with constant-time compare and replay window.
- [ ] Auto-update mechanisms verify signatures (Electron: code-signed releases, HTTPS update feed).
- [ ] CI/CD: third-party actions pinned to commit SHAs; untrusted PRs cannot access secrets
      (`pull_request_target` misuse); build scripts do not curl-pipe-shell unpinned content.

## A09 Security logging and monitoring failures

- [ ] Authentication events, authorization failures, admin actions and high-value transactions are logged with
      actor, action, target and timestamp.
- [ ] Logs exclude secrets and unnecessary personal data; log injection prevented.
- [ ] Alerts exist (or are recommended) for brute force and anomalous access patterns.

## A10 Server-side request forgery (and API10 unsafe consumption of APIs)

- [ ] User-influenced outbound URLs restricted by scheme and host allowlist, or resolved and blocked for private,
      loopback, link-local and metadata ranges, with connection pinned to the checked IP.
- [ ] Redirects disabled or re-validated per hop; timeouts and response size limits set.
- [ ] Responses from third-party APIs are validated like user input before use (schema, size, types).

## Client and desktop specifics

- [ ] Browser storage: no long-lived secrets in `localStorage` where XSS could read them; prefer `HttpOnly` cookies.
- [ ] `postMessage` handlers check `event.origin`; senders specify a target origin (not `"*"`) for sensitive data.
- [ ] Electron: see electron-hardening.md (contextIsolation, sandbox, IPC validation, openExternal, navigation, CSP,
      fuses).
- [ ] Deep links / custom protocol handlers validate every parameter as untrusted input.
- [ ] Local servers (dev servers, IDE bridges, agents) bind to `127.0.0.1`, require a token, and check `Origin`/`Host`
      to resist DNS rebinding and drive-by requests from web pages.

## Secrets

- [ ] No credentials, API keys, private keys or tokens in source, config committed to Git, test fixtures, or
      client bundles (anything in a frontend bundle is public).
- [ ] `.env*` files gitignored (except documented `.env.example` with dummy values).
- [ ] History scanned (`gitleaks detect --source .` / `trufflehog git file://.`); exposed secrets rotated.
