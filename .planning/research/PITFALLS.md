# Pitfalls Research — v1.3 Landing Page

**Domain:** Adding a marketing landing page to an existing Next.js 16.2 App Router multi-tenant SaaS  
**Researched:** 2026-05-07  
**Confidence:** HIGH (routing and middleware verified against live codebase; OG/i18n/JSON-LD pitfalls cross-referenced with official Next.js docs and verified GitHub issues)

---

## Executive Summary

The v1.3 landing page looks simple — one static page at `/` — but it shares a namespace with every tenant slug (`/{slug}`), runs inside a middleware that calls Supabase Auth on every request, and must hit Lighthouse 95+ on mobile while living inside a codebase full of client-heavy SaaS code. The eight risk areas below are not hypothetical; they are the exact failure modes that trip production teams adding marketing pages to existing multi-tenant Next.js apps.

**The single highest-risk pitfall for this project:** middleware runs `supabase.auth.getUser()` (a network call to Supabase Auth) on every request — including the landing page at `/`. Without an explicit middleware bypass for public marketing routes, every visitor to `xmartmenu.skale.club` pays a Supabase round-trip before the page loads, killing both LCP and Lighthouse scores.

---

## Pitfall 1: Tenant Slug Namespace Collision

### What Goes Wrong

The public menu route `src/app/(public)/[slug]/page.tsx` matches any single-segment path, including `/pricing`, `/about`, `/features`, `/demo`, `/pt`, `/en`. A restaurant owner who names their company "Pricing" would get the slug `pricing` via `slugify()`, and `xmartmenu.skale.club/pricing` would serve their restaurant menu instead of the landing page pricing section. More critically, the i18n locale prefixes (`/pt`, `/en`) are themselves top-level paths that would resolve to the `[slug]` route if a tenant with that slug exists.

**Verified in codebase:** `src/app/(public)/[slug]/page.tsx` calls `getTenantBySlug(slug)` and returns `notFound()` if no tenant exists — but it does NOT check whether the slug is a reserved marketing path. There is no reserved path list anywhere in the codebase.

### Why It Happens

App Router dynamic routing resolves in specificity order: static routes beat dynamic ones. So `/pricing` as a page file would win over `[slug]`. But if the landing page uses `#pricing` hash sections (single-page layout) rather than `/pricing` as a distinct route, there is no static file to win the race — any tenant named "pricing" takes the path.

The `slugify()` function in `src/lib/utils.ts` does not filter reserved words. The onboarding API (`src/app/api/onboarding/route.ts`) only deduplicates slugs that already exist in the `tenants` table — not against a reserved word list.

### How to Avoid

**In middleware (`src/middleware.ts`):** Add a `RESERVED_PATHS` set and ensure any path matching it is not treated as a tenant slug:

```typescript
// src/middleware.ts — add above all other logic
const RESERVED_PATHS = new Set([
  'pricing', 'features', 'about', 'demo', 'faq', 'blog',
  'pt', 'en',  // i18n locale prefixes
  'auth', 'api', 'onboarding', 'dashboard', 'menu',
  'settings', 'overview', 'tenants', 'users',
])

const firstSegment = pathname.split('/')[1]
if (RESERVED_PATHS.has(firstSegment)) {
  // Let the request pass to the static route handler — skip tenant-auth logic
  return NextResponse.next({ request })
}
```

**In onboarding API (`src/app/api/onboarding/route.ts`):** Reject slugs that match reserved paths at registration time:

```typescript
const RESERVED_SLUGS = new Set(['pricing', 'features', 'about', 'demo', 'faq', 'pt', 'en', ...])
if (RESERVED_SLUGS.has(slug)) {
  slug = `${slug}-${Date.now().toString(36)}`
}
```

**Route structure:** Use actual Next.js page files for marketing sections that need SEO-addressable URLs (`/pricing` → `src/app/pricing/page.tsx`) rather than single-page hash navigation. Static routes always beat `[slug]` in App Router.

### Warning Signs

- A tenant named "Pricing SaaS" completes onboarding and gets slug `pricing` — the `/pricing` URL now serves their menu instead of the landing page pricing section.
- The `/pt` or `/en` locale prefix returns a 404 because no tenant with that slug exists, instead of serving the PT/EN landing page.
- After adding the `/demo` link in the landing page, visiting `xmartmenu.skale.club/demo` 404s because the `demo` tenant hasn't been provisioned yet and the `[slug]` route returns `notFound()`.

