# Codebase Structure

**Analysis Date:** 2026-05-05

## Directory Layout

```
src/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout (html, body, globals.css)
│   ├── page.tsx                   # Home page (auth redirect)
│   ├── (admin)/                   # Protected admin route group
│   │   ├── layout.tsx             # Admin sidebar + main layout
│   │   ├── dashboard/page.tsx      # Store overview
│   │   ├── menu/
│   │   │   ├── categories/        # Category management UI
│   │   │   └── products/          # Product management UI
│   │   ├── menus/                 # Menu CRUD UI
│   │   ├── orders/                # Orders list UI
│   │   └── settings/
│   │       ├── store/             # Tenant settings (phone, address, hours)
│   │       ├── branding/          # Logo, colors, banner
│   │       ├── qrcode/            # QR code generation and tracking
│   │       ├── staff/             # Staff member management
│   │       └── password/          # Password reset
│   ├── (public)/                  # Public route group (no auth)
│   │   └── [slug]/
│   │       └── page.tsx           # Public menu display by tenant slug
│   │       └── [menuSlug]/page.tsx # Specific menu variant (not primary)
│   ├── (superadmin)/              # Protected superadmin route group
│   │   ├── layout.tsx             # Superadmin sidebar + main layout
│   │   ├── overview/page.tsx       # Dashboard with platform stats
│   │   ├── tenants/               # Tenant management
│   │   │   ├── page.tsx           # List all tenants
│   │   │   └── [id]/page.tsx      # Tenant detail + edit
│   │   ├── users/page.tsx         # All user management
│   │   └── settings/page.tsx      # Platform-wide settings
│   ├── auth/                      # Auth flows
│   │   ├── login/page.tsx         # Login form
│   │   ├── register/page.tsx      # Sign up form
│   │   ├── pending/page.tsx       # Email confirmation pending
│   │   └── callback/route.ts      # OAuth redirect handler
│   ├── onboarding/page.tsx        # Multi-step tenant creation for new store-admins
│   ├── api/
│   │   ├── auth/
│   │   │   ├── register/route.ts  # Sign up endpoint
│   │   │   ├── signout/route.ts   # Logout endpoint
│   │   │   └── resolve-redirect/route.ts # Post-login routing
│   │   ├── admin/
│   │   │   ├── menus/route.ts     # GET/POST menus for tenant
│   │   │   ├── menus/select/route.ts   # POST select active menu (sets cookie)
│   │   │   ├── menus/[id]/route.ts     # GET/PUT/DELETE specific menu
│   │   │   ├── categories/route.ts     # GET/POST categories
│   │   │   ├── categories/[id]/route.ts # GET/PUT/DELETE specific category
│   │   │   ├── staff/route.ts     # GET/POST staff members
│   │   │   ├── staff/[id]/route.ts # GET/PUT/DELETE staff
│   │   │   ├── enter-preview/route.ts  # Superadmin: set preview_tenant_id cookie
│   │   │   └── exit-preview/route.ts   # Superadmin: clear preview_tenant_id
│   │   ├── superadmin/
│   │   │   ├── settings/route.ts  # GET/POST platform_settings
│   │   │   ├── tenants/route.ts   # GET/POST tenants (superadmin only)
│   │   │   ├── tenants/[id]/route.ts        # GET/PUT/DELETE tenant
│   │   │   ├── tenants/[id]/menus/route.ts  # GET tenant menus
│   │   │   ├── tenants/[id]/settings/route.ts # GET/PUT tenant_settings
│   │   │   ├── tenants/[id]/staff/route.ts    # GET/POST staff for tenant
│   │   │   ├── tenants/[id]/staff/[staffId]/route.ts # GET/PUT/DELETE staff member
│   │   │   ├── tenants/[id]/upload/route.ts   # File upload handler
│   │   │   ├── users/route.ts     # GET/POST users (all users)
│   │   │   └── users/[id]/route.ts # GET/PUT/DELETE user
│   │   ├── onboarding/route.ts    # POST: create tenant + initial data
│   │   ├── orders/route.ts        # GET/POST orders (customer orders)
│   │   ├── orders/[id]/route.ts   # GET order detail
│   │   └── public/[slug]/route.ts # GET public tenant data
│   ├── globals.css                # Tailwind + custom styles
│   └── favicon.ico
├── components/                     # Reusable UI components
│   ├── admin/
│   │   ├── AdminSidebar.tsx       # Navigation sidebar for admin panel
│   │   └── CopyMenuUrl.tsx        # Copy-to-clipboard for menu URL
│   ├── menu/
│   │   └── MenuPage.tsx           # Full public menu display (searchable, filterable, cart)
│   └── ui/
│       └── ConfirmDialog.tsx      # Generic confirmation modal
├── lib/                           # Utilities and helpers
│   ├── supabase/
│   │   ├── client.ts              # createClient() for SSR user context
│   │   ├── server.ts              # createClient() + createServiceClient() factories
│   │   └── middleware.ts           # updateSession() - Supabase auth refresh + route guards
│   ├── auth/
│   │   └── role-utils.ts          # normalizeRole(), parseSuperadminEmails()
│   ├── get-effective-tenant.ts    # Resolve tenant context for user (handle superadmin preview)
│   ├── get-active-menu.ts         # Resolve active menu from cookie or default
│   ├── superadmin-auth.ts         # Superadmin permission checking
│   ├── upload.ts                  # File upload handling (image storage)
│   └── utils.ts                   # slugify(), formatPrice(), cn() class helpers
├── types/
│   └── database.ts                # TypeScript interfaces for all database records
├── middleware.ts                  # Next.js middleware entry point
└── .env.example                   # Environment variable template
```

