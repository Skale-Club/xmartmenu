---
phase: 36
slug: english-conversion
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-19
---

# Phase 36 — UI Design Contract: English Conversion

> This phase is a text-only migration. No layout changes, no new components, no new pages. The contract defines the string mapping, tone/voice rules, and interaction label changes (KDS chips, toast messages, confirmations).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — Tailwind CSS utility classes only |
| Preset | not applicable |
| Component library | none — custom components |
| Icon library | lucide-react |
| Font | system default (Tailwind sans) |

Source: codebase scan — no `components.json` found; project uses hand-rolled components with Tailwind.

---

## Spacing Scale

No spacing changes in this phase. The existing Tailwind scale is preserved as-is. Documented for contract completeness.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline padding |
| sm | 8px | Compact element spacing |
| md | 16px | Default element spacing |
| lg | 24px | Section padding (p-6) |
| xl | 32px | Layout gaps (p-8) |
| 2xl | 48px | Major section breaks |
| 3xl | 64px | Page-level spacing |

Exceptions: none — this phase makes no spacing changes.

---

## Typography

No typography changes in this phase. Documented for contract completeness.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px (text-sm) | 500 (font-medium) | 1.5 |
| Label | 10px (text-[10px]) | 900 (font-black) | 1.2 |
| Heading | 36px (text-4xl) | 900 (font-black) | 1.1 |
| Display | 48px (text-5xl) | 900 (font-black) | 1.0 |

Source: codebase scan of admin panel components — no font-size changes in this phase.

---

## Color

No color changes in this phase. Documented for contract completeness.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | zinc-950 / white | Page backgrounds, card surfaces |
| Secondary (30%) | zinc-100 / zinc-50 | Sidebar, nav, secondary surfaces |
| Accent (10%) | var(--color-primary) | Active states, primary buttons, focus rings |
| Destructive | red-500 / red-50 | Delete confirmations, error states only |

Accent reserved for: active nav items, primary action buttons, active filter chips, focus ring on text inputs, KDS active status badge.

---

## Tone and Voice Contract

This is the primary deliverable of this phase. All operator-facing UI strings must follow these rules.

### Voice Principles

- **Concise over verbose.** "Save" not "Save your changes". "Delete" not "Delete this item permanently".
- **Sentence case for body copy.** "No products found" not "No Products Found".
- **Title case for navigation and headings.** "Store Settings", "Admin Panel", "Subscription Plans".
- **ALL CAPS only for chip labels and micro-labels.** "ACTIVE", "PENDING", "STRUCTURE" — only where the codebase already uses `uppercase tracking-widest` classes.
- **Active voice for CTAs.** "Create Category" not "Category Creation". "Save Changes" not "Changes Saved".
- **No Portuguese filler.** Zero occurrences of "Erro", "ao", "editar", "criar", "excluir", "salvar", "verificar" in rendered UI strings after this phase.

---

## String Mapping Contract

### Navigation (AdminSidebar.tsx)

Already fully in English. No changes required.

| Current | Correct English | Status |
|---------|----------------|--------|
| Dashboard | Dashboard | Already correct |
| Menus | Menus | Already correct |
| Categories | Categories | Already correct |
| Products | Products | Already correct |
| Orders | Orders | Already correct |
| Ingredients | Ingredients | Already correct |
| Store | Store | Already correct |
| Subscription | Subscription | Already correct |
| Branding | Branding | Already correct |
| QR Code | QR Code | Already correct |
| Change Password | Change Password | Already correct |
| Staff | Staff | Already correct |
| Admin Panel | Admin Panel | Already correct |
| View public menu | View public menu | Already correct |
| Sign out | Sign out | Already correct |

### KDS Filter Chips (OrdersClient.tsx)

Already fully in English. No changes required.

| Current | Correct English | Status |
|---------|----------------|--------|
| Active | Active | Already correct |
| Pending | Pending | Already correct |
| Preparing | Preparing | Already correct |
| Ready | Ready | Already correct |
| All | All | Already correct |

### KDS Status Labels (OrdersClient.tsx)

Already fully in English. No changes required.

| Current | Correct English | Status |
|---------|----------------|--------|
| Pending | Pending | Already correct |
| Preparing | Preparing | Already correct |
| Ready | Ready | Already correct |
| Done | Done | Already correct |
| Cancelled | Cancelled | Already correct |

### KDS Action Buttons (OrdersClient.tsx)

Already fully in English. No changes required.

| Current | Correct English | Status |
|---------|----------------|--------|
| Start preparing | Start preparing | Already correct |
| Mark ready | Mark ready | Already correct |
| Complete | Complete | Already correct |

### Store Settings — Custom Domain Section (StoreClient.tsx)

This section is the primary site of Portuguese strings in the admin panel.

