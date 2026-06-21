# Pitfalls Research — v2.4 Xphere CRM Sync

**Domain:** Async outbound CRM sync (Next.js 16 App Router + Supabase + Upstash QStash → shared external `POST /api/v1/sync`, fan-in from Stripe webhooks)
**Researched:** 2026-06-20
**Confidence:** HIGH

> Scope: common mistakes when ADDING async, retried, webhook-fan-in CRM sync to the existing XmartMenu system. The Stripe webhook handler (`src/app/api/stripe/webhooks/route.ts`) is the idempotency pattern to mirror: raw body for signature, idempotency recorded only after success, 500-to-retry on failure, every handler written idempotent. The Xphere `/api/v1/sync` endpoint is NOT-YET-BUILT — every pitfall below assumes you are coding against a documented contract for a moving target.

Suggested phase vocabulary used in mappings (the roadmapper can rename):
- **Phase A — Schema & contract:** `tenants` migration (`xphere_*` columns), types, mapping module, contract stub/mock of `/api/v1/sync`.
- **Phase B — Worker:** QStash worker route `/api/internal/xphere-sync`, signature verification, idempotent upsert call, error capture.
- **Phase C — Enqueue / lifecycle hooks:** onboarding + Stripe webhook + connect-callback producers.
- **Phase D — Backfill:** superadmin route to enqueue existing tenants.
- **Phase E — Observability & ops:** surfacing `xphere_sync_error`, DLQ, rate-limit/retry-storm guards, secret scanning.

---

## Critical Pitfalls

### Pitfall 1: Out-of-order events — `subscription.updated` syncs before the contact exists

**What goes wrong:**
A `customer.subscription.updated` (or `past_due`/`churn`) lifecycle event for a tenant is enqueued and processed by the worker before the `onboarded` event that was supposed to create the Account/Contact/Opportunity. The CRM upsert either hard-fails (no parent record) or silently creates a half-populated record that the later `onboarded` sync then fights with. Because QStash gives **no ordering guarantee** and uses exponential backoff (12s, ~2.5min, … up to 24h per retry), a retried older event can also land *after* a newer one and overwrite fresh state with stale state.

**Why it happens:**
Developers assume "I enqueued onboarding first, so it runs first." With independent QStash messages + per-message retries, delivery order is effectively random under failure. Stripe itself does not guarantee event order either, and the same tenant can have webhook + backfill producers racing.

**How to avoid:**
- Make the worker **self-healing / upsert-by-`external_id`**: every sync call must be a full upsert keyed on `external_id = tenants.id`, not an "update existing contact" that assumes prior creation. If the Account/Contact doesn't exist, the same call creates it. This collapses ordering into a non-issue for *existence*.
- For *state* (subscription status), include a **monotonic version/timestamp** in the payload (e.g. the Stripe event `created` unix ts, or `tenants.xphere_synced_at` watermark) and have the worker (or, ideally, the `/api/v1/sync` contract) apply **last-writer-wins by event timestamp**, not by arrival time. At minimum, never write a status derived from an event older than `xphere_synced_at`.
- Build the worker so it **reads current tenant state from Supabase at process time** rather than trusting the enqueued snapshot — the DB row is the source of truth and is already current. Enqueue only `{ tenant_id, reason }`, then re-derive the full payload from the live row inside the worker. This makes a late retry harmless: it re-sends *current* truth.

**Warning signs:**
- CRM records with subscription status flapping backwards (active → trial → active).
- `xphere_sync_error` rows referencing "account/contact not found" or "parent missing."
- Backfill run produces different results than a fresh tenant's live sync.

**Phase to address:** Phase B (worker = upsert + read-live-state), reinforced by Phase A (payload includes event timestamp / watermark column).

---

### Pitfall 2: Idempotency keyed on phone/email instead of `external_id`

**What goes wrong:**
The CRM upsert dedups on email or phone. Two tenants share an owner email (chain owner, agency, test account reused), or a tenant edits their email — and the sync merges two distinct tenants into one CRM Account, or splits one tenant across two. Worse, the same tenant processed twice (webhook + backfill) creates duplicate Accounts because the second call didn't match on the mutable field.

**Why it happens:**
Email/phone "feels" like a natural key and is what humans dedup on. But these are mutable and non-unique in a multi-tenant restaurant SaaS where one operator runs several restaurants.

