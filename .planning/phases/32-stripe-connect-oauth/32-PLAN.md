---
phase: "32"
plan: "01"
name: Stripe Connect OAuth
type: execute
autonomous: false
wave: 1
depends_on: []
requirements:
  - MON-03
  - MON-04
---

# Phase 32 Plan 01: Stripe Connect OAuth

## Objective

Implement Stripe Connect Standard OAuth flow for tenants on the `payments` plan, enabling them to connect their own Stripe accounts for receiving customer payments directly.

## Context

Phase 30 established the database schema (`plans`, `tenant_subscriptions`, `stripe_connections` tables) and `getTenantPlan()` helper. Phase 31 added superadmin plan management UI. This plan adds the OAuth flow (connect/disconnect) and tenant-facing settings UI.

**Feature gating rules:**
- `menu` plan → `orders_enabled = false` (forced)
- `orders` plan → `orders_enabled = true`, no Stripe
- `payments` plan → `orders_enabled = true`, Stripe Connect available
- Stripe Connect button visible ONLY for tenants with `stripe-connect` in plan features

## Implementation

### Task 1: Install Stripe SDK

**Type:** `auto`

Install the official Stripe Node.js SDK as a project dependency.

**Behavior:**
- Run `npm install stripe` in project root
- SDK version: `^14.0.0` (stable, supports OAuth token endpoint)

**Verification:**
- `npm list stripe` shows stripe package
- `node -e "require('stripe')"` loads without error

---

### Task 2: Create Stripe library (`src/lib/stripe.ts`)

**Type:** `auto`

Create the Stripe client initialization module.

**Files to create:**
- `src/lib/stripe.ts`

**Behavior:**
```typescript
import Stripe from 'stripe'

// Initialize Stripe client with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-10-28.acacia',
})

export { stripe }

// Feature gate: check if tenant can use Stripe payments
export async function isStripeEnabled(tenantId: string): Promise<boolean> {
  const { getTenantPlan } = await import('@/lib/tenant-plan')
  const plan = await getTenantPlan(tenantId)
  
  if (!plan) return false
  if (!plan.features.includes('stripe-connect')) return false
  
  // Check for active Stripe connection
  const supabase = await import('@/lib/supabase/server').then(m => m.createClient())
  const { data } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()
  
  return !!data
}

// Get Stripe connection for a tenant
export async function getStripeConnection(tenantId: string): Promise<StripeConnection | null> {
  const supabase = await import('@/lib/supabase/server').then(m => m.createClient())
  const { data } = await supabase
    .from('stripe_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .single()
  return data
}
```

**Verification:**
- File compiles without TypeScript errors
- `isStripeEnabled()` and `getStripeConnection()` exported

---

### Task 3: OAuth initiation route

**Type:** `auto`

Create the OAuth initiation endpoint that redirects to Stripe.

**Files to create:**
- `src/app/api/stripe/connect/oauth/route.ts`

**Behavior:**
```
GET /api/stripe/connect/oauth
Authorization: session (tenant must be logged in)
```

1. Get `tenantId` from authenticated session (`getEffectiveTenant()`)
2. Verify tenant has `stripe-connect` feature in plan (return 403 if not)
3. Check if tenant already has active connection → redirect to settings with `?stripe=already_connected`
4. Build Stripe OAuth URL:
   ```
   https://connect.stripe.com/oauth/authorize?
     response_type=code&
     client_id={STRIPE_CLIENT_ID}&
     scope=read_write&
     redirect_uri={BASE_URL}/api/stripe/connect/callback&
     state={base64(JSON.stringify({ tenantId, timestamp }))}
   ```
5. Redirect to Stripe OAuth URL

**Error handling:**
- 401 → redirect to login
- 403 → `?stripe=feature_not_available`
- Missing env vars → return 500

**Verification:**
- GET `/api/stripe/connect/oauth` returns 302 to Stripe URL
- URL contains correct `client_id`, `scope`, `redirect_uri`, `state`

---

### Task 4: OAuth callback route

**Type:** `auto`

Handle the OAuth callback from Stripe.

**Files to create:**
- `src/app/api/stripe/connect/callback/route.ts`

**Behavior:**
```
GET /api/stripe/connect/callback?code=xxx&state=yyy
```

1. Parse `code` and `state` from query params
2. Decode `state` to get `tenantId`
3. **Error flows:**
   - Missing `code` → redirect to settings with `?stripe=missing_code`
   - `error=access_denied` from Stripe → redirect with `?stripe=access_denied`
   - Invalid state (missing/expired) → redirect with `?stripe=invalid_state`
4. Exchange `code` for `stripe_account_id` using `stripe.oauth.token()`:
   ```typescript
   const response = await stripe.oauth.token({
     grant_type: 'authorization_code',
     code,
   })
   // response.stripe_user_id = 'acct_xxx'
   ```
5. Upsert into `stripe_connections`:
   ```typescript
   supabase.from('stripe_connections').upsert({
     tenant_id: tenantId,
     stripe_account_id: response.stripe_user_id,
     scope: 'read_write',
     connected_at: new Date().toISOString(),
     is_active: true,
   }, { onConflict: 'tenant_id' })
   ```
6. Redirect to settings with `?stripe=connected`

**Verification:**
- Valid code → creates/updates `stripe_connections` row, redirects to `?stripe=connected`
- Invalid code → redirects to `?stripe=exchange_failed`
- Denied permission → redirects to `?stripe=access_denied`

