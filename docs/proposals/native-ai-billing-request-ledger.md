# Native AI billing request ledger (proposal; not applied)

The current `billAiUsage` claims `ai_usage_events.billing_batch` before creating a Stripe invoice item. A retry reconstructs the customer, invoice, FX rate, cutoff/description and amount from current inputs. A request accepted remotely but not marked locally can therefore be retried with changed parameters or after Stripe has pruned its idempotency key. The native replacement must persist the original request before sending it and refuse uncertain recovery before a second charge.

This proposal changes neither Source billing nor production. It requires a separately reviewed additive OWNED-only migration; the Supabase migrations and existing usage columns remain unchanged. Missing migration/grants must return a retryable error, never use Source billing.

## Minimal additive storage

One `public.ai_billing_requests` table, owned by the existing owner, RLS enabled without public/browser policies. Explicit runtime SELECT/INSERT/UPDATE and staging-reader SELECT grants, no public/anon/authenticated grants, no new SQL role. The public SQL file will be a proposal outside the Supabase migration directory until its actual candidate operation is reviewed.

| Columns | Purpose |
| --- | --- |
| `batch_id uuid PRIMARY KEY`, `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT` | Link the existing usage batch to its immutable request and tenant. No rewrite of usage history. |
| `created_at`, `cutoff_at timestamptz NOT NULL` | Original claim/description cutoff. |
| `stripe_customer_id`, `stripe_invoice_id NULL`, `currency`, `amount_minor bigint`, `description`, `metadata jsonb` | Exact allowlisted Stripe create body. Amount is positive, safe integer; metadata is fixed server-generated strings. |
| `cost_usd numeric`, `charge_usd numeric`, `usd_to_brl numeric`, `events integer`, `max_event_id bigint`, `usage_digest text` | Original totals, membership/facts digest and result projection. Digest covers sorted ID/cost/charge tuples; no provider key or personal contact information. |
| `request_hash text`, `stripe_account_id text`, `livemode boolean`, `api_version text` | Pin serialized request and provider account/environment/version; credentials never persist. |
| `state`, `attempt_token uuid NULL`, `lease_until NULL`, `first_attempt_at NULL`, `stripe_invoice_item_id NULL UNIQUE`, `confirmed_at NULL` | CAS attempt ownership and recovery. States: prepared, requesting, confirmed, reconcile_required. State consistency enforced with CHECKs. |

Use partial unique `(tenant_id) WHERE state <> 'confirmed'` to prevent a second open batch while an earlier one needs reconciliation. Invoice-item IDs are unique when set. Existing `billing_batch` remains only the usage membership link, not a store for request data. Explicit parameterized SQL targets fixed columns; no JSON-supplied SQL or destination.

## Transaction and provider boundary

1. Reuse the admin-menu pool (max two connections). Lock the tenant before its subscription/settings/usage rows, matching the plan/webhook lock order. Current customer is required; no customer returns the existing no-op result. An unfinished known request takes priority over new usage. An existing claimed usage batch with no request record is legacy/unknown: refuse and require reviewed provider reconciliation rather than inventing original facts.
2. In one short transaction claim eligible unbatched billable rows through the supplied cutoff, read the current FX rate and freeze the exact body, sorted membership digest, totals and provider context. No usage means the existing no-op. A sub-cent total releases its new claim in the same transaction and keeps accumulating; it never creates a financial request.
3. Before an outbound call, CAS prepared/requesting into requesting with a fresh attempt token and a bounded lease. Persist `first_attempt_at` once. A live lease refuses concurrent requests. An ambiguous COMMIT refuses before the network call; a later invocation re-reads the durable state. No SQL transaction or pooled connection stays open during Stripe calls.
4. Send only the persisted body with key `ai-usage-batch-<batch_id>`, timeout 6s and zero SDK retries. An expired local lease may retry the identical persisted body only within a conservative 20-hour window from the first durable attempt, and only for the same verified Stripe account/livemode/API version. Context mismatch, clock uncertainty, an older attempt, or unclassified provider errors enter/refuse reconcile_required without a new create. The 20-hour choice stays below Stripe's documented minimum 24-hour idempotency retention; it is a policy bound, not a guarantee that every network failure is harmless.
5. Validate a returned or recovered item against all authoritative facts (customer/invoice/amount/currency/metadata/batch, account/livemode where available). In one final transaction re-lock tenant/request, check token/request hash and exact usage digest/count, mark exactly those tenant+batch rows invoiced and persist the item ID/result. A mark/receipt failure does not release the claim or declare success; recovery uses the stored item ID or same bounded request facts. Zero-row or changed-membership updates refuse.
6. Beyond the retry window, read-only provider reconciliation may confirm exactly one exhaustive, matching invoice item and then perform the local finalization. It must follow pagination to a bounded explicit completion and compare every request fact, never accept a first-page miss or metadata-only match. Zero/ambiguous/partial results remain blocked; there is no automatic new financial request. Initial implementation can keep this recovery as a reviewed operator rather than pretend listing absence proves non-delivery.

## Entrypoints and webhook completion

The existing admin-menu flag selects the new `billAiUsage` branch before any Source constructor; flag false retains the old function. Superadmin Bill now retains its actor check and returns the existing `BillResult`. No new provider/client feature flag or pool.

`invoice.created` cannot call Stripe inside the current SaaS transaction. Split only this event into prepare/execute/finalize: first check its event receipt and fixed invoice tuple, then persist/reuse the batch request, release SQL, perform the bounded provider step, and finally atomically finalize usage plus event receipt. Duplicate or concurrent delivery binds the same invoice request and never creates a second live attempt. An uncertain provider/local outcome leaves no successful event receipt. Valid no-charge cases can still receipt normally. Unrelated SaaS/Connect handlers keep their current single-transaction path.

No successful response claims finalization before the final transaction commits. QStash/CRM behavior remains as currently documented. Source fences, all-business-data reconciliation, candidate DDL/grants proof, provider environment verification and actual acceptance remain rollout gates; flags stay false during preparation.

## Required evidence before publication/rollout

Offline injected gateways prove no Source or financial fallback; exact-body reuse despite changing FX/customer/caller cutoff; timeout/options; expired/unknown/mismatched outcomes; expanded/string returned IDs; below-minimum/no-customer results; and failures before versus after provider effect. No tests call Stripe.

Disposable PostgreSQL cases prove parallel Bill now/invoice delivery, tenant isolation, request claim CAS/lease, all membership/totals guards, receipt atomicity, COMMIT-uncertain recovery, old batch refusal, one confirmed item per batch, no duplicate event receipt, and exact preservation of unrelated tenants/usage. Existing Source billing tests remain unchanged. A separately reviewed candidate operation must pin all business digests and roles before/after additive DDL and retain an encrypted, restoration-proven backup; no live apply is part of code publication.

References: [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [webhook delivery and duplicate handling](https://docs.stripe.com/webhooks). Persistent request facts and refusal after uncertain retention are application safeguards; Stripe does not guarantee indefinite deduplication.