### Phase to Address

Phase 12 (Landing Page Build) — reserved path list must exist before any marketing routes are deployed. Blocking issue.

---

## Pitfall 2: Middleware Supabase Session Call Kills Landing Page Performance

### What Goes Wrong

The current `src/middleware.ts` calls `supabase.auth.getUser()` — a network call to Supabase Auth — on every matched request. The matcher is:

```typescript
'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
```

This means every visitor to `xmartmenu.skale.club/` triggers a Supabase Auth network call before the page HTML is served. On Vercel's edge network this call adds 50–200ms of server-side latency per request, directly penalizing Time to First Byte (TTFB). For a page targeting Lighthouse 95+ mobile, this is a hard blocker — TTFB above 200ms alone can drop the performance score from 95 to 85–88.

**Verified in codebase:** `src/lib/supabase/middleware.ts` calls `supabase.auth.getUser()` with no path exclusion. The landing page at `/` is not in any bypass list.

### Why It Happens

The middleware was designed for app routes (admin, superadmin, auth flows). The landing page didn't exist when it was written. The "allow app boot without Supabase configured" guard (lines 11–13 of middleware.ts) bypasses the call only when `NEXT_PUBLIC_SUPABASE_URL` is missing — which will never be true in production.

### How to Avoid

Add a public-path bypass at the very start of `updateSession`:

```typescript
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Marketing routes: skip auth entirely — no Supabase call
  const isMarketingRoute =
    pathname === '/' ||
    pathname.startsWith('/pt') ||
    pathname.startsWith('/en') ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'

  if (isMarketingRoute) {
    return NextResponse.next({ request })
  }

  // ... rest of existing logic
}
```

The public tenant menu routes (`/{slug}` and `/{slug}/{menuSlug}`) also do not need user session auth — they use `createServiceClient` (service role key). Consider whether those paths also need a bypass to eliminate unnecessary Supabase calls on every public menu page load.

### Warning Signs

- Vercel function logs show `updateSession` executing for every `/` request.
- Lighthouse TTFB is consistently above 500ms in lab tests despite the page being "static."
- Chrome DevTools Network shows the first document request taking longer than expected before any HTML bytes arrive.
- Supabase Auth dashboard shows spikes in `getUser` calls correlating with marketing page traffic.

### Phase to Address

Phase 12 (Landing Page Build) — must be patched before Lighthouse measurement. Blocking for the performance target.

---

## Pitfall 3: OG Image Too Heavy for WhatsApp Sharing

### What Goes Wrong

Next.js `ImageResponse` (used in `opengraph-image.tsx`) generates PNG by default. A 1200×630 PNG for a landing page with background imagery and text can easily exceed 1 MB. WhatsApp has a hard 300 KB OG image size limit. Images over 300 KB are silently discarded by WhatsApp — the link preview shows no image at all. Since the primary audience is Brazilian restaurateurs who share links almost exclusively via WhatsApp, a landing page with no WhatsApp preview is a missed acquisition opportunity.

**Verified:** GitHub Discussion #60366 in the Next.js repo confirms: "When generating images at recommended resolution of 1200x630 with background image, the output image size is usually over 1MB, which prevents use by apps like WhatsApp that has a size limit of 300kb."

### Why It Happens

`ImageResponse` was designed for generic OG images and defaults to PNG for lossless rendering fidelity. Developers test OG previews with tools like ogcheck.com or opengraph.xyz (which follow the spec without size limits) but never test in WhatsApp itself. WhatsApp's silent drop behavior means the issue is invisible in standard testing.

### How to Avoid

**Option A (preferred):** Use a static OG image file instead of `ImageResponse`. A carefully designed 1200×630 JPEG or WebP exported from a design tool can be under 100 KB. Place as `src/app/opengraph-image.jpg` — Next.js auto-generates the meta tag. This avoids the PNG overhead entirely.

**Option B:** If using `ImageResponse`, keep it pure CSS with flat colors and text only. No background images inside `ImageResponse` — they are embedded as base64 inside the PNG, ballooning file size.

