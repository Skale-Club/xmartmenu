---
id: SEED-016
status: completed
completed: 2026-05-19
planted: 2026-05-19
completed_in: v2.2 (Restaurant Growth Platform — phase 36)
planted_during: v2.2-milestone-setup
trigger_when: preparing the platform for international users or cleaning up language inconsistencies in the codebase
scope: small
---

# SEED-016: App-Wide English Conversion

## Why This Matters

XmartMenu was originally built in Portuguese (Brazilian market first). As the platform grows toward a SaaS with international ambitions, the admin panel, superadmin UI, onboarding wizard, API error messages, and internal copy are a mix of Portuguese and English — inconsistent, unprofessional, and a barrier to non-Portuguese users.

This seed converts all user-facing text in the **operator-side** of the app (admin panel, superadmin panel, onboarding wizard, settings, KDS, error messages) to English. The **customer-facing** public menu remains multilingual and follows the tenant's configured language — that is untouched.

**Scope boundary:**
- IN: admin panel, superadmin panel, onboarding, settings, KDS, orders view, error messages, toast notifications, form labels, placeholder text, button labels, navigation items
- OUT: public menu pages, menu item names/descriptions (those are tenant data), landing page (already English), API response payloads (already English)

## When to Surface

**Trigger:** when cleaning up language inconsistencies in the operator UI; or when preparing the platform for international or English-first users

Surface during `/gsd:new-milestone` when the scope involves:
- Internationalization / localization groundwork
- Platform quality and polish milestones
- Preparing for international SaaS launch
- Developer experience improvements (consistent language in codebase)

## Scope Estimate

**Small** — 1–2 days. This is a text-replacement task, not an architectural change.

**Approach:** systematic grep through all `.tsx` / `.ts` files in `src/app/(admin)/`, `src/app/(superadmin)/`, `src/app/onboarding/`, `src/components/` for Portuguese strings. Batch-replace in each area:

1. **Admin panel** (`src/app/(admin)/`)
   - Navigation labels (e.g., "Cardápio" → "Menu", "Pedidos" → "Orders", "Configurações" → "Settings")
   - Section headings, button labels, empty states, form placeholders
   - Toast/alert messages (e.g., "Salvo com sucesso" → "Saved successfully")

2. **Superadmin panel** (`src/app/(superadmin)/`)
   - Table headers, action buttons, modal titles
   - AI seeding tool labels and status messages

3. **Onboarding wizard** (`src/app/onboarding/`)
   - Step titles, instructions, field labels, CTAs

4. **KDS** (`src/app/(admin)/kds/`)
   - Status labels ("Pendente" → "Pending", "Em preparo" → "Preparing", "Pronto" → "Ready")
   - Filter chips, time labels

5. **Settings pages** (`src/app/(admin)/settings/`)
   - All section headings, toggles, field labels, descriptions

6. **Error / validation messages**
   - Zod error messages, API error responses shown in UI
   - Form validation feedback

7. **TypeScript comments and internal strings**
   - Code comments in Portuguese → English (for consistency in the codebase)
   - Internal-only strings (non-user-facing) are lower priority but worth cleaning

## Breadcrumbs

- `src/app/(admin)/` — entire admin panel tree
- `src/app/(superadmin)/` — superadmin panel tree
- `src/app/onboarding/` — onboarding wizard
- `src/components/` — shared components (modals, forms, nav)
- `src/app/(admin)/kds/` — KDS-specific labels
- `src/app/(admin)/settings/` — settings panel
- `src/app/api/` — API error messages returned to admin UI

## Notes

- **Public menu is out of scope** — menu item names, categories, and descriptions are tenant data. The menu rendering layer (language switching, UI copy) was already built with multi-language in mind — leave it.
- **Landing page is already English** — skip `src/app/(marketing)/`.
- **i18n library is NOT needed** — this is a one-time migration to English-only for the operator UI. Full i18n (react-intl, next-intl) is a future seed if we ever localize the admin panel for non-English operators. Don't over-engineer.
- **Priority order:** Start with the most visible user-facing text (nav, buttons, headings), then work down to error messages and code comments.
- **Commit per area** — admin panel, superadmin panel, onboarding, KDS as separate commits for easier review and rollback if needed.
