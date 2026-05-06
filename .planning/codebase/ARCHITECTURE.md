# Architecture

**Analysis Date:** 2026-05-05

## Pattern Overview

**Overall:** Next.js App Router with multi-tenant architecture and role-based access control

**Key Characteristics:**
- Server Components for data fetching + Client Components for interactivity
- Multi-tenant isolation via tenant_id in database queries
- Three user roles: superadmin, store-admin, store-staff with different route access
- Middleware for authentication and authorization enforcement
- Supabase for auth and database with service-level and user-level clients
- Public/admin/superadmin route groups with distinct layouts and sidebars
- Cookie-based tenant scoping for superadmin preview mode

## Layers

**Request Entry & Auth Layer:**
- Purpose: Intercept requests, validate session, enforce routing rules, refresh auth
- Location: `src/middleware.ts`, `src/lib/supabase/middleware.ts`
- Contains: Next.js middleware matcher config, Supabase SSR client setup, route protection logic
- Depends on: Supabase Auth, cookies
- Used by: All routes

**Tenant Resolution Layer:**
- Purpose: Determine active tenant context from user profile, handle superadmin preview mode
- Location: `src/lib/get-effective-tenant.ts`, `src/lib/get-active-menu.ts`, `src/lib/auth/role-utils.ts`
- Contains: `getEffectiveTenant()` returns tenant + role; `getActiveMenuForTenant()` resolves menu from cookie/default; `normalizeRole()` maps role variants
- Depends on: Server Supabase client, cookies, profiles table
- Used by: Layout components, API routes

**Server Data Fetching Layer:**
- Purpose: Fetch data server-side in layouts and page components without exposing queries to client
- Location: `src/app/(admin)/layout.tsx`, `src/app/(public)/[slug]/page.tsx`, `src/app/(superadmin)/layout.tsx`
- Contains: Async layout/page components that query menus, categories, products, tenant_settings
- Depends on: Supabase server client, middleware-resolved auth context
- Used by: Page rendering, component hydration

**API Route Layer:**
- Purpose: Handle CRUD operations for admin/staff/superadmin actions; validate tenant scoping
- Location: `src/app/api/admin/*`, `src/app/api/superadmin/*`, `src/app/api/onboarding/*`
- Contains: Route handlers using `getEffectiveTenant()` to scope queries; sanitization functions; error handling
- Depends on: Supabase clients, request bodies, effective tenant context
- Used by: Client-side form submissions, admin operations

**UI Component Layer:**
- Purpose: Render interactive admin, menu display, onboarding flows
- Location: `src/components/admin/AdminSidebar.tsx`, `src/components/menu/MenuPage.tsx`, `src/app/onboarding/page.tsx`
- Contains: Client-side forms, modals, category/product grids, cart management, state handling
- Depends on: API routes, Supabase client-side auth, browser APIs
- Used by: Page rendering

## Data Flow

**Public Menu Display (Store Customer Path):**

1. User visits `/{tenantSlug}` → `src/app/(public)/[slug]/page.tsx` (server component)
2. Server queries tenant by slug using service client (no auth required)
3. Server fetches active menu, categories, products for tenant
4. Fires off `scan_events` insert (fire-and-forget)
5. Passes data to `MenuPage` client component with initial language
6. Client renders interactive menu with search, category filters, product modals
7. Customer can add to cart and submit order via `/api/orders`

**Admin Dashboard (Store Admin Path):**

1. User logs in → redirected to auth callback `/auth/callback`
2. Callback queries profile, normalizes role, creates superadmin if email matches `SUPERADMIN_EMAILS`
3. Redirects to `/dashboard` (admin route)
4. Middleware validates auth; non-superadmin users enter `/dashboard`
5. Admin layout `src/app/(admin)/layout.tsx` calls `getEffectiveTenant()` → loads menus
6. Admin sidebar shows restaurant name, menu selector, navigation links
7. Admin clicks menu items → routes to categories/products/orders/settings pages
8. Each page loads data server-side via Supabase, renders client components for interaction

**Superadmin Multi-Tenant Preview (Superadmin Path):**

1. Superadmin logs in → redirected to `/overview`
2. Views list of all tenants at `/tenants`
3. Clicks "Enter Preview" → calls `/api/admin/enter-preview` → sets `preview_tenant_id` cookie
4. Middleware detects `preview_tenant_id` cookie on admin routes → allows access
5. Admin layout uses `getEffectiveTenant()` which reads `preview_tenant_id` cookie
6. Displays "Viewing: {TenantName}" banner with exit button
7. Can now browse that tenant's dashboard exactly as store-admin would
8. Clicks "Exit Preview" → clears cookie, redirects to `/overview`

**Onboarding Flow (New Store-Admin):**

1. New user signs up → profile created with role=null, tenant_id=null
2. Callback checks for onboarding requirement → redirects to `/onboarding`
3. Client-side form collects company name, contact info, first menu/category/product
4. POST to `/api/onboarding`:
   - Creates tenant if user has no tenant_id
   - Creates tenant_settings with contact info
   - Updates profile to role=store-admin, tenant_id={new tenant}
   - Creates menu, category, product in single atomic flow
5. Returns success with `/{tenantSlug}/{menuSlug}` URL
6. Redirects to dashboard

**State Management:**

