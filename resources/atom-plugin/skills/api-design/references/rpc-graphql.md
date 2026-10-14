# RPC (gRPC/protobuf) and GraphQL design notes

The principles from SKILL.md (consumer first, consistency, additive change, per-object authorization, bounded
inputs) apply unchanged. This file covers what differs.

## gRPC and protobuf

### Service and method shape

```proto
syntax = "proto3";

package billing.v1;                       // version in the package; v2 is a new package

import "google/protobuf/field_mask.proto";
import "google/protobuf/timestamp.proto";

service InvoiceService {
  rpc GetInvoice(GetInvoiceRequest) returns (Invoice);
  rpc ListInvoices(ListInvoicesRequest) returns (ListInvoicesResponse);
  rpc CreateInvoice(CreateInvoiceRequest) returns (Invoice);
  rpc UpdateInvoice(UpdateInvoiceRequest) returns (Invoice);
  rpc VoidInvoice(VoidInvoiceRequest) returns (Invoice);   // custom action: a verb method
}

message Invoice {
  string id = 1;                          // "invoices/inv_123" resource names (AIP-122) or opaque ids
  string customer_id = 2;
  int64 amount_minor = 3;                 // money as integer minor units
  string currency = 4;                    // ISO 4217
  InvoiceStatus status = 5;
  google.protobuf.Timestamp create_time = 6;
  reserved 7;                             // removed field: never reuse the number
  reserved "legacy_note";                 // ...or the name
}

enum InvoiceStatus {
  INVOICE_STATUS_UNSPECIFIED = 0;         // zero value must mean "unset"
  INVOICE_STATUS_OPEN = 1;
  INVOICE_STATUS_PAID = 2;
  INVOICE_STATUS_VOID = 3;
}

message ListInvoicesRequest {
  int32 page_size = 1;                    // server enforces a maximum
  string page_token = 2;                  // opaque cursor
  string filter = 3;                      // e.g. AIP-160 filter syntax, if you support filtering
}

message ListInvoicesResponse {
  repeated Invoice invoices = 1;
  string next_page_token = 2;             // empty when there are no more pages
}

message UpdateInvoiceRequest {
  Invoice invoice = 1;
  google.protobuf.FieldMask update_mask = 2;   // partial update without null ambiguity
}

message CreateInvoiceRequest {
  Invoice invoice = 1;
  string request_id = 2;                  // idempotency key (UUID) for safe retries
}
```

### Rules and reasons

- **One request and one response message per method**, even if it only wraps one field today - you can add fields
  later without changing the signature.
- **Field numbers are the wire contract.** Never change a field's number or type, never reuse a deleted number;
  mark removed fields `reserved`. Renaming a field is wire-compatible but breaks JSON transcoding and generated code.
- **Enums**: first value `*_UNSPECIFIED = 0`; prefix values with the enum name (protobuf enum values share a scope).
- **Errors**: return canonical status codes (`NOT_FOUND`, `INVALID_ARGUMENT`, `FAILED_PRECONDITION`,
  `PERMISSION_DENIED`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`, `ALREADY_EXISTS`, `ABORTED`, `UNAVAILABLE`) and put
  structured details in `google.rpc.Status` details (`BadRequest` with field violations, `ErrorInfo` with a stable
  reason). `UNAVAILABLE` signals "safe to retry"; `INTERNAL` does not.
- **Deadlines**: clients set a deadline on every call; servers propagate the context and stop work when it expires.
- **Streaming** only when there is a real stream (logs, events, large result sets); unary calls are simpler to retry,
  load-balance and observe.
- Tooling:

```bash
buf lint
buf breaking --against '.git#branch=main'
buf generate
```

Go server error with details:

```go
st := status.New(codes.InvalidArgument, "invalid invoice")
st, _ = st.WithDetails(&errdetails.BadRequest{
	FieldViolations: []*errdetails.BadRequest_FieldViolation{
		{Field: "invoice.amount_minor", Description: "must be positive"},
	},
})
return nil, st.Err()
```

## GraphQL

### Schema shape

```graphql
type Query {
  invoice(id: ID!): Invoice
  invoices(first: Int = 20, after: String, filter: InvoiceFilter): InvoiceConnection!
}

type Invoice implements Node {
  id: ID!
  number: String!
  amount: Money!
  status: InvoiceStatus!
  customer: Customer!          # resolved via DataLoader to avoid N+1
  createdAt: DateTime!
  legacyRef: String @deprecated(reason: "Use `number`. Removal after 2027-01-01.")
}

type InvoiceConnection {
  edges: [InvoiceEdge!]!
  pageInfo: PageInfo!
  totalCount: Int              # only if cheap to compute
}
type InvoiceEdge { node: Invoice!  cursor: String! }

type Mutation {
  createInvoice(input: CreateInvoiceInput!): CreateInvoicePayload!
}

input CreateInvoiceInput {
  customerId: ID!
  lineItems: [LineItemInput!]!
  clientMutationId: String     # optional idempotency/correlation key
}

type CreateInvoicePayload {
  invoice: Invoice
  userErrors: [UserError!]!    # expected, user-fixable errors live in the schema
}

type UserError {
  field: [String!]             # path to the input field
  message: String!
  code: UserErrorCode!
}
```

### Rules and reasons

- **Model the client's graph, not your tables.** Expose relationships as fields (`invoice.customer`) instead of
  foreign-key IDs only.
- **Nullability**: fields are nullable by default for a reason - a failing resolver nulls only that field. Make a
  field non-null (`!`) only when it can truly never fail or be absent; changing non-null to nullable later is a
  breaking change for clients.
- **Mutations**: one specific mutation per use case (`archiveProject`, not a generic `updateProject` with a status
  field), a single `input` argument, and a payload type with the changed object plus `userErrors`. Reserve the
  top-level `errors` array for unexpected failures.
- **Pagination**: Relay cursor connections (`first`/`after`, `pageInfo { hasNextPage endCursor }`) with a maximum
  `first`.
- **Evolution**: GraphQL APIs are usually unversioned. Add fields freely; deprecate with `@deprecated(reason:)`;
  remove only after usage (tracked per field) drops to zero. Check with
  `graphql-inspector diff old.graphql new.graphql`.
- **Performance**: batch and cache per request with DataLoader so `invoices { customer { name } }` issues 2 queries,
  not N+1.

```ts
// One DataLoader per request (never share across users: it caches)
const customerLoader = new DataLoader(async (ids: readonly string[]) => {
  const rows = await db.customer.findMany({ where: { id: { in: [...ids] } } });
  const byId = new Map(rows.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id) ?? new Error(`customer ${id} not found`));
});
```

- **Security**: authorize in the business layer (each resolver or the service it calls), not only at the HTTP
  route - every field is an entry point. Enforce query depth and cost/complexity limits, cap list sizes, and
  consider persisted queries (allowlisted operations) for first-party clients. Disable verbose error messages and
  stack traces in production.
