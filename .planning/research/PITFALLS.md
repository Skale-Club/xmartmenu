# Pitfalls Research — v2.4 Xphere CRM Sync

**Domain:** Async outbound product→CRM sync (Next.js 16 App Router + Supabase + Upstash QStash → shared external `POST /api/v1/sync`, fan-in from Stripe webhooks), deployed on **Docker / Coolify (self-hosted, NOT Vercel)**
**Researched:** 2026-06-21
**Confidence:** HIGH

> Scope: common mistakes when ADDING async, retried, webhook-fan-in CRM sync to the existing XmartMenu system. The Stripe webhook handler (`src/app/api/stripe/webhooks/route.ts`) is the idempotency pattern to mirror: raw body for signature, idempotency recorded only after success, 500-to-retry on failure, every handler idempotent. The Xphere `/api/v1/sync` endpoint is **NOT-YET-BUILT** (separate Xtimator effort) — every pitfall below assumes you are coding against a documented contract for a moving target you must not modify. **Deployment is Docker/Coolify behind a reverse proxy, not Vercel** — this changes the QStash signature-URL and reachability story materially (Pitfalls 4 and 10).

Suggested phase vocabulary used in mappings (the roadmapper can rename):
- **Phase A — Schema & contract:** `tenants` migration (`xphere_*` columns), types, mapping module, contract stub/mock of `/api/v1/sync`.
- **Phase B — Worker:** QStash worker route `/api/internal/xphere-sync`, signature verification, idempotent upsert call, error capture, runtime pinning.
- **Phase C — Enqueue / lifecycle hooks:** onboarding + Stripe webhook + connect-callback producers (enqueue-only, never inline).
- **Phase D — Backfill:** superadmin route to enqueue existing tenants (throttled, reuses worker path).
- **Phase E — Observability & ops:** surfacing `xphere_sync_error`, DLQ, rate-limit/retry-storm guards, secret scanning, callback-URL reachability check.

---

## Critical Pitfalls

### Pitfall 1: Idempotency keyed on phone/email instead of a stable `external_id`

**What goes wrong:**
The CRM upsert dedups on email or phone. Two tenants share an owner email (chain owner, agency, reused test account), or a tenant edits their email — and the sync merges two distinct tenants into one CRM Account, or splits one tenant across two. Worse, the same tenant processed twice (webhook + backfill) creates duplicate Accounts because the second call didn't match on the mutable field.

**Why it happens:**
Email/phone "feels" like a natural key and is what humans dedup on. But these are mutable and non-unique in a multi-tenant restaurant SaaS where one operator runs several restaurants. The earlier project assumption was literally "dedup by phone→email" — and it was explicitly corrected (see memory note) because it can't set `account_id` or `external_id`.

**How to avoid:**
- The idempotency/match key for the upsert is **`external_id = tenants.id`** (immutable UUID) — full stop. This is the documented contract (`POST /api/v1/sync` = "idempotent upsert keyed by `external_id`"). The mapping module must always send `external_id` and must NOT send email/phone as a match hint.
- Treat email/phone strictly as **attributes to set**, never as the lookup key.
- Persist the returned `xphere_account_id` / `xphere_contact_id` / `xphere_opportunity_id` back onto the tenant row so subsequent syncs confirm the same target and can detect drift.

**Warning signs:**
- Two restaurants from the same owner collapse into one CRM Account.
- A tenant changing their email creates a second Contact.
- `xphere_account_id` on a tenant row changes between syncs.

**Phase to address:** Phase A (mapping module hard-codes `external_id` as the key; schema stores returned CRM ids), verified in Phase B.

---

### Pitfall 2: At-least-once delivery → double-processing and out-of-order events (churn before activate)

**What goes wrong:**
QStash guarantees **at-least-once** delivery with **no ordering guarantee** and exponential backoff (≈12s, ~2.5min … up to 24h per retry). Two failure modes compound:
1. **Double-processing:** the same message is delivered twice (a retry after a slow-but-eventually-successful run, or webhook + backfill both enqueuing the same tenant). Non-idempotent work runs twice → duplicate Opportunities, write-back races, two `/api/v1/sync` calls the endpoint may or may not serialize.
2. **Out-of-order:** a `customer.subscription.deleted` (churn) or `past_due` lands *before* the `onboarding`/`plan_activated` that was supposed to create the Account/Contact/Opportunity. A retried *older* event can also arrive *after* a newer one and overwrite fresh state with stale state (active → trial → active flapping). Stripe itself does not guarantee event order either.

**Why it happens:**
Developers assume "I enqueued onboarding first, so it runs first" and "a message arrives once." Independent QStash messages + per-message retries make delivery order effectively random under failure, and at-least-once means a handler must tolerate replays.