**How to avoid:**
- The idempotency/match key for the upsert is **`external_id = tenants.id`** (immutable UUID) — full stop. This is already the documented contract (`POST /api/v1/sync` is "idempotent upsert keyed by `external_id`"). Enforce it: the mapping module must always send `external_id`, and must NOT send email/phone as a match hint.
- Treat email/phone strictly as **attributes to set**, never as the lookup key.
- Persist the returned `xphere_account_id` / `xphere_contact_id` / `xphere_opportunity_id` back onto the tenant row so subsequent syncs can confirm the same target and detect drift.

**Warning signs:**
- Two restaurants from the same owner collapse into one CRM Account.
- A tenant changing their email creates a second Contact.
- `xphere_account_id` on a tenant row changes between syncs.

**Phase to address:** Phase A (mapping module hard-codes `external_id` as the key; schema stores returned CRM ids), verified in Phase B.

---

### Pitfall 3: Double-processing — Stripe webhook AND backfill enqueue the same tenant

**What goes wrong:**
The superadmin runs the backfill (Phase D) at the same time a tenant's Stripe webhook fires. Two QStash messages for the same tenant run concurrently. Both read state, both upsert, and you get a race: duplicate opportunities, or one worker overwriting the other's just-written CRM ids, or two `/api/v1/sync` calls that the endpoint may or may not serialize.

**Why it happens:**
Backfill is treated as a one-off "outside" the normal flow, so its overlap with live events isn't considered. QStash delivers in parallel by default.