| File | Location | Portuguese String | English Replacement |
|------|----------|-------------------|---------------------|
| StoreClient.tsx | Section heading | `Domínio Personalizado` | `Custom Domain` |
| StoreClient.tsx | Field label | `Seu domínio` | `Your domain` |
| StoreClient.tsx | Save button | `Salvar` | `Save Domain` |
| StoreClient.tsx | Helper text | `Sem https:// — ex: sitedocliente.com` | `No https:// — e.g. yourdomain.com` |
| StoreClient.tsx | Verify button | `Verificando...` | `Verifying...` |
| StoreClient.tsx | Verify button | `Verificar DNS` | `Verify DNS` |
| StoreClient.tsx | Verified badge | `Ativo` | `Active` |
| StoreClient.tsx | Not verified badge | `Não verificado` | `Not verified` |
| StoreClient.tsx | Success message | `Domínio verificado! Seu site está acessível em {domain}` | `Domain verified! Your site is live at {domain}` |
| StoreClient.tsx | Error message | `Verificação falhou: {reason ?? 'verifique o DNS'}` | `Verification failed: {reason ?? 'check your DNS settings'}` |
| StoreClient.tsx | DNS instructions heading | `Configurar DNS` | `Configure DNS` |
| StoreClient.tsx | DNS instructions body | `No painel do seu registrador de domínio, crie um registro CNAME:` | `In your domain registrar's panel, create a CNAME record:` |
| StoreClient.tsx | DNS instructions field | `Tipo:` | `Type:` |
| StoreClient.tsx | DNS instructions field | `Host:` | `Host:` |
| StoreClient.tsx | DNS instructions field | `Destino:` | `Target:` |
| StoreClient.tsx | DNS propagation note | `A propagação pode levar até 24 horas.` | `DNS propagation may take up to 24 hours.` |

### Superadmin Tenants Panel (TenantsClient.tsx)

Three hardcoded Portuguese error strings remain in the client component.

| File | Line | Portuguese String | English Replacement |
|------|------|-------------------|---------------------|
| TenantsClient.tsx | 127 | `'Erro ao editar: ' + data.error` | `'Failed to update: ' + data.error` |
| TenantsClient.tsx | 146 | `data.error ?? 'Erro ao criar cliente'` | `data.error ?? 'Failed to create restaurant'` |
| TenantsClient.tsx | 177 | `'Erro ao excluir: ' + data.error` | `'Failed to delete: ' + data.error` |
| TenantsClient.tsx | 185 | `'Erro ao excluir: ' + data.error` | `'Failed to delete: ' + data.error` |

### Superadmin Settings Panel (SettingsClient.tsx)

One Portuguese fallback error string.

| File | Line | Portuguese String | English Replacement |
|------|------|-------------------|---------------------|
| SettingsClient.tsx | 69 | `d.error ?? 'Erro ao salvar'` | `d.error ?? 'Failed to save settings'` |

### Admin Layout Comments (layout.tsx)

Two Portuguese code comments that must be converted to English.

| File | Line | Portuguese Comment | English Replacement |
|------|------|--------------------|---------------------|
| (admin)/layout.tsx | ~30 | `// Evita loop infinito: faz logout antes de redirecionar` | `// Avoid infinite loop: sign out before redirecting` |
| (admin)/layout.tsx | ~35 | `// Superadmin pode acessar o painel de qualquer tenant via cookie` | `// Superadmin can access any tenant's panel via preview cookie` |

### Onboarding Wizard (onboarding/page.tsx)

Already fully in English. No changes required.

| Element | Current English | Status |
|---------|----------------|--------|
| Step 1 heading | "Welcome" | Already correct |
| Step 2 heading | "Contact info" | Already correct |
| Step 3 heading | "Your digital menu" | Already correct |
| Step 4 heading | "Your first product" | Already correct |
| Step 5 heading | "Menu created!" | Already correct |
| Primary CTA | "Continue" / "Finish" / "Add more products" | Already correct |
| Error fallback | "Failed to create your store" | Already correct |

---

## Copywriting Contract

### Primary CTAs

| Surface | CTA Label |
|---------|-----------|
| Categories — create | New Category |
| Products — create | Add Product |
| Menus — create | New Menu |
| Superadmin tenants — create | New Restaurant |
| Superadmin plans — create | Create New Plan |
| Superadmin plans — launch new | Launch Plan |
| Store settings — save | Apply Settings |
| Store settings — custom domain save | Save Domain |
| Store settings — DNS verify | Verify DNS |
| Onboarding — advance step | Continue |
| Onboarding — submit | Finish |

### Toast / Inline Success Messages

| Trigger | Message |
|---------|---------|
| Any record saved | "Saved successfully" — or surface-specific: "Changes saved!" |
| Custom domain saved | "Domain saved" |
| Custom domain verified | "Domain verified! Your site is live at {domain}" |
| Billing cycle updated | "Billing cycle updated successfully!" |
| Staff invited | Display credentials panel — no separate toast |

### Toast / Inline Error Messages

