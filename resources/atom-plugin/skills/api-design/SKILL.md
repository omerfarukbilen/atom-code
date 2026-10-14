---
name: api-design
description: Design or review HTTP APIs (REST, RPC/gRPC, GraphQL) - resource modeling, URL and field naming, methods and status codes, RFC 9457 problem-details errors, pagination, filtering, idempotency keys, concurrency control, authentication and authorization, rate limiting, versioning and backwards compatibility, and OpenAPI specs. Use when adding or changing an endpoint, schema, webhook or public SDK surface, writing an OpenAPI/proto/GraphQL schema, or reviewing an API for consistency and breaking changes.
---

# API Design

An API is a promise to code you will never see. Internal implementation can be refactored any afternoon; a
published field name lives for years. Design for the consumer, be boringly consistent, and make every change
additive.

## When to use

- Adding, changing or removing an endpoint, query parameter, request/response field, error, header or webhook.
- Writing or updating an OpenAPI document, `.proto` file or GraphQL schema.
- Reviewing an API diff for consistency, security and breaking changes.

Not for: internal function signatures inside one codebase (use normal refactoring judgment), or database schema
design and migrations (`atom:database-migrations`; related, but storage shape should not dictate API shape).

## Step 1 - Start from the consumer

Before writing any route, answer (ask the user with AskUserQuestion if the code does not tell you):

1. **Who calls it?** Your own frontend, third-party developers, other internal services, mobile apps that cannot
   be force-updated? The less control you have over clients, the stricter compatibility must be.
2. **What jobs do they need to do?** Write the 3-5 key use cases as calls: "list my open invoices, newest first",
   "pay an invoice exactly once even if the network drops".
3. **What exists already?** Read the existing routes/handlers/spec (Grep for `router.`, `app.get(`, `@app.`,
   `HandleFunc`, `openapi`, `.proto`, `type Query`). Match their conventions for naming, casing, envelopes,
   pagination and errors - an inconsistent "better" design is worse than a consistent ordinary one.

## Step 2 - Model resources (REST)

- Resources are **nouns**, plural, lower-case, kebab-case: `/invoices`, `/invoices/{invoiceId}`,
  `/invoices/{invoiceId}/line-items`. Avoid verbs in paths; the method is the verb.
- Nest at most one level to express ownership. Beyond that, link by ID: `/line-items?invoiceId=...`.
- Actions that are not CRUD: model the action's result as a resource (`POST /invoices/{id}/payments`) or, when that
  is contrived, use a sub-resource verb with POST: `POST /invoices/{id}:void` (Google AIP style) or
  `POST /invoices/{id}/void`. Pick one style per API.
- IDs are opaque strings in JSON (`"id": "inv_8f2k..."`), even if they are integers in the database - it keeps you
  free to change ID schemes and avoids 2^53 precision loss in JavaScript. Prefixed IDs make logs self-describing.

**Method semantics** (get these right; clients, proxies and retries rely on them):

| Method | Use | Safe | Idempotent | Typical success |
| --- | --- | --- | --- | --- |
| GET | Read a resource or collection | yes | yes | 200 |
| POST | Create in a collection, or trigger an action | no | no (make it so with Idempotency-Key) | 201 + `Location`, or 200/202 |
| PUT | Replace a resource entirely (or create at a client-chosen ID) | no | yes | 200 or 204 (201 if created) |
| PATCH | Partial update (JSON Merge Patch RFC 7396 or JSON Patch RFC 6902) | no | not necessarily | 200 or 204 |
| DELETE | Remove | no | yes (repeat returns 204 or 404, never 500) | 204 |

Status code guide with decision rules: [references/http-status.md](references/http-status.md).

## Step 3 - Design representations

- **Field naming**: one convention for the whole API - `camelCase` (JS-centric) or `snake_case` - matching the
  existing API. Never mix.
- **Timestamps**: RFC 3339 strings in UTC with a `Z` suffix (`"2026-03-04T10:15:30Z"`); name them `createdAt`,
  `updatedAt`, `expiresAt`. Dates without time: `"2026-03-04"`.
- **Money**: integer minor units plus currency (`{"amount": 1999, "currency": "EUR"}`) or a decimal string. Never
  floats.
- **Enums**: lower-case strings (`"status": "past_due"`), documented, and clients must tolerate unknown values
  (state this in the docs so you can add values later).
- **Booleans** named as predicates (`isArchived`, `hasMore`); avoid tri-state booleans - use an enum.
- **Nulls**: decide and document whether absent and `null` differ (they matter for PATCH).
- Return the created/updated resource from POST/PUT/PATCH so clients do not need a second GET.
- Do not leak internals: no database column names that make no sense to consumers, no stack traces, no internal
  hostnames.

