# Requirements — v2.1 Custom Domains

## Traceability

| Requirement | Description | Phase | Status |
|-------------|-------------|-------|--------|
| DOM-01.1 | DB migration: add `custom_domain` column to `tenants` table | 35 | Pending |
| DOM-01.2 | Middleware: resolve tenant by `host` header instead of pathname | 35 | Pending |
| DOM-01.3 | Admin UI: tenant settings page for custom domain input and validation | 35 | Pending |
| DOM-01.4 | DNS instructions: display CNAME configuration in admin panel | 35 | Pending |
| DOM-01.5 | Routing: bypass slug in pathname for tenants with custom domain | 35 | Pending |
| DOM-01.6 | Validation: verify custom domain resolves to platform before activation | 35 | Pending |

---

## Detail

### DOM-01.1 — DB Migration: custom_domain column

**Type:** Database
**Category:** Infrastructure

**Description:** Add `custom_domain` column (VARCHAR, unique, nullable) to `tenants` table via DB migration. Column stores the custom domain configured by the tenant (e.g., `sitedocliente.com`).

**Acceptance criteria:**
- Migration adds `custom_domain` column with appropriate constraints
- Column is nullable (tenant can exist without custom domain)
- Column has unique constraint to prevent duplicate domains
- RLS policies allow tenant owner to read/update their custom_domain

---

### DOM-01.2 — Middleware: hostname-based tenant resolution

**Type:** Infrastructure
**Category:** Routing

**Description:** Update Next.js middleware to resolve tenant by `host` header (e.g., `sitedocliente.com`) instead of pathname (e.g., `/nomedocliente`). Maintain backward compatibility with slug-based URLs for tenants without custom domain.

**Acceptance criteria:**
- Middleware extracts `host` header from request
- If `host` matches a tenant's `custom_domain`, resolve tenant from DB
- If `host` does not match any custom domain, fall back to pathname slug resolution
- Custom domain lookup is cached to avoid DB query on every request

---

### DOM-01.3 — Admin UI: custom domain management

**Type:** Frontend
**Category:** UI

**Description:** Add UI in tenant admin panel (Settings page) for inputting and managing custom domain. Include field for domain entry and validation status display.

**Acceptance criteria:**
- Settings page includes "Domínio Personalizado" section
- Input field accepts domain string (e.g., `sitedocliente.com`)
- Save button persists value to `tenants.custom_domain`
- Validation status (pending/verified/failed) displayed after save
- UI only visible to store-admin role

---

### DOM-01.4 — DNS instructions display

**Type:** Frontend
**Category:** UX

**Description:** Display CNAME configuration instructions in admin panel after tenant saves custom domain. Instructions guide tenant to configure DNS at their domain registrar.

**Acceptance criteria:**
- After custom domain saved, panel shows CNAME record instructions
- Instructions display: "Configure um registro CNAME: `@` -> `xmartmenu.skale.club`"
- Clear copy/paste friendly format
- Instructions update when custom_domain changes

---

### DOM-01.5 — Pathname slug bypass for custom domains

**Type:** Infrastructure
**Category:** Routing

**Description:** When a request arrives on tenant's custom domain (e.g., `sitedocliente.com/menu`), the middleware should not require the tenant slug in the pathname. Menu pages work directly at root path or with any pathname structure.

**Acceptance criteria:**
- Request to `sitedocliente.com/` loads tenant's default menu
- Request to `sitedocliente.com/any-path` loads tenant's menu without requiring `/slug` prefix
- If tenant has multiple menus, path after domain selects which menu (e.g., `/lunch` → lunch menu)
- Platform domain (`xmartmenu.skale.club/slug`) continues to work as before

---

### DOM-01.6 — Domain validation before activation

**Type:** Backend
**Category:** Validation

**Description:** Before activating a custom domain, system verifies the domain actually points to the platform (CNAME resolves correctly). Prevent tenants from activating domains they don't control.

**Acceptance criteria:**
- When tenant clicks "Ativar", system performs DNS lookup on custom_domain
- Verification passes if CNAME resolves to platform domain
- Verification fails if domain doesn't resolve or resolves elsewhere
- Only verified domains become active (customers see custom domain)
- Manual override available for superadmin to force activation

---

*Last updated: 2026-05-10 — v2.1 Custom Domains requirements defined*