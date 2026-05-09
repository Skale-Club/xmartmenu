---
phase: 32
plan: "01"
name: Stripe Connect OAuth
status: discussion
created: 2026-05-09
---

# Phase 32 Discussion Log

## Discussion Date: 2026-05-09

### Scope Confirmation

Phase 32 covers **SEED-009 Phase C**: Stripe Connect OAuth

**Deliverables:**
1. OAuth initiation and callback routes
2. Disconnect endpoint
3. Tenant settings UI for Stripe connection
4. Feature gate helper for `stripe_enabled`

### OAuth Flow Design

#### Pattern Decision: Standard OAuth Flow

**Stripe Connect OAuth Options:**
- **Standard** — Tenant gets full Stripe dashboard, money goes directly to them
- **Express** — We host more of the onboarding, more code but faster
- **Custom** — Full control, significant compliance burden

- **Selected:** Standard OAuth
- **Rationale:** Per SEED-009 decision, tenants maintain control of their Stripe accounts. Standard provides maximum tenant control with minimal platform code.
- **Trade-off:** Slightly longer OAuth flow, but tenant controls their own Stripe experience

#### OAuth State Parameter

**Option 1:** Pass `tenant_id` encrypted in state parameter
- Pros: Secure, self-contained
- Cons: Need encryption mechanism

**Option 2:** Pass `tenant_id` in state, validate on callback via session
- Pros: Simple, leverages existing auth
- Cons: State could be manipulated

- **Selected:** Option 2 — Use session to get tenant_id on callback
- **Rationale:** Authenticated tenant session already contains tenant_id. State parameter can be a nonce or empty. Validate by checking session matches.

**Revised Flow:**
1. `/api/stripe/connect/oauth` → generate state nonce, store in DB or cache
2. Redirect to Stripe with state nonce
3. Callback receives code + state
4. On callback: verify state nonce valid, exchange code for stripe_account_id
5. Save to stripe_connections with tenant_id from session

Actually, simpler approach:
1. OAuth initiation uses authenticated session → tenant_id known
2. State parameter = `tenant_id:nonce` hashed or signed
3. Callback validates state, extracts tenant_id

**Final Decision:** State parameter = `tenant_id` (base64 encoded). Callback decodes and uses. Security via HTTPS + short-lived state validation.

#### Callback Redirect URL

**Option 1:** Redirect to `/admin/settings/store?tab=subscription&status=connected`
- Pros: Stay in settings context
- Cons: URL parameters for status

**Option 2:** Redirect to `/admin/settings/store` with toast notification
- Pros: Cleaner URL, toast handles message
- Cons: Need toast notification system

- **Selected:** Option 2 — Toast-based feedback
- **Rationale:** Matches existing UX patterns for success/error feedback

### API Design

#### OAuth Initiation Route

```
GET /api/stripe/connect/oauth
```

**Response:** 302 Redirect to Stripe OAuth URL

**URL Construction:**
```
https://connect.stripe.com/oauth/authorize?
  response_type=code&
  client_id={STRIPE_CLIENT_ID}&
  scope=read_write&
  redirect_uri={BASE_URL}/api/stripe/connect/callback&
  state={tenant_id_encoded}
```

#### OAuth Callback Route

```
GET /api/stripe/connect/callback?code=xxx&state=yyy
```

**Logic:**
1. Decode state → get tenant_id
2. Exchange code for stripe_account_id via `stripe.oauth.token()`
3. Upsert into `stripe_connections` table
4. Redirect to settings with success param

#### Disconnect Route

```
POST /api/stripe/connect/disconnect
Authorization: Bearer {session_token}
```

**Logic:**
1. Get tenant_id from session
2. Set `is_active = false` in `stripe_connections`
3. Return { success: true }

### Tenant Settings UI

#### Subscription Tab Enhancement

**Current State (Phase 31):**
- Current plan display
- Effective pricing
- Billing cycle selector
- Override fields

**Add Stripe Section:**

