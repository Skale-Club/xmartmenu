---
phase: 31
plan: "01"
name: Superadmin Plan Management
status: discussion
created: 2026-05-09
---

# Phase 31 Discussion Log

## Discussion Date: 2026-05-09

### Scope Confirmation

Phase 31 covers **SEED-009 Phase B**: Superadmin Plan Management UI

**Deliverables:**
1. `/superadmin/plans` — Full CRUD for plans table
2. `/superadmin/tenants/[id]` — Subscription tab with override controls
3. Tenant list enhancement with plan column

### Implementation Strategy

#### 1. Plan Management Page (`/superadmin/plans`)

**Pattern Decision:** Inline editing vs. modal vs. separate page?

- **Selected:** Inline editing with section-based form
- **Rationale:** Matches existing `StoreClient.tsx` pattern; simple, fast
- **Alternative:** Modal — more click-heavy, but cleaner for complex edits
- **Decision:** Use inline form pattern for consistency with existing superadmin UX

**Fields to Edit:**
- name (text)
- description (text, optional)
- monthly_price (number)
- annual_price (number)
- transaction_fee_pct (number, displayed as percentage)
- features (JSONB array, editable as comma-separated)
- is_active (toggle)
- sort_order (number)

#### 2. Tenant Subscription Tab

**Pattern Decision:** Add as new tab in existing tenant detail page?

- **Selected:** New "Subscription" tab in tenant detail
- **Existing tabs:** Staff, Menus (per TenantDetailClient)
- **Subscription tab content:**
  - Current plan name (read-only display)
  - Effective price (base or override, resolved)
  - Billing cycle toggle (monthly/annual)
  - Override price fields (nullable inputs)
  - Override notes textarea
  - Save button

**Override UI Pattern:**
- Empty/cleared = use base price (NULL in DB)
- Filled = override applied
- Visual indicator: "Base: $X" vs "Override: $Y"

#### 3. Tenant List Enhancement

**Pattern Decision:** Add plan column to existing table?

- **Selected:** Add plan column to TenantsClient table
- **Existing columns:** Name, Slug, Status, Created
- **New column:** Plan (shows plan name or "—")
- **No filter/sort needed for v1** — just display

### Technical Decisions

#### API Routes
- Create new API routes under `/api/superadmin/plans/`
- Follow existing pattern: route.ts files with GET/PUT handlers
- Use `createServiceClient()` for admin operations

#### Type Safety
- Reuse existing `Plan`, `TenantSubscription` types from database.ts
- Create `PlanFormData` type for form state
- Use Zod for API request validation

#### UI Components
- Reuse existing UI patterns (sections, input styles from StoreClient)
- No new components needed — use existing primitives
- Tailwind for all styling (consistent with codebase)

### Edge Cases Considered

1. **Plan with no tenants** — Plan can be deactivated (is_active=false)
2. **Tenant on inactive plan** — Show warning, allow override to continue
3. **Grandfathered tenant** — Display indicator, preserve override_notes
4. **Empty override fields** — Treat as NULL, use base price
5. **Price validation** — Must be >= 0, annual >= monthly

### Implementation Order (TDD)

1. **API Routes First:**
   - GET/POST/PUT for plans
   - GET/PUT for tenant subscriptions

2. **Plan Page:**
   - List all plans
   - Edit inline form
   - Create new plan

3. **Tenant Detail Enhancement:**
   - Add subscription tab
   - Load subscription data
   - Save override functionality

4. **Tenants List:**
   - Add plan column to table

### Questions for Future Phases (Not in Scope)

- **Phase 32:** Stripe Connect OAuth flow
- **Phase 33:** Payment Intent creation
- **Phase 34:** Tenant-facing subscription UI

### Dependencies

- Phase 30 completed (migration applied, helper created)
- Database types available in `src/types/database.ts`
- Existing superadmin layout and auth pattern

---

## Summary for Planning

**Phase 31 is ready to plan.** 

Key deliverables:
- Plan CRUD at `/superadmin/plans`
- Tenant subscription override at `/superadmin/tenants/[id]` (new tab)
- Plan column in tenants list

Estimated complexity: Medium
- 4-6 tasks
- ~30-45 minutes estimated