# External Integrations

**Analysis Date:** 2026-05-05

## APIs & External Services

**Supabase (Primary Backend):**
- PostgreSQL database + authentication + storage + real-time
  - SDK/Client: @supabase/supabase-js 2.101.1, @supabase/ssr 0.10.0
  - Auth: Environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
  - Implementation: Server-side client (`src/lib/supabase/server.ts`), browser client (`src/lib/supabase/client.ts`), middleware integration (`src/lib/supabase/middleware.ts`)

## Data Storage

**Primary Database:**
- PostgreSQL (Supabase)
  - Connection: Via @supabase/supabase-js client
  - Client: createClient() for browser, createServerClient() for SSR, createServiceClient() for admin operations
  - Schema: Multi-tenant with 19 migrations (001-019) in `supabase/migrations/`
  - Key tables:
    - `tenants` - Tenant records with slug, plan (free/pro/enterprise)
    - `profiles` - User profiles with role (superadmin/admin/store-admin/store-staff/customer), tenant_id
    - `products` - Menu items with category_id, pricing, availability, images
    - `categories` - Product categories per tenant
    - `menus` - Multiple menus per tenant (supports i18n)
    - `orders` - Customer orders with status
    - `order_items` - Order line items
    - `qr_codes` - QR code tracking
    - `scan_events` - QR code scan analytics
    - `staff` - Store staff members with roles and permissions
    - `tenant_settings` - Branding, contact info, business hours

**File Storage:**
- Supabase Storage
  - Bucket: `tenant-assets` (for logos, banners, product images)
  - Access: Via `supabase.storage.from('tenant-assets').upload()` and `.getPublicUrl()`
  - Remote image pattern: `https://*.supabase.co/storage/v1/object/public/**`
  - Implementation: `src/app/api/superadmin/tenants/[id]/upload/route.ts`, `src/app/(admin)/menu/products/ProductsClient.tsx`

**Caching:**
- None detected - Uses Supabase query caching naturally

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (built-in)
  - Implementation: Email/password signup and signin
  - Flow:
    1. `POST /api/auth/register` - Creates auth.users and profiles record
    2. Email verification (optional redirect URL via query param)
    3. `POST /api/auth/resolve-redirect` - Determines user redirect based on role
    4. Session managed via cookies (Supabase SSR cookie handling)
  - Quick-flow: Anonymous customer via auto-generated credentials (name + phone only)
  - Password requirements: Minimum 8 characters
  - Roles:
    - superadmin - Full platform access (configured via email allowlist in env vars)
    - store-admin - Full tenant access
    - store-staff - Limited tenant access (read-only on menus/settings)
    - customer - Public menu access + order placement
  - Session invalidation: `POST /api/auth/signout`
  - Middleware route protection: `src/middleware.ts` → `src/lib/supabase/middleware.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected - Basic console.error() logging in API routes

**Logs:**
- Browser: console.log/error (development)
- Server: console.error for API errors with context labels (e.g., "orders.create_error", "orders.fetch_error")
- No centralized logging service

## CI/CD & Deployment

**Hosting:**
- Vercel (implied via Next.js 16.2.2 and next.config.ts)
- Supabase (database + storage + auth)

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or build config visible

## Environment Configuration

**Required env vars (from `.env.example`):**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Optional env vars (inferred from code):**
```
NEXT_PUBLIC_APP_URL=https://yourdomain.com  (defaults to localhost:3000)
```

**For Superadmin Configuration:**
- Superadmin emails are parsed from environment (see `src/lib/auth/role-utils.ts` - `parseSuperadminEmails()`)
- Implementation: Check if email matches configured superadmin list, upgrade role in profiles table

**Secrets location:**
- `.env.local` (local development) - loaded by dotenv in seed scripts
- Vercel environment variables (production)
- Supabase project dashboard (keys are also stored server-side)

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Supabase Auth email verification callback: `${origin}/auth/callback?next=${redirectTo}`
  - Handled by `src/app/auth/callback/route.ts` (location inferred from auth flow)

**Special Callbacks:**
- `POST /api/auth/register` - Custom registration with email verification redirect
- `POST /api/auth/resolve-redirect` - Post-auth redirect logic based on user role
- `POST /api/auth/signout` - Logout with redirect to login

## API Routes (Internal Endpoints)

**Authentication:**
- `POST /api/auth/register` - Create user account (email+password or quick QR flow)
- `POST /api/auth/resolve-redirect` - Determine post-login redirect
- `POST /api/auth/signout` - Sign out user

**Admin Operations:**
- `GET|POST /api/admin/categories` - List/create categories
- `GET|PUT|DELETE /api/admin/categories/[id]` - Manage individual category
- `GET|POST /api/admin/menus` - List/create menus
- `GET /api/admin/menus/select` - Fetch menus for selection
- `GET|PUT|DELETE /api/admin/menus/[id]` - Manage individual menu
- `GET|POST /api/admin/staff` - List/create staff members
- `GET|PUT|DELETE /api/admin/staff/[id]` - Manage staff roles/permissions
- `POST /api/admin/enter-preview` - Enter tenant preview mode (superadmin)
- `POST /api/admin/exit-preview` - Exit preview mode

**Superadmin Operations:**
- `GET|POST /api/superadmin/tenants` - List/create tenants
- `GET|PUT|DELETE /api/superadmin/tenants/[id]` - Manage tenant
- `GET|PUT /api/superadmin/tenants/[id]/settings` - Branding/settings
- `GET|POST /api/superadmin/tenants/[id]/menus` - Tenant menus
- `GET|POST /api/superadmin/tenants/[id]/staff` - Tenant staff
- `GET|PUT|DELETE /api/superadmin/tenants/[id]/staff/[staffId]` - Staff management
- `POST /api/superadmin/tenants/[id]/upload` - File upload to Supabase Storage
- `GET|POST /api/superadmin/users` - User management
- `GET|PUT|DELETE /api/superadmin/users/[id]` - Individual user operations
- `GET|PUT /api/superadmin/settings` - Platform-wide settings

**Orders:**
- `GET|POST /api/orders` - Create order, list by tenant_id
- `GET|PUT|DELETE /api/orders/[id]` - Manage individual order

**Public:**
- `GET /api/public/[slug]` - Public menu access (no auth required)

**Onboarding:**
- `POST /api/onboarding` - Create initial tenant for new admin

## Integration Points Summary

| Integration | Purpose | Type | Location |
|-------------|---------|------|----------|
| Supabase PostgreSQL | Multi-tenant database | Database | `createServiceClient()` in API routes |
| Supabase Auth | User authentication | Auth provider | `createClient()` SSR, auth routes |
| Supabase Storage | File/image upload | File storage | `src/lib/upload.ts`, upload API routes |
| QR Code Generation | Menu QR codes | Library | `src/app/(admin)/settings/qrcode/` |
| Image Processing | WebP conversion | Library | `src/lib/upload.ts` with sharp |

---

*Integration audit: 2026-05-05*
