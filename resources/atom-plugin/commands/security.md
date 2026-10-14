---
description: Security audit of a path, feature, diff or the whole repository - threat model, source-to-sink tracing, dependency audit and severity-ranked findings with fixes
argument-hint: "[path | feature | diff | ref range | blank for the whole repo]"
---

Run a security audit of the target below. Follow the `atom:security-audit` skill (load it with the Skill
tool; its references have grep patterns per language, the OWASP checklist and Electron hardening). This is
an audit: do not modify code unless the user asks for fixes afterwards.

Audit target from the user: $ARGUMENTS

## 1. Scope

- **Empty** → the whole repository, prioritized by exposure: internet-facing entry points first, then
  authentication and authorization, file and process handling, IPC, background consumers.
- **`diff`** → uncommitted changes (`git diff HEAD`); **a ref range** → `git diff <base>...<head>`.
- **A path or feature** → that code plus the entry points that reach it and the sinks it reaches.

## 2. Threat model (a few lines, not a document)

Write down the assets (user data, credentials, money, admin capabilities, the host machine), the actors and
trust boundaries (anonymous user, authenticated user, other tenants, admins, renderer vs main process,
webhooks, CI), and the entry points (routes, resolvers, IPC handlers, CLI arguments, file parsers, queue
consumers, deep links, stored user content). Track the areas to cover in TodoWrite.

## 3. Map, trace, verify

1. Enumerate entry points and dangerous sinks with Grep (patterns in the skill's
   `references/grep-patterns.md`): SQL built from strings, shell execution, path joins with user input,
   HTML injection sinks, template rendering, deserialization, outbound requests with user-controlled URLs,
   redirects, `eval`, Electron `webPreferences` and IPC handlers.
2. Trace each sink back to its sources. A finding needs a reachable path from attacker-controlled data to the
   sink without an effective control; a sink fed only by constants is not a finding.
3. Check authorization separately for every object access by id: whose object is it, and where is that checked?
4. Review secrets, crypto, session and cookie settings, CSRF, CORS, security headers, and Electron hardening
   where relevant.
5. Audit dependencies read-only and triage by reachability:
   ```bash
   npm audit --omit=dev      # or pnpm audit --prod / yarn npm audit / yarn audit
   pip-audit                 # if installed
   govulncheck ./...         # if installed
   cargo audit               # if installed
   ```
   Never run `npm audit fix` or upgrade packages during the audit.

For a large codebase, delegate independent areas (for example "auth and sessions", "file upload paths",
"Electron IPC surface") to `atom:security-auditor` subagents in parallel with the Agent tool, then verify,
de-duplicate and re-grade their findings yourself.

Keep all testing local and non-destructive. Never print a discovered secret in full - show the location and a
redacted prefix, and recommend rotation.

## 4. Report

```markdown
## Security audit: <scope>
**Method:** <threat model, areas traced, tools run>
**Findings:** <n> Critical · <n> High · <n> Medium · <n> Low · <n> Info
**Top risk:** <one sentence>

### [Severity] <title>
- **Location:** path:line
- **CWE:** CWE-<id>
- **Description:** <what is wrong>
- **Exploit scenario:** <who can do what, concretely>
- **Fix:** <concrete code-level fix at the sink, with a snippet>
- **Confidence:** Confirmed | Likely — <how you verified>

### Needs confirmation
- path:line — suspicion and what would confirm it

### Reviewed with no findings
- <areas and entry points checked and clean>
```

Severity is impact times exploitability in this deployment: **Critical** (remote or low-privilege code
execution, full data access, account takeover), **High** (significant data exposure or privilege escalation
with some preconditions), **Medium** (limited impact or harder preconditions), **Low** (defense-in-depth
gaps), **Info** (hardening notes). Order findings most severe first.

Finish by offering to fix the Critical and High findings one at a time, each with a regression test.