**Test requirement:** Before shipping, verify OG image size:

```bash
# Check OG image size in production
curl -I https://xmartmenu.skale.club/opengraph-image | grep -i content-length
# Must be under 300000 bytes (300 KB)
```

Also paste the production URL into WhatsApp and confirm the image preview renders.

Also set `metadataBase` in `src/app/layout.tsx` — without it, OG image URLs are relative and break on external crawlers:

```typescript
export const metadata: Metadata = {
  metadataBase: new URL('https://xmartmenu.skale.club'),
}
```

**Verified in codebase:** `src/app/layout.tsx` currently has no `metadataBase` set.

### Warning Signs

- WhatsApp link preview shows no image (but Facebook/Twitter/Telegram show it correctly).
- `curl -I` on the OG image URL shows `Content-Length` above 300000.
- `opengraph-image.tsx` uses `fetch()` to embed an external image inside `ImageResponse`.
- `metadataBase` is absent from `src/app/layout.tsx`.

### Phase to Address

Phase 13 (SEO + Analytics) — acceptance criterion: OG image verified in WhatsApp before Phase 13 is marked complete.

---

## Pitfall 4: Lighthouse Budget Broken by Middleware, Fonts, or Client Components

### What Goes Wrong

The landing page is statically generated but still scores below 90 on mobile Lighthouse because of compounding penalties:

1. **Middleware TTFB penalty** (see Pitfall 2) — 50–200ms before any HTML byte.
2. **Inter font missing `display` option** — if `display: 'swap'` is absent, the font can cause FOIT (invisible text) or CLS (layout shift). Verified: `src/app/layout.tsx` uses `Inter({ subsets: ['latin'] })` with no `display` option.
3. **Client components in hero section** — any `'use client'` in the above-the-fold area forces JavaScript to be downloaded and executed before the hero becomes interactive, raising TBT and INP.
4. **Vercel Analytics / Speed Insights as blocking scripts** — if added to the root layout without deferred loading, these add render-blocking script time.
5. **Shared root layout pulls in SaaS admin CSS** — the full Tailwind 4 stylesheet applied to the landing page includes SaaS admin styles (tables, forms, complex modals) not present on the landing page, inflating CSS payload.

### How to Avoid

**Font:** Add `display: 'swap'` and `preload: true`:

```typescript
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})
```

**Zero above-the-fold client JS:** The hero section, nav, and first feature block must be Server Components. No `'use client'` above the fold. CTA button is a plain `<a href="/auth/register">` — no state needed.

**Analytics isolation:** Add Vercel Analytics and Speed Insights as the last children in the root layout body. Both packages are async by default but should not be placed inside the main content flow.

**Separate marketing layout:** Create `src/app/(marketing)/layout.tsx` so the landing page does not inherit admin-focused CSS/JS. The root `src/app/layout.tsx` remains minimal (font + globals.css); the marketing layout adds only what marketing pages need.

**Measurement gate:** Run Lighthouse before marking either phase complete:

```bash
npx lighthouse https://xmartmenu.skale.club --preset=perf --form-factor=mobile --output=json | jq '.categories.performance.score'
# Must be >= 0.95
```

### Warning Signs

- Lighthouse shows TBT above 200ms (client JS executing above the fold).
- LCP element is the hero image but takes more than 2.5s (not preloaded or oversized).
- CLS score above 0.05 (font or image without fixed dimensions causing layout shift).
- `next build` output shows the landing page JS bundle above 80 KB gzipped.

### Phase to Address

Phase 12 (Landing Page Build) — performance must be built in, not retrofitted. Phase 13 (SEO + Analytics) — final Lighthouse gate before marking milestone complete.

---

## Pitfall 5: JSON-LD Conflicts with Existing Root Layout Metadata

### What Goes Wrong

Two problems occur when JSON-LD is added carelessly:

1. **JSON-LD in `layout.tsx` appears on every page** — including tenant menu pages at `/{slug}`, auth pages, and admin pages. An Organization schema on a restaurant's menu page is irrelevant and can confuse Google's structured data parser.

