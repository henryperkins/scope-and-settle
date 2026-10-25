# Figma agent connector (custom MCP)

Scope & Settle can serve a custom MCP connector so that the Figma agent (or Figma Make) can read the project scope, request an explicit paid assessment of a Figma comment, create a reviewable draft change order and read payment status. The connector is **implemented and tested locally only**. It is disabled by default, it has not been deployed or registered in Figma, and the native Figma flow has not been verified (see [External gates](#external-gates-still-unverified)).

## Direction of access

Figma is an MCP **client** of this application's server: Figma calls `POST https://<your host>/mcp`. Supporting MCP gives this backend **no access to Figma's own (restricted) official MCP server**, and the connector adds no new Figma permissions. The backend still reads Figma only through its configured REST token and file key.

## Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `MCP_CONNECTOR_ENABLED` | `false` | While `false`, `/mcp` answers 404 to every method, the designer page cannot issue credentials, and every existing credential is refused. Turning it off mid-call fails the call closed. |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | The exact public origin. A request's `Host` (or trusted forwarded host and protocol) must form exactly this origin, including the port. |
| `MCP_ALLOWED_ORIGINS` | empty | Comma-separated exact browser origins (for example `https://www.figma.com`). A request with any other `Origin`, or a duplicated `Origin`, is refused; a request without `Origin` is accepted only with a valid credential. Startup fails on an entry that is not an exact origin. |
| `MCP_TRUSTED_PROXIES` | empty | Comma-separated peer IP addresses whose `X-Forwarded-Host` and `X-Forwarded-Proto` are trusted (exactly one of each, no chains). From any other peer, forwarded headers are ignored. Startup fails on an entry that is not an IP address. |

There is no wildcard CORS on `/mcp`. Responses to an allowlisted origin carry that exact origin and `Vary: Origin`, never `*` and never credentials.

## Credential lifecycle

- **Issue** only from the authenticated designer page in a normal browser tab (the plugin iframe is refused by the Origin check). Issuance needs explicit consent and chooses: the operations (any of the four, default all), expiry (1–60 minutes, never beyond the issuing designer session or judging grant), the paid assessment count (0–20, default 2) and the model spend bound (0–25 USD, default 1.5 USD).
- The secret (`ssc1.<id>.<random>`) is **shown once**. Only a domain-separated SHA-256 digest is stored; the list shows status, expiry and usage, never the secret.
- The credential is bound to one project, run and Figma file. It stops working when it expires or is revoked, when its parent designer session or judging grant ends, when the run is reset or closed, when the file changes, or when the connector is disabled.
- **Revoke** from the same panel. Revocation is one-way; rotation is revoke followed by a new issue. A demo reset revokes the run's credentials.
- Budget rows are never refilled. A dispatched assessment whose outcome is unknown stays held against the bound.

## Connecting Figma (not yet performed)

1. Deploy the backend behind public HTTPS (see [Deployment implications](#deployment-implications)) and set `MCP_CONNECTOR_ENABLED=true`.
2. In Figma, add a custom MCP connector with URL `https://<your host>/mcp`.
3. Add one custom request header: `Authorization: Bearer ssc1.…` with the issued secret.
4. Keep the connector **creator-private**. Never publish it to an organization: publication shares its headers, and with them the credential.
5. Enable only the tools you want; `assess_change_request` and `draft_change_order` are write tools. Figma's generic tool consent never adds application authority: every call is checked against the credential.

## Transport

- Streamable HTTP on the exact path `/mcp`, served by `@modelcontextprotocol/server` 2.4.0 through `@modelcontextprotocol/node` 2.1.2, with a fresh server instance per request and no sessions. Both protocol eras are served: 2025-11-25 (`initialize`, version negotiation) and 2026-07-28 (`server/discover`, per-request metadata). Responses are JSON or SSE as the SDK chooses; clients must accept both (legacy serving already streams SSE).
- `POST` only. `GET` and `DELETE` answer 405 (no standalone stream or session termination). `OPTIONS` answers only a preflight from an allowlisted origin (204, exact origin, `POST`); every other `OPTIONS` is 403.
- Every request, including discovery and notifications, must carry exactly one `Authorization: Bearer` header with a live credential. Credentials in the URL, the JSON body, MCP metadata or a session header are ignored. Unauthenticated requests get 401 with `WWW-Authenticate: Bearer` and no OAuth metadata; this is a static-header integration, not OAuth (per-user OAuth is planned separately).
- Bounds, checked before the SDK where possible: 64 KiB body (declared or streamed), 64 header lines, single-valued `Host`, `Origin`, `Content-Type` and MCP headers, at most 8 open exchanges and at most 8 running tool executions across all requests (a new request is refused with 503 `busy`; a tool call beyond the cap, for example inside a legacy JSON-RPC batch, gets the tool error `busy`; an execution whose client disconnected keeps its slot until its result is recorded), 10 seconds to receive the body (408), 150 seconds per exchange (504 `timeout` if no headers were sent yet; an already-open SSE stream receives one terminal sanitized JSON-RPC error per pending request ID and ends, never answered twice).
- Pre-SDK refusals are sanitized JSON-RPC errors with a stable `data.code` (`not_found`, `host_not_allowed`, `origin_not_allowed`, `bad_request`, `method_not_allowed`, `body_too_large`, `headers_too_large`, `busy`, `unauthorized`, `forbidden`, `request_timeout`, `timeout`, `shutting_down`) and a correlation ID.
- A timeout or client disconnect never cancels admitted domain work, never erases an assessment attempt and never authorizes a retry: a repeated call reuses the durable result. On shutdown the server stops admitting, aborts in-flight 2026-era exchanges, waits for every admitted domain call (so paid results are recorded), lets delivered responses flush, ends the rest, then closes SQLite.

## The connector tools

Discovery lists only the operations the presented credential allows. The four core operations (`get_project_scope`, `assess_change_request`, `draft_change_order`, `get_payment_status`) are selected by default at issuance; the two action-preparation operations (`submit_for_client_approval`, `issue_approved_invoice`) are **opt-in** at issuance (default off, and existing credentials never gain them). Nothing else is advertised: no resources, prompts, subscriptions or sampling, and no direct execution, approval or payment-mutation tools. Every input and output is a strict versioned object (`"schemaVersion": 1`, unknown fields refused at every level, never stripped). Project, run, actor, role, parent, policy, approval, merchant and price fields are never accepted.

| Tool | Input | Returns | Limits and guarantees |
| --- | --- | --- | --- |
| `get_project_scope` | `{schemaVersion}` | Scope snapshot (clauses), rate card, approved commitment terms, context version and fingerprint, acknowledgement state | Read-only; works while a request source is fenced. At most 50 clauses, 100 rates, 100 commitments. |
| `assess_change_request` | `{schemaVersion, commentId, expectedSource?, expectedContextFingerprint?, evidenceSnapshotId?}` | Assessment ID, canonical source reference, items with classifications, quoted evidence, questions, rate-card lines, exact review references and draft eligibility | The only paid tool, run only when called. Uses one credential allowance unless an identical result is cached or in flight. Optional expectations must match before any dispatch. Refused for a fenced (known unavailable) source. Up to 20 items. |
| `draft_change_order` | `{schemaVersion, operationId, assessmentId, items:[{itemId, expected}]}` (1–20 items) | Draft order ID, revision, status, items, terms and the designer landing path | Requires each item's exact displayed review reference. The same `operationId`, connector and references replay the same draft. Never sets prices, submits, approves, publishes or invoices. Refused for a fenced source. |
| `get_payment_status` | `{schemaVersion, orderId, expectedRevision, refresh?}` | Approval, invoice and payment state, safe amounts, observation time, `cached` and `source` | Exact revision required. `refresh: true` reads PayPal; otherwise the stored observation. Never creates, sends or reminds about an invoice. Works while a source is fenced. Unknown and other-run orders look identical. |
| `submit_for_client_approval` (opt-in) | `{schemaVersion, orderId, expectedRevision}` | `actionId`, `kind`, `orderId`, `revision`, `previewHash`, authenticated designer `reviewUrl`, `expiresAt`, `state: "prepared"` | Preparation only: zero publication, invitation or approval side effects, and no client review link in the output. Refused for a fenced or changed source or stale scope/rates. Only the credential's owning human designer can confirm in Scope & Settle. |
| `issue_approved_invoice` (opt-in) | `{schemaVersion, orderId, expectedRevision}` | `actionId`, `kind`, `orderId`, `revision`, `previewHash`, authenticated designer `reviewUrl`, `expiresAt`, `state: "prepared"` | Preparation only: requires persisted client approval of the exact revision. Zero PayPal calls during preparation. Confirmation by the owning human designer revalidates approval, terms, merchant, currency and scope and reuses the single invoice operation. Works while a source is fenced. |

Action-preparation outputs include only the nonsecret authenticated designer review URL, which grants no access and never executes on GET. Outputs never contain private portal, client approval, invoice or payer links, credentials, actor or grant identities, provider payloads, prompts or model internals. Each success returns `structuredContent` (at most 60,000 bytes) plus one short summary text that never repeats client text; a larger result is the explicit error `result_too_large`, never a truncation.

Comment, reply, clause and quote text is untrusted client data. It may appear verbatim inside quoted fields (including any instructions or links a client typed), but it never changes the tools, the credential's authority or any policy.

[Portable agent instructions](agent-instructions/scope-and-settle.md) describe evidence citation, preparation-only actions, uncertainty, approval/payment/delivery boundaries and private-link protection. Installation and invocation in the actual supported client remain unverified.

[Linked Figma status cards](FIGMA-STATUS-CARDS.md) are updated explicitly from the plugin. They are cached application projections, with monetary display off by default and delivery kept separate from payment. Card writes and display-policy edits are not MCP tools. Native qualification remains separate.

Tool errors are returned as `isError` results with only `{schemaVersion: 1, error: {code, correlationId}}` and a matching one-line text. Every tool error and pre-SDK refusal is logged as `{event, code, correlationId}` (with the error class only for unexpected failures), so a reported correlation ID can be traced. Codes: `invalid_arguments`, `busy`, `unauthorized`, `forbidden`, `not_found`, `source_not_found`, `source_unavailable`, `stale_reference`, `stale_revision`, `operation_conflict`, `budget_exhausted`, `attempt_unresolved`, `item_not_billable`, `item_already_reserved`, `designer_review_required`, `conflict`, `assessment_failed`, `provider_unavailable`, `shutting_down`, `result_too_large` (a string or list over its bound, or more than 60,000 bytes), `output_invalid` (any other output mismatch, including a numeric bound) and `internal_error`. Input and exception text are never echoed. Calling a tool the credential does not allow is a sanitized MCP protocol error (`invalid_arguments`), without echoing its name. Unsupported methods use `method_not_found`. Protocol errors preserve the request ID and a correlation ID; incomplete bodies have no validated ID and use null. SDK exception text, tool names and resource/subscription values never enter errors or logs.

## Deployment implications

Nothing here has been deployed. The MCP SDK makes these the application's first **runtime** dependencies (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `zod`, plus transitive `@modelcontextprotocol/core`, `hono` and `@hono/node-server`), and the whole backend imports them at startup, even while the connector is disabled. Local `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start` and the test suite work unchanged.

- The `Dockerfile` has a `deps` stage that runs `pnpm install --prod --frozen-lockfile` (pnpm 10.34.5, `onlyBuiltDependencies` unchanged), and the runtime stage copies its `node_modules`: exactly the lockfile's production closure, with no dev packages such as `@modelcontextprotocol/client`, `typescript` or `esbuild`.
- `app/scripts/check-container.mjs` (run from `app/` with an image tag) derives that closure from `pnpm-lock.yaml` and asserts that the container's `node_modules` holds exactly it and no devDependency. It also asserts that the app starts and that the disabled `/mcp` answers 404. It uses placeholder credentials and makes no provider calls.
- The build stage installs Git and copies only the two public evaluation fixture files and two frozen-contract/case-note files required by its tests. The runtime receives only `scope-judgment-cases.json`; Git, tests and those four inputs must be absent. The smoke runner verifies this footprint.
- Smoke setup runs the reviewed canonical draft fixture in a network-disabled disposable container before the server starts. Only the two test helper modules are injected into its unique disposable volume. The real draft route receives canonical item IDs and an operation ID; repeated creation reuses the order, and another run is refused. The session, order and a synthetic 100,000-micro-USD settled budget entry must survive container replacement. Tokens stay inside the runner and never enter its report. Cleanup is limited to that runner's uniquely named resources.
- `deploy/gcp/prepare-runtime.mjs` writes no `MCP_*` keys, so a hosted runtime stays disabled until they are added deliberately.
- The hosted app sits behind a Cloudflare tunnel. Set `PUBLIC_BASE_URL` to the public `https://` origin and `MCP_TRUSTED_PROXIES` to the peer address the container actually observes for the tunnel (with the current `docker run --publish 127.0.0.1:8787:8787`, a Docker bridge gateway address rather than `127.0.0.1`); verify it before enabling, or every request is refused with `host_not_allowed`.

## External gates still unverified

- The target Figma file's owning plan and edit access (the main team is Professional/Dev/admin; the separate judging team is Starter/View/admin).
- Custom-connector entitlement and admin policy for that team.
- Public HTTPS reachability of `/mcp`.
- Delivery of the private `Authorization` header on every request, and Figma's actual `Origin`, protocol era and JSON/SSE behavior.
- The native flow: discover the tools, then read the scope, run an explicit bounded assessment and create a reviewable draft, with no approval, publication or invoice action.

## Local verification

The October 25 A–C closeout verifies the canonical smoke helper against the real isolated HTTP server and rehearses backup/restore at schema 19 with approvals, exact replacement acceptance, immutable PNG exports, budget history and reset tombstones. Docker engine access is currently blocked: a bounded `docker version --format '{{.Server.Version}}'` probe returned `ETIMEDOUT` after 20 seconds with empty stdout/stderr. Host checks and restored fixtures do not establish a successful current Docker build or container start. See the [current qualification record](verification/agent-integrations-a-c-closeout-2026-10-24.md) for candidate identities and gate status.

`app/tests/mcp.test.mjs` drives the real `/mcp` route with the official SDK client (`@modelcontextprotocol/client` 2.4.0, dev only) in both eras and with raw HTTP for edge cases. It uses synthetic Figma, model and PayPal adapters only. `app/tests/mcp-auth.test.mjs` covers the credential, authority and domain entrances underneath.

Production transport limits are frozen. Local test fixtures construct separate transport instances with their own copied, frozen limits; no HTTP or job argument can change those limits. Schemas live in `mcpSchemas.ts`, typed domain-code translation and the explicit legacy message adapter in `mcpErrors.ts`, and bounded HTTP/SSE admission, sanitization and lifecycle in `mcpTransport.ts`. Domain modules depend on the optional `ScopedAccessError.code` type from context rather than importing transport code.
