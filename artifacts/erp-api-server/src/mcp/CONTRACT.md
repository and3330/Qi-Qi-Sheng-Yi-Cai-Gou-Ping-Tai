# AI draft approval boundary

Mount the default router from `index.ts` at `/mcp` after JSON parsing, before human session middleware. Set `ERP_AI_KEY` and positive integer `ERP_AI_TENANT_ID` via deployment secrets. Missing configuration fails closed. Stateless MCP supports POST only, with 60 admitted requests per tenant per rolling minute using PostgreSQL advisory serialization. Audit availability is mandatory.

Only `ai_actions`, `ai_draft_documents` and `ai_customer_drafts` are written by this backend. Apply the reviewed additive SQL in `lib/erp-db/migrations/20260910_ai_only.sql` and `lib/erp-db/migrations/20261107_ai_customer_drafts.sql` through the approved release process; never at startup. Existing release-safety blockers remain.

All three AI tables require an explicit `tenantId` on INSERT and have **no database tenant default**.
All MCP writers derive it from `currentTenantId()` inside `runWithTenant` and fail closed without
that context; human confirmation derives it from the verified human session/context. Never accept
it from tool arguments. The non-null column and complete RLS WITH CHECK remain mandatory.

## Human approval contract

Exports from `drafts.ts`:

- `docTypeSchema`, `DraftType`: receipt, payment, quotation, payment_request, sales_invoice.
- `draftPayloadSchemas`: strict canonical draft input schemas.
- `validateDraft(type, storedPayload)`: async, requires `runWithTenant` context, validates references and balances and returns the **existing human POST request body**.
- `draftTarget(type)`: `/vouchers`, `/quotations`, `/payment-requests`, `/invoices`.

The stored payload is canonical draft input, not the converted return value. Receipt/payment payload includes `accountId` at header level, Chinese `voucherType` 收款單/付款單, `voucherDate`, appropriate party ID, description, and `items[{invoiceId,amount}]`. Conversion adds accountId and description to each voucher item and computes totalAmount. Do not feed converted payload back into the canonical validator.

Human approval must authenticate and authorize its own user/tenant (never the AI bearer), lock the pending draft, validate again, call the existing human create logic with the converted body, and atomically record confirmedBy/confirmedAt/resultDocumentId/status. Reject duplicate approval. The human financial route must retain its own row locking, period, settlement and approval checks; AI drafts do not reserve funds. Never directly insert financial tables based on draft JSON. Rejection changes only draft state. Accounts have no active column in current ERP schema: validation requires existing non-group Asset account; no fabricated active status.

Receipt/payment accountId must also equal the cash account returned by the existing `resolveJournalLines` resolver, because the existing voucher posting route resolves cash by name rather than trusting item accountId. E-invoices with ecpayVoidedAt are rejected.

Audit args deliberately retain no user content. Unknown/invalid calls, auth failures and rate denials are audited (under configured tenant only); auth-denial audit is best effort and always returns 401 for invalid credentials. Database errors are never returned verbatim. Document/customer reads use safe field allowlists. No employees, bank details, invoice provider responses or private attachments are returned. Receivables are capped at 500 and overdue aggregation indicates truncation; document/customer/draft lists at 50.

## Customer master drafts: `create_customer_draft` (tool 10)

Scope: AI may only **propose** a customer. It never inserts `customers`; it inserts one row
into `ai_customer_drafts` (status `pending`) and writes the usual redacted `ai_actions` audit
(`target_type = ai_customer_drafts`) in the same transaction. Failures are audited as `error`
after rollback; schema violations as `denied`.

Arguments (strict Zod, snake_case like the other tools; every string is trimmed):

| argument | rule | stored payload key |
|---|---|---|
| `name` | required, non-empty after trim, ≤ 200 | `name` |
| `customer_code` | optional, 1–50 | `customerCode` |
| `tax_id` | optional; if present must be a valid 統編 (see below) | `taxId` |
| `short_name`, `email`, `phone`, `mobile`, `contact_person`, `sales_person`, `address`, `city`, `country`, `category` | optional, bounded length; blank values are dropped | camelCase customers column |

Unknown keys — including `tenant`, `tenantId`, `tenant_id`, `id` or camelCase variants — are
rejected by `.strict()`. The tenant comes only from `ERP_AI_TENANT_ID` → `runWithTenant` →
`currentTenantId()`.

The stored `payload` is the canonical **POST /customers body** (camelCase customers fields),
validated again by `validateCustomerDraft` at confirmation time (exports in `customer-drafts.ts`:
`createCustomerDraftArgs`, `customerDraftPayloadSchema`, `toCustomerDraftPayload`,
`validateCustomerDraft(payload, excludeDraftId?)`, `CustomerDraftConflictError`).

