// Disposable CI only. All provider calls are injected in-memory gateways.
import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction, createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
import { prepareNativeBilling, claimNativeBilling, finalizeNativeBilling, refuseNativeBilling, nativeInvoiceTarget, type NativeBillingOptions } from '../../src/lib/data/ai-billing'
import { runNativeAiBilling, type NativeBillingRepository, type NativeBillingGateway } from '../../src/lib/ai/native-billing'
import { BILLING_RETRY_WINDOW_MS, type BillingProviderContext, type BillingRequestBody } from '../../src/lib/ai/native-billing-facts'
const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw Error('Explicit disposable billing target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test' || target.search || target.hash) throw Error('Not a disposable billing target')
const admin = new pg.Pool({ connectionString: raw, max: 2, statement_timeout: 5000 })
const pool = createAdminMenusPool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname, PROD_DATABASE_NAME: 'xmartmenu_identity_test', ADMIN_MENUS_DATABASE_URL: raw, ADMIN_MENUS_DATABASE_SSL: 'disable' })
const tx = <T>(op: Parameters<typeof adminMenuTransaction<T>>[2]) => adminMenuTransaction(pool, true, op)
const a = randomUUID(), b = randomUUID(), now = new Date('2026-11-04T22:00:00Z')
const context: BillingProviderContext = { accountId: 'acct_fixture', livemode: false, apiVersion: '2026-04-22.dahlia' }
const options: NativeBillingOptions = { tenantId: a, now }
const repo: NativeBillingRepository = {
  prepare: (opts, ctx) => tx(q => prepareNativeBilling(q, opts, ctx)), claim: (req, ctx, clock) => tx(q => claimNativeBilling(q, req, ctx, clock)),
  refuse: (req, token) => tx(q => refuseNativeBilling(q, req, token)), finalize: (req, token, item, opts, clock) => tx(q => finalizeNativeBilling(q, req, token, item, opts, clock)),
}
const item = (body: BillingRequestBody) => ({ ...body, invoice: body.invoice ?? null, id: 'ii_fixture', object: 'invoiceitem', livemode: false })
const gateway = (create?: NativeBillingGateway['create']): NativeBillingGateway => ({ context: async () => context, create: create ?? (async body => item(body)) })
const frozen = async (opts = options) => { const value = await repo.prepare(opts, context); assert.equal(value.kind, 'request'); if (value.kind !== 'request') throw Error('Request required'); return value.request }
const usageRows = async (tenant = a) => (await admin.query('SELECT id::text,billing_batch,invoiced_at,stripe_invoice_item_id FROM public.ai_usage_events WHERE tenant_id=$1 ORDER BY id', [tenant])).rows
const requestRow = async () => (await admin.query('SELECT * FROM public.ai_billing_requests WHERE tenant_id=$1', [a])).rows[0]
before(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.ai_billing_requests,public.ai_usage_events,public.processed_stripe_events,public.platform_ai_settings,public.tenant_subscriptions,public.tenants CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.tenant_subscriptions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),stripe_customer_id text,stripe_subscription_id text);
    CREATE TABLE public.platform_ai_settings(id int PRIMARY KEY,usd_to_brl numeric);
    CREATE TABLE public.ai_usage_events(id bigserial PRIMARY KEY,tenant_id uuid REFERENCES public.tenants(id),occurred_at timestamptz NOT NULL,billable boolean NOT NULL,cost_usd numeric(14,8) NOT NULL,charge_usd numeric(14,8) NOT NULL,billing_batch uuid,invoiced_at timestamptz,stripe_invoice_item_id text);
    CREATE TABLE public.processed_stripe_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);`)
  const proposal = await readFile(new URL('../../docs/proposals/native-ai-billing-owned-only.sql', import.meta.url), 'utf8')
  // Exact proposed table/index/RLS DDL, with host/role admission intentionally
  // excluded from this disposable schema projection. No production apply.
  await admin.query(proposal.slice(proposal.indexOf('CREATE TABLE public.ai_billing_requests'), proposal.indexOf('-- Existing runtime')))
  await admin.query('CREATE ROLE xmartmenu_billing_fixture_runtime NOLOGIN BYPASSRLS')
  await admin.query('GRANT USAGE ON SCHEMA public TO xmartmenu_billing_fixture_runtime')
  for (const grant of proposal.match(/GRANT (?:SELECT,INSERT|UPDATE\(state[^;]+) ON public\.ai_billing_requests TO xmartmenu_runtime;/g) ?? []) {
    await admin.query(grant.replace('xmartmenu_runtime', 'xmartmenu_billing_fixture_runtime'))
  }
  await admin.query('INSERT INTO public.tenants VALUES($1),($2)', [a, b])
  await admin.query("INSERT INTO public.tenant_subscriptions VALUES($1,'cus_a','sub_a'),($2,'cus_b','sub_b')", [a, b])
  await admin.query('INSERT INTO public.platform_ai_settings VALUES(1,5)')
})
beforeEach(async () => {
  await admin.query('DELETE FROM public.processed_stripe_events; DELETE FROM public.ai_billing_requests; DELETE FROM public.ai_usage_events; UPDATE public.platform_ai_settings SET usd_to_brl=5')
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_customer_id=CASE WHEN tenant_id=$1 THEN 'cus_a' ELSE 'cus_b' END,stripe_subscription_id=CASE WHEN tenant_id=$1 THEN 'sub_a' ELSE 'sub_b' END", [a])
  await admin.query('INSERT INTO public.ai_usage_events(tenant_id,occurred_at,billable,cost_usd,charge_usd) VALUES($1,$3,true,0.1,0.13),($1,$3,true,0.2,0.26),($2,$3,true,1,2)', [a, b, now.toISOString()])
})
after(async () => {
  await pool.end()
  try { await admin.query('DROP TABLE IF EXISTS public.ai_billing_requests,public.ai_usage_events,public.processed_stripe_events,public.platform_ai_settings,public.tenant_subscriptions,public.tenants CASCADE; REVOKE USAGE ON SCHEMA public FROM xmartmenu_billing_fixture_runtime; DROP ROLE IF EXISTS xmartmenu_billing_fixture_runtime') }
  finally { await admin.end() }
})
test('concurrent billing claims one immutable batch and issues one financial request', async () => {
  let creates = 0
  const provider = gateway(async body => { creates++; await new Promise(resolve => setTimeout(resolve, 30)); return item(body) })
  const results = await Promise.allSettled([runNativeAiBilling(options, repo, provider, () => now), runNativeAiBilling(options, repo, provider, () => now)])
  assert.equal(creates, 1); assert.ok(results.some(result => result.status === 'fulfilled' && result.value.result.billed))
  assert.equal((await requestRow()).state, 'confirmed'); assert.ok((await usageRows()).every(row => row.invoiced_at))
  assert.ok((await usageRows(b)).every(row => !row.invoiced_at && !row.billing_batch))
})
test('persisted financial facts survive FX/customer/cutoff changes and local finalize rollback without a second item', async () => {
  const items = new Map<string, unknown>(), bodies: BillingRequestBody[] = []
  const provider = gateway(async (body, opts) => { bodies.push(body); if (!items.has(opts.idempotencyKey)) items.set(opts.idempotencyKey, item(body)); return items.get(opts.idempotencyKey) })
  const failing: NativeBillingRepository = { ...repo, finalize: (req, token, response, opts, clock) => tx(async q => { await finalizeNativeBilling(q, req, token, response, opts, clock); throw Error('Commit not reached') }) }
  await assert.rejects(runNativeAiBilling(options, failing, provider, () => now))
  assert.equal((await requestRow()).state, 'requesting'); assert.ok((await usageRows()).every(row => !row.invoiced_at))
  await admin.query('UPDATE public.platform_ai_settings SET usd_to_brl=9')
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_customer_id='cus_changed' WHERE tenant_id=$1", [a])
  await admin.query('INSERT INTO public.ai_usage_events(tenant_id,occurred_at,billable,cost_usd,charge_usd) VALUES($1,$2,true,5,6)', [a, now.toISOString()])
  const result = await runNativeAiBilling({ ...options, currency: 'usd', now: new Date(now.getTime() + 100000) }, repo, provider, () => new Date(now.getTime() + 31000))
  assert.equal(items.size, 1); assert.deepEqual(bodies[0], bodies[1]); assert.equal(result.result.currency, 'brl'); assert.equal(result.result.events, 2)
  assert.equal((await usageRows()).filter(row => row.invoiced_at).length, 2); assert.equal((await usageRows()).filter(row => !row.invoiced_at && !row.billing_batch).length, 1)
})
test('expired attempts durably require reconciliation and never reach create again', async () => {
  const req = await frozen(); assert.ok(await repo.claim(req, context, now))
  let creates = 0
  await assert.rejects(runNativeAiBilling(options, repo, gateway(async body => { creates++; return item(body) }), () => new Date(now.getTime() + BILLING_RETRY_WINDOW_MS)))
  assert.equal(creates, 0); assert.equal((await requestRow()).state, 'reconcile_required')
})
test('provider errors or mismatched financial facts persist reconciliation without usage finalization', async () => {
  for (const bad of ['throw','amount']) {
    await admin.query('DELETE FROM public.ai_billing_requests')
    await admin.query('UPDATE public.ai_usage_events SET billing_batch=NULL WHERE tenant_id=$1', [a])
    await assert.rejects(runNativeAiBilling(options, repo, gateway(async body => { if (bad === 'throw') throw Error('unknown delivery'); return { ...item(body), amount: 1 } }), () => now))
    assert.equal((await requestRow()).state, 'reconcile_required'); assert.ok((await usageRows()).every(row => row.billing_batch && !row.invoiced_at))
  }
})
test('unknown legacy claimed batches refuse without inventing facts or claiming more usage', async () => {
  await admin.query('UPDATE public.ai_usage_events SET billing_batch=$2 WHERE tenant_id=$1', [a, randomUUID()])
  await assert.rejects(repo.prepare(options, context), { status: 503 }); assert.equal(await requestRow(), undefined)
})
test('tenant/request context, live lease, cutoff and tuple guards prevent cross-request financial effects', async () => {
  const req = await frozen()
  await assert.rejects(repo.claim(req, { ...context, accountId: 'acct_other' }, now), { status: 503 })
  await assert.rejects(repo.claim({ ...req, tenantId: b }, context, now), { status: 503 })
  const claim = await repo.claim(req, context, now); assert.ok(claim)
  await assert.rejects(repo.claim(req, context, now), { status: 503 })
  await assert.rejects(repo.prepare({ ...options, invoiceId: 'in_other' }, context), { status: 503 })
  await assert.rejects(repo.finalize(req, randomUUID(), item(req.body), options, now), { status: 503 })
  assert.ok((await usageRows()).every(row => !row.invoiced_at))
})
test('changed usage membership or money refuses before create and before successful finalization', async () => {
  const req = await frozen()
  await admin.query('UPDATE public.ai_usage_events SET charge_usd=1 WHERE tenant_id=$1', [a])
  await assert.rejects(repo.claim(req, context, now), { status: 503 })
  assert.equal((await requestRow()).state, 'prepared')
  await admin.query('UPDATE public.ai_usage_events SET charge_usd=CASE WHEN cost_usd=0.1 THEN 0.13 ELSE 0.26 END WHERE tenant_id=$1', [a])
  const claim = await repo.claim(req, context, now); assert.ok(claim)
  await admin.query('INSERT INTO public.ai_usage_events(tenant_id,occurred_at,billable,cost_usd,charge_usd,billing_batch) VALUES($1,$2,true,1,1,$3)', [a, now.toISOString(), req.batchId])
  await assert.rejects(repo.finalize(req, claim.token, item(req.body), options, now), { status: 503 })
  assert.ok((await usageRows()).every(row => !row.invoiced_at)); assert.equal((await requestRow()).state, 'requesting')
})
test('valid no-customer, no-usage, future-cutoff and below-minimum cases retain no-charge semantics', async () => {
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_customer_id=NULL WHERE tenant_id=$1", [a])
  let result = await repo.prepare(options); assert.equal(result.kind, 'done'); if (result.kind === 'done') assert.equal(result.result.reason, 'no_stripe_customer')
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_customer_id='cus_a' WHERE tenant_id=$1", [a])
  result = await repo.prepare({ ...options, now: new Date(now.getTime() - 1) }); assert.equal(result.kind, 'done'); if (result.kind === 'done') assert.equal(result.result.reason, 'nothing_to_bill')
  await admin.query('UPDATE public.ai_usage_events SET cost_usd=0.00000001,charge_usd=0.00000001 WHERE tenant_id=$1', [a])
  result = await repo.prepare(options); assert.equal(result.kind, 'done'); if (result.kind === 'done') assert.equal(result.result.reason, 'below_minimum')
  assert.ok((await usageRows()).every(row => !row.billing_batch && !row.invoiced_at)); assert.equal(await requestRow(), undefined)
})
test('invoice usage and event receipt finalize atomically, duplicates skip and no-charge invoices can receipt', async () => {
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, invoiceId: 'in_fixture', subscriptionId: 'sub_a' }, opts = { ...options, invoiceId: event.invoiceId, event }
  const resolved = await tx(q => nativeInvoiceTarget(q, { id: event.id, type: 'invoice.created', data: { object: { id: event.invoiceId, status: 'draft', billing_reason: 'subscription_cycle', subscription: event.subscriptionId, currency: 'brl' } } }))
  assert.equal(resolved?.tenantId, a)
  let creates = 0
  const provider = gateway(async body => { creates++; return item(body) })
  const result = await runNativeAiBilling(opts, repo, provider, () => now); assert.equal(result.result.billed, true)
  assert.equal((await admin.query('SELECT event_type FROM public.processed_stripe_events WHERE event_id=$1', [event.id])).rows[0].event_type, 'invoice.created')
  assert.equal((await runNativeAiBilling(opts, repo, provider, () => now)).skipped, true); assert.equal(creates, 1)
  const noop = { ...opts, event: { ...event, id: `evt_${randomUUID().replaceAll('-', '')}` } }
  assert.equal((await runNativeAiBilling(noop, repo, provider, () => now)).result.reason, 'nothing_to_bill'); assert.equal(creates, 1)
})
test('invoice receipt failure rolls back the entire local mark and recovers the identical request', async () => {
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, invoiceId: 'in_fixture', subscriptionId: 'sub_a' }, opts = { ...options, invoiceId: event.invoiceId, event }
  await admin.query(`ALTER TABLE public.processed_stripe_events ADD CONSTRAINT fixture_refuse_receipt CHECK(event_id<>'${event.id}')`)
  let creates = 0
  const provider = gateway(async body => { creates++; return item(body) })
  await assert.rejects(runNativeAiBilling(opts, repo, provider, () => now))
  assert.ok((await usageRows()).every(row => !row.invoiced_at)); assert.equal((await requestRow()).state, 'requesting')
  await admin.query('ALTER TABLE public.processed_stripe_events DROP CONSTRAINT fixture_refuse_receipt')
  await runNativeAiBilling(opts, repo, provider, () => new Date(now.getTime() + 31000)); assert.equal(creates, 2)
  assert.ok((await usageRows()).every(row => row.invoiced_at)); assert.equal((await requestRow()).state, 'confirmed')
})
test('request state CHECKs and the one-open-tenant index reject malformed financial transitions', async () => {
  const req = await frozen()
  await assert.rejects(admin.query("UPDATE public.ai_billing_requests SET state='confirmed' WHERE batch_id=$1", [req.batchId]))
  await assert.rejects(admin.query('INSERT INTO public.ai_billing_requests SELECT $2,tenant_id,created_at,cutoff_at,request_body,provider_context,request_hash,usage_digest,event_count,cost_usd,charge_usd,max_event_id,NULL,state,first_attempt_at,attempt_token,lease_until,stripe_invoice_item_id,confirmed_at FROM public.ai_billing_requests WHERE batch_id=$1', [req.batchId, randomUUID()]))
  assert.equal((await requestRow()).state, 'prepared')
})
test('subscription drift cannot acknowledge an invoice event with an unsettled financial request', async () => {
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, invoiceId: 'in_fixture', subscriptionId: 'sub_a' }
  await frozen({ ...options, invoiceId: event.invoiceId, event })
  await admin.query("UPDATE public.tenant_subscriptions SET stripe_subscription_id='sub_changed' WHERE tenant_id=$1", [a])
  await assert.rejects(tx(q => nativeInvoiceTarget(q, { id: event.id, type: 'invoice.created', data: { object: { id: event.invoiceId, status: 'draft', billing_reason: 'subscription_cycle', subscription: event.subscriptionId } } })), { status: 503 })
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.processed_stripe_events')).rows[0].n, 0)
  assert.equal((await requestRow()).state, 'prepared')
})
test('the proposed runtime grants permit state advancement but forbid fact replacement and deletion', async () => {
  const req = await frozen(), client = await admin.connect()
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL ROLE xmartmenu_billing_fixture_runtime')
    const read = await client.query('SELECT request_hash FROM public.ai_billing_requests WHERE batch_id=$1', [req.batchId]); assert.equal(read.rows[0].request_hash, req.requestHash)
    await client.query("UPDATE public.ai_billing_requests SET state='requesting',first_attempt_at=$2,attempt_token=$3,lease_until=$4 WHERE batch_id=$1", [req.batchId, now.toISOString(), randomUUID(), new Date(now.getTime() + 30000).toISOString()])
    await client.query('ROLLBACK')
    for (const sql of ['UPDATE public.ai_billing_requests SET request_body=request_body', 'DELETE FROM public.ai_billing_requests']) {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE xmartmenu_billing_fixture_runtime')
      await assert.rejects(client.query(sql), (error: unknown) => (error as { code?: string }).code === '42501'); await client.query('ROLLBACK')
    }
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release() }
})