## Directory Purposes

**`src/app/`**
- Purpose: Next.js App Router pages and API routes
- Contains: Server components for data fetching, client components for UI, route handlers
- Key structure: Route groups like `(admin)`, `(public)`, `(superadmin)` for layout isolation

**`src/app/(admin)/`**
- Purpose: Protected admin dashboard routes for store-admin and store-staff
- Contains: Page components and layout that render AdminSidebar, load menus, categories, products
- Access: Requires authenticated user with role store-admin or store-staff AND tenant_id
- Key files: `layout.tsx` (security check + data loading), `dashboard/page.tsx` (main view)

**`src/app/(public)/`**
- Purpose: Public, unauthenticated customer-facing menu display
- Contains: Server component that fetches tenant by slug, renders interactive MenuPage
- Access: No authentication required
- Key files: `[slug]/page.tsx` (entry point for customers scanning QR code)

**`src/app/(superadmin)/`**
- Purpose: Protected superadmin panel for platform management
- Contains: Tenant management, user management, platform settings
- Access: Requires authenticated user with role superadmin
- Key files: `layout.tsx` (superadmin check), `tenants/page.tsx` (tenant list)

**`src/app/auth/`**
- Purpose: Authentication flows (login, sign up, OAuth callback)
- Contains: Form pages and redirect handler
- Key files: `callback/route.ts` (handles OAuth code exchange, role assignment)

**`src/app/api/`**
- Purpose: Backend API route handlers for all CRUD operations
- Contains: Request/response handlers that validate auth, scope by tenant, interact with Supabase
- Pattern: Each route calls `getEffectiveTenant()` early to enforce tenant scoping

**`src/app/api/admin/`**
- Purpose: CRUD endpoints for store admin operations (menus, categories, staff, settings)
- Access: Requires store-admin role (some endpoints allow store-staff read-only)
- Key pattern: Filters queries by `ctx.tenantId` from `getEffectiveTenant()`

**`src/app/api/superadmin/`**
- Purpose: CRUD endpoints for platform superadmin operations (tenants, users, global settings)
- Access: Requires superadmin role
- Key pattern: No tenant scoping; operates on all records; creates users via Supabase Auth admin API

