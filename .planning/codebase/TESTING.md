# Testing Patterns

**Analysis Date:** 2026-05-05

## Test Framework

**Status:** No testing framework installed or configured.

**Observation:** The project has 80 TypeScript/TSX files across 22 directories (`src/` tree) with no test files (`.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`) present in the codebase. The `devDependencies` in `package.json` include:
- `@types/node`, `@types/react`, `@types/react-dom` (TypeScript support)
- `eslint`, `@tailwindcss/postcss`, `tailwindcss` (linting and styling)
- `tsx` (TypeScript execution)

But no entries for Jest, Vitest, Mocha, or any testing framework.

**Available Commands:**
```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run start     # Start production server
npm run lint      # Run ESLint
npm run seed      # Run database seed script (tsx-based)
```

Testing is not part of the standard npm scripts.

## Test File Organization

**No tests exist.**

Current structure (relevant to where tests would go):
```
src/
├── app/
│   ├── api/                    # API route handlers (18 route files)
│   ├── (admin)/                # Admin pages (10 page.tsx files)
│   ├── (superadmin)/           # Superadmin pages (3 page.tsx files)
│   ├── (public)/               # Public facing pages (2 page.tsx files)
│   └── auth/                   # Auth pages (3 page.tsx files)
├── components/
│   ├── admin/                  # 2 admin components
│   ├── menu/                   # 1 menu component
│   └── ui/                     # 1 UI component
└── lib/
    ├── auth/                   # role-utils.ts
    ├── supabase/               # 3 Supabase client/server/middleware files
    └── [utilities]             # 6 utility files
```

## Test Coverage Gaps

**Critical untested areas:**

1. **API Routes (18 files)** — All authentication and data handling untested
   - `src/app/api/auth/register/route.ts` — User registration logic including customer account creation
   - `src/app/api/admin/categories/route.ts` — CREATE/UPDATE/DELETE category operations
   - `src/app/api/admin/menus/route.ts` — Menu creation with language sanitization
   - `src/app/api/superadmin/tenants/route.ts` — Tenant management operations
   - Error scenarios not validated (e.g., malformed requests, unauthorized access)

2. **Client Components (4 files)** — All interactive UI untested
   - `src/components/admin/AdminSidebar.tsx` — Navigation, menu selection, logout
   - `src/app/(admin)/menu/categories/CategoriesClient.tsx` — CRUD modal interactions
   - `src/app/(admin)/menu/products/ProductsClient.tsx` — Complex form with image uploads (100+ lines)
   - `src/app/(superadmin)/tenants/TenantsClient.tsx`

3. **Authentication & Authorization** — No tests for:
   - Role-based access control in middleware (`src/lib/supabase/middleware.ts`)
   - User context retrieval (`src/lib/get-effective-tenant.ts`)
   - Role normalization (`src/lib/auth/role-utils.ts`)
   - Superadmin preview tenant functionality

4. **Data Validation** — Input sanitization untested:
   - Language code filtering in menus (`sanitizeLanguages()`)
   - Translation object validation (`sanitizeTranslations()`)
   - Request body field whitelisting in PATCH handlers
   - Database constraint handling

5. **Database Interactions** — All Supabase queries untested:
   - Query success/failure scenarios
   - Row-level security (RLS) enforcement
   - Transaction-like operations (multi-step inserts/updates)
   - Data consistency checks

6. **Middleware** — Route protection untested:
   - Auth redirect logic (`src/lib/supabase/middleware.ts`)
   - Password change enforcement (`must_change_password` flag)
   - Staff role access restrictions
   - Superadmin preview mode

## Integration Testing Opportunities

**No integration test framework configured**, but the following would be high-value:

- **E2E Registration Flow:** User registers → Customer account created → Profile upserted → Session established
- **Menu Management:** Create menu → Add categories → Add products → Verify tenant isolation
- **Role-Based Isolation:** Store-admin cannot access superadmin routes; store-staff cannot access menu management
- **Database Seed Validation:** `npm run seed` creates valid test data (script exists at `scripts/seed.ts`)

## Testing Recommendations

**Priority 1 (Blocking bugs):**
- Unit tests for API route error handling (401/403/500 responses)
- Unit tests for role validation (`normalizeRole()`)
- Unit tests for data sanitization (`sanitizeLanguages()`, `sanitizeTranslations()`)

**Priority 2 (Reliability):**
- Component interaction tests for client forms (`CategoriesClient`, `ProductsClient`)
- Middleware auth flow tests
- Database query integration tests with Supabase (may use test DB)

**Priority 3 (Coverage):**
- Utility function tests (`slugify()`, `formatPrice()`, `cn()`)
- Type guard tests
- Edge case handling

## Recommended Setup

**For this project, recommended stack:**

```json
{
  "devDependencies": {
    "vitest": "^1.x",
    "@vitest/ui": "^1.x",
    "@testing-library/react": "^15.x",
    "@testing-library/jest-dom": "^6.x",
    "@testing-library/user-event": "^14.x",
    "jsdom": "^24.x",
    "node-mocks-http": "^1.x"
  },
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}
```

**Config file placement:** `vitest.config.ts` (import from `vitest/config`)

**Test file pattern:** Place alongside source
- `src/lib/utils.test.ts` next to `src/lib/utils.ts`
- `src/components/admin/AdminSidebar.test.tsx` next to component

---

**Key Takeaway:** The xmartmenu codebase is a production Next.js application handling multi-tenant restaurant menus with authentication, payments, and admin dashboards — all without any automated tests. This represents significant technical risk for:
- Regression bugs in auth flows
- Inadvertent RLS bypass
- Data leakage between tenants
- API contract breakage

*Testing analysis: 2026-05-05*
