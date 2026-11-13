# Rebrand plan: XmartMenu → Xprout (xprout.app)

Decision: owner, 2026-11-12 (XMM-D-2026-11-12-brand-name, approved). The product is renamed **Xprout** ("es-prout" = sprout); the main address becomes **https://xprout.app**. Research and the rejected names: Notion → Projects → XmartMenu → Brand Name Research.

Status updated 2026-11-13: the product/domain rebrand is live. The owner now requires a complete repository/workspace rename, superseding the original internal-name exemption below. See [the full rename record](../product/xprout-rename-2026-11-13.md) for verified changes, compatibility identifiers and pending operational migration. The original inventory and deployment sequence below remain historical planning evidence.

## Principles

- Superseded on 2026-11-13: the original scope kept internal identifiers. The owner now requires Xprout throughout active product, repository and workspace naming. Existing data, authentication, archive and payment protocols require compatible transitions; historical records remain intact.
- The old address never dies: `xmartmenu.skale.club` answers forever with a permanent redirect to the same path on `xprout.app`, because restaurants have printed QR codes.
- One change at a time in production, with the owner's OK before each production step (universal rules).
- Start from `dev` on a branch `feat/rebrand-xprout`; release through the normal CI/deploy flow.

## Inventory (2026-11-12)

- Brand text "xmart" in `src`: about 221 lines in 134 files. Much of the visible name comes from `platform_settings.app_name`, `brand_name` and `menu_footer_brand`, with the fallback `'XmartMenu'` hard-coded in `src/app/(admin)/layout.tsx`, `src/app/(marketing)/layout.tsx`, `page.tsx`, `ClientPage.tsx` and `src/app/(superadmin)/admin/SettingsClient.tsx`.
- Old host `xmartmenu.skale.club` in 10 source files (`src/app/layout.tsx`, `src/app/(marketing)/layout.tsx`, `src/lib/seo.ts`, `src/middleware.ts`, `src/lib/tenant-subdomain.ts`, `src/lib/access-requests/notify.ts`, `src/app/api/admin/tenants/[id]/verify-domain/route.ts`, `src/app/(admin)/settings/store/StoreClient.tsx`, the Apple Pay domain-association route and a launch-checklist test), 4 GitHub workflows (`build-deploy.yml`, `rollback.yml`, `uptime.yml`, `lighthouse-ci.yml`), 5 scripts, 3 tests, `.lighthouserc.json`, `.env.example`, `README.md`.
- Base-URL env vars: `NEXT_PUBLIC_APP_URL` (23 uses), `NEXT_PUBLIC_SITE_URL` (8), `NEXT_PUBLIC_BASE_URL` (3), `MCP_PUBLIC_ORIGIN` (2).
- PWA manifest: `src/app/manifest.ts`.
- Placeholder e-mail domains `@xmartmenu.local` (register route, demo): internal, may stay.

## Phase 0: owner actions (before any code)

1. **Buy domains** (owner): `xprout.app` (USD 9.99, then 15/yr). Recommended defensive: `xprout.menu` (30/yr) and `xproutmenu.com` (12.03/yr). Optional: check the price of `xprout.com` on Atom (domains.atom.com). Put them on Cloudflare DNS like the other Skale domains.
2. **Trademark clearance** (owner + attorney): USPTO knockout for XPROUT in classes 9, 35, 42, 43; include BeSprout (restaurant online ordering), Sprout Social and WeSprout as nearby marks. Optionally file XPROUT.
3. **Brand assets** (design): logo, app icons (192/512/maskable, Apple touch, favicon), OG image. Idea from the research: the existing crossed fork-and-knife icon already forms an X.
4. **Handles**: reserve Xprout on Instagram, TikTok, X, LinkedIn, YouTube; check the App Store and Google Play name.

## Phase 1: code (branch `feat/rebrand-xprout`, development only)