| Trigger | Message |
|---------|---------|
| Generic save failure | "Failed to save. Please try again." |
| Superadmin settings save failure | "Failed to save settings" |
| Tenant create failure | "Failed to create restaurant" |
| Tenant update failure | "Failed to update" |
| Tenant delete failure | "Failed to delete" |
| Custom domain DNS not verified | "Verification failed: {server reason, or 'check your DNS settings'}" |
| Form validation — required field | "Required field" |
| Form validation — invalid email | "Invalid email" |
| KDS time threshold validation | "Thresholds must be greater than zero" |
| KDS amber/red order validation | "The amber threshold must be lower than the red threshold" |

### Empty States

| Surface | Heading | Body |
|---------|---------|------|
| Categories — no categories | "No categories defined" | "Start organizing your menu by creating your first category today." |
| Products — no products | "No products found" | "Add products to this category or change filters to see items." |
| Staff tab — no staff | (icon only) | "No staff members yet" |
| Menus tab — no menus | (icon only) | "No menus created yet" |
| Subscription — no plan | "No Active Subscription" | "You don't have an active plan. Link your account to get started with XmartMenu." |

### Destructive Actions

| Action | Confirmation Dialog Title | Confirmation Body | Confirm Button Label |
|--------|--------------------------|-------------------|----------------------|
| Delete category | "Delete category" | "Delete this category? Products will not be deleted." | "Delete" (default) |
| Delete product | "Delete product" | "Delete this product? This action cannot be undone." | "Delete" (default) |
| Delete tenant (superadmin) | "Delete client" | `Delete "{name}"? This action cannot be undone.` | "Delete" (default) |
| Remove staff member (superadmin) | "Remove staff member" | `Remove "{name}"? They will lose access to the dashboard.` | "Remove" |
| Delete subscription plan (superadmin) | "Delete Subscription Plan" | `Are you sure you want to delete "{name}"? This will affect all future subscriptions using this plan.` | "Delete Plan" |
| Disconnect Stripe | (native confirm dialog) | "Are you sure you want to disconnect your Stripe account?" | native browser OK |

---

## Interaction Contract: KDS Filter Chips

Filter chips use the `FilterValue` type union: `'active' | 'pending' | 'preparing' | 'ready' | 'all'`.

- Labels are rendered from the `FILTER_CHIPS` array constant — the `label` property is the rendered text.
- All chip labels are already English. No data-model changes required.
- Active chip: `bg-zinc-950 text-white border-zinc-950` — no change.
- Inactive chip: `bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300` — no change.

**Interaction unchanged.** Only verify labels match the contract above after execution.

---

## Interaction Contract: Status Advancement Buttons

KDS advance-action button labels come from the `ADVANCE_LABEL` record constant:

```
pending   → "Start preparing"
preparing → "Mark ready"
ready     → "Complete"
```

All already English. Executor must verify these strings are unchanged after the conversion pass.

---

## Files in Scope (17 operator-facing files)

Files that require changes in this phase:

| File | Portuguese Strings Found | Change Required |
|------|--------------------------|-----------------|
| src/app/(admin)/settings/store/StoreClient.tsx | 15 strings — entire Custom Domain section | YES |
| src/app/(superadmin)/tenants/TenantsClient.tsx | 4 error message strings | YES |
| src/app/(superadmin)/settings/SettingsClient.tsx | 1 error fallback string | YES |
| src/app/(admin)/layout.tsx | 2 Portuguese code comments | YES (comments only) |

Files already fully in English (verified by codebase scan):

| File | Status |
|------|--------|
| src/app/(admin)/menu/categories/CategoriesClient.tsx | Already English |
| src/app/(admin)/menu/ingredients/IngredientsClient.tsx | Not scanned — verify in execution |
| src/app/(admin)/menu/products/ProductsClient.tsx | Already English |
| src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx | Not scanned — verify in execution |
| src/app/(admin)/menus/MenusClient.tsx | Not scanned — verify in execution |
| src/app/(admin)/settings/branding/BrandingClient.tsx | Not scanned — verify in execution |
| src/app/(admin)/settings/staff/StaffClient.tsx | Not scanned — verify in execution |
| src/app/(admin)/settings/subscription/SubscriptionClient.tsx | Already English |
| src/app/(superadmin)/plans/PlansClient.tsx | Already English |
| src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx | Not scanned — verify in execution |
| src/app/(superadmin)/users/UsersClient.tsx | Not scanned — verify in execution |
| src/app/onboarding/page.tsx | Already English |
| src/app/api/admin/products/upload/route.ts | Not scanned — verify in execution |
| src/app/api/admin/staff/route.ts | Already English |
| src/components/admin/AdminSidebar.tsx | Already English |
| src/app/(admin)/orders/OrdersClient.tsx (KDS) | Already English |

**Executor instruction:** Run a grep scan for Portuguese patterns (`[À-ÿ]|Erro ao|erro ao|Não |Ativo`) against all files in `src/app/(admin)/`, `src/app/(superadmin)/`, `src/app/api/`, and `src/app/onboarding/` before and after changes to verify completeness.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — project does not use shadcn | not applicable |
| Third-party | none | not applicable |

No registry usage in this phase. String replacement only.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
