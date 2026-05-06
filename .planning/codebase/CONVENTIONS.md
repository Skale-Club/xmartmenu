# Coding Conventions

**Analysis Date:** 2026-05-05

## Naming Patterns

**Files:**
- Page files: `page.tsx` in route directories (Next.js App Router convention)
- Route handlers: `route.ts` in `api/` directories
- Components: PascalCase with `.tsx` extension (e.g., `AdminSidebar.tsx`, `CategoriesClient.tsx`)
- Utilities/helpers: camelCase with `.ts` extension (e.g., `get-effective-tenant.ts`, `role-utils.ts`)
- Database types: `database.ts` containing all interfaces
- Server-side utilities: `-server` suffix convention (e.g., `supabase/server.ts`)
- Client-side utilities: `-client` suffix convention (e.g., `supabase/client.ts`)

**Functions:**
- Async functions use standard async/await pattern
- Utility functions use camelCase: `slugify()`, `formatPrice()`, `cn()`, `normalizeRole()`
- Event handlers use camelCase with `handle` prefix: `handleSubmit()`, `handleSelectMenu()`, `handleLogout()`
- Helper functions with `get` prefix for data retrieval: `getEffectiveTenant()`, `getActiveMenuForTenant()`, `getSafeRedirect()`
- Functions with `create` prefix for instantiation: `createClient()`, `createServiceClient()`
- Type guards use `is` prefix or check patterns: `normalize Role()` for validation

**Variables:**
- State variables use camelCase: `isLoading`, `showForm`, `editingId`, `selectedMenuId`
- Request parameters use snake_case (from database): `menu_id`, `tenant_id`, `product_id`, `is_active`, `is_featured`
- Destructured values maintain their source naming (snake_case from DB, camelCase from JS)
- Constants use UPPER_SNAKE_CASE: `DEFAULT_TAGS`, `TAG_COLORS`, `CURRENCY_SYMBOL`, `ALLOWED_LANGUAGE_CODES`, `SUPERADMIN_EMAILS`
- Enum-like objects use PascalCase keys: `const mainItems = [{ href: '/dashboard', label: 'Dashboard', icon: '📊' }]`

**Types:**
- Database types defined in `src/types/database.ts` use PascalCase: `Tenant`, `Profile`, `Category`, `Product`, `Menu`, `Order`, `TenantSettings`
- Interface names use PascalCase: `EffectiveTenant`, `Props`, `ConfirmDialogProps`, `ProductWithCategory`
- Union types for roles: `'superadmin' | 'store-admin' | 'store-staff' | 'customer'`
- Type imports use `type` keyword: `import type { Category, Product } from '@/types/database'`
- Discriminated union values use kebab-case: `'store-admin'`, `'store-staff'`, `'direct-orders'`

## Code Style

**Formatting:**
- No explicit prettier config found — defaults to 2-space indentation via Next.js + TypeScript
- Line length appears to favor readability over strict limits (long JSX chains allowed)
- Semicolons used consistently throughout
- Quotes: single quotes for strings, backticks for template literals

