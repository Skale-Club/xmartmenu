# Phase 36: English Conversion - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Convert all operator-facing UI text from Portuguese to English across the admin panel, superadmin panel, KDS, onboarding wizard, settings pages, and API error messages. Customer-facing surfaces (public menu, CartModal, MenuPage, checkout flow) are explicitly out of scope.

**In scope:** src/app/(admin)/, src/app/(superadmin)/, src/app/onboarding/, src/components/ (operator-only), src/app/api/ error messages surfaced in admin UI
**Out of scope:** src/app/(public)/, CartModal.tsx, MenuPage.tsx, src/app/(public)/checkout/, tenant-entered data in DB

</domain>

<decisions>
## Implementation Decisions

### Scope Boundary
- CartModal.tsx and MenuPage.tsx are customer-facing — skip entirely
- API route error messages (e.g., "Senha inválida" in route.ts) are in scope — they surface in admin UI toasts/alerts
- Portuguese code comments should be converted to English for codebase consistency
- src/app/(public)/checkout/ is out of scope — customer-facing checkout flow

### Terminology Standards
- KDS status labels: Pending / Preparing / Ready / Done / Cancelled (matches order schema `status` column values)
- Navigation: "Cardápio" → "Menu", "Pedidos" → "Orders", "Configurações" → "Settings", "Filiais" → "Branches", "Ingredientes" → "Ingredients", "Assinatura" → "Subscription"
- Headings: "Configurações da loja" → "Store Settings", "Marca" → "Branding", "Equipe" → "Staff"
- Toast messages: descriptive pattern — "Saved successfully" / "Failed to save" / "Deleted successfully" / "Created successfully"
- Form validation: "Campo obrigatório" → "Required field", "Email inválido" → "Invalid email"

### Execution Strategy
- 4 section commits: (1) admin panel, (2) superadmin panel, (3) KDS + onboarding + settings, (4) API error messages
- 2 plans: Plan 01 covers admin + superadmin; Plan 02 covers KDS + onboarding + settings + API errors
- Post-conversion: run grep scan for remaining Portuguese strings to verify completeness
- Tenant-entered data (restaurant names, descriptions stored in DB) is skipped — not UI strings

### Claude's Discretion
- Exact phrasing of individual labels where no standard exists (e.g., specific section titles)
- Order of changes within each file

</decisions>

<code_context>
## Existing Code Insights

### Affected Files (17 operator-facing files with Portuguese strings)
- src/app/(admin)/menu/categories/CategoriesClient.tsx
- src/app/(admin)/menu/ingredients/IngredientsClient.tsx
- src/app/(admin)/menu/products/ProductsClient.tsx
- src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx
- src/app/(admin)/menus/MenusClient.tsx
- src/app/(admin)/settings/branding/BrandingClient.tsx
- src/app/(admin)/settings/staff/StaffClient.tsx
- src/app/(admin)/settings/store/StoreClient.tsx
- src/app/(admin)/settings/subscription/SubscriptionClient.tsx
- src/app/(superadmin)/plans/PlansClient.tsx
- src/app/(superadmin)/settings/SettingsClient.tsx
- src/app/(superadmin)/tenants/TenantsClient.tsx
- src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx
- src/app/(superadmin)/users/UsersClient.tsx
- src/app/onboarding/page.tsx
- src/app/api/admin/products/upload/route.ts
- src/app/api/admin/staff/route.ts (+ [id]/route.ts, auth/register/route.ts)

### Established Patterns
- Toast/alert messages use a consistent `toast()` or state-based pattern — replace string argument
- Navigation items are defined in sidebar/nav component files — single source of truth per panel
- KDS status is a string union type in database.ts — status display labels are separate from DB values

### Integration Points
- Admin sidebar navigation: likely in src/app/(admin)/layout.tsx or a shared AdminSidebar component
- Superadmin navigation: src/app/(superadmin)/layout.tsx
- KDS filter chips: src/app/(admin)/kds/ — filter state uses string values

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the terminology standards captured in decisions — open to standard English SaaS conventions for any strings not explicitly listed.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