**統編 validation** (`artifacts/api-server/src/lib/tax-id-tw.ts`, shared with POST /customers):
trim → exactly 8 ASCII digits (inner spaces/letters/full-width digits rejected) → MOF weights
`[1,2,1,2,1,2,4,1]`, add tens+units of each product, valid when `sum % 5 === 0`; when the 7th
digit (index 6) is `7`, `(sum + 1) % 5 === 0` is also valid. *Deviation from the work order:* the
order listed weights `[1,2,1,2,1,2,1,2]` and `% 10`; those weights reject real tax IDs (e.g.
22099131) and MOF moved the divisor from 10 to 5 in 2023 (every `% 10` ID still passes).

**Duplicate rules** (same tenant only; exact match after `btrim`, case-sensitive — consistent with
the existing ERP, which has no case-insensitive customer matching):

- `tax_id` (when given) equal to an existing customer's `tax_id` or a pending draft's `taxId` → reject
- `customer_code` (when given) equal to an existing `customer_code` or pending draft `customerCode` → reject
- `name` equal to an existing customer `name` or pending draft `name` → reject

Checks run under a per-tenant transaction advisory lock (`pg_advisory_xact_lock(826318, tenant)`)
shared with POST /customers and its batch endpoint, so concurrent creates are serialized.
A duplicate returns the fixed, content-free message `Duplicate <field> in this tenant
(existing customer | pending customer draft); no draft created.`; other failures keep the generic
message. Confirmed/rejected drafts do not block new drafts (only `customers` and `pending` drafts).
`list_my_drafts` is unchanged and lists document drafts only.

### Human confirmation of customer drafts

Routes (mounted under the same `/ai-drafts` chain: `sessionOnly` + `requireAuth` +
`requireRole("owner","admin","finance_admin","accountant")`; API keys and the AI bearer are denied):

- `GET /api/ai-drafts/customers?status=pending|confirmed|rejected`
- `POST /api/ai-drafts/customers/:id/confirm`
- `POST /api/ai-drafts/customers/:id/reject`

The tenant must equal `session.user.tenantId`. Confirm, inside one `runInTenantTransaction`:
`SELECT … FOR UPDATE` the draft (other tenant → 404; not pending → 409) → `validateCustomerDraft`
on the **stored** payload, excluding the draft itself (duplicate → 409 with `field`; invalid → 400)
→ dispatch the converted body to the **existing `POST /customers` handler** (module guard,
`requireAuth`, its own trim/統編/duplicate checks and the `activities` record; nested as a
SAVEPOINT) → set `status=confirmed, confirmed_by, confirmed_at, result_customer_id` → insert
`ai_actions` (`human_confirm_customer_draft`, args `{draftId,userId}` only, `target_type=customers`).
Any failure rolls back the whole transaction, so no formal customer remains. Reject changes only
`status`. Request bodies are ignored (no forged payload/result/tenant). Confirmation creates a
customer master record only — it is not an accounting posting and creates no documents.

### POST /api/customers hardening (human route)

`POST /customers`: trims all string fields, blank optional fields become `null` (blank category
keeps the DB default), `name` required after trim (400), invalid `taxId` → 400, same-tenant
duplicate `taxId` / `customerCode` / `name` (exact trimmed match, only when given) → 409
`{ error, field }`. Success response shape is unchanged (201, customer row + `totalOrders/totalSpent`).
`POST /customers/batch` applies the same normalization, 統編 and duplicate rules (against existing
customers and within the batch); any violation rejects the whole batch with `index`. Blank names
are no longer replaced by "未命名". `PATCH /customers/:id` is out of scope for this stage.

## Read-only document and customer details

`get_document` retains its existing header keys and returns customerName/customerCode,
type-specific stored headers (quote validity/notes/terms, order remarks/delivery date,
invoice due date/tax totals, voucher description) and **all** item rows. Product rows
normalize legacy qty/quantity, rate/unitPrice, code/itemCode, name/itemName to
quantity/unitPrice/code/name, with unit, discount/discountRate/discountAmount,
taxAmount/taxRate, subtotal/amount and description/notes. Missing stored financial
values are null, not invented zeroes, allocated tax or guessed discount semantics.
Item master name/code/unit are fallbacks only; historical line snapshots win.
Invoices have no notes or validity column: these are not fabricated.

Vouchers return their safe `items`, and `lines` from the linked journal entry when
present; journal header totals and `lineSource` identify the basis. Unposted vouchers
without a journal use voucher items, without inferring debit/credit from an amount.
Account names/codes use stored values first, then the same-tenant chart. Linked
records, customers, item masters and account masters all require the trusted tenant.
Arbitrary JSON keys, employee IDs, costs and provider metadata are never exported.