2. **Hydration duplication with `next/script`** — adding JSON-LD via `<Script strategy="beforeInteractive">` causes the script to appear twice in the HTML: once server-rendered, once during React hydration. This is a known App Router issue documented in GitHub Discussion #80088.

3. **Multiple conflicting schemas** — if the root layout adds Organization schema and the landing page also adds SoftwareApplication schema via `generateMetadata`, Google's Rich Results Test may flag duplicate or conflicting top-level entities.

### How to Avoid

**Rule:** JSON-LD belongs in the page file body as an inline `<script>` with `dangerouslySetInnerHTML`, never in `layout.tsx`, never via `next/script`:

```tsx
// src/app/page.tsx (landing page only)
export default function LandingPage() {
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'XmartMenu',
    url: 'https://xmartmenu.skale.club',
    description: 'Cardápio digital via QR Code para restaurantes',
  }

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'XmartMenu',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      {/* page content */}
    </>
  )
}
```

**Validation requirement:** Test structured data at [https://search.google.com/test/rich-results](https://search.google.com/test/rich-results) before Phase 13 is complete. Both schemas must validate without errors or warnings.

### Warning Signs

- `<script type="application/ld+json">` appears twice in view-source of the landing page.
- JSON-LD block appears when viewing source of `xmartmenu.skale.club/demo` (tenant menu page) — means it leaked from the root layout.
- Google Rich Results Test shows "Multiple entities detected" warning.

### Phase to Address

Phase 13 (SEO + Analytics) — validated before marking complete.

---

## Pitfall 6: CTA Flow Breaks Before Landing Page Ships

### What Goes Wrong

The landing page hero "Get started" CTA points to `/auth/register`. The full conversion flow is:

```
/ → /auth/register → email confirm → /auth/callback → /onboarding → /dashboard
```

If any link in this chain is broken, the landing page actively harms conversion — it raises expectations and then fails to deliver. Specific break points in the current codebase:

1. **`src/app/page.tsx` currently redirects to `/auth/login`** — when the landing page replaces this file, the redirect is removed. Any hardcoded links elsewhere in the app that point to `/` expecting a login redirect will now see the marketing page instead.

2. **Email confirmation origin mismatch** — `src/app/api/auth/register/route.ts` sets `emailRedirectTo: ${origin}/auth/callback?next=...`. In local dev, `origin` is `localhost:3000`. If pre-launch testing is done against a Vercel preview URL, the confirmation email link may go to the wrong origin.

3. **Onboarding `useEffect` auth check** — `src/app/onboarding/page.tsx` uses client-side `useEffect` to check auth. If email is not confirmed and the user visits `/onboarding` directly, they are redirected to `/auth/login` with no explanation. The landing page copy must set accurate expectations about the email confirmation step.

4. **`/demo` tenant must exist before the landing page links to it** — if the `demo` tenant has no menus or `is_active: false`, the public menu route returns `notFound()`. A visitor who clicks "See a live demo" and gets a Next.js 404 is worse than having no demo link at all.

### How to Avoid

**Before shipping Phase 12:** Walk the full CTA flow in the production environment:

1. Visit `xmartmenu.skale.club/`, click "Get started" → lands on `/auth/register`
2. Complete registration form → success message appears
3. Confirm email from inbox → `/auth/callback` redirects to `/onboarding`
4. Complete onboarding wizard → `/dashboard` accessible
5. Visit `/{new_tenant_slug}` → public menu renders with content

**Demo tenant checklist:** The `demo` tenant in production DB must have:
- `is_active: true`
- At least one active menu with `is_default: true`
- At least 3 active categories with available products
- A cover image (`tenant_settings.logo_url`) so the page looks populated

Provision via the superadmin panel using the AI seeding tools already shipped in v1.2.

**Fallback for demo link:** If demo tenant health cannot be guaranteed, link to the two-segment path (`/demo/cardapio`) — the `[slug]/[menuSlug]` route has its own data fetching and shows a more specific 404 if the menu slug doesn't exist, which is easier to debug than a bare tenant 404.

### Warning Signs

- Clicking "Get started" in production leads to `/auth/login` instead of `/auth/register` (old redirect still active).
- Demo link returns the Next.js 404 page (tenant not provisioned or inactive).
- Email confirmation link in the inbox goes to `localhost:3000` (origin not production URL).
- Onboarding page shows "Loading..." indefinitely after email confirmation.

### Phase to Address

Phase 12 (Landing Page Build) — CTA flow verification is a gate criterion. Demo tenant must be provisioned as part of Phase 12. Phase 13 does not start until the CTA flow passes a full end-to-end walkthrough.

---

## Pitfall 7: i18n Route Group Collides With `[slug]` Dynamic Route

### What Goes Wrong

The planned i18n pattern uses path-based locale prefixes (`/pt`, `/en`). In Next.js App Router, a common structure is a `[locale]` dynamic route at the root: `src/app/[locale]/page.tsx`. This immediately conflicts with the existing `src/app/(public)/[slug]/page.tsx` — both are dynamic segments at the root level. Next.js will throw a build-time route conflict, or worse, resolve them ambiguously in development but fail in production.

Even without an explicit `[locale]` route, if the i18n middleware rewrites `/pt` to `/[locale]/page`, and the `[slug]` route also matches `/pt`, Next.js may serve the wrong handler depending on route group resolution order.

### How to Avoid

**Option A (recommended):** Scope marketing i18n to a named route group that does NOT add a URL segment:

```
src/app/
├── (marketing)/          # Parenthesized group — no URL segment added
│   ├── [locale]/         # Matches /pt and /en only (use generateStaticParams)
│   │   └── page.tsx
│   └── page.tsx          # / root (default locale)
├── (public)/
│   └── [slug]/           # /{tenantSlug} — existing, unchanged
│       └── page.tsx
```

The `(marketing)` group keeps i18n scoped to marketing pages only. The `[slug]` route in `(public)` is unaffected.

**Option B (simpler):** Keep the landing page at `/` only. Serve EN by default; add a language toggle that sets a cookie. No path-based locale, no route conflict. Simpler but worse for multilingual SEO.

**If using next-intl:** `setRequestLocale` is required for static generation — without it, locale pages fall back to dynamic rendering:

```typescript
// src/app/(marketing)/[locale]/page.tsx
import { setRequestLocale } from 'next-intl/server'

export function generateStaticParams() {
  return [{ locale: 'pt' }, { locale: 'en' }]
}

export default function LandingPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale) // Must be before any useTranslations call
  // ...
}
```

**In middleware and onboarding API:** Add `pt` and `en` to the reserved path list (Pitfall 1) to prevent a tenant from claiming these slugs.

### Warning Signs

- `next build` throws a route conflict error mentioning `[slug]` and `[locale]`.
- Visiting `/pt` serves a tenant menu instead of the Portuguese landing page.
- `generateStaticParams` is missing — `next build` output shows `/pt` and `/en` as dynamically rendered (`λ`) instead of static (`○`).

### Phase to Address

Phase 12 (Landing Page Build) — architecture decision (Option A or B) must be made before any routing code is written.

---

## Pitfall 8: `sitemap.ts` Leaks Tenant Slugs as Public Data

### What Goes Wrong

A `src/app/sitemap.ts` that automatically queries all active tenants and lists their `/{slug}` URLs exposes the complete tenant roster as a public XML file. Competitors or data harvesters can extract all restaurant names and their slugs from `xmartmenu.skale.club/sitemap.xml`. This includes tenants still in onboarding, internal test tenants, and restaurants that have not yet publicly announced their digital menu.

### How to Avoid

**Landing page sitemap only** — `src/app/sitemap.ts` lists only marketing URLs:

```typescript
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://xmartmenu.skale.club/', lastModified: new Date(), priority: 1.0 },
    { url: 'https://xmartmenu.skale.club/pt', lastModified: new Date(), priority: 0.9 },
    { url: 'https://xmartmenu.skale.club/en', lastModified: new Date(), priority: 0.9 },
  ]
}
```

Do not query the `tenants` table from `sitemap.ts`. Tenant menu pages are public and indexed individually by crawlers visiting them — no need to enumerate them in the sitemap.

**`robots.txt`:** Explicitly disallow admin, superadmin, and API routes:

```typescript
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: ['/dashboard', '/settings', '/tenants', '/overview', '/api/'],
        allow: '/',
      },
    ],
    sitemap: 'https://xmartmenu.skale.club/sitemap.xml',
  }
}
```

### Warning Signs

- `sitemap.xml` in production contains URLs like `xmartmenu.skale.club/pizza-joe`.
- The sitemap generation function queries the `tenants` table.
- Internal test tenants (slug: `test`, `demo2`, `qa-restaurant`) appear in the sitemap.

### Phase to Address

Phase 13 (SEO + Analytics).

---

## Integration Gotchas Quick Reference

| Area | Common Mistake | Correct Approach |
|------|---------------|------------------|
| Middleware | `supabase.auth.getUser()` fires on every request including `/` | Add public-path bypass at start of `updateSession`; return `NextResponse.next()` immediately for marketing routes |
| Tenant namespace | No reserved path list → tenant named "Pricing" shadows `/pricing` | Reserved path set in both middleware and onboarding API |
| Tenant namespace | `/pt` and `/en` locale prefixes resolve as tenant slugs | Add `'pt'` and `'en'` to reserved path list |
| OG image | `ImageResponse` with background image generates >1 MB PNG → silent WhatsApp drop | Use static JPEG/WebP under 100 KB, or pure CSS+text `ImageResponse` |
| OG image | `metadataBase` not set → relative OG URLs that external crawlers cannot resolve | `metadataBase: new URL('https://xmartmenu.skale.club')` in root layout |
| JSON-LD | Added to `layout.tsx` → appears on tenant menu pages, auth pages, admin pages | JSON-LD only in `page.tsx` files, inline `<script dangerouslySetInnerHTML>`, never via `next/script` |
| i18n routing | `[locale]` dynamic segment at root conflicts with `[slug]` | Use `(marketing)/[locale]/` route group to scope i18n to marketing only |
| i18n static | Missing `setRequestLocale()` → locale pages dynamically rendered | Call `setRequestLocale(locale)` at top of every locale page and layout |
| Performance | Hero section uses `'use client'` for animation | Server Component hero; plain `<a>` CTA; interactivity below the fold only |
| Font | `Inter({ subsets: ['latin'] })` with no `display` option → FOIT or CLS | `Inter({ subsets: ['latin'], display: 'swap', preload: true })` |
| CTA flow | Demo tenant not provisioned before landing page ships | Provision `demo` tenant via superadmin + AI seeding as part of Phase 12 |
| Sitemap | `sitemap.ts` queries all tenants → leaks tenant roster | Sitemap lists only marketing routes |

---

## Acceptance Criteria by Phase

### Phase 12 (Landing Page Build)

- [ ] Reserved path list exists in `src/middleware.ts` and `src/app/api/onboarding/route.ts` — covers all marketing sections and locale prefixes (`pt`, `en`, `pricing`, `features`, `about`, `demo`, `faq`).
- [ ] Middleware bypass for marketing routes implemented — requests to `/` do NOT trigger `supabase.auth.getUser()`.
- [ ] `demo` tenant provisioned in production: `is_active: true`, has a default menu with categories and products seeded via AI tools.
- [ ] CTA flow verified end-to-end in production: `/` → `/auth/register` → email confirm → `/onboarding` → `/dashboard`.
- [ ] Hero section is a Server Component — `'use client'` does not appear in any above-the-fold component.
- [ ] `Inter` font configured with `display: 'swap'`.
- [ ] Lighthouse mobile performance ≥ 90 (preliminary gate before Phase 13 SEO tuning).

### Phase 13 (SEO + Analytics)

- [ ] `metadataBase` set in root layout.
- [ ] OG image `Content-Length` verified under 300 KB via `curl -I`.
- [ ] OG image tested in WhatsApp — preview image renders.
- [ ] JSON-LD validated at Google Rich Results Test — no errors.
- [ ] JSON-LD does NOT appear in view-source of `/{tenantSlug}` or `/auth/*` pages.
- [ ] `sitemap.xml` contains only marketing URLs — no tenant slugs.
- [ ] `robots.txt` disallows `/dashboard`, `/settings`, `/tenants`, `/overview`, `/api/`.
- [ ] Lighthouse mobile performance ≥ 95 (final gate).
- [ ] Vercel Analytics and Speed Insights active and reporting in Vercel dashboard.

---

## "Looks Done But Isn't" Checklist

- [ ] **Namespace collision:** Register a tenant named "Pricing" via onboarding — confirm slug is forced to `pricing-{suffix}` and visiting `/pricing` shows the marketing pricing section, not a tenant menu.
- [ ] **Middleware bypass:** Check Vercel function logs — `/` requests do NOT show `updateSession` Supabase call entries.
- [ ] **OG image WhatsApp:** Paste production URL into WhatsApp (real device, not simulator) — image preview renders.
- [ ] **JSON-LD isolation:** View source of `xmartmenu.skale.club/demo` — confirm no `application/ld+json` block appears.
- [ ] **Demo tenant health:** Visit `xmartmenu.skale.club/demo` from incognito browser — a real-looking menu with products and images renders.
- [ ] **CTA flow end-to-end:** Complete full registration and onboarding from the production landing page in under 5 minutes.
- [ ] **i18n static:** `next build` output shows `/pt` and `/en` as `○` (static), not `λ` (dynamic).
- [ ] **Font CLS:** Lighthouse mobile CLS score < 0.05.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Steps if Shipped Broken |
|---------|---------------|-------------------------|
| Tenant slug collision (tenant already named "pricing") | MEDIUM | Rename offending tenant slug in DB; add reserved path guard to prevent recurrence; 301 redirect if the tenant had distributed QR codes |
| Middleware TTFB — Lighthouse below 90 | LOW | Add bypass in middleware (one-line fix); redeploy; rescore |
| OG image too large — no WhatsApp preview | LOW | Replace with static JPEG under 100 KB; redeploy; test in WhatsApp |
| JSON-LD on wrong pages | LOW | Move `<script>` from `layout.tsx` to `page.tsx`; redeploy |
| Demo tenant 404 | LOW | Provision tenant via superadmin panel; activate; add content via AI seeding |
| CTA flow broken in production | HIGH | Requires debugging Supabase Auth email templates, redirect URLs, and CORS config in Supabase dashboard — plan 2–4 hours; do not ship without pre-launch CTA walkthrough |

---

## Sources

### Primary (HIGH confidence — verified against live codebase)
- `src/middleware.ts` + `src/lib/supabase/middleware.ts` — `getUser()` runs on all routes including `/`; no marketing bypass exists
- `src/app/(public)/[slug]/page.tsx` — `[slug]` catches any first-segment path; no reserved path check
- `src/app/api/onboarding/route.ts` — `slugify()` does not filter reserved words; only deduplicates against existing DB tenants
- `src/lib/utils.ts` — `slugify()` confirmed: no reserved word list
- `src/app/layout.tsx` — `metadataBase` not set; `Inter` missing `display` option

### Primary (HIGH confidence — official docs)
- [Next.js opengraph-image file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image)
- [Next.js JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld)
- [Next.js sitemap.xml](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Next.js robots.txt](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots)
- [Next.js internationalization guide](https://nextjs.org/docs/app/guides/internationalization)
- [next-intl App Router setup](https://next-intl.dev/docs/getting-started/app-router)

### Secondary (MEDIUM confidence — verified GitHub issues)
- [vercel/next.js #60366 — ImageResponse PNG too heavy for WhatsApp (300 KB limit)](https://github.com/vercel/next.js/discussions/60366)
- [vercel/next.js #80088 — JSON-LD hydration duplication in App Router with next/script](https://github.com/vercel/next.js/discussions/80088)
- [supabase/discussions #20905 — getUser() in middleware causes latency](https://github.com/orgs/supabase/discussions/20905)

### Secondary (MEDIUM confidence — community, multiple sources agree)
- [WhatsApp OG pitfalls with Next.js](https://medium.com/@eduardojs999/how-to-use-whatsapp-open-graph-preview-with-next-js-avoiding-common-pitfalls-88fea4b7c949)
- [next-intl setRequestLocale requirement for static generation](https://next-intl.dev/docs/routing/configuration)
- [Achieving 95+ Lighthouse on Next.js 15](https://medium.com/@sureshdotariya/achieving-95-lighthouse-scores-in-next-js-15-modern-web-application-part1-e2183ba25fc1)

---

*Pitfalls research for: v1.3 Marketing Landing Page — xmartmenu.skale.club*  
*Researched: 2026-05-07*