**How to avoid:**
- Rely on the upsert-by-`external_id` contract (Pitfall 2) so concurrent calls converge instead of duplicating — this is the primary defense and must hold even under concurrency on the Xphere side.
- Add a **per-tenant local guard** mirroring the Stripe `processed_stripe_events` pattern: a `xphere_sync_log` (or a `xphere_sync_in_progress` / advisory lock on `tenants.id`) so the worker can detect "a sync for this tenant is already running / just ran with the same content hash" and no-op. Record a content hash of the payload; if unchanged since `xphere_synced_at`, skip the outbound call entirely.
- Make backfill **enqueue through the exact same worker path** as live events (don't write a parallel "backfill-only" sync function). One code path = one set of guarantees.

**Warning signs:**
- Duplicate Opportunities appear immediately after a backfill run.
- `xphere_synced_at` updated twice within milliseconds for one tenant.
- CRM id columns overwritten with different values during backfill.

**Phase to address:** Phase D (backfill reuses worker path), with the local guard built in Phase B.

---

### Pitfall 4: QStash signature verification mistakes (raw body, wrong key, App Router cloning)

**What goes wrong:**
The worker route `/api/internal/xphere-sync` either (a) reads `await request.json()` then re-stringifies for verification — formatting differs, signature fails; (b) verifies against the wrong key (using `QSTASH_TOKEN` or the publish key instead of the **signing keys**, or only checking `current` and breaking during key rotation); (c) clones/consumes the request body twice in App Router so the verifier gets an empty/consumed stream; or (d) skips verification entirely, leaving an open `/api/internal/*` endpoint anyone can POST to and forge CRM writes.

**Why it happens:**
QStash signature verification has the same raw-body footgun as Stripe (the existing handler already uses `request.text()` for exactly this reason), but the QStash JWT also encodes the **request URL** and **body SHA-256** in its claims, so any body mutation or URL mismatch (proxy, trailing slash, http vs https) breaks it.

**How to avoid:**
- Use the SDK rather than hand-rolling: either wrap the handler with **`verifySignatureAppRouter(handler)`** from `@upstash/qstash/nextjs` (it loads `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` from env and throws if either is missing), or use `new Receiver({ currentSigningKey, nextSigningKey })` and call `receiver.verify({ body, signature, url })` with the **raw body string**.
- If verifying manually, read the body **once** with `await request.text()` (exactly like the Stripe handler) and pass that same string to both the verifier and `JSON.parse` — never re-stringify.
- Always supply **both** `currentSigningKey` and `nextSigningKey` so signing-key rotation doesn't take down sync.
- Ensure the `url` used in verification matches the **public deployment URL** QStash called (mind Vercel preview URLs, trailing slashes, and any reverse proxy) — a URL claim mismatch fails verification even with the right keys.
- Reject unsigned requests with 401/400; never allow an unverified path "for testing."

**Warning signs:**
- Worker logs full of "signature verification failed" only in production (URL mismatch) or only after a key rotation (missing next key).
- 200s on the worker route when called directly with `curl` and no signature.

**Phase to address:** Phase B (signature verification is the first thing built into the worker route).

---

### Pitfall 5: Partial failure — Account created but Opportunity fails; worker not re-runnable

**What goes wrong:**
A single sync creates the Account + Contact, then the Opportunity call fails (network blip, missing pipeline stage). The worker returns 500, QStash retries — but the retry re-creates the Account/Contact (duplicates) because the first two steps weren't idempotent or their returned ids weren't persisted before the failure. Or the worker swallows the partial error, returns 200, and the Opportunity is silently never created.

**Why it happens:**
Multi-entity sync is treated as a linear script with no checkpointing. There's no transaction across an HTTP boundary, so "all or nothing" must be engineered.

**How to avoid:**
- Prefer a **single idempotent `/api/v1/sync` call** that the contract guarantees creates/updates Account+Contact+Opportunity atomically on the Xphere side, all keyed by `external_id`. If the contract truly does this, partial failure within Xphere is Xphere's problem and a retry is always safe. **Confirm this in the contract before designing multi-call orchestration.**
- If the worker must make multiple calls, make each step **independently idempotent and checkpointed**: persist `xphere_account_id` to the tenant row immediately after step 1 succeeds, `xphere_contact_id` after step 2, etc. On retry, skip any step whose id column is already populated (re-fetch/confirm rather than re-create).
- On any failure: write `xphere_sync_error` with the failing step, leave `xphere_synced_at` unchanged, and return **500 so QStash retries** — exactly mirroring the Stripe handler's "don't record success on failure" discipline.
- Make the entire worker safe to run N times with the same input → identical end state.

**Warning signs:**
- Retries produce duplicate Accounts/Contacts.
- `xphere_opportunity_id` null while `xphere_account_id` set, with no error recorded.
- `xphere_synced_at` advancing on a tenant whose Opportunity never appeared in CRM.

**Phase to address:** Phase B (checkpointed, re-runnable worker), gated by clarifying the atomicity of the contract in Phase A.

---

### Pitfall 6: Missing pipeline stage names on the Xphere side → hard failures

**What goes wrong:**
The mapping sends a stage like `"Past Due"` or `"Churned"` that doesn't exist in the XmartMenu Xphere org's pipeline (org `e375f031-…`). The `/api/v1/sync` call 4xxs on an unknown stage, the worker 500s, QStash retries forever, and every subscription transition for every tenant starts failing — a fleet-wide outage triggered by config drift, not code.

**Why it happens:**
Pipeline stages are **data-only config** created via UI/MCP in the Xphere org, NOT in repo code (explicit project constraint). So stage names live outside the codebase, outside CI, and can be renamed/deleted by anyone with org access without the repo knowing.

**How to avoid:**
- Define the stage-name set as a **single mapping constant** in `src/lib/xphere/` and document that these strings MUST exist verbatim in the Xphere org pipeline. Treat it as a contract artifact.
- Add a **startup/backfill preflight** that lists the org's pipeline stages (via the Xphere API/MCP) and asserts every stage name the mapper can emit is present; fail loudly (and surface in observability) rather than discovering it per-event in production.
- Map lifecycle → stage **defensively**: an unknown/unmapped status falls back to a known-safe default stage plus an `xphere_sync_error` note, instead of sending an invalid stage that hard-fails.
- Make a missing-stage error **non-retryable** where possible (don't let it enter an infinite-retry storm — see Pitfall 10): detect the "unknown stage" 4xx and route to DLQ / alert instead of retrying 24h.

**Warning signs:**
- A whole class of events (e.g. all `past_due`) failing while others succeed.
- Errors spike right after someone edited the pipeline in the Xphere UI.

**Phase to address:** Phase A (stage constants + documented contract), preflight in Phase D/E.

---

### Pitfall 7: Coupling to the not-yet-built `/api/v1/sync` endpoint

**What goes wrong:**
XmartMenu development blocks on, or hard-couples to, an endpoint that doesn't exist yet (built by the separate Xtimator effort). The team either stalls, or codes against assumed request/response shapes that turn out wrong, forcing a rewrite. Worse, lifecycle hooks are wired to call sync synchronously, so when the endpoint is down/slow/unbuilt, onboarding and Stripe webhook processing break for the *core product*.

**Why it happens:**
Treating an external, separately-owned, in-progress dependency as if it were stable. The constraint explicitly says: do NOT modify the Xphere repo; build against the documented contract.

**How to avoid:**
- **Decouple by construction:** lifecycle hooks only **enqueue to QStash** and return immediately. They never call `/api/v1/sync` inline. If Xphere is unbuilt/down, messages queue and retry — onboarding and Stripe webhooks are unaffected. This is the single most important architectural safeguard.
- Build against a **contract stub/mock** in Phase A: encode the documented request/response in `src/lib/xphere/types.ts`, point the worker at a configurable `XPHERE_API_URL`, and test the full pipeline against a local mock until the real endpoint ships. A feature flag (`XPHERE_SYNC_ENABLED`) lets you ship the producers dark.
- Add a **circuit-breaker / `XPHERE_SYNC_ENABLED` kill switch**: if the endpoint is down or the contract changes, flip the flag — producers stop enqueuing (or the worker no-ops and DLQs) without touching core flows.
- Pin the assumed **contract version**; treat a shape mismatch as a recordable `xphere_sync_error`, not a crash.

**Warning signs:**
- A failing/absent Xphere endpoint causes 500s on `/api/onboarding` or the Stripe webhook.
- Worker can't be tested without the real endpoint.

**Phase to address:** Phase C (hooks enqueue-only, never inline), Phase A (mock + flag), Phase E (kill switch).

---

### Pitfall 8: Leaking secrets (gitleaks)

**What goes wrong:**
`XPHERE_API_KEY`, `QSTASH_TOKEN`, or the QStash signing keys get committed — in a `.env` accidentally tracked, a test fixture, a hardcoded fallback (CONCERNS.md already documents this exact pattern: `|| 'Staff@12345'` hardcoded fallback, and a prior `.env.local` exposure concern), or logged in plaintext when capturing `xphere_sync_error`.

**Why it happens:**
Lots of new env vars land at once (`XPHERE_API_URL/KEY/ORG_ID`, `QSTASH_TOKEN`, two signing keys). Copy-paste into examples, default fallbacks, and verbose error logging all leak.

**How to avoid:**
- Add **gitleaks** (or trufflehog) to CI as a blocking gate before this milestone merges — the repo currently has CI gaps (CONCERNS.md) and these are high-value credentials (a leaked `QSTASH_TOKEN` lets anyone enqueue, a leaked `XPHERE_API_KEY` lets anyone write to the CRM org).
- **No hardcoded fallbacks** for any secret — require the env var, throw at boot if missing (avoid the `|| 'literal'` antipattern flagged in CONCERNS.md).
- Keep secrets out of `.env.example` (placeholders only) and verify `.env*` is gitignored.
- **Scrub secrets from error capture:** `xphere_sync_error` and `captureSecurityEvent` must store status/code/message, never request headers or the API key. Never log the signed JWT.

**Warning signs:**
- gitleaks flags a commit; an API key visible in logs or in `xphere_sync_error`.
- Secret values present in `.env.example` or any committed fixture.

**Phase to address:** Phase E (gitleaks CI gate + log scrubbing), but "no hardcoded fallback" applies from Phase A onward.

---

### Pitfall 9: Rate limits on `/api/v1/sync` (especially during backfill)

**What goes wrong:**
The superadmin backfill enqueues thousands of tenants at once; QStash fans them out concurrently; `/api/v1/sync` (or the upstream CRM) rate-limits and 429s; the worker treats 429 as failure and 500s; QStash retries all of them with backoff, amplifying load and never draining.

**Why it happens:**
Backfill is "enqueue everything" with no throttle, and 429 isn't handled distinctly from a real error.

**How to avoid:**
- **Throttle the backfill:** use QStash flow-control / per-queue concurrency limits, or enqueue with staggered delays, so outbound rate stays under the documented `/api/v1/sync` limit.
- **Honor 429 properly:** QStash respects `Retry-After` / `X-RateLimit-Reset` response headers (up to 24h) — when the worker gets a 429 from Xphere, propagate a `Retry-After` so QStash backs off instead of hammering. Don't treat 429 as a hard failure that burns retries.
- Make backfill **resumable and idempotent** (Pitfall 3) so a throttled/partial run can simply be re-run.

**Warning signs:**
- Backfill triggers a wave of 429s; retry queue grows instead of draining.
- `/api/v1/sync` latency spikes only during backfill windows.

**Phase to address:** Phase D (throttled backfill), Phase B (429-aware worker).

---

### Pitfall 10: Infinite-retry storms / poison messages

**What goes wrong:**
A permanently-failing event (malformed payload, deleted tenant, unknown pipeline stage, contract mismatch) returns 500 on every attempt. QStash retries with exponential backoff up to 24h per attempt, the message never drains, the DLQ fills (or doesn't), and the failure is invisible until someone notices CRM is stale. A bad deploy can turn *every* event into a poison message simultaneously.

**Why it happens:**
Treating all failures as transient + retryable. Some failures are **permanent** (4xx, validation, missing tenant) and retrying them is pure waste and noise.

**How to avoid:**
- **Distinguish transient vs permanent** in the worker: 5xx/network/429 → return 500 (let QStash retry); 4xx validation / unknown-stage / tenant-not-found → record `xphere_sync_error`, return **200** (or use QStash's non-retryable signal: respond `489` with `Upstash-NonRetryable-Error: true` to skip retries and send straight to DLQ). Don't retry what can't succeed.
- **Cap retries** via the `Upstash-Retries` header to a sane number for transient cases instead of the plan maximum.
- **Monitor the DLQ** and surface `xphere_sync_error` count in the Phase E observability so storms are visible within minutes, not days.
- Guard against fleet-wide poison: a feature-flag kill switch (Pitfall 7) lets you stop the bleeding after a bad deploy.

**Warning signs:**
- DLQ growing; the same `tenant_id` failing dozens of times; QStash dashboard showing a backlog that never clears.
- Error count flat-lines high after a deploy (every message poisoned).

**Phase to address:** Phase B (transient/permanent classification + non-retryable signal), Phase E (DLQ monitoring + kill switch).

---

### Pitfall 11: PII / opt-out / source tagging — dirty segmentation

**What goes wrong:**
Every tenant (including test accounts, churned trials, internal/demo tenants, and tenants who opted out of marketing) gets synced into the CRM with no provenance, no opt-out respect, and no source tag. Marketing can't segment XmartMenu-sourced contacts, can't honor unsubscribes, and PII (owner email/phone) flows into a CRM org without consent tracking — a GDPR/LGPD exposure.

**Why it happens:**
The sync is built as "mirror everything" without thinking about *which* tenants belong in a sales/marketing CRM and what consent state they carry.

**How to avoid:**
- Always send **`source='xmartmenu'`** (already in the contract) plus a sync timestamp so CRM records are cleanly segmentable and attributable.
- **Filter at the producer:** don't enqueue internal/demo/test tenants (flag them); decide explicitly whether churned/cancelled tenants update vs. are suppressed.
- **Respect opt-out:** if a tenant has a marketing opt-out / consent flag, either don't sync PII fields or mark the CRM contact as do-not-contact. Add the consent field to the mapping if it exists; if it doesn't, flag that gap to product before syncing PII.
- **Minimize PII:** send only the fields the CRM needs (owner name/email for Contact); don't dump unrelated personal data.

**Warning signs:**
- Test/demo restaurants appear as sales leads.
- A tenant who unsubscribed still receives CRM-driven outreach.
- CRM contacts with no `source` tag, un-segmentable.

**Phase to address:** Phase C (producer filters internal/opt-out tenants; sets `source`), Phase A (mapping includes source + consent field).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call `/api/v1/sync` **inline** from lifecycle hooks (skip QStash) | One less moving part | Couples core onboarding/Stripe flows to an external, unbuilt endpoint's uptime/latency; blocks the milestone | **Never** — enqueue-only is the whole point |
| Enqueue the **full payload snapshot** instead of re-reading the tenant row in the worker | Simpler worker | Late retries write stale state (Pitfall 1) | Only if payload carries an event timestamp and worker enforces last-writer-wins |
| Dedup on **email** "just to ship" | Fast to write | Merges/splits tenants; duplicate Accounts (Pitfall 2) | Never |
| Skip signature verification on `/api/internal/xphere-sync` in dev | Easier local testing | Open CRM-write endpoint if it reaches prod (Pitfall 4) | Only behind an env guard impossible to enable in prod |
| Treat **all** failures as retryable (no transient/permanent split) | Less code | Poison-message storms, 24h-backoff zombies (Pitfall 10) | MVP only, with a low `Upstash-Retries` cap and DLQ monitoring |
| Backfill with no throttle | One-line loop | 429 storms during backfill (Pitfall 9) | Only for tiny tenant counts (<~50) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| QStash signature | `await request.json()` then re-stringify for verify | Read raw body **once** with `request.text()`; pass same string to verifier (mirror Stripe handler) |
| QStash keys | Verify only the `current` signing key | Always provide `QSTASH_CURRENT_SIGNING_KEY` **and** `QSTASH_NEXT_SIGNING_KEY` (rotation-safe) |
| QStash URL claim | Verify against wrong/proxy/preview URL | Use the exact public deployment URL QStash called (trailing slash, https, no proxy rewrite) |
| QStash retries | Assume ordered, at-most-once delivery | No ordering guarantee, at-least-once → worker must be idempotent + re-runnable |
| QStash failures | Retry permanent 4xx forever | Respond `489` + `Upstash-NonRetryable-Error: true` (or 200 + log) to route to DLQ |
| Xphere `/api/v1/sync` | Assume request/response shape | Code against documented contract via typed mock + `XPHERE_API_URL`; pin contract version |
| Xphere pipeline stages | Hardcode stage strings that may not exist in the org | Central stage constants + preflight asserting stages exist in org `e375f031-…` |
| Stripe webhook (producer) | Enqueue from inside the handler before idempotency commit, double-firing | Enqueue once per successfully-processed event, inside the same success path as `processed_stripe_events` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unthrottled backfill fan-out | 429 wave, growing retry backlog | QStash flow-control / concurrency limit + staggered enqueue | At first full backfill of existing tenants |
| Re-syncing unchanged tenants | CRM write volume >> actual changes; rate-limit pressure | Content-hash gate: skip outbound call if payload unchanged since `xphere_synced_at` | Recurring/scheduled re-syncs at tenant scale |
| Synchronous CRM call in onboarding/webhook | Core flow latency tracks Xphere latency | Enqueue-only producers | As soon as Xphere is slow or down |
| Per-event poison retries at 24h backoff | DLQ/backlog grows silently | Transient/permanent split + retry cap + DLQ alerts | After any deploy that breaks the contract |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unverified `/api/internal/xphere-sync` | Anyone can forge CRM writes for any tenant | Mandatory QStash signature verification (Pitfall 4) |
| Hardcoded secret fallback (`\|\| 'literal'`) | Predictable/leaked credential (CONCERNS.md pattern) | Require env var; throw at boot if missing |
| Logging API key / signed JWT / headers into `xphere_sync_error` | Secret leak via logs/DB | Store only status/code/message; scrub headers + key |
| Committing `XPHERE_API_KEY` / `QSTASH_TOKEN` / signing keys | Full CRM-org write + queue-publish access for attacker | gitleaks CI gate; placeholders in `.env.example`; gitignore `.env*` |
| Syncing PII without consent/opt-out | GDPR/LGPD exposure; un-suppressable outreach | Respect opt-out flag; minimize PII; tag `source` |
| `external_id` mismatch lets one tenant overwrite another's CRM record | Cross-tenant data corruption | Immutable `external_id = tenants.id` as the only match key; persist returned CRM ids and detect drift |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sync errors invisible to operators | Stale CRM, churned tenants still "active" in sales view, no one notices | Surface `xphere_sync_error` + last-synced in superadmin observability (Phase E) |
| Test/demo tenants appear as leads | Sales chases fake accounts; dirty pipeline | Producer filters internal/test tenants before enqueue |
| No manual re-sync affordance | Operator can't recover a stuck tenant without a deploy | Superadmin "re-sync this tenant" button reusing the worker path |
| Opt-out tenants still contacted | Trust/compliance damage | Honor consent flag in mapping; mark do-not-contact |

## "Looks Done But Isn't" Checklist

- [ ] **Worker idempotency:** Run the same message twice — verify it produces ONE Account/Contact/Opportunity, not duplicates.
- [ ] **Out-of-order:** Process a `subscription.updated` before `onboarded` for a fresh tenant — verify the contact is created and final state is correct.
- [ ] **Stale retry:** Replay an old event after a newer one — verify it does NOT overwrite newer subscription status.
- [ ] **Signature:** `curl` the worker route with no signature → 401/400; with a tampered body → rejected; after simulated key rotation (next key) → still verifies.
- [ ] **Partial failure:** Force the Opportunity step to fail — verify retry doesn't duplicate Account/Contact and `xphere_sync_error` records the failing step.
- [ ] **Missing stage:** Send an unmapped lifecycle status — verify safe fallback + recorded error, not an infinite-retry hard fail.
- [ ] **Backfill + live race:** Run backfill while firing a live webhook for the same tenant — verify no duplicate CRM records.
- [ ] **Endpoint down:** Point `XPHERE_API_URL` at a dead host — verify onboarding + Stripe webhook still succeed and messages queue/DLQ.
- [ ] **Secrets:** gitleaks passes; no secret in `.env.example`, logs, or `xphere_sync_error`.
- [ ] **Opt-out:** A tenant with opt-out flag is NOT synced as a marketable contact.
- [ ] **Observability:** A failing sync is visible in the superadmin UI within minutes.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate CRM records (bad idempotency key) | HIGH | Identify dupes by `external_id`; merge/delete in CRM; fix mapper to key on `external_id`; re-run backfill (now idempotent) |
| Stale state from out-of-order writes | MEDIUM | Re-trigger sync from live tenant rows (source of truth); worker re-derives current state and overwrites |
| Poison-message storm / full DLQ | LOW–MEDIUM | Flip `XPHERE_SYNC_ENABLED` off; fix root cause; reclassify error as non-retryable; replay DLQ |
| Leaked secret committed | HIGH | Rotate `XPHERE_API_KEY` / `QSTASH_TOKEN` / signing keys; purge history; add gitleaks gate |
| Missing pipeline stage outage | LOW | Add stage in Xphere org UI (or ship mapper fallback); replay failed messages from DLQ |
| Endpoint contract changed | MEDIUM | Pin/update contract types; flip kill switch while updating mapper; replay |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Out-of-order events | B (worker reads live state + ts watermark); A (event ts in payload) | Replay old-before-new + stale-retry tests pass |
| 2. Wrong idempotency key | A (mapper keys on `external_id`; store returned ids) | Same-owner / email-change tests produce one record |
| 3. Double-processing (webhook+backfill) | D (backfill reuses worker path) + B (per-tenant guard) | Concurrent backfill+webhook test: no dupes |
| 4. QStash signature mistakes | B (raw body, both keys, URL, verify-first) | curl/no-sig rejected; rotation still verifies |
| 5. Partial failure / re-runnable | B (checkpointed worker); A (confirm contract atomicity) | Forced-failure retry: no dupes, error recorded |
| 6. Missing pipeline stages | A (stage constants) + D/E (preflight) | Preflight asserts all stages exist; unmapped status falls back |
| 7. Coupling to unbuilt endpoint | C (enqueue-only) + A (mock+flag) + E (kill switch) | Dead-host test: core flows unaffected |
| 8. Secret leaks | E (gitleaks + scrub) + A onward (no fallbacks) | gitleaks CI green; no secret in logs/example |
| 9. Rate limits | D (throttle) + B (429-aware) | Backfill stays under limit; 429 backs off, drains |
| 10. Retry storms | B (transient/permanent split) + E (DLQ + kill switch) | Permanent failure → DLQ, not infinite retry |
| 11. PII / opt-out / source | C (producer filter + source) + A (consent in mapping) | Opt-out/test tenants excluded; all records `source='xmartmenu'` |

## Sources

- `src/app/api/stripe/webhooks/route.ts` — existing idempotency/raw-body/500-to-retry pattern to mirror (HIGH; in-repo).
- `.planning/PROJECT.md` (v2.4 milestone scope + constraints) and `.planning/codebase/CONCERNS.md` (hardcoded-fallback secret pattern, CI gaps, RLS/abuse-vector context) (HIGH; in-repo).
- Upstash QStash docs — signature verification (`Receiver` / `verifySignatureAppRouter`, raw-body requirement, current+next signing keys, URL claim): https://upstash.com/docs/qstash/howto/signature and https://upstash.com/docs/qstash/quickstarts/vercel-nextjs (HIGH; official).
- Upstash QStash docs — retries (exponential backoff up to 24h, `Upstash-Retries`, `Retry-After`/`X-RateLimit-Reset`, `489` + `Upstash-NonRetryable-Error` → DLQ, no ordering guarantee): https://upstash.com/docs/qstash/features/retry (HIGH; official).

---
*Pitfalls research for: async outbound CRM sync (QStash + webhook fan-in → Xphere `/api/v1/sync`)*
*Researched: 2026-06-20*