**Linting:**
- ESLint 9 with `eslint-config-next` and `@tailwindcss` integration
- Config file: `eslint.config.mjs` (new ESLint flat config format)
- Rules applied: core-web-vitals + typescript linting from Next.js
- Ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`
- No custom rule overrides observed

## Import Organization

**Order:**
1. External packages: `import { createBrowserClient } from '@supabase/ssr'`
2. Next.js modules: `import { cookies } from 'next/headers'`, `import { useRouter } from 'next/navigation'`
3. React: `import { useEffect, useState } from 'react'`
4. Project utilities (path aliases): `import { cn } from '@/lib/utils'`
5. Project types: `import type { Category, Product } from '@/types/database'`
6. Component imports: `import ConfirmDialog from '@/components/ui/ConfirmDialog'`

**Path Aliases:**
- Base alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- Usage examples:
  - `@/lib/supabase/client` for Supabase client utilities
  - `@/lib/auth/role-utils` for authentication utilities
  - `@/components/admin/AdminSidebar` for components
  - `@/types/database` for type definitions
  - `@/app/api/...` for route patterns

## Error Handling

**Patterns:**
- API routes return `NextResponse.json({ error: 'message' }, { status: code })`
- Consistent error status codes:
  - `401` for unauthorized (no user)
  - `403` for forbidden (insufficient permissions)
  - `400` for bad request (validation failure)
  - `404` for not found
  - `500` for server errors from Supabase
- Error checks use destructuring: `const { data, error } = await service.from(...)`
- Early returns with error: `if (error) return NextResponse.json({ error: error.message }, { status: 500 })`
- Client-side errors displayed in UI: `{error && <div className="bg-red-50...>{error}</div>}`
- Null checks for authenticated contexts: `if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`
- Role-based access control: `if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })`

**Data Validation:**
- Input sanitization on POST/PATCH endpoints (e.g., `sanitizeLanguages()`, `sanitizeTranslations()` in `src/app/api/admin/menus/route.ts`)
- Guard clauses: `if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })`
- Type guards for request bodies: `typeof value === 'string'`, `Array.isArray(...)`
- Whitelist approach for PATCH updates: only allowed fields are updated
  ```typescript
  const allowed = ['name', 'description', 'position', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  ```

## Logging

**Framework:** `console` (no external logging framework detected)

**Patterns:**
- Minimal logging in application code
- Comments use Portuguese in explanations (e.g., `// Cache por request — evita múltiplos clientes na mesma request`)
- Error boundaries logged to server response for client debugging
- Middleware logging delegated to Next.js request handling

## Comments

**When to Comment:**
- Architecture decisions (e.g., "Cache por request — evita múltiplos clientes na mesma request")
- Non-obvious algorithms (e.g., in `slugify()`, regex explanation implicit in code)
- Environment handling notes (e.g., "Allow app boot without Supabase configured")
- Role-based access logic: `// Superadmin nunca precisa de onboarding nem deve acessar rotas admin sem preview`

**JSDoc/TSDoc:**
- Minimal usage observed
- Props interfaces documented via TypeScript: `interface Props { tenantName: string; ... }`
- Function parameters self-documented through types

## Function Design

**Size:**
- Small focused functions: `slugify()`, `formatPrice()`, `cn()` — 3-6 lines
- Medium helper functions: `getEffectiveTenant()` — 15-20 lines
- API route handlers: POST/PATCH typically 30-50 lines (includes data validation + DB query)
- Client components: split into smaller utilities when complex (e.g., `sanitizeLanguages()` extracted from POST handler)

**Parameters:**
- Destructured object parameters for multiple arguments: `{ tenantName, tenantSlug, role, appName = 'XmartMenu', menus = [], activeMenuId = null }`
- Default parameters used: `appName = 'XmartMenu'`, `currency = 'BRL'`
- Type annotations required for all parameters

**Return Values:**
- Explicit return types on all functions
- API handlers return `NextResponse` (JSON or redirects)
- Utility functions return primitives or typed objects
- Async operations return Promises: `Promise<EffectiveTenant | null>`

## Module Design

**Exports:**
- Default exports for page components and route handlers
- Named exports for utilities and shared components
- Single component per file (page.tsx, route.ts patterns)
- Re-export pattern in `lib/` modules

**Barrel Files:**
- Not used — direct imports from specific module files
- Example: `import { createClient } from '@/lib/supabase/server'` (specific file, not index)

## Server vs Client Components

**Server Components (Default):**
- Page files in `app/(admin)/`, `app/(superadmin)/`, `app/(public)` directories
- Layout files: `layout.tsx`
- Marked with `export const dynamic = 'force-dynamic'` when content changes frequently
- Can directly access Supabase, databases, private environment variables
- Examples: `src/app/(admin)/dashboard/page.tsx`, `src/app/(superadmin)/overview/page.tsx`

**Client Components:**
- Marked with `'use client'` directive at top of file
- UI components in `src/components/` that need interactivity
- Form handlers using React hooks (`useState`, `useEffect`, `useRouter`)
- Examples: `src/components/admin/AdminSidebar.tsx`, `src/app/(admin)/menu/categories/CategoriesClient.tsx`

## Supabase Client Usage

**Browser Client (`createClient()`):**
- Located: `src/lib/supabase/client.ts`
- Exports: `export function createClient() { return createBrowserClient(...) }`
- Usage context: Client components only
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Authentication: Uses browser cookies for session management
- Example: `const supabase = createClient(); await supabase.auth.signOut()`

**Server Client (`createClient()` from server):**
- Located: `src/lib/supabase/server.ts`
- Exports: `export const createClient = cache(createClientUncached)` — wrapped with React cache
- Usage: Server components and API routes
- Authentication: Cookie-based session management with Supabase SSR
- Caching: Request-scoped caching to avoid multiple client instances in same request
- Example: `const supabase = await createClient(); const { data } = await supabase.from('...).select(...)`

**Service Client (`createServiceClient()`):**
- Located: `src/lib/supabase/server.ts`
- Exports: Direct service role client
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Usage: Server-side operations requiring elevated privileges (e.g., user creation, admin operations)
- Authentication: Service role key, no session management
- Example: `const service = await createServiceClient(); await service.auth.admin.createUser(...)`
- Note: Used for admin operations that bypass RLS

**Query Patterns:**
- Select queries: `.select('*')` or field list
- Filters: `.eq('field', value)`, `.gte('field', value)`
- Single results: `.single()` or `.maybeSingle()`
- Ordering: `.order('field')`
- Inserts: `.insert({ ... }).select().single()`
- Updates: `.update({ ... }).select().single()` with `.eq()` filters
- Deletes: `.delete().eq('id', id)`

---

*Convention analysis: 2026-05-05*
