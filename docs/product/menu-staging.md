# Menu staging (preview, approve, publish)

When we roll something out for a restaurant (for example 3D dishes in augmented
reality), we change a **staging copy** of its menu, the restaurant looks at it
through a **preview link**, approves it, and we **publish**: the copy swaps
into production in one step. Guests never see a half-done menu.

Both versions are public pages; only production is listed and indexed.

| | Production (live menu) | Staging copy |
|---|---|---|
| Address | `/<slug>` (or `/<slug>/<menu>`), the custom domain, QR codes, branches | `/<slug>/preview/<token>` (or `/preview/<token>` on the custom domain) |
| Who sees it | everyone | whoever has the link (the token is 32 random characters) |
| Search engines | indexed (restaurant's SEO settings) | `noindex, nofollow` (meta + `X-Robots-Tag`), not in the sitemap, `Referrer-Policy: no-referrer` |
| Cache | public menu cache | none: every edit shows on reload |
| Ordering, waiter calls, WhatsApp, chat | as configured | off (a "Preview · not live yet · ordering off" pill is shown); the order API also refuses dishes of a hidden menu |
| Analytics | recorded | not recorded |

## How the team uses it (back office › Menus)

1. On the live menu, **Create staging**. Everything guests see is copied:
   categories, dishes, sizes/options, ingredients, photos and videos, 3D models
   (the files are shared, not duplicated). The copy is selected for editing, and
   shows in the sidebar menu picker as "(staging)".
2. Make the changes in the usual editors (**Manage items**, dish editor, 3D tab).
3. **Copy preview link** and send it to the restaurant. **New link** (↻) makes a
   new one and the old link stops working.
4. When approved, **Publish**. In one transaction the copy takes the live menu's
   address, default flag, visibility, position and branches; the public cache is
   dropped, so guests see it right away. QR codes keep working (they point to the
   address, not to a menu id).
5. The replaced version stays as **Previous version** with its own preview link.
   **Restore** on it is the undo (the same swap the other way). Delete old
   versions when no longer needed.

After a publish, edits to the live menu go live immediately again: create a new
staging copy for the next round. Only one open staging copy per live menu.
Managers (store admin, superadmin) can create, publish and rotate links; staff
cannot. **Discard** on a staging copy deletes it (its rows only, never the live
menu or the shared files).

What is staged is the **menu** (everything under it). Restaurant-wide settings
(branding colours, logo, SEO, store settings, ordering switches) are not
staged: they apply to every version at once.

## How it works

- Schema: `menus.staging_of` (the live menu a copy stages; on a replaced version,
  the menu that replaced it), `menus.preview_token`, `menus.replaced_at`;
  CHECK `menus_staging_hidden` makes a staging copy unable to be visible or the
  default, so the publish swap is the only way to production. Owned database:
  `docs/owned-schema/20261111120000_menu_staging.sql` (apply with the Owned
  schema workflow); legacy: `supabase/migrations/20261111120000_menu_staging.sql`.
  Until the schema step runs, the staging buttons answer "Staging is not
  available yet" and preview links 404; nothing else changes.
- Writer: `src/lib/data/menu-staging.ts` (create, publish, rotate-link), behind the
  menu writer's per-tenant advisory lock. The copy is column-generic
  (`jsonb_populate_record` of each source row with the ids remapped), so a
  column added to a catalog table later is copied too. Upsell links inside the
  menu are remapped; links to dishes of other menus are kept.
- API: `POST /api/admin/menus/<id>/staging` `{ action: 'create' | 'publish' | 'rotate-link' }`
  (`src/lib/admin/owned-menu-staging-http.ts`, same-origin only). Discard is the
  normal `DELETE /api/admin/menus/<id>`. Owned database only (legacy answers 501).
- Preview: `src/app/(public)/[slug]/preview/[token]/page.tsx`, data from
  `src/lib/menu/staging-preview.ts` → `readOwnedPublicMenu(..., { previewToken })`.
- Menu deletion guard (`admin-menus.ts`) now also reviews `menus.staging_of`
  (SET NULL: deleting a live menu leaves its copies as ordinary hidden menus) and
  `product_ar_models` (CASCADE), which it did not know before.
- Tests: `tests/integration/menu-staging.test.ts`, the preview case in
  `tests/integration/public-menu.test.ts`, `tests/unit/menu/staging-preview.test.ts`,
  `scripts/ops/test_xprout_owned_schema.py` (staging file).

## Known limits

- Published dishes are new rows (new ids): per-dish analytics start again from
  the publish, and a guest holding a cart of the replaced version is told the
  items are no longer available at checkout and reloads the menu.
- A menu or branch slug `preview` under a restaurant would clash with the
  preview route; `preview` is now reserved as a restaurant slug.
- Edits made to the live menu while a copy is being created may or may not be in
  the copy (the copy takes a few statements, not one snapshot).