## Step 4 - Errors: RFC 9457 Problem Details

Use one error format everywhere, with `Content-Type: application/problem+json`:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Request validation failed",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/invoices",
  "errors": [
    { "pointer": "#/lineItems/0/quantity", "detail": "must be greater than 0" },
    { "pointer": "#/dueDate", "detail": "must be a date in the future" }
  ],
  "traceId": "4bf92f3577b34da6"
}
```

- `type` is a stable URI identifying the problem kind - clients branch on it (or on a stable `code` extension),
  never on `title`/`detail` text, which is for humans and may change or be localized.
- `status` mirrors the HTTP status. `errors` and `traceId` are extension members (allowed by the RFC).
- Validate input at the boundary and report **all** field errors at once, with JSON Pointers to the field.
- Map exceptions centrally (one error middleware) so no handler can leak a stack trace or an ad-hoc shape.
  How errors should travel from the database or a client library to that middleware - typed errors, wrapping,
  retries and logging - is covered by `atom:error-handling`.

```ts
// TypeScript (Express-style) - central mapping
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const p = err instanceof ProblemError ? err.problem
    : { type: "about:blank", title: "Internal Server Error", status: 500 };
  if (p.status >= 500) logger.error({ err, path: req.path }, "unhandled error"); // details stay in logs
  res.status(p.status).type("application/problem+json").json({ ...p, instance: req.originalUrl });
});
```

```go
// Go net/http
func writeProblem(w http.ResponseWriter, p Problem) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}
```

## Step 5 - Collections: pagination, filtering, sorting

- **Always paginate collections**, even if they are small today. Adding pagination later is a breaking change.
- Prefer **cursor pagination** for feeds and large or frequently changing data: stable under inserts, O(1) seeks
  with a keyset index. Offset pagination (`?page=3`) is fine for small, admin-style lists where jumping to page N matters.
- Request: `?limit=50&cursor=eyJpZCI6...` with a documented default and maximum `limit` (e.g. 20 / 100).
- Response: `{"data": [...], "nextCursor": "eyJ...", "hasMore": true}` (or RFC 8288 `Link: <...>; rel="next"`).
  Cursors are opaque (base64-encoded JSON of the sort key + id) so you can change their contents later.
- Filtering with plain query params: `?status=open&customerId=cus_123&createdAfter=2026-01-01T00:00:00Z`.
  Sorting: `?sort=-createdAt,name` (leading `-` for descending). Allowlist sortable/filterable fields - each one
  needs an index, and arbitrary sorting is a denial-of-service vector.

```python
# Python keyset pagination (SQLAlchemy 2.x) - sort by (created_at, id) for a total order
from sqlalchemy import select, tuple_

def list_invoices(session, limit: int, cursor: str | None):
    limit = min(limit, 100)
    stmt = select(Invoice).order_by(Invoice.created_at.desc(), Invoice.id.desc()).limit(limit + 1)
    if cursor:
        created_at, last_id = decode_cursor(cursor)
        stmt = stmt.where(tuple_(Invoice.created_at, Invoice.id) < (created_at, last_id))
    rows = session.scalars(stmt).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more else None
    return {"data": rows, "nextCursor": next_cursor, "hasMore": has_more}
