# HTTP status codes for API designers

Status codes are part of the contract: clients, proxies, caches, retry libraries and monitoring all act on them.
Use the most specific code that is correct, and keep the choice consistent across the API. Semantics follow
RFC 9110 (HTTP Semantics) unless noted.

## Quick decision flow for errors

1. Credentials missing, malformed, expired or invalid? -> **401** (with `WWW-Authenticate`).
2. Authenticated, but this caller may never do this? -> **403**. If admitting the resource exists leaks
   information (another tenant's object), -> **404**.
3. Target resource or route does not exist? -> **404**. Method not supported on an existing route? -> **405** (with `Allow`).
4. Request body unparseable (bad JSON, wrong content type)? -> **400** (or **415** for an unsupported
   `Content-Type`).
5. Body parses but fails validation (field rules)? -> **422** (or **400** if the API already uses 400 for all
   client input errors - be consistent).
6. Valid request, but conflicts with current state (duplicate unique key, invalid state transition, edit
   conflict without preconditions)? -> **409**.
7. A precondition header (`If-Match`, `If-Unmodified-Since`) failed? -> **412**. Precondition required but missing? -> **428**.
8. Too many requests? -> **429** (with `Retry-After`).
9. Server bug or unexpected exception? -> **500**. Upstream dependency failed? -> **502**/**504**. Deliberately
   unavailable (maintenance, overload)? -> **503** (with `Retry-After`).

Client errors (4xx) mean "do not retry unchanged". Server errors (5xx) and 429 may be retried with backoff - so
never return 5xx for a client mistake, or clients will hammer you with retries.

## 2xx Success

| Code | Name | Use it when | Notes |
| --- | --- | --- | --- |
| 200 | OK | Successful GET; PUT/PATCH/POST that returns a body | Default success with a body |
| 201 | Created | POST (or PUT) created a new resource | Include `Location: /things/{id}` and usually the created resource |
| 202 | Accepted | Work was queued, not done yet | Return `Location` of an operation/status resource |
| 204 | No Content | Success with no body (DELETE, PUT/PATCH when you do not return the resource) | Must not include a body |
| 206 | Partial Content | Range requests (file downloads, media) | Not for API pagination |

## 3xx Redirection

| Code | Name | Use it when | Notes |
| --- | --- | --- | --- |
| 301 | Moved Permanently | A URL moved forever | Clients may change POST to GET - prefer 308 for APIs |
| 302 | Found | Temporary redirect (browser flows, OAuth) | Same method-change caveat - prefer 307 for APIs |
| 303 | See Other | After POST, point the client to a result to GET | Useful for async operation results |
| 304 | Not Modified | Conditional GET (`If-None-Match` / `If-Modified-Since`) matched | No body; enables cheap polling with ETags |
| 307 | Temporary Redirect | Temporary, method and body preserved | |
| 308 | Permanent Redirect | Permanent, method and body preserved | |

## 4xx Client errors

| Code | Name | Use it when | Notes |
| --- | --- | --- | --- |
| 400 | Bad Request | Malformed syntax, unparseable JSON, invalid query param types | Generic client error |
| 401 | Unauthorized | Not authenticated: no/invalid/expired credentials | Despite the name, it means *unauthenticated*. Send `WWW-Authenticate` |
| 403 | Forbidden | Authenticated but lacking permission | Re-authenticating will not help |
| 404 | Not Found | No such resource or route; also to hide existence from unauthorized callers | |
| 405 | Method Not Allowed | Route exists, method does not | Must include `Allow: GET, POST` |
| 406 | Not Acceptable | Cannot produce any representation in `Accept` | Rare in JSON APIs |
| 408 | Request Timeout | Client took too long to send the request | Usually emitted by servers/proxies, not app code |
| 409 | Conflict | State conflict: duplicate, invalid transition, concurrent modification, idempotency key reuse in flight | Explain the conflict in `detail` |
| 410 | Gone | Resource or endpoint deliberately and permanently removed | Good after an API version sunset |
| 412 | Precondition Failed | `If-Match` ETag mismatch (optimistic locking) | Client should re-fetch and retry |
| 413 | Content Too Large | Body exceeds the size limit | Document the limit |
| 414 | URI Too Long | Query string too long | Suggest a POST search endpoint for complex queries |
| 415 | Unsupported Media Type | `Content-Type` not supported | e.g. form data sent to a JSON endpoint |
| 422 | Unprocessable Content | Well-formed but semantically invalid (validation errors) | Return field-level `errors` in problem details |
| 428 | Precondition Required | You require `If-Match` and it was missing (RFC 6585) | Prevents lost updates |
| 429 | Too Many Requests | Rate limit or quota exceeded (RFC 6585) | Include `Retry-After` (seconds or HTTP date) |
| 431 | Request Header Fields Too Large | Headers too large (often huge cookies) | |
| 451 | Unavailable For Legal Reasons | Blocked for legal reasons (RFC 7725) | |

## 5xx Server errors

| Code | Name | Use it when | Notes |
| --- | --- | --- | --- |
| 500 | Internal Server Error | Unexpected failure / bug | Log details server-side with a trace ID; return a generic problem body |
| 501 | Not Implemented | Method not supported by the server at all | Rare; not for "feature coming soon" on a route (use 404) |
| 502 | Bad Gateway | Invalid response from an upstream service | Gateways/proxies |
| 503 | Service Unavailable | Overloaded or in maintenance | `Retry-After` if known |
| 504 | Gateway Timeout | Upstream did not respond in time | |

## Common mistakes

- `200 OK` with `{"error": ...}` in the body. Monitoring sees success, clients must parse bodies to detect failure.
- `500` for validation errors or missing resources (an unhandled `NotFound` exception). Map known exceptions to 4xx.
- `403` when credentials are missing (should be 401) or `401` for permission problems (should be 403).
- `404` for an empty collection - an empty list is `200` with `"data": []`.
- `400` for everything client-side when more specific codes (409, 412, 413, 415, 422, 429) would let clients react
  correctly.
- `201` without a `Location` header; `204` with a body.
- DELETE of an already-deleted resource returning 500. Return 404 (or 204 if you treat delete as "ensure absent" -
  pick one and document it).
- Redirects with 301/302 on non-GET API calls - clients may switch to GET and drop the body. Use 307/308.

## Headers that travel with status codes

| Header | With | Purpose |
| --- | --- | --- |
| `Location` | 201, 202, 3xx | URL of the created resource / operation / redirect target |
| `Allow` | 405 | Supported methods |
| `WWW-Authenticate` | 401 | Authentication scheme (`Bearer realm="api", error="invalid_token"`) |
| `Retry-After` | 429, 503, 202 polling | When to retry |
| `ETag` / `Last-Modified` | 200 on GET | Enables 304 and 412 flows |
| `Content-Type: application/problem+json` | all 4xx/5xx with a body | RFC 9457 error format |
| `Deprecation` / `Sunset` / `Link` | any, on deprecated endpoints | RFC 9745 / RFC 8594 deprecation signaling |