---

### Task 5: Disconnect route

**Type:** `auto`

Create the endpoint to deactivate a Stripe connection.

**Files to create:**
- `src/app/api/stripe/connect/disconnect/route.ts`

**Behavior:**
```
POST /api/stripe/connect/disconnect
Authorization: session (tenant must be logged in)
```

1. Get `tenantId` from authenticated session
2. Set `is_active = false` on tenant's Stripe connection (soft delete for audit trail)
3. Return `{ success: true, disconnected: true }` or `{ success: true, disconnected: false }` if no active connection

**Response format:**
```typescript
// Success
{ success: true, disconnected: true }

// Already disconnected
{ success: true, disconnected: false }
```

**Error handling:**
- 401 → return `{ error: 'Unauthorized' }`
- DB error → return 500

**Verification:**
- POST with active connection → `is_active = false`, returns `{ success: true, disconnected: true }`
- POST with no active connection → returns `{ success: true, disconnected: false }`

---

### Task 6: Tenant settings Stripe section

**Type:** `checkpoint:human-verify`

Add Stripe Connect UI to the tenant settings page.

**Files to modify:**
- `src/app/(admin)/settings/store/page.tsx` — fetch Stripe connection status
- `src/app/(admin)/settings/store/StoreClient.tsx` — add Stripe Connect section

**Page.tsx changes:**
```typescript
// Fetch stripe connection status alongside settings
const { data: stripeConnection } = await supabase
  .from('stripe_connections')
  .select('*')
  .eq('tenant_id', tenantId)
  .eq('is_active', true)
  .single()

return <StoreClient 
  settings={settings} 
  tenantId={tenantId}
  stripeConnection={stripeConnection}
/>
```

**StoreClient.tsx changes:**

Add `stripeConnection` prop to interface, then add a new section:

```tsx
// Check if tenant has stripe-connect feature (passed as prop or fetched)
{hasStripeConnectFeature ? (
  stripeConnection ? (
    // Connected state
    <div className={section}>
      <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">
        Stripe Connect
      </h2>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span className="text-sm font-medium text-zinc-700">Connected</span>
        </div>
        <p className="text-xs text-zinc-400">
          Account: {maskStripeAccountId(stripeConnection.stripe_account_id)}
        </p>
        <p className="text-xs text-zinc-400">
          Connected: {new Date(stripeConnection.connected_at).toLocaleDateString()}
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="mt-2 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect Stripe Account'}
        </button>
      </div>
    </div>
  ) : (
    // Not connected state
    <div className={section}>
      <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">
        Stripe Connect
      </h2>
      <p className="text-xs text-zinc-400 mb-3">
        Connect your Stripe account to accept online payments directly to your bank.
      </p>
      <a
        href="/api/stripe/connect/oauth"
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white text-sm rounded-lg hover:bg-[#5552E5]"
      >
        <StripeIcon /> Connect with Stripe
      </a>
    </div>
  )
) : (
  // Feature not available
  <div className={section}>
    <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">
      Stripe Connect
    </h2>
    <div className="flex items-start gap-2 text-zinc-500">
      <span>🔒</span>
      <p className="text-sm">
        Stripe Connect requires the Menu + Payments plan. Upgrade to enable online payments.
      </p>
    </div>
  </div>
)}
```

**Client-side state management:**
```typescript
const [disconnecting, setDisconnecting] = useState(false)
const [stripeStatus, setStripeStatus] = useState<string | null>(
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('stripe') : null
)

async function handleDisconnect() {
  if (!confirm('Are you sure you want to disconnect your Stripe account?')) return
  setDisconnecting(true)
  const res = await fetch('/api/stripe/connect/disconnect', { method: 'POST' })
  const data = await res.json()
  if (data.success) {
    window.location.reload()
  } else {
    setDisconnecting(false)
    alert('Failed to disconnect: ' + (data.error || 'Unknown error'))
  }
}
```

**Verification:**
- Navigate to `/admin/settings/store` as a payments-plan tenant
- Click "Connect with Stripe" → redirects to Stripe OAuth
- After callback → shows "Connected" with masked account ID
- Click "Disconnect" → confirms and reloads with disconnected state
- Non-payments plan tenant sees "🔒" locked state

---

## Verification & Success Criteria

1. `npm list stripe` shows installed package
2. `src/lib/stripe.ts` exports `stripe`, `isStripeEnabled()`, `getStripeConnection()`
3. `/api/stripe/connect/oauth` returns 302 to Stripe with correct params
4. `/api/stripe/connect/callback` creates/updates `stripe_connections` record
5. `/api/stripe/connect/disconnect` soft-deletes the connection
6. Tenant settings page shows Stripe Connect section (only for payments plan)
7. UI states: connected (with disconnect button), not connected (with connect button), locked (for non-payments)
8. Feature gate helper `isStripeEnabled()` correctly checks plan + connection

## Key Files

| File | Action |
|------|--------|
| `src/lib/stripe.ts` | Create |
| `src/app/api/stripe/connect/oauth/route.ts` | Create |
| `src/app/api/stripe/connect/callback/route.ts` | Create |
| `src/app/api/stripe/connect/disconnect/route.ts` | Create |
| `src/app/(admin)/settings/store/page.tsx` | Modify |
| `src/app/(admin)/settings/store/StoreClient.tsx` | Modify |

## Environment Variables Needed

Add to `.env.local`:
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CLIENT_ID=ca_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # Phase 33 will need this
```