**How to avoid:**
- **Make existence order-independent:** every sync is a full **upsert-by-`external_id`**, never an "update existing contact" that assumes prior creation. If Account/Contact doesn't exist, the same call creates it. Churn-before-activate then just creates the record in churned state, and the later activate corrects it.
- **Thin message + fat read (the keystone):** enqueue only `{ tenantId, reason }`; the worker **re-reads canonical tenant+profile+subscription state from Supabase at process time** and re-derives the payload. A late retry then re-sends *current* truth, not a stale snapshot — making both double-processing and out-of-order harmless for state. (This mirrors the repo's existing "follow-up query after Realtime INSERT" decision.)
- **Last-writer-wins by event time, not arrival time:** if a status must reflect a specific event, include a monotonic timestamp (Stripe event `created`, or a `xphere_synced_at` watermark) and never write a status derived from an event older than the watermark.
- **Local replay guard** mirroring `processed_stripe_events`: optionally record a content hash; if the derived payload is unchanged since `xphere_synced_at`, no-op the outbound call.

**Warning signs:**
- CRM subscription status flapping backwards.
- `xphere_sync_error` rows referencing "account/contact not found" / "parent missing."
- Duplicate Opportunities right after a backfill, or `xphere_synced_at` updated twice in milliseconds for one tenant.

**Phase to address:** Phase B (upsert + read-live-state + replay guard), reinforced by Phase A (event timestamp / watermark column), stress-tested in Phase D (backfill+live race).

---

### Pitfall 3: Building against a contract that doesn't exist yet — unsafe stubbing

**What goes wrong:**
XmartMenu development blocks on, or hard-couples to, the `/api/v1/sync` endpoint that doesn't exist yet (built by the separate Xtimator effort, which the team must NOT modify). The team either stalls, or codes against assumed request/response shapes that turn out wrong → rewrite. Worse, hooks call sync synchronously, so when the endpoint is down/slow/unbuilt, onboarding and Stripe webhook processing break for the *core product*.

**Why it happens:**
Treating an external, separately-owned, in-progress dependency as if it were stable. The hard constraint: do NOT modify the Xphere repo; build against the documented contract; integration-test only once it lands.

**How to avoid:**
- **Depend on the interface, not the implementation:** encode the documented request/response in `src/lib/xphere/types.ts`. Keep `mapping.ts` a **pure function** (tenant+profile+sub → payload) so the part most likely to be wrong is unit-testable offline against the documented contract with zero network/DB.
- **One network seam:** only `client.ts` touches `fetch`. Point it at a configurable `XPHERE_API_URL`. **Contract-test against a local stub** (a tiny mock route or a recorded fixture) that asserts the documented request shape and returns the documented response — run the *entire* producer→queue→worker→write-back pipeline against the stub in CI until the real endpoint ships.
- **Gate live calls on env presence** (same shape as `hasUpstash` in `rate-limit.ts`): with `XPHERE_*` unset, `client.ts` throws "not configured" and the worker records an error — so the feature ships dark and "activates" the moment credentials land, zero code change. Add an `XPHERE_SYNC_ENABLED` kill switch.
- **Pin the contract version**; treat a shape mismatch as a recordable `xphere_sync_error`, not a crash. When the real endpoint lands, run a one-time **conformance test** of the stub's assumptions against it before flipping the flag.

**Warning signs:**
- A failing/absent Xphere endpoint causes 500s on `/api/onboarding` or the Stripe webhook (means it's NOT decoupled — see Pitfall 6).
- The worker can't be tested without the real endpoint.
- The stub and the real endpoint disagree on field names/casing the first time you integration-test.

**Phase to address:** Phase A (types + pure mapping + local stub + flag), Phase C (hooks enqueue-only), Phase E (kill switch + conformance test on landing).

---

### Pitfall 4: QStash signature verification mistakes (raw body, body consumed twice, edge vs node runtime, URL claim)

**What goes wrong:**
The worker route `/api/internal/xphere-sync` mis-verifies and either rejects all valid messages or, worse, accepts forged ones:
- **(a) Re-stringified body:** reads `await request.json()` then re-`JSON.stringify` for verification — formatting/key-order differs from the bytes QStash hashed (the JWT carries a **SHA-256 of the raw body**), so verification fails. QStash docs call this out explicitly: "converting the parsed object back to a string may cause inconsistencies."
- **(b) Body consumed twice:** in App Router the request body is a one-shot stream; calling `request.text()`/`json()` twice (or cloning incorrectly) yields an empty/consumed body on the second read → the verifier sees `""`.
- **(c) Edge vs node runtime:** the route runs on the **Edge runtime**, which lacks the Node `crypto` module that the default `Receiver`/`verifySignatureAppRouter` path uses. You get a runtime crash or a silently-wrong verify. (The worker also needs the Supabase service-role key and a longer execution budget — both point to Node.)
- **(d) Wrong key / rotation:** verifying against `QSTASH_TOKEN` or the publish token instead of the **signing keys**, or only checking `QSTASH_CURRENT_SIGNING_KEY` so signature breaks the moment Upstash rotates to the next key.
- **(e) URL claim mismatch:** the JWT `sub` claim is the **exact URL QStash called**; behind Coolify's reverse proxy the app may see an internal URL / different host / scheme / trailing slash than the public one, so verification fails in prod only (see Pitfall 10).
- **(f) No verification at all:** leaving `/api/internal/*` open so anyone can POST `{ tenantId }` and forge CRM writes / enumerate tenants.

**Why it happens:**
QStash verification has the same raw-body footgun as Stripe (the existing handler already uses `request.text()` for exactly this reason), but adds two App-Router/self-host-specific traps: the one-shot body stream and the runtime split, plus a URL claim that a reverse proxy can silently break.

**How to avoid:**
- **Pin the runtime:** `export const runtime = 'nodejs'` on the route. The worker needs Node `crypto`, the service-role key, and time to call Xphere — Edge is wrong on all three. (If Edge were ever required, switch to `verifySignatureEdge` / Web Crypto — but don't.)
- **Read the body exactly once** with `await request.text()` and pass that *same string* to both the verifier and `JSON.parse`. Never re-stringify. Never read the body twice.
- **Use the SDK:** wrap with `verifySignatureAppRouter(handler)` (loads `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` and throws if missing), or `new Receiver({ currentSigningKey, nextSigningKey }).verify({ body, signature, url })`. Read the `Upstash-Signature` header (lower-case on some platforms).
- **Always supply BOTH signing keys** so rotation doesn't take down sync.
- **Make the verify URL deterministic:** verify against the exact public URL QStash was told to call (set it from one env var, e.g. `XPHERE_WORKER_URL` / `NEXT_PUBLIC_APP_URL`), so the proxy's rewritten host doesn't matter. (See Pitfall 10.)
- **Reject unsigned/invalid with 401/400.** Never ship an "unverified for testing" path to prod — at most behind an env guard that cannot be enabled in production.

**Warning signs:**
- "signature verification failed" only in production (URL/proxy mismatch) or only after a key rotation (missing next key).
- 200s when the route is hit by `curl` with no signature.
- A `crypto is not defined` / Edge-runtime error on the worker route.

**Phase to address:** Phase B (runtime pin + raw-body verify-first + both keys + deterministic URL is the first thing built into the worker).

---

### Pitfall 5: Partial-failure persistence — Account created but Opportunity stage missing in CRM

**What goes wrong:**
A single sync creates the Account + Contact, then the Opportunity step fails (network blip, unknown pipeline stage). The worker 500s, QStash retries — but the retry re-creates the Account/Contact (duplicates) because the first steps weren't idempotent or their returned ids weren't persisted before the failure. Or the worker swallows the partial error, returns 200, and the Opportunity (or its stage) is silently never created — the CRM shows an Account with no deal, which sales reads as "no pipeline."

**Why it happens:**
Multi-entity sync is treated as a linear script with no checkpointing. There's no transaction across an HTTP boundary, so "all or nothing" must be engineered.

**How to avoid:**
- **Prefer the single atomic `/api/v1/sync` call:** the documented contract is a *consolidated* upsert of Account+Contact+Opportunity keyed by `external_id`. If it's truly atomic on the Xphere side, partial failure is Xphere's problem and any retry is safe. **Confirm atomicity in the contract before designing multi-call orchestration** — this is a contract question to ask Xtimator (Pitfall 3).
- **If multiple calls are unavoidable:** make each step independently idempotent and **checkpointed** — persist `xphere_account_id` immediately after step 1, `xphere_contact_id` after step 2, etc. On retry, skip any step whose id column is already populated (confirm rather than re-create).
- **Fail closed on error:** write `xphere_sync_error` with the failing step, leave `xphere_synced_at` unchanged, return **500 so QStash retries** — mirroring the Stripe handler's "don't record success on failure" discipline. Never advance `xphere_synced_at` past a failed Opportunity.
- Make the whole worker safe to run N times with the same input → identical end state.

**Warning signs:**
- Retries produce duplicate Accounts/Contacts.
- `xphere_opportunity_id` null while `xphere_account_id` set, with no error recorded.
- `xphere_synced_at` advancing on a tenant whose Opportunity/stage never appeared in CRM.

**Phase to address:** Phase B (checkpointed, re-runnable worker), gated by clarifying contract atomicity in Phase A.

---

### Pitfall 6: Blocking user-facing flows on the sync

**What goes wrong:**
The lifecycle hook `await fetch(xphereUrl)` (or even `await enqueue` that can throw) runs *inline* in `/api/onboarding`, the Stripe webhook handler, or the Connect callback. Now a slow/down/unbuilt Xphere makes onboarding hang, makes Stripe see a 500 and retry the **whole** webhook (re-running all its side effects), or breaks the Connect redirect. A best-effort CRM mirror takes down the core product.

**Why it happens:**
Sync feels like "just one more step" in the same handler, and the failure mode (external API down) isn't imagined at build time. The endpoint being unbuilt makes this *guaranteed* to bite if inline.

**How to avoid:**
- **Enqueue-only producers:** every hook calls a single `enqueueXphereSync(tenantId, reason)` that publishes to QStash and **returns immediately**. It never calls `/api/v1/sync` inline.
- **The producer swallows its own errors (FAIL-OPEN):** a QStash hiccup must not flip a successful webhook to 500. Mirror the proven `rate-limit.ts` pattern (no env ⇒ no-op; errors logged, never rethrown). The backfill route is the recovery path for a dropped enqueue.
- **Enqueue inside the success branch, after the DB write and idempotency record** — never before, never in a way that can alter the handler's 200/500 contract.
- Backfill loops must also not block: paginate and enqueue, don't sync inline in the request.

**Warning signs:**
- Onboarding latency tracks Xphere latency; Stripe dashboard shows webhook retries when Xphere is down.
- Removing/breaking the Xphere endpoint changes the status code of a core route.

**Phase to address:** Phase C (enqueue-only, FAIL-OPEN producers); verified with an "endpoint dead-host" test that core flows still 200.

---

### Pitfall 7: PII / opt-out / source tagging — dirty, non-compliant segmentation

**What goes wrong:**
Every tenant (including test/demo/internal accounts, churned trials, and tenants who opted out of marketing) gets synced into the CRM with no provenance, no opt-out respect, and no source tag. Marketing can't segment XmartMenu-sourced contacts, can't honor unsubscribes, and PII (owner email/phone) flows into a sales CRM without consent tracking — a GDPR/LGPD exposure.

**Why it happens:**
The sync is built as "mirror everything" without asking *which* tenants belong in a sales/marketing CRM and what consent state they carry.

**How to avoid:**
- Always send **`source='xmartmenu'`** (in the contract) plus a sync timestamp so CRM records are cleanly segmentable and attributable.
- **Filter at the producer:** don't enqueue internal/demo/test tenants (flag them); decide explicitly whether churned/cancelled tenants update vs. are suppressed.
- **Respect opt-out:** if a tenant has a marketing-consent / opt-out flag, either don't sync PII fields or mark the CRM contact do-not-contact. If no consent field exists yet, **flag that gap to product before syncing PII** rather than syncing silently.
- **Minimize PII:** send only what the CRM needs (owner name/email for Contact); don't dump unrelated personal data.

**Warning signs:**
- Test/demo restaurants appear as sales leads.
- A tenant who unsubscribed still receives CRM-driven outreach.
- CRM contacts with no `source` tag, un-segmentable.

**Phase to address:** Phase C (producer filters internal/opt-out tenants; sets `source`), Phase A (mapping includes source + consent field).

---

### Pitfall 8: Missing pipeline stage names on the Xphere side → fleet-wide hard failures

**What goes wrong:**
The mapping sends a stage like `"Past Due"` or `"Churned"` that doesn't exist in the XmartMenu Xphere org's pipeline (org `e375f031-…`). The `/api/v1/sync` call 4xxs on the unknown stage, the worker 500s, QStash retries forever, and every subscription transition for every tenant starts failing — a fleet-wide outage triggered by config drift, not code.

**Why it happens:**
Pipeline stages are **data-only config** created via UI/MCP in the Xphere org, NOT in repo code (explicit project constraint). So stage names live outside the codebase, outside CI, and can be renamed/deleted by anyone with org access without the repo knowing.

**How to avoid:**
- Define the stage-name set as a **single mapping constant** in `src/lib/xphere/` and document that these strings MUST exist verbatim in the org pipeline. Treat it as a contract artifact.
- Add a **backfill/startup preflight** that lists the org's pipeline stages (Xphere API/MCP) and asserts every emittable stage name exists; fail loudly and surface in observability rather than discovering it per-event in prod.
- Map lifecycle → stage **defensively:** an unknown/unmapped status falls back to a known-safe default stage plus an `xphere_sync_error` note, instead of sending an invalid stage that hard-fails.
- Make a missing-stage error **non-retryable** (don't let it enter an infinite-retry storm — Pitfall 9).

**Warning signs:**
- A whole class of events (e.g. all `past_due`) failing while others succeed.
- Errors spike right after someone edited the pipeline in the Xphere UI.

**Phase to address:** Phase A (stage constants + documented contract), preflight in Phase D/E.

---

### Pitfall 9: Backfill stampede, rate limits, and infinite-retry / poison-message storms

**What goes wrong:**
Two related queue-amplification failures:
1. **Stampede/rate-limit:** the superadmin backfill enqueues thousands of tenants at once; QStash fans them out concurrently; `/api/v1/sync` (or the upstream CRM) 429s; the worker treats 429 as failure and 500s; QStash retries all of them with backoff, amplifying load and never draining.
2. **Poison messages:** a permanently-failing event (malformed payload, deleted tenant, unknown stage, contract mismatch) 500s on every attempt; QStash retries up to 24h per attempt; the message never drains; the DLQ fills (or doesn't) and the failure is invisible until someone notices CRM is stale. A bad deploy can poison *every* event at once.

**Why it happens:**
Backfill is "enqueue everything" with no throttle, and all failures are treated as transient + retryable. Some failures are **permanent** (4xx, validation, missing tenant) and retrying them is pure waste.

**How to avoid:**
- **Throttle the backfill:** QStash flow-control / per-queue concurrency limits, or staggered `delay`, so outbound rate stays under the documented `/api/v1/sync` limit. Make backfill **resumable + idempotent** (Pitfall 2) so a throttled/partial run can just be re-run.
- **Honor 429 properly:** QStash respects `Retry-After` / `X-RateLimit-Reset` — propagate the upstream `Retry-After` so QStash backs off instead of hammering. Don't burn retries on 429.
- **Distinguish transient vs permanent:** 5xx/network/429 → return 500 (let QStash retry); 4xx validation / unknown-stage / tenant-not-found → record `xphere_sync_error`, return **200** (or QStash's non-retryable signal: respond `489` + `Upstash-NonRetryable-Error: true` → straight to DLQ). Cap transient retries via `Upstash-Retries`.
- **Monitor the DLQ + `xphere_sync_error` count** in Phase E so storms are visible in minutes. A kill switch (Pitfall 3) stops fleet-wide bleeding after a bad deploy.

**Warning signs:**
- Backfill triggers a wave of 429s; the retry queue grows instead of draining; `/api/v1/sync` latency spikes only during backfill windows.
- The same `tenant_id` failing dozens of times; error count flat-lines high after a deploy (every message poisoned).

**Phase to address:** Phase D (throttled, resumable backfill), Phase B (429-aware + transient/permanent classification), Phase E (DLQ monitoring + kill switch).

---

### Pitfall 10: Self-hosted (Coolify) callback-URL reachability and proxy URL rewriting

**What goes wrong:**
QStash is a hosted service that delivers by making an **outbound HTTPS request to a publicly reachable URL** — "QStash requires a publicly available API to send messages to." On Docker/Coolify this breaks in two distinct ways:
1. **Unreachable worker URL:** if `/api/internal/xphere-sync` is only reachable on an internal Docker network / private hostname / behind a firewall, QStash can't deliver at all — every message fails silently with connection errors, and nothing syncs. (Localhost dev has the same problem — needs a tunnel like ngrok/localtunnel.)
2. **Proxy-rewritten URL breaks signature verification:** Coolify fronts the app with a reverse proxy (Traefik/Caddy). The app sees an internal host/scheme/port, but QStash signed the JWT against the **public** URL it was told to call (the `sub` claim). If you verify against `req.url` / the proxied host, the URL claim won't match → verification fails in prod even though keys are correct (this is the prod-only failure in Pitfall 4e).

**Why it happens:**
The prior plan was Vercel-shaped (public URL = deployment URL, no proxy rewrite to worry about). On Coolify you own the proxy and the DNS, so reachability and the public-vs-internal URL split become *your* problem. Easy to miss until the first real QStash delivery in production.

**How to avoid:**
- **Publicly route the worker path:** ensure `https://<public-domain>/api/internal/xphere-sync` resolves over the public internet (Coolify domain + proxy rule + TLS), not just on the Docker network. Lock it down with signature verification (Pitfall 4), not network isolation — it *must* be reachable, so auth is the boundary.
- **Pin the public URL explicitly:** publish to QStash with a fixed `XPHERE_WORKER_URL` (public domain), and **verify the signature against that same constant**, not `req.url`/Host. This makes proxy rewriting irrelevant — both sides agree on the canonical URL. Mind trailing slash, `http` vs `https`, and any path prefix the proxy adds.
- **Trust the proxy's forwarded headers correctly** (or, better, don't depend on them for verification — use the env constant). If Next.js must know its own URL, configure `X-Forwarded-Proto`/`X-Forwarded-Host` handling in the Coolify proxy.
- **Local/staging:** use a tunnel (ngrok/localtunnel) so QStash can reach a dev box; never assume `localhost:3000` works.
- **Add a reachability healthcheck** (Phase E): a tiny "ping" that confirms QStash can hit the worker URL after each deploy, so a broken proxy/DNS surfaces immediately, not on the first real event.

**Warning signs:**
- QStash dashboard shows delivery attempts failing with connection-refused/timeout/DNS errors (never reaches the app).
- Signature verification fails 100% in production but passes locally (URL claim ≠ proxied URL).
- Sync works on Vercel-style previews but not on the Coolify deployment.

**Phase to address:** Phase B (verify against a pinned public-URL constant, not `req.url`), Phase E (public route + TLS + post-deploy reachability check). Flag in Phase A as an infra prerequisite.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call `/api/v1/sync` **inline** from lifecycle hooks (skip QStash) | One less moving part | Couples core onboarding/Stripe flows to an external, unbuilt endpoint's uptime/latency; blocks the milestone (Pitfall 6) | **Never** — enqueue-only is the whole point |
| Enqueue the **full payload snapshot** instead of re-reading the row in the worker | Simpler worker | Late retries write stale state; out-of-order writes (Pitfall 2) | Only if payload carries an event timestamp and worker enforces last-writer-wins |
| Dedup on **email/phone** "just to ship" | Fast to write | Merges/splits tenants; duplicate Accounts (Pitfall 1) | Never |
| Skip signature verification on `/api/internal/xphere-sync` in dev | Easier local testing | Open CRM-write endpoint if it reaches prod (Pitfall 4f) | Only behind an env guard impossible to enable in prod |
| Verify QStash signature against `req.url` instead of a pinned constant | Looks simpler | Breaks under Coolify proxy rewriting in prod only (Pitfall 10) | Never on self-hosted/proxied deploys |
| Run the worker on the **Edge runtime** | Slightly cheaper cold start | No Node `crypto`, no service-role budget, verify crashes (Pitfall 4c) | Never for this worker |
| Treat **all** failures as retryable | Less code | Poison-message storms, 24h-backoff zombies (Pitfall 9) | MVP only, with a low `Upstash-Retries` cap + DLQ monitoring |
| Backfill with no throttle | One-line loop | 429 storms during backfill (Pitfall 9) | Only for tiny tenant counts (<~50) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| QStash signature | `await request.json()` then re-stringify; or read body twice | Read raw body **once** with `request.text()`; pass same string to verifier + `JSON.parse` (mirror Stripe handler) |
| QStash runtime | Worker on Edge runtime | `export const runtime = 'nodejs'` (needs Node crypto + service-role + time budget) |
| QStash keys | Verify only the `current` signing key | Always provide `QSTASH_CURRENT_SIGNING_KEY` **and** `QSTASH_NEXT_SIGNING_KEY` (rotation-safe) |
| QStash URL claim (self-hosted) | Verify against proxied `req.url`/Host | Verify against a pinned public-URL constant; configure Coolify `X-Forwarded-*` |
| QStash reachability (Coolify) | Worker URL only on internal Docker network / firewalled | Publicly route `…/api/internal/xphere-sync` + TLS; tunnel for local dev |
| QStash retries | Assume ordered, at-most-once delivery | No ordering guarantee, at-least-once → worker idempotent + re-runnable |
| QStash failures | Retry permanent 4xx forever | Respond `489` + `Upstash-NonRetryable-Error: true` (or 200 + log) → DLQ |
| Xphere `/api/v1/sync` | Assume request/response shape; integrate only against the real thing | Code against documented contract via typed mock + local stub; pin contract version; conformance-test on landing |
| Xphere atomicity | Assume one call is all-or-nothing | Confirm in contract; otherwise checkpoint each entity id (Pitfall 5) |
| Xphere pipeline stages | Hardcode stage strings that may not exist in the org | Central stage constants + preflight asserting stages exist in org `e375f031-…` |
| Stripe webhook (producer) | Enqueue before idempotency commit / inline await that can throw | Enqueue once, inside the success branch after `processed_stripe_events`, error swallowed by `queue.ts` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unthrottled backfill fan-out | 429 wave, growing retry backlog | QStash flow-control / concurrency limit + staggered enqueue | At first full backfill of existing tenants |
| Re-syncing unchanged tenants | CRM write volume >> actual changes; rate-limit pressure | Content-hash gate: skip outbound call if payload unchanged since `xphere_synced_at` | Recurring/scheduled re-syncs at tenant scale |
| Synchronous CRM call in onboarding/webhook | Core flow latency tracks Xphere latency | Enqueue-only producers (Pitfall 6) | As soon as Xphere is slow or down |
| Per-event poison retries at 24h backoff | DLQ/backlog grows silently | Transient/permanent split + retry cap + DLQ alerts | After any deploy that breaks the contract |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unverified `/api/internal/xphere-sync` | Anyone can forge CRM writes / enumerate tenants | Mandatory QStash signature verification (Pitfall 4) |
| Hardcoded secret fallback (`\|\| 'literal'`) | Predictable/leaked credential (the exact `\|\| 'Staff@12345'` pattern in CONCERNS.md) | Require env var; throw at boot if missing |
| Logging API key / signed JWT / headers into `xphere_sync_error` | Secret leak via logs/DB | Store only status/code/message; scrub headers + key; truncate |
| Committing `XPHERE_API_KEY` / `QSTASH_TOKEN` / signing keys | Full CRM-org write + queue-publish access for an attacker | **gitleaks CI gate** (repo has gitleaks); placeholders in `.env.example`; gitignore `.env*` (CONCERNS.md flagged a prior `.env.local` exposure) |
| Syncing PII without consent/opt-out | GDPR/LGPD exposure; un-suppressable outreach | Respect opt-out flag; minimize PII; tag `source` (Pitfall 7) |
| `external_id` mismatch lets one tenant overwrite another's CRM record | Cross-tenant data corruption | Immutable `external_id = tenants.id` as the only match key; persist returned ids; detect drift |
| Worker route reachable internally but unverified, "protected" by network only | False sense of security; proxy misconfig exposes it | Auth (signature) is the boundary, not network isolation (Pitfall 10) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sync errors invisible to operators | Stale CRM; churned tenants still "active" in sales view; no one notices | Surface `xphere_sync_error` + last-synced in superadmin observability (Phase E) |
| Test/demo tenants appear as leads | Sales chases fake accounts; dirty pipeline | Producer filters internal/test tenants before enqueue |
| No manual re-sync affordance | Operator can't recover a stuck tenant without a deploy | Superadmin "re-sync this tenant" button reusing the worker path |
| Opt-out tenants still contacted | Trust/compliance damage | Honor consent flag in mapping; mark do-not-contact |

## "Looks Done But Isn't" Checklist

- [ ] **Worker idempotency:** Run the same message twice — verify ONE Account/Contact/Opportunity, not duplicates.
- [ ] **At-least-once replay:** Re-deliver a delivered message — verify no duplicate side effects.
- [ ] **Out-of-order (churn before activate):** Process `subscription.deleted` before `onboarding` for a fresh tenant — verify the record is created and final state is correct.
- [ ] **Stale retry:** Replay an old event after a newer one — verify it does NOT overwrite newer subscription status.
- [ ] **Signature:** `curl` the worker with no signature → 401; tampered body → rejected; simulated key rotation (next key) → still verifies.
- [ ] **Runtime:** Worker route is `runtime = 'nodejs'`; no `crypto is not defined`/Edge error.
- [ ] **Raw body:** Body read once; verifier and `JSON.parse` use the same string; no re-stringify.
- [ ] **Coolify reachability:** QStash can reach `https://<public-domain>/api/internal/xphere-sync` from the public internet; signature verifies against the pinned URL (not `req.url`).
- [ ] **Partial failure:** Force the Opportunity/stage step to fail — verify retry doesn't duplicate Account/Contact and `xphere_sync_error` records the failing step.
- [ ] **Missing stage:** Send an unmapped lifecycle status — verify safe fallback + recorded error, not an infinite-retry hard fail.
- [ ] **Backfill + live race:** Run backfill while firing a live webhook for the same tenant — verify no duplicate CRM records.
- [ ] **Endpoint down:** Point `XPHERE_API_URL` at a dead host — verify onboarding + Stripe webhook still succeed and messages queue/DLQ.
- [ ] **Contract stub:** Full pipeline passes against the local `/api/v1/sync` stub before the real endpoint exists; conformance test planned for landing.
- [ ] **Secrets:** gitleaks passes; no secret in `.env.example`, logs, or `xphere_sync_error`.
- [ ] **Opt-out:** A tenant with opt-out flag is NOT synced as a marketable contact.
- [ ] **Observability:** A failing sync is visible in the superadmin UI within minutes.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate CRM records (bad idempotency key) | HIGH | Identify dupes by `external_id`; merge/delete in CRM; fix mapper to key on `external_id`; re-run (now-idempotent) backfill |
| Stale state from out-of-order writes | MEDIUM | Re-trigger sync from live tenant rows (source of truth); worker re-derives current state and overwrites |
| Poison-message storm / full DLQ | LOW–MEDIUM | Flip `XPHERE_SYNC_ENABLED` off; fix root cause; reclassify error non-retryable; replay DLQ |
| Leaked secret committed | HIGH | Rotate `XPHERE_API_KEY` / `QSTASH_TOKEN` / signing keys; purge history; add gitleaks gate |
| Missing pipeline stage outage | LOW | Add stage in Xphere org UI (or ship mapper fallback); replay failed messages from DLQ |
| Endpoint contract changed | MEDIUM | Pin/update contract types; flip kill switch while updating mapper; replay |
| QStash can't reach Coolify worker | MEDIUM | Fix public route/DNS/TLS in Coolify proxy; verify with reachability ping; replay queued/failed messages |
| Signature fails 100% in prod (proxy URL) | LOW | Pin verify URL to public-domain constant (not `req.url`); redeploy; replay |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Wrong idempotency key (phone/email) | A (mapper keys on `external_id`; store returned ids) | Same-owner / email-change tests produce one record |
| 2. At-least-once + out-of-order | B (upsert + read-live-state + replay guard); A (event ts) | Replay, churn-before-activate, stale-retry tests pass |
| 3. Contract not yet built | A (types + pure mapping + local stub + flag); C (enqueue-only); E (conformance test on landing) | Pipeline passes vs stub; dead-host test; conformance on landing |
| 4. QStash signature mistakes | B (node runtime, raw body once, both keys, pinned URL, verify-first) | curl/no-sig → 401; rotation verifies; no Edge crash |
| 5. Partial failure / missing stage | B (checkpointed worker); A (confirm contract atomicity) | Forced-failure retry: no dupes, error recorded |
| 6. Blocking user flows | C (enqueue-only, FAIL-OPEN producers) | Dead-host test: onboarding/webhook still 200 |
| 7. PII / opt-out / source | C (producer filter + source); A (consent in mapping) | Opt-out/test tenants excluded; all records `source='xmartmenu'` |
| 8. Missing pipeline stages | A (stage constants) + D/E (preflight) | Preflight asserts all stages exist; unmapped status falls back |
| 9. Backfill stampede / retry storms | D (throttle+resumable) + B (429-aware, transient/permanent) + E (DLQ + kill switch) | Backfill stays under limit; permanent failure → DLQ |
| 10. Self-hosted reachability / proxy URL | B (verify pinned URL); E (public route + TLS + reachability ping) | QStash reaches worker; prod signature verifies |

## Sources

- `src/app/api/stripe/webhooks/route.ts` — existing idempotency / raw-body (`request.text()`) / 500-to-retry pattern to mirror (HIGH; in-repo).
- `.planning/PROJECT.md` (v2.4 milestone scope + constraints), `.planning/codebase/CONCERNS.md` (hardcoded-fallback secret pattern, prior `.env.local` exposure, CI gaps), memory note `xphere-crm-integration.md` (corrected phone→email dedup assumption; QStash transport; Coolify) (HIGH; in-repo).
- `.planning/research/ARCHITECTURE.md` — companion architecture for this feature (thin-message/fat-read worker, FAIL-OPEN producer, node runtime) (HIGH; in-repo).
- Upstash QStash — signature verification (`Receiver`/`verifySignatureAppRouter`, raw-body requirement, current+next signing keys, JWT `sub`=URL + `body`=SHA-256 claims): https://upstash.com/docs/qstash/howto/signature (HIGH; official).
- Upstash QStash — public-reachability requirement + local tunnel (ngrok/localtunnel) for self-hosted/local destinations: https://upstash.com/docs/qstash/howto/local-tunnel (HIGH; official).
- Upstash QStash — Next.js quickstart, `verifySignatureAppRouter` / `verifySignatureEdge`, lower-case `upstash-signature` header note: https://upstash.com/docs/qstash/quickstarts/vercel-nextjs (HIGH; official).
- Edge runtime lacks Node `crypto`; use Node runtime or Web Crypto for verification: https://nextjs.org/docs/messages/node-module-in-edge-runtime and QStash `verifySignatureEdge` (MEDIUM–HIGH; official Next.js + Upstash).
- Upstash QStash — retries (exponential backoff up to 24h, `Upstash-Retries`, `Retry-After`/`X-RateLimit-Reset`, `489` + `Upstash-NonRetryable-Error` → DLQ, no ordering guarantee, at-least-once): https://upstash.com/docs/qstash/features/retry (HIGH; official).

---
*Pitfalls research for: async outbound product→CRM sync (QStash + webhook fan-in → Xphere `/api/v1/sync`), self-hosted on Coolify*
*Researched: 2026-06-21*