**`src/components/admin/`**
- Purpose: Admin-specific UI components (navigation, utilities)
- Key files: `AdminSidebar.tsx` (main navigation sidebar), `CopyMenuUrl.tsx` (URL clipboard utility)

**`src/components/menu/`**
- Purpose: Customer-facing menu display component
- Key files: `MenuPage.tsx` (large interactive component: search, filters, product modals, cart, orders)

**`src/components/ui/`**
- Purpose: Generic, reusable UI components (modal, dialog, etc.)
- Key files: `ConfirmDialog.tsx` (delete confirmation modal)

**`src/lib/supabase/`**
- Purpose: Supabase client initialization and middleware
- Key files:
  - `server.ts`: `createClient()` (user context with auth), `createServiceClient()` (admin key, no auth)
  - `middleware.ts`: `updateSession()` (SSR auth refresh + request routing logic)
  - `client.ts`: Browser-side Supabase client (not used in current code but available)

**`src/lib/auth/`**
- Purpose: Role normalization and superadmin configuration
- Key files: `role-utils.ts` (maps role variants, parses SUPERADMIN_EMAILS from env)

**`src/lib/`**
- Purpose: Shared utilities and business logic
- Key files:
  - `get-effective-tenant.ts`: Resolve tenant from user profile or superadmin preview cookie
  - `get-active-menu.ts`: Resolve active menu from cookie or defaults
  - `utils.ts`: slugify(), formatPrice(), cn() for CSS classes