```
┌─ Stripe Connect ─────────────────────────────────────┐
│                                                      │
│  Status: ● Connected (acct_xxx...yZ)                │
│  Connected: May 9, 2026                              │
│                                                      │
│  [Disconnect Stripe Account]                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**For payments plan, not connected:**
```
┌─ Stripe Connect ─────────────────────────────────────┐
│                                                      │
│  Status: ○ Not connected                            │
│                                                      │
│  Connect your Stripe account to accept online       │
│  payments directly to your bank.                     │
│                                                      │
│  [Connect with Stripe]                               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**For non-payments plan:**
```
┌─ Stripe Connect ─────────────────────────────────────┐
│                                                      │
│  🔒 Stripe Connect requires the Menu + Payments     │
│     plan. Upgrade to enable online payments.         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Feature Gate Implementation

```typescript
// src/lib/stripe.ts
export async function isStripeEnabled(tenantId: string): Promise<boolean> {
  const plan = await getTenantPlan(tenantId)
  if (!plan) return false
  if (!plan.features.includes('stripe-connect')) return false
  
  // Check for active Stripe connection
  const { data } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()
  
  return !!data
}
```

### Error Handling

**Stripe OAuth Errors:**
- User denies permission → redirect with `?error=access_denied`
- Invalid state → redirect with `?error=invalid_state`
- Stripe API error → log, redirect with `?error=stripe_error`
- Code exchange fails → log, redirect with `?error=exchange_failed`

**Disconnect Errors:**
- No active connection → return { connected: false }
- Database error → return 500 with error message

### Edge Cases

1. **Tenant already connected** — Upsert (update existing or insert new)
2. **OAuth timeout** — State parameter could expire; handle gracefully
3. **Multiple connect attempts** — Prevent duplicate connections
4. **Reconnecting after disconnect** — Reactivate existing record vs create new
5. **Non-payments plan user tries API directly** — Return 403 Forbidden
6. **Stripe account already linked to another xmartmenu tenant** — Stripe will reject; handle error message

### Implementation Order (Recommended)

1. **Stripe Library Setup** (`src/lib/stripe.ts`)
   - Initialize Stripe client
   - Type definitions for OAuth responses

2. **OAuth Routes**
   - OAuth initiation route with URL building
   - Callback route with code exchange
   - Test OAuth flow end-to-end

3. **Disconnect Route**
   - Soft delete pattern
   - API response format

4. **Tenant Settings UI**
   - Fetch Stripe connection status
   - Connect button with loading state
   - Connection status display
   - Disconnect button

5. **Feature Gate Helper**
   - `isStripeEnabled()` function
   - `stripeHasFeature()` helper

### Dependencies

- Phase 30: `stripe_connections` table, `StripeConnection` type
- Phase 31: Subscription tab infrastructure
- SEED-009 Phase C: OAuth, connect/disconnect, tenant UI
- SEED-003: Superseded by SEED-009 (reference for OAuth patterns)

### Environment Variables Required

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CLIENT_ID=ca_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
# Optional for Phase 32 (required for Phase 33)
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Known Stripe API Details

**OAuth Token Exchange:**
```typescript
const response = await stripe.oauth.token({
  grant_type: 'authorization_code',
  code: authorizationCode,
})
// response.stripe_user_id = acct_xxx (the connected account ID)
```

**Account ID Format:**
- Test mode: `acct_xxx` (starts with acct_)
- Live mode: `acct_xxx` (same format)

### Open Questions

1. **Should we verify the Stripe account is valid before saving?**
   - Pro: Prevent invalid accounts
   - Con: Extra API call, edge case handling
   - Decision: Skip for v1, handle errors from Phase 33

2. **Do we need webhooks for account status changes?**
   - `account.updated` event could notify us of account issues
   - Deferred to Phase 33 (webhook phase)

3. **Should Stripe connection status be real-time?**
   - Could use Stripe API to verify account status
   - Deferred to future phase, store-only for v1

---

## Summary for Planning

**Phase 32 is ready to plan.**

Key deliverables:
- OAuth initiation route → redirect to Stripe
- OAuth callback route → exchange code, save connection
- Disconnect route → soft delete connection
- Tenant settings Stripe section → connect button, status, disconnect
- `isStripeEnabled()` feature gate helper

Estimated complexity: Medium
- 5-6 tasks
- ~30-45 minutes estimated

**Next:** Phase 33 (Payment Intent + Webhook)