1. **One brand source.** Add `src/lib/brand.ts` with `BRAND_NAME = 'Xprout'`, `BRAND_DOMAIN = 'xprout.app'`, `LEGACY_HOSTS = ['xmartmenu.skale.club']`; replace every hard-coded `'XmartMenu'` fallback with it. `platform_settings` keeps overriding at run time.
2. **Visible text.** Replace "XmartMenu"/"Xmartmenu" in UI copy, metadata, JSON-LD, emails/notifications (`access-requests/notify.ts`), WhatsApp/SMS templates, legal pages, admin and superadmin screens, AI prompts that name the product, MCP server name/description, landing and blog defaults. Review each hit; do not blind-replace internal identifiers.
3. **URLs.** Replace `https://xmartmenu.skale.club` defaults with the env var or `BRAND_DOMAIN` in `layout.tsx`, `seo.ts` (canonical, sitemap, robots), `middleware.ts`, `tenant-subdomain.ts`, `verify-domain` (CNAME/A instructions shown to restaurants), `StoreClient.tsx`, QR code generation (new QR codes must point to `xprout.app`).
4. **Legacy-host redirect.** In `middleware.ts`: a request whose host is in `LEGACY_HOSTS` gets a 308 to `https://xprout.app` + same path and query, except paths that must answer on both hosts during the switch (`/api/health*`, Stripe/webhook routes, `/.well-known/*`). Covered by unit tests.
5. **PWA manifest and icons:** `manifest.ts` name/short_name/description and the new icon set.
6. **Apple Pay:** the domain-association route must also serve for `xprout.app`; the new domain must be registered in Stripe (Payment method domains).
7. **Workflows and tooling:** the 4 GitHub workflows (deploy health URL, uptime, rollback, Lighthouse), `.lighthouserc.json`, scripts, `.env.example`, tests that assert the old name or host.
8. **Docs:** README, AGENTS.md, docs/ (current-state docs only; history stays as written).
9. **Tests:** unit tests for the brand fallback and the legacy redirect; update e2e expectations; run the targeted tests locally and the full suite in CI.

## Phase 2: infrastructure (production, owner OK per step)

1. DNS: `xprout.app` (and `www`) → the Coolify host; `.app` is HSTS-preloaded, so TLS must be ready before anything points there.
2. Coolify: add `xprout.app` to the app's domains next to `xmartmenu.skale.club`; Let's Encrypt certificate; keep both hosts on the same app.
3. Env vars in Coolify: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`, `MCP_PUBLIC_ORIGIN` → `https://xprout.app` (`NEXT_PUBLIC_*` are baked at build time: rebuild after changing).
4. Google Identity: add `https://xprout.app` to authorized JavaScript origins and redirect URIs (keep the old ones until the switch is done).
5. Stripe: add the new domain to Payment method domains (Apple Pay / Google Pay); update Connect OAuth redirect URI, customer portal and checkout return URLs; update the public business name and statement descriptor if they say XmartMenu. Webhook endpoints: add the new URL, keep the old one until traffic moves.
6. Other providers that whitelist origins or send links: Firebase authorized domains, Sentry allowed domains, OpenRouter app name/referrer, Cloudflare R2/CDN CORS, MCP OAuth redirect URIs, Xphere CRM sync source name, e-mail/SMS sender names.
7. Sessions: identity cookies are host-only (`__Host-`), so users signed in on the old host must sign in again on `xprout.app`. Announce it; no data is lost.

## Phase 3: data (production, owner OK)

1. `platform_settings`: `app_name`, `brand_name`, `menu_footer_brand`, SEO title/description, landing texts → Xprout (via the superadmin settings screen, so the change is audited).
2. Search the database for stored "XmartMenu" text in tenant-facing templates (emails, blog defaults) and update only platform-owned rows, never tenant content.

## Phase 4: release and switch

1. Merge to `dev`, check on localhost/dev (old host redirect, login, ordering, Stripe test checkout, AR/3D, QR generation, custom domains and tenant subdomains unaffected).
2. Release `dev` → `main` with the owner's OK; follow CI and the deploy; check `https://xprout.app/api/health/ready` and a public menu.
3. Turn on the legacy redirect (if shipped behind a flag) and verify: an old printed QR URL `https://xmartmenu.skale.club/<slug>` lands on `https://xprout.app/<slug>`.
4. Google Search Console: add `xprout.app`, submit the sitemap, use Change of Address from the old property.
5. Tell restaurants (e-mail + in-panel notice): new name, new address, old QR codes keep working, sign in again once.
6. Store listings and social profiles when they exist.

## Phase 5: after the switch

- Watch for a week: redirect hits, 404s, sign-in errors, Stripe webhook failures, Sentry.
- Keep `xmartmenu.skale.club` redirecting indefinitely; renew the defensive domains.
- Notion: rename the project page and journal titles to Xprout; update the Current State.

## Rollback

Code: redeploy the previous image by SHA (existing rollback workflow). Domain: keep `xmartmenu.skale.club` attached the whole time, so removing the redirect brings the old address back at once. Data: the superadmin settings can be changed back.

## Risks

- Sign-in breaks if Google/Firebase origins are not updated before the switch.
- Payments: Apple Pay and Connect redirects fail on the new domain until registered in Stripe.
- SEO dip for a few weeks after the change of address.
- Printed QR codes depend on the legacy redirect: never remove it.
- Trademark: BeSprout (restaurant ordering) shares the word "sprout"; get clearance before heavy marketing.