**`src/types/`**
- Purpose: TypeScript type definitions for database records
- Key files: `database.ts` (interfaces for Tenant, Profile, Menu, Category, Product, Order, etc.)

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` - Root layout, metadata, global CSS
- `src/middleware.ts` - Next.js middleware entry point
- `src/app/auth/callback/route.ts` - OAuth callback handler

**Configuration:**
- `src/lib/supabase/server.ts` - Supabase client factories
- `src/lib/auth/role-utils.ts` - Role mapping from environment
- `src/types/database.ts` - Type definitions for all database models

**Core Logic:**
- `src/lib/get-effective-tenant.ts` - Tenant resolution (critical for multi-tenancy)
- `src/lib/get-active-menu.ts` - Menu selection persistence
- `src/lib/supabase/middleware.ts` - Authentication and route protection

**Admin UI:**
- `src/app/(admin)/layout.tsx` - Admin sidebar + main layout
- `src/components/admin/AdminSidebar.tsx` - Navigation menu component
- `src/app/(admin)/dashboard/page.tsx` - Admin home page

**Public UI:**
- `src/app/(public)/[slug]/page.tsx` - Customer-facing menu entry point
- `src/components/menu/MenuPage.tsx` - Interactive menu display (880+ lines)

**Superadmin:**
- `src/app/(superadmin)/layout.tsx` - Superadmin sidebar and layout
- `src/app/api/superadmin/tenants/route.ts` - Tenant CRUD (create, list)
- `src/app/api/superadmin/tenants/[id]/route.ts` - Tenant detail and edit

**Onboarding:**
- `src/app/onboarding/page.tsx` - Multi-step form for new store-admin (446 lines)
- `src/app/api/onboarding/route.ts` - Tenant + menu + category + product creation (262 lines)

## Naming Conventions

**Files:**
- Server components and pages: `page.tsx`, `layout.tsx` (App Router convention)
- Client components: Suffix `Client.tsx` when distinguished (e.g., `CategoriesClient.tsx`, `MenusClient.tsx`)
- Utility modules: `{feature}.ts` (e.g., `get-effective-tenant.ts`, `role-utils.ts`)
- API routes: `route.ts` in appropriately nested folder matching REST path
- Types: `database.ts` for schema-driven types

**Directories:**
- Feature-based under `app/`: `(admin)`, `(public)`, `(superadmin)` as route groups
- API endpoint hierarchy mirrors REST structure: `api/admin/menus/[id]/route.ts` → `PATCH /api/admin/menus/{id}`
- Component grouping: `admin/`, `menu/`, `ui/` under `components/`
- Utilities by domain: `supabase/`, `auth/` under `lib/`

**Functions:**
- camelCase for all functions: `getEffectiveTenant()`, `createClient()`, `normalizeRole()`
- Async server functions: `async function` or `export async function`
- Event handlers: `handle{Action}` (e.g., `handleSelectMenu()`, `handleLogout()`)

**Variables & Constants:**
- camelCase for locals: `const tenantId = ...`, `const [ loading, setLoading ] = ...`
- SCREAMING_SNAKE_CASE for config constants: `ALLOWED_LANGUAGE_CODES`, `BUSINESS_TYPES`, `ALLOWED_MENU_PURPOSES`
- Type names: PascalCase (e.g., `UserRole`, `EffectiveTenant`, `Menu`)

## Where to Add New Code

**New Feature (e.g., "Pricing Plans" admin page):**
- Primary code: `src/app/(admin)/settings/pricing/page.tsx`
- API route: `src/app/api/admin/pricing/route.ts` (if CRUD needed)
- Component: `src/components/admin/PricingPanel.tsx` or inline in page if small
- Types: Add to `src/types/database.ts` (e.g., `export interface PricingPlan { ... }`)

**New Component/Module:**
- Implementation: `src/components/{category}/{FeatureName}.tsx`
- Import path: Use alias `@/` (configured in tsconfig) - e.g., `import { Something } from '@/components/admin/AdminSidebar'`
- Export: Default export for pages, named export for components

**New Public API Endpoint (e.g., "GET /api/tenants/{id}/reviews"):**
- Route file: `src/app/api/superadmin/tenants/[id]/reviews/route.ts`
- Handler: `export async function GET(request: Request, { params }: { params: Promise<{ id: string }> })`
- Auth check: Call `getEffectiveTenant()` if tenant-scoped; check superadmin if platform-level
- Return: `NextResponse.json(data, { status: 200 })`

**Utilities & Helpers:**
- Shared utils: `src/lib/utils.ts` (general) or domain-specific `src/lib/{domain}/something.ts`
- Auth helpers: `src/lib/auth/` (e.g., `permission-checks.ts`)
- Supabase wrappers: `src/lib/supabase/` (client factories, middleware)

**Types/Interfaces:**
- Location: `src/types/database.ts` (single file for all database record types)
- Pattern: `export interface {RecordType} { id: string; ... }`

## Special Directories

**`src/app/api/`** (Generated-like from routes, not committed artifacts)
- Purpose: Next.js App Router auto-routes files named `route.ts`
- Committed: Yes (source code)
- Generated: No

**`.env` file** (Not in repo, local only)
- Purpose: Runtime environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPERADMIN_EMAILS)
- Committed: No (git-ignored)
- Template: `.env.example` in root

**`public/` directory** (if added later)
- Purpose: Static assets (images, fonts, icons)
- Should mirror: `public/images/`, `public/fonts/`

**`.next/` build output** (generated)
- Purpose: Compiled Next.js output
- Committed: No (git-ignored)
- Regenerated: On `npm run build`

**`node_modules/` dependencies** (generated)
- Purpose: npm packages
- Committed: No (git-ignored)
- Regenerated: On `npm install` from `package.json` + `package-lock.json`

## Import Path Aliases

**Configured in `tsconfig.json`:**
- `@/*` → `src/*` (all relative imports use `@/`)

**Examples:**
- `import { getEffectiveTenant } from '@/lib/get-effective-tenant'`
- `import { AdminSidebar } from '@/components/admin/AdminSidebar'`
- `import type { Menu } from '@/types/database'`
- `import { createClient } from '@/lib/supabase/server'`

---

*Structure analysis: 2026-05-05*