- **Auth state:** Supabase Auth session (JWT in httpOnly cookie managed by SSR middleware)
- **Tenant context:** Profile record + tenant relation fetched per request
- **UI state:** Component-local React state (search, cart, modals) + cookies for menu selection
- **Data mutations:** Form submissions POST to API routes; no client-side state sync with server

## Key Abstractions

**Multi-Tenant Scoping:**
- Purpose: Ensure users only access their tenant's data; enforce row-level security
- Examples: `getEffectiveTenant()` in `src/lib/get-effective-tenant.ts`, tenant_id parameter in `src/app/api/admin/menus/route.ts`
- Pattern: Every API route calls `getEffectiveTenant()` at start; if user is superadmin in preview, use preview_tenant_id; if store-admin, use profile.tenant_id. All queries filtered by `eq('tenant_id', ctx.tenantId)`. Returns 401 if user not authenticated or no tenant context.

**Menu Selection Persistence:**
- Purpose: Remember which menu admin is editing without page reload
- Examples: `getActiveMenuForTenant()` in `src/lib/get-active-menu.ts`, `POST /api/admin/menus/select`
- Pattern: Admin selects menu → POST stores menu_id in cookie `selected_menu_id` → sidebar reads cookie on next load → filters products/categories by selected menu

**Role-Based Route Access:**
- Purpose: Prevent unauthorized access to admin panels or superadmin features
- Examples: Middleware checks in `src/lib/supabase/middleware.ts` (lines 45-105), layout checks in `src/app/(admin)/layout.tsx` (line 21), `src/app/(superadmin)/layout.tsx` (line 18)
- Pattern: Middleware blocks non-authenticated users from /dashboard, /menus, /settings. Layouts check profile.role and redirect to login/home if mismatch. Superadmin without preview_tenant_id redirected to /overview.

**Menu Purpose & Language Aliases:**
- Purpose: Normalize menu type inputs and support multiple languages
- Examples: `sanitizeMenuPurpose()` in `src/app/api/onboarding/route.ts` (lines 15-20), `MENU_PURPOSE_ALIASES` map
- Pattern: User enters "pizzaria" → maps to "restaurant"; stores normalized value in menus.purpose column. Supported languages validated against allowed codes.

**Dynamic Route Parameters:**
- Purpose: Enable customer-facing URLs like `/{tenantSlug}/{menuSlug}` and admin routes like `/menu/categories`
- Examples: `src/app/(public)/[slug]/page.tsx` (slug parameter), `src/app/(admin)/menu/categories/page.tsx`
- Pattern: Next.js `params` prop (async in App Router) extracts dynamic segment. Server-side queries use slug/id to fetch record. Returns notFound() if record doesn't exist.

## Entry Points

**Web Routes:**
- `src/app/layout.tsx` - Root layout, metadata, global styles
- `src/app/page.tsx` - Home redirect (authenticates and sends to dashboard or login)
- `src/app/auth/login/page.tsx` - Login form redirects to Supabase Auth
- `src/auth/callback/route.ts` - OAuth callback: exchanges code, normalizes role, determines redirect
- `src/app/(public)/[slug]/page.tsx` - Public menu by tenant slug (no auth)
- `src/app/(admin)/(layout.tsx)` - Protected admin dashboard with sidebar
- `src/app/(superadmin)/layout.tsx` - Protected superadmin panel with all-tenants view
- `src/app/onboarding/page.tsx` - New store-admin tenant creation flow

**API Routes:**
- `src/app/api/auth/*` - Auth flow: register, callback, signout
- `src/app/api/admin/*` - Store admin CRUD: menus, categories, staff, settings
- `src/app/api/superadmin/*` - Superadmin CRUD: tenants, users, global settings
- `src/app/api/onboarding/route.ts` - Tenant + initial data creation
- `src/app/api/orders/route.ts` - Customer order submission
- `src/app/api/public/*` - Public-facing endpoints (no auth)

**Middleware:**
- `src/middleware.ts` - Invokes `updateSession()` from Supabase SSR middleware

## Error Handling

**Strategy:** Try/catch in API routes; 4xx/5xx responses; specific error messages in non-production

**Patterns:**
- **Validation:** Check required fields early in API routes; return 400 with field names
- **Auth errors:** Middleware and layouts redirect to `/auth/login`; API routes return 401
- **Permission errors:** API routes check role and return 403
- **Not found:** Server components call `notFound()` from Next.js if record missing
- **Server errors:** Wrap in try/catch; log error; return 500 with generic message (or details in dev)
- **Schema mismatch during onboarding:** Retry with fallback payloads (lines 192-210 in `/api/onboarding/route.ts`)

## Cross-Cutting Concerns

**Logging:** Console.error() for critical failures (profile lookup, tenant/menu creation in onboarding). No centralized logging system.

**Validation:** 
- Field presence checks at route handler start
- Type sanitization for user inputs (e.g., `sanitizeLanguages()`, `sanitizeMenuPurpose()`)
- Slug generation with collision detection (append timestamp if slug exists)
- Email validation via Supabase Auth

**Authentication:** 
- Supabase Auth manages JWT
- SSR middleware refreshes session on every request
- httpOnly cookies store session (managed by @supabase/ssr)
- Role determined from profiles.role column

**Tenant Scoping:** 
- Every data mutation scoped by tenant_id
- Superadmin mode uses cookie to temporarily assume role of tenant
- Staff restricted from settings/menus/staff management routes (middleware enforces)

---

*Architecture analysis: 2026-05-05*