`search_documents` keeps the existing summary shape with added customerName/customerCode.
Quotation customer-name snapshots are preserved, including free-text customers.
`search_customers` accepts `{}`, `{limit:20}`, or blank/whitespace keyword, and lists
customers deterministically by ID (default/max 50). A nonblank keyword matches literal
name, customer code, tax ID or contact person. It returns id/code/customerCode/name/
taxId/contactPerson. Schemas remain strict; caller tenant IDs and unknown keys are denied.
The read-only projections themselves introduce no tools, financial writes or schema changes.

Finance summary returns labeled `incomeStatement` and `cashFlow`, directly from their existing read handlers, with `period` YYYY-MM and report basis names.

Receivables invokes the existing ar-aging handler and returns its asOfDate and unfiltered sourceSummary. Its existing Sales-only semantics are retained (no BI Sales Invoice/dead-status expansion). Since the original handler returns customer buckets without customer IDs or invoice details, exact customer/day filters require a supplemental safe invoice projection. Every aging bucket and total is reconciled to the handler output before filtering; drift or concurrent changes fail closed instead of silently diverging. The filtered rows include totalMatching, limit and truncated; overdue customer amounts cover only returned invoices when truncated.

## Identities and tiered actions (2026-11-11)

Authorized by the owner on 2026-11-11: agents (e.g. GROKBOT) act under **role-bound keys** and
actions are **tiered**. Code: `identity.ts`, `direct-tools.ts`; tests: `identity.test.ts`.

Keys live only in deployment secrets. Role keys must be at least 24 characters; two roles sharing
one key value disables the endpoint (503) rather than guessing an identity.

| secret | role | tools |
|---|---|---|
| `ERP_AI_KEY_SALES` | sales | search/get documents and customers, `create_customer`, `create_customer_draft`, `create_quotation`, `list_my_drafts`, `request_quotation_email` |
| `ERP_AI_KEY_FINANCE` | finance | all reads, `create_document_draft`, `create_receipt_draft`, `list_my_drafts`, `list_unmatched_bank_entries`, `match_bank_entry`, `preview_invoice_email`, `request_invoice_email` |
| `ERP_AI_KEY_READONLY` | readonly | all reads, `list_unmatched_bank_entries`, `preview_invoice_email` |
| `ERP_AI_KEY` | legacy | the original 10 tools, unchanged |

`tools/list` returns only the caller's tools; a call outside the role is denied and audited.
`ai_actions.args` now also records `role` (never user content).

Tiers:

- **Immediate** (`DIRECT_WRITE_TOOLS`): `create_customer` (same normalisation, 統編 and duplicate
  rules and advisory lock as `POST /customers`), `create_quotation` (always `Draft`; a human must
  mark it Accepted before it can become a sales order), `match_bank_entry` (entry must be
  Unmatched, amounts equal, voucher not matched elsewhere; a human can unmatch).
- **Draft, human confirms in the ERP**: invoices (`create_document_draft` / `sales_invoice`),
  receipts (`create_receipt_draft`), payments and payment requests. Unchanged approval contract.
- **Human only**: issuing e-invoices and actually sending email to a customer. `preview_invoice_email`
  is read-only (recipient, subject, blockers). `request_quotation_email` (sales) and
  `request_invoice_email` (finance) only queue an email awaiting confirmation: a row in
  `email_logs` with `status = pending` and `trigger = ai`. Nothing is sent until a human
  confirms it in the ERP (AI drafts page); the body is always rebuilt by the server from the
  document. No schema change was needed.

## Full-control identity: `ERP_AI_KEY_ADMIN` (2026-11-13)

Owner decision: one trusted agent may operate every module. A separate key (`ERP_AI_KEY_ADMIN`, ≥ 24 chars, distinct from the other keys) maps to role `admin`; the sales / finance / readonly / legacy keys keep exactly the tools they had.

Admin-only tools:

- `erp_list_endpoints`, `erp_request`: call the existing `/api` routes in-process over loopback, authenticated by a per-process random token (`lib/internal-auth.ts`, never persisted or returned) and bound to `ERP_AI_TENANT_ID`. Every existing route check (validation, lock date, stock, credit limit, RLS) still applies, and the REST audit log records the actor as `apikey:AI 全權`.
- `get_quotation_pdf`, `send_quotation_pdf`: server-side quotation PDF (`lib/quotation-pdf.ts`); a signed, expiring, single-document download link (`/api/public/quotation-pdf/:tenant/:id`), direct email with the PDF attached, or POST to the owner-configured `ERP_AI_PDF_WEBHOOK_URL` (https only in production; the agent cannot choose the URL).

Still reserved for humans (`mcp/admin-guard.ts`, returns `humanOnly`): paying (payment vouchers, payment requests → Paid, payroll payout, advance repayment), void / cancel / delete / approve / reject, credit-limit override, and everything under accounts, API keys, backup, billing, platform, plus writes to roles, system settings, batch and email endpoints. Issuing the government e-invoice (`POST /sales-orders/:id/issue-ecpay-invoice`) is allowed by owner decision; voiding one is not.
