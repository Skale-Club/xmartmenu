# Phase 30 Discussion Log

## Initial Analysis: 2026-05-09

### Context Discovered

**Primary source:** SEED-009 (Plans, Pricing & Stripe Connect Monetization)

SEED-009 defines a 5-phase scope for v2.0 Monetization. Phase 30 corresponds to Phase A of the seed ("Schema + Planos Base").

**Key facts:**
- 4 new DB tables needed: `plans`, `tenant_subscriptions`, `stripe_connections`, `processed_stripe_events`
- 3 seed plans: `menu` ($49/mo), `orders` ($99/mo), `payments` ($179/mo + 0.5% tx fee)
- Existing tenants grandfathered to `payments` plan
- `getTenantPlan(tenantId)` helper resolves overrides
- Zero hardcoded prices in code — all go through helper

**Breaking change identified:** `src/types/database.ts` has `Plan = 'free' | 'pro' | 'enterprise'`. This must be replaced with a DB-driven plan system. The string literal type will be removed and replaced with a `Plan` interface that represents a row from the `plans` table.

### Architectural Questions

**Q1: Where does `getTenantPlan()` live?**
- Option A: `src/lib/tenant-plan.ts` — dedicated module, imported anywhere price/feature check needed
- Option B: Inline in component/route — simpler, but scattered
- Decision: `src/lib/tenant-plan.ts` — single source of truth for plan resolution

**Q2: Override pattern — NULL vs absent key?**
- SEED-009 specifies: NULL = use plan value, value = override
- Must ensure `getTenantPlan` never returns mixed values (e.g., base monthly_price but overridden annual_price)
- Decision: Helper returns fully-resolved `EffectivePlan` object with all values populated

**Q3: Feature gating — where does `orders_enabled` logic live?**
- Currently: `orders_enabled` column on `tenant_settings`
- New: derived from plan type (menu plan forces false)
- Decision: Phase 30 does NOT change `orders_enabled` behavior — it only creates the schema. Feature gate implementation is Phase 32 concern.

**Q4: Migration approach?**
- Supabase migrations via `supabase/migrations/` directory (standard pattern)
- Migration 029: `029_plans_subscriptions.sql`
- Decision: Use Supabase migration pattern (same as migrations 024-028)

### Concerns & Observations

1. **No Stripe env vars yet** — Phase 30 doesn't need them, but planning should note that Phase 32 will require `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

2. **Billing SaaS fee NOT included** — SEED-009 notes: "cobrança é manual/offline por enquanto" — the system only tracks which plan a tenant has, not billing/payment from tenant to xmartmenu

3. **Trial status** — Schema includes `trial` status but implementation is future. No trial logic in Phase 30.

4. **Multi-plan per tenant** — Not supported (UNIQUE on tenant_id). Intentional for v1 to keep scope manageable.

5. **Inactive plans** — `is_active = false` plan doesn't appear for new tenants but existing tenants keep access (grandfather rule)

### References Consulted

- SEED-009 (primary) — phase A scope, schema, seed data, feature gating rules
- SEED-003 (superseded by SEED-009) — original Stripe Connect seed, useful for understanding the evolution
- `src/types/database.ts` — current types, identified `Plan` type needs replacement
- `.planning/ROADMAP.md` — Phase 30 description confirmed
- `.planning/PROJECT.md` — current state (v2.0 in progress), tech stack
- Phase 21 `21-RESEARCH.md` — pattern for research/discussion files in the project

### Next Steps

1. Create PLAN.md with tasks based on SEED-009 Phase A scope
2. Execute migration + seed + types + helper
3. Verify with: `SELECT * FROM plans` → 3 rows, all tenants have subscriptions

---

*Log entry: 2026-05-09T16:00:00Z — Phase 30 discussion initiated*