```

## Step 6 - Idempotency and concurrency

Networks fail after the server acted but before the client heard back. Clients retry. Make retries safe:

- **Idempotency keys for POST** that creates or charges: the client sends `Idempotency-Key: <uuid>`; the server
  stores key + hash of the request + the response for ~24h. A retry with the same key and body returns the stored
  response; same key with a different body returns 422 (or 409); a retry while the first request is still running
  returns 409. Scope keys per account/user.
- **Optimistic concurrency** for updates: return `ETag` on GET; clients send `If-Match: "<etag>"` on PUT/PATCH/DELETE;
  respond `412 Precondition Failed` on mismatch. This prevents lost updates when two users edit the same resource.
- **Long-running work**: respond `202 Accepted` with `Location: /operations/{id}`; the operation resource reports
  `status` (`pending`/`running`/`succeeded`/`failed`) and links to the result.
- **Webhooks**: sign payloads (HMAC with a per-endpoint secret, timestamp in the signed content to stop replays),
  include an event ID so receivers can deduplicate, retry with backoff, and document that delivery is at-least-once.

## Step 7 - Security: authentication, authorization, limits

- **Authentication**: OAuth 2.x / OIDC bearer tokens for user-delegated access, API keys (sent in a header, never
  in the URL - URLs end up in logs) for server-to-server. TLS only.
- **401 vs 403**: 401 = not authenticated (missing/invalid credentials, include `WWW-Authenticate`); 403 = authenticated
  but not allowed. Return 404 instead of 403 when revealing that a resource exists would leak information.
- **Authorize every object access** (the #1 API vulnerability, BOLA/IDOR): scope queries by the caller's tenant/owner,
  e.g. `WHERE id = $1 AND org_id = $2`, not just `WHERE id = $1`. Check field-level permissions on writes too
  (mass assignment: never bind the request body directly onto a model that has `role` or `isAdmin` fields).
- **Rate limiting**: respond `429 Too Many Requests` with `Retry-After`. Communicate quotas with headers (the IETF
  `RateLimit` / `RateLimit-Policy` fields, or the widely used `X-RateLimit-Limit/Remaining/Reset` if the API already
  uses them).
- **Input limits**: maximum body size, array lengths, string lengths, page size. Reject unknown fields or ignore
  them - decide and document.

For a deeper security pass, use the `atom:security-audit` skill.

## Step 8 - Versioning and backwards compatibility

**Non-breaking (additive) changes** - ship any time:
adding an endpoint, adding an optional request field or query param, adding a response field, adding a new error
`type` for a new situation, relaxing a validation rule.

**Breaking changes** - require a new version or a migration plan:
removing or renaming a field/endpoint/param; changing a type or format (`"id": 123` to `"123"`); making an optional
field required; changing defaults or sort order; tightening validation; changing status codes or error `type`s;
changing auth requirements; adding enum values when clients were not told to tolerate unknown ones.

- Version with a URL prefix (`/v1/`) for coarse major versions, or a header/date-based version (`Api-Version:
  2026-01-15`) for frequent evolution. Follow the existing choice.
- Deprecate before removing: document it, emit `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) response headers
  with a `Link` to migration docs, monitor usage, then remove.
- Be a tolerant reader as a client and a conservative writer as a server.
- Detect breaking changes mechanically: `oasdiff breaking old.yaml new.yaml` (OpenAPI), `buf breaking --against
  '.git#branch=main'` (protobuf), `graphql-inspector diff old.graphql new.graphql` (GraphQL).

## Step 9 - Specify with OpenAPI

Design-first for public APIs: write or update the OpenAPI 3.1 document in the same change as the code, review it
like code, and generate types/clients from it. A starter document with problem details, cursor pagination,
idempotency and security schemes: [templates/openapi.yaml](templates/openapi.yaml).

```bash
npx @redocly/cli lint openapi.yaml              # or: npx @stoplight/spectral-cli lint openapi.yaml
npx openapi-typescript openapi.yaml -o src/api/schema.d.ts   # TS types from the spec
```

## RPC (gRPC) and GraphQL

Read [references/rpc-graphql.md](references/rpc-graphql.md) when the API is gRPC/protobuf or GraphQL. Key points:

- **gRPC**: methods are verbs (`CreateInvoice`, `ListInvoices`) with dedicated `XRequest`/`XResponse` messages per
  method; never reuse or renumber field numbers (mark removed ones `reserved`); use `google.rpc.Status` error details;
  set deadlines on every call; run `buf lint` and `buf breaking`.
- **GraphQL**: design the schema around the client's graph, not your tables; Relay-style connections for
  pagination; one input type and one payload type per mutation, with typed user errors in the payload; deprecate
  with `@deprecated(reason: ...)` instead of removing; prevent N+1 with DataLoader; enforce depth/complexity limits
  and disable introspection only if your threat model requires it.

## Common pitfalls

- Designing the API as a mirror of database tables (leaks storage, couples clients to schema changes).
- Returning 200 with `{"success": false}` - breaks HTTP semantics, caches and client error handling.
- Unbounded list endpoints; `limit` without a maximum.
- Authorization checked on the collection route but not on `/{id}` routes.
- Different error shapes from different handlers or frameworks layers (404 from the router is HTML).
- Using floats for money or local times without offsets.
- Renaming a field "for consistency" in a published API without versioning.
- Non-idempotent retries creating duplicate orders or charges.

## Definition of done

- [ ] Use cases map to calls; naming, casing and structure match the existing API.
- [ ] Methods and status codes have correct semantics; errors use the problem-details format consistently.
- [ ] Collections are paginated with a max page size; filters/sorts are allowlisted.
- [ ] Unsafe operations that clients may retry are idempotent (Idempotency-Key or natural idempotency).
- [ ] Every endpoint authenticates and authorizes per object; input sizes are bounded; rate limits defined.
- [ ] The change is additive, or the breaking change is versioned with a deprecation plan.
- [ ] OpenAPI/proto/GraphQL schema updated and linted; breaking-change check run against the base branch.
- [ ] Tests cover success, validation errors, auth failures (401/403/404) and pagination boundaries.
