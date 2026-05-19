---
id: SEED-014
status: completed
completed: 2026-05-19
planted: 2026-05-19
completed_in: v2.2 (Restaurant Growth Platform — phases 42-43)
planted_during: post-v2.1-custom-domains
trigger_when: improving search visibility for XmartMenu's own pages, tenant-owned custom domains, or multi-location branches
scope: medium
---

# SEED-014: Robust SEO — Platform and Per-Tenant

## Why This Matters

XmartMenu operates at two levels of SEO concern, and today neither is fully covered:

**Platform-level (XmartMenu's own pages):**
The marketing landing page shipped basic metadata and JSON-LD in v1.3, but it's missing: a complete `sitemap.xml` strategy, `hreflang` for multi-language support, structured `Organization` and `SoftwareApplication` rich results, Twitter card tags, and ongoing Core Web Vitals-aware meta hygiene.

**Tenant-level (the restaurant's pages):**
This is the bigger opportunity. When a restaurant uses XmartMenu with a custom domain (SEED-010), the menu page at `restaurantsite.com` becomes their primary web presence. Today there's no `<title>`, `<meta description>`, OG image, or structured data scoped to that restaurant. A Google search for "Sushi Yamamoto restaurant" finds nothing — even though the menu is live.

To make tenant pages genuinely discoverable:
- Dynamic `<title>` and `<meta description>` from tenant name + description
- OG image generated per tenant (logo + brand colors, `ImageResponse`)
- `LocalBusiness` JSON-LD with address, phone, hours, cuisine type
- `Menu` and `MenuItem` schema for menu items (Google rich results for food menus)
- Dynamic `sitemap.xml` per tenant domain (if custom domain active)
- `robots.txt` served per domain, not platform-global
- Canonical URL handling when same content exists at both `xmartmenu.skale.club/slug` and `restaurantsite.com`

Since the menu page at the custom domain IS the restaurant's website (SEED-010), SEO is table stakes — a restaurant website with no indexability is useless.

## When to Surface

**Trigger:** when a tenant activates a custom domain; when working on tenant website features (SEED-012); or when improving platform discoverability

Surface during `/gsd:new-milestone` when the scope involves:
- Tenant digital presence and discoverability
- Custom domain rollout (SEED-010)
- Multi-location branch system (SEED-011) — each branch needs its own local SEO
- Google ranking improvements for the platform or tenants
- Rich search results (Google Business-like cards for restaurants)

## Scope Estimate

**Medium** — 2–4 days. Three independent tracks:

### Track A: XmartMenu platform SEO

1. **Complete sitemap strategy**
   - `/sitemap.xml` at platform level: lists `/` + `/[tenantSlug]` for all active tenants (static paths only, no custom domains leaking into platform sitemap)
   - Tenant-level sitemap at `restaurantsite.com/sitemap.xml` (when custom domain active): lists `/`, `/menu`, `/about`, `/contact` etc.
   - `next-sitemap` or manual `route.ts` generation, regenerated on ISR

2. **Twitter card + enhanced OG tags**
   - `twitter:card = summary_large_image`, `twitter:site = @xmartmenu`
   - `og:type = website` on landing page, `og:type = restaurant` on tenant pages

3. **JSON-LD hardening**
   - `Organization` on platform landing page (already partial, complete address + sameAs social links)
   - `WebSite` + `SearchAction` sitelinks searchbox schema for platform
   - Validate via Google Rich Results Test

4. **Core Web Vitals monitoring**
   - Vercel Analytics already active; add Web Vitals reporting hook if missing
   - Budget threshold for LCP < 2.5s on public menu pages

### Track B: Per-tenant SEO

1. **Dynamic metadata per tenant**
   - `generateMetadata()` in `src/app/(public)/[slug]/page.tsx` (and future `[domain]/page.tsx`)
   - Title: `{tenant.name} — Digital Menu`
   - Description: `{tenant.description}` (add `description` field to tenants if missing)
   - `metadataBase` set to tenant's custom domain when active, else platform domain

2. **Per-tenant OG image**
   - `opengraph-image.tsx` at tenant route level using `ImageResponse`
   - Renders: tenant logo + name + brand color background
   - Cached per tenant; revalidated when branding changes

3. **LocalBusiness JSON-LD**
   - Schema.org `LocalBusiness` (or `Restaurant` subtype) per tenant
   - Fields: `name`, `address`, `telephone`, `url`, `logo`, `openingHours`, `servesCuisine`
   - Injected as `<script type="application/ld+json">` in tenant page layout
   - Data sourced from `tenants` + `tenant_settings`

4. **Menu + MenuItem schema**
   - Schema.org `Menu` → `MenuSection` → `MenuItem` for each product
   - `offers.price` from product price, `description`, `image`
   - Enables Google's food menu rich results in SERPs
   - Generated server-side from existing menu data query

5. **Canonical URL strategy**
   - `<link rel="canonical">` on platform slug pages pointing to custom domain when active
   - Prevents duplicate content penalty if both URLs are indexed

6. **Per-domain robots.txt**
   - `GET /robots.txt` route that detects whether request is from a custom domain
   - Custom domain: `Allow: /`, `Sitemap: https://customdomain.com/sitemap.xml`
   - Platform slug: `Disallow: /` (prevent indexing of the platform-slug version when custom domain is active)

### Track C: Per-branch local SEO (depends on SEED-011)

When a tenant has multiple locations, each branch is a distinct physical business that Google can index and surface separately in local search results ("restaurants near me", Google Maps, etc.).

1. **Branch-level LocalBusiness JSON-LD**
   - Each active `location` gets its own `LocalBusiness` JSON-LD block
   - Schema: `@type: Restaurant`, `name: "{tenant.name} — {location.name}"`, `address`, `telephone`, `openingHours` from `location.operating_hours`
   - `branchOf: { @type: Organization, name: "{tenant.name}", url: "{tenant.custom_domain}" }` — links the branch to the parent brand
   - Injected on branch-specific pages (e.g. `restaurantsite.com?location=downtown`) or, if branches get their own subpaths, per-branch route

2. **Per-branch sitemap entries**
   - Tenant sitemap includes a URL entry per active branch (if branches have unique URLs or query params)
   - `<loc>`, `<lastmod>`, `<changefreq>` per branch entry

3. **Per-branch OG metadata**
   - When `?location=<slug>` is present in the URL, `generateMetadata()` scopes title and description to that branch
   - Title: `"{tenant.name} — {location.name} — Menu"`
   - Description includes branch address for local search relevance

4. **Google Maps deep-link per branch**
   - Each branch JSON-LD includes `hasMap: "https://maps.google.com/?q={encoded_address}"` for direct Google Maps linking

## Breadcrumbs

- `src/app/(public)/[slug]/page.tsx` — where `generateMetadata()` needs to be added/upgraded
- `src/app/(public)/[slug]/layout.tsx` — where JSON-LD scripts should be injected
- `src/app/(marketing)/page.tsx` — platform landing page with existing basic SEO (v1.3)
- `src/app/sitemap.ts` — current sitemap listing only `/`; needs tenant paths
- `src/app/robots.ts` — current platform robots.txt; needs per-domain logic
- `src/app/opengraph-image.tsx` — platform OG image; tenant version needed at route level
- `src/lib/get-effective-tenant.ts` — tenant data needed for metadata generation
- `src/lib/get-active-menu.ts` — menu data for MenuItem schema
- `src/types/database.ts` — `Tenant` may need `description`, `cuisine_type`, `address` fields

## Notes

- **Order of implementation matters:** Track B depends on tenant data being rich enough (description, address, hours). If those fields don't exist on `tenants` yet, the migration is small — add them alongside this seed.
- **MenuItem schema is high-value, low-cost** — Google can surface individual dishes in search results with prices and images. This is a significant discoverability win for restaurants with well-filled menus.
- **Canonical URL is critical when SEED-010 is active** — without it, Google may index both `xmartmenu.skale.club/slug` and `restaurantsite.com` as duplicates and split PageRank.
- **Track C is gated on SEED-011** — implement only after the `locations` table and branch routing exist. Design Track B's `LocalBusiness` JSON-LD to be easily extended with `branchOf` later.
- **Local SEO is the highest-value play for multi-location** — a chain restaurant with 3 branches, each indexed by Google with its own address and hours, can appear in "near me" searches across multiple neighborhoods simultaneously. This is a significant competitive advantage.
