# Pitfalls Research — v1.3 Landing Page

**Domain:** Adding a marketing landing page to an existing Next.js 16.2 App Router multi-tenant SaaS  
**Researched:** 2026-05-07  
**Confidence:** HIGH (routing and middleware verified against live codebase; OG/i18n/JSON-LD pitfalls cross-referenced with official Next.js docs and verified GitHub issues)

---

## Executive Summary

The v1.3 landing page looks simple — one static page at `/` — but it shares a namespace with every tenant slug (`/{slug}`), runs inside a middleware that calls Supabase Auth on every request, and must hit Lighthouse 95+ on mobile while living inside a codebase full of client-heavy SaaS code. The six risk areas below are not hypothetical; they are the exact failure modes that trip production teams adding marketing pages to existing multi-tenant Next.js apps.

**The single highest-risk pitfall for this project:** middleware runs `supabase.auth.getUser()` (a network call to Supabase Auth) on every request — including the landing page at `/`. Without an explicit middleware bypass for public marketing routes, every visitor to `xmartmenu.skale.club` pays a Supabase round-trip before the page loads, killing both LCP and Lighthouse scores.

---

## Pitfall 1: Tenant Slug Namespace Collision

### What Goes Wrong

The public menu route `src/app/(public)/[slug]/page.tsx` matches any single-segment path, including `/pricing`, `/about`, `/features`, `/demo`, `/pt`, `/en`. A restaurant owner who names their company "Pricing" would get the slug `pricing` via `slugify()`, and `xmartmenu.skale.club/pricing` would serve their restaurant menu instead of the landing page pricing section. More critically, the `i18n` locale prefixes (`/pt`, `/en`) are themselves top-level paths that would resolve to the `[slug]` route if a tenant with that slug exists.

**Verified in codebase:** `src/app/(public)/[slug]/page.tsx` calls `getTenantBySlug(slug)` and returns `notFound()` if no tenant exists — but it does NOT check whether the slug is a reserved marketing path. There is no reserved path list anywhere in the codebase.

### Why It Happens

App Router dynamic routing resolves in specificity order: static routes beat dynamic ones. So `/pricing` as a page file would win over `[slug]`. But if the landing page uses `#pricing` hash sections (single-page layout) rather than `/pricing` as a distinct route, there is no static file to win the race — any tenant named "pricing" takes the path.

The `slugify()` function in `src/lib/utils.ts` does not filter reserved words. The onboarding API (`src/app/api/onboarding/route.ts`) only deduplicates slugs that already exist in the `tenants` table — not against a reserved word list.

### How to Avoid

**In middleware (`src/middleware.ts`):** Add a `RESERVED_PATHS` set and redirect any slug that matches before the `[slug]` route handler gets the request:

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
  // Let the request pass through to static route — do NOT treat as tenant slug
  // No redirect needed; just skip tenant-auth logic for this path
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

**Verified in codebase:** `src/lib/supabase/middleware.ts` line 34 calls `supabase.auth.getUser()` with no path exclusion. The landing page at `/` is not in any bypass list.

### Why It Happens

The middleware was designed for app routes (admin, superadmin, auth flows). The landing page didn't exist when it was written. The "allow app boot without Supabase configured" guard (lines 11–13) bypasses the call only when `NEXT_PUBLIC_SUPABASE_URL` is missing, which will never be true in production.

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

The public tenant menu routes (`/{slug}`) also do not need auth — they use `createServiceClient` (service role key), not user session. Consider whether those also need a bypass. At minimum the marketing routes must be excluded.

### Warning Signs

- Vercel function logs show `updateSession` executing for every `/` request.
- Lighthouse TTFB is consistently above 500ms in lab tests despite the page being "static."
- Chrome DevTools Network shows the first document request taking longer than expected before any HTML bytes arrive.

### Phase to Address

Phase 12 (Landing Page Build) — must be patched before Lighthouse measurement. Blocking for performance target.

---

## Pitfall 3: OG Image Too Heavy for WhatsApp Sharing

### What Goes Wrong

Next.js `ImageResponse` (used in `opengraph-image.tsx`) generates PNG by default. A 1200×630 PNG for a landing page with background imagery and text can easily exceed 1 MB. WhatsApp has a hard 300 KB OG image size limit. Images over 300 KB are silently discarded by WhatsApp — the link preview shows no image at all. Since the primary audience is Brazilian restaurateurs who share links almost exclusively via WhatsApp, a landing page with no WhatsApp preview is a missed acquisition opportunity.

**Verified:** GitHub Discussion [#60366](https://github.com/vercel/next.js/discussions/60366) confirms: "When generating images at recommended resolution of 1200x630 with background image, the output image size is usually over 1MB, which prevents use by apps like WhatsApp that has a size limit of 300kb."

### Why It Happens

`ImageResponse` was designed for generic OG images and defaults to PNG for lossless rendering fidelity. Developers test OG previews with tools like ogcheck.com or opengraph.xyz (which follow the spec without size limits) but never test in WhatsApp itself. WhatsApp's silent drop behavior means the issue is invisible in testing.

### How to Avoid

**Option A (preferred):** Use a static OG image file instead of `ImageResponse`. A carefully designed 1200×630 JPEG or WebP exported from a design tool can be under 100 KB. Place as `src/app/opengraph-image.jpg` (Next.js auto-generates the tag). Avoids the PNG overhead entirely.

**Option B:** If using `ImageResponse` for dynamic generation, keep it pure CSS with no background images and limit to flat colors + text. Text-only ImageResponse outputs stay well under 100 KB.

**Never do:** Background images inside `ImageResponse` — they are embedded as base64 inside the PNG, ballooning file size.

**Test requirement:** Before shipping, verify OG image size with `curl -I` on the generated URL and confirm the `Content-Length` header is under 300 KB. Also paste the landing page URL into WhatsApp and confirm the preview appears.

```bash
# Check OG image size
curl -I https://xmartmenu.skale.club/opengraph-image | grep -i content-length

# Must be under 300000 bytes (300 KB)
```

Also set `metadataBase` in `src/app/layout.tsx` — without it, Next.js emits a warning and OG image URLs are relative (break on external crawlers):

```typescript
export const metadata: Metadata = {
  metadataBase: new URL('https://xmartmenu.skale.club'),
  // ...
}
```

### Warning Signs

- WhatsApp link preview for the landing page shows no image (but Facebook/Twitter/Telegram show it fine).
- `curl -I` on the OG image URL shows `Content-Length` above 300000.
- `opengraph-image.tsx` uses `fetch()` to embed an image inside `ImageResponse`.

### Phase to Address

Phase 13 (SEO + Analytics) — acceptance criterion: OG image verified in WhatsApp before Phase 13 is marked complete.

---

## Pitfall 4: Lighthouse Budget Broken by Middleware, Fonts, or Client Components

### What Goes Wrong

The landing page is statically generated but still scores below 90 on mobile Lighthouse because of compounding penalties:

1. **Middleware TTFB penalty** (see Pitfall 2) — 50–200ms before any HTML byte.
2. **Inter font from Google Fonts loaded at runtime** — if `next/font` is not configured correctly, the font request hits Google's servers at render time instead of being self-hosted at build time, adding a third-party round trip and CLS.
3. **Client components in hero section** — any `'use client'` in the above-the-fold area forces JavaScript to be downloaded and executed before the hero becomes interactive, raising TBT and INP.
4. **`@vercel/analytics` and `@vercel/speed-insights` adding render-blocking scripts** — both packages ship a `<script>` tag; if not deferred/isolated, they block paint.
5. **Tailwind CSS unused styles not purged** — the full Tailwind 4 stylesheet applied to the landing page includes SaaS admin styles (tables, forms, modals) not present on the landing page, inflating CSS payload.

**Verified in codebase:** `src/app/layout.tsx` currently uses `Inter({ subsets: ['latin'] })` — correct pattern, but `display` option is not set. The root layout applies to all routes including the marketing page; the SaaS admin JavaScript bundles could bleed into the landing page if they share the same layout.

### How to Avoid

**Font:** Confirm `display: 'swap'` and `preload: true` in the Inter config. Next.js 16 self-hosts Google Fonts at build time, eliminating the third-party request, but `display` must be explicit:

```typescript
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})
```

**Zero above-the-fold client JS:** The hero section, nav, and first feature block must be Server Components. No `'use client'` above the fold. CTA button can be a simple `<a href="/auth/register">` — no state needed.

**Analytics isolation:** Add Vercel Analytics and Speed Insights in a `<Suspense>` boundary or as the last children in the root layout body, not inline in the hero. Both packages are lightweight but should not block initial paint.

**Separate marketing layout:** Create `src/app/(marketing)/layout.tsx` so the landing page does not inherit the full SaaS admin CSS/JS bundle. The root `src/app/layout.tsx` should remain minimal (font, globals.css) and the marketing layout adds only what marketing pages need.

**Measurement gate:** Run Lighthouse before marking Phase 12 or 13 complete:

```bash
npx lighthouse https://xmartmenu.skale.club --preset=perf --form-factor=mobile --output=json | jq '.categories.performance.score'
# Must be >= 0.95
```

### Warning Signs

- Lighthouse shows TBT above 200ms (client JS executing above the fold).
- LCP element is the hero image but takes more than 2.5s (not preloaded or too large).
- CLS score above 0.05 (font or image without dimensions causing layout shift).
- `next build` output shows the landing page bundle size above 80 KB (gzipped).

### Phase to Address

Phase 12 (Landing Page Build) — performance must be built in, not retrofitted. Phase 13 (SEO + Analytics) — final Lighthouse gate before marking milestone complete.

---

## Pitfall 5: JSON-LD Conflicts with Existing Root Layout Metadata

### What Goes Wrong

Two JSON-LD `<script>` tags with conflicting or duplicate schema types appear on the same page because:

1. The root `src/app/layout.tsx` already exports `metadata` with `title` and `description`. If JSON-LD `Organization` schema is added to the root layout and the landing page also exports `SoftwareApplication` schema via `generateMetadata`, Google's Rich Results Test flags "multiple top-level entities" and ignores both.

2. The tenant public menu pages at `src/app/(public)/[slug]/page.tsx` use `generateMetadata` with `openGraph`. If JSON-LD is also added to that route (e.g., a `Restaurant` schema), two `<script type="application/ld+json">` tags appear — one from the root layout and one from the page — which is valid but requires the schemas to be designed to not conflict.

3. In App Router, JSON-LD added to a Server Component body is included in the HTML and does NOT get duplicated on hydration (unlike scripts added via `<Script>`). Using `next/script` for JSON-LD is wrong and causes double-rendering.

**Verified:** GitHub Discussion [#80088](https://github.com/vercel/next.js/discussions/80088) confirms the hydration duplication issue specifically for JSON-LD in App Router.

### How to Avoid

**Rule:** JSON-LD belongs in the page file body as an inline `<script>`, never in `layout.tsx`, never via `next/script`:

```tsx
// src/app/page.tsx (landing page)
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
      {/* ... page content */}
    </>
  )
}
```

**Validation requirement:** Test structured data at [https://search.google.com/test/rich-results](https://search.google.com/test/rich-results) before Phase 13 is complete. Both schemas must validate without errors.

**Do not add JSON-LD to `src/app/layout.tsx`** — the root layout applies to tenant menu pages, auth pages, and admin pages, causing Organization schema to appear on every page in the app.

### Warning Signs

- `<script type="application/ld+json">` appears twice in the page HTML (view source).
- Google's Rich Results Test shows "Multiple entities detected" warning.
- JSON-LD appears on `/{tenantSlug}` menu pages (leaked from root layout).
- `dangerouslySetInnerHTML` is not used — the JSON is rendered as text content instead of raw HTML, breaking the script tag.

### Phase to Address

Phase 13 (SEO + Analytics) — validated before marking complete.

---

## Pitfall 6: CTA Flow Breaks Before Landing Page Ships

### What Goes Wrong

The landing page hero "Get started" CTA points to `/auth/register`. The full conversion flow is:

```
/ (landing) → /auth/register → email confirm → /auth/callback → /onboarding → /dashboard
```

If any link in this chain is broken, the landing page actively harms conversion rather than helping it — it raises a prospect's expectations and then fails to deliver. Specific break points in the current codebase:

1. **`/auth/register` has no link back to the landing page** — after registering, the "Back to menu" link on the success screen goes to `from` which defaults to `'/'`, which currently redirects to `/auth/login` (the old `src/app/page.tsx`). When the landing page replaces the redirect, this becomes correct — but it must be tested explicitly.

2. **Email confirmation loop** — `src/app/api/auth/register/route.ts` sends a confirmation email with `emailRedirectTo: ${origin}/auth/callback?next=...`. In local dev, `origin` is `localhost:3000`, producing a callback URL that fails in production testing. This is not a launch blocker but can confuse pre-launch E2E testing.

3. **Onboarding → dashboard flow** — `src/app/onboarding/page.tsx` uses client-side `useEffect` to check auth. If email is not confirmed (user skips confirmation and tries to access `/onboarding` directly), the `supabase.auth.getUser()` call returns null and the page redirects to `/auth/login`. This is correct behavior, but the landing page copy must set accurate expectations ("check your email to confirm, then complete your store setup").

4. **`/demo` tenant must exist before the landing page links to it** — the landing page should link to a live demo at `xmartmenu.skale.club/demo`. If the `demo` tenant has no menus or is `is_active: false`, the public menu route returns `notFound()`. A visitor who clicks "See a live demo" and gets a 404 or blank page is worse than not having a demo link.

### How to Avoid

**Before shipping Phase 12:** Walk the full CTA flow in a staging/preview environment:
1. Visit `/`, click "Get started" → lands on `/auth/register` ✓
2. Complete registration → success screen shows ✓
3. Confirm email → `/auth/callback` redirects to `/onboarding` ✓
4. Complete onboarding → `/dashboard` accessible ✓
5. Visit `/{new_tenant_slug}` → public menu renders ✓

**Demo tenant checklist:** The `demo` tenant in the DB must have:
- `is_active: true`
- At least one active menu with `is_default: true`
- At least one active category and one available product
- A cover image (tenant_settings logo_url) so the menu page looks populated

Provision the demo tenant via the superadmin panel using the AI seeding tools (already shipped in v1.2) to guarantee it looks realistic without manual data entry.

**Fallback for demo link:** If the demo tenant cannot be guaranteed to stay healthy, link to a specific tenant+menu path (`/demo/main-menu`) instead of just `/demo` — the two-segment path goes to `src/app/(public)/[slug]/[menuSlug]/page.tsx`, which has its own data fetching and is less likely to return a bare 404.

**Do not ship** the landing page until the CTA flow is verified end-to-end in the production environment (not just local dev). Supabase Auth email templates, redirect URLs, and CORS settings differ between environments.

### Warning Signs

- Clicking "Get started" on the landing page in production lands on `/auth/login` (the old redirect — means `src/app/page.tsx` was not properly replaced).
- The demo link returns a Next.js 404 page (demo tenant not provisioned or not active).
- Email confirmation link in the registration success email goes to `localhost:3000` (origin detection wrong in production).
- Onboarding page shows "Loading..." indefinitely after email confirmation (session not established correctly by `/auth/callback`).

### Phase to Address

Phase 12 (Landing Page Build) — CTA flow verification is a gate criterion, not a nice-to-have. Demo tenant must be provisioned as part of Phase 12. Phase 13 does not start until the CTA flow passes.

---

## Pitfall 7: i18n Route Group Collides With `[slug]` Dynamic Route

### What Goes Wrong

The planned i18n pattern uses path-based locale prefixes (`/pt`, `/en`). In Next.js App Router, the canonical structure is a `[locale]` route group: `src/app/[locale]/page.tsx`. This creates an immediate conflict: the existing `src/app/(public)/[slug]/page.tsx` matches any first-segment path, including `/pt` and `/en`, before the `[locale]` route can match.

Next.js resolves segment specificity as: static routes > route groups (parenthesized) > dynamic `[param]` routes. Because `(public)` is a route group (not a segment), the `[slug]` dynamic route inside it competes at the root level with `[locale]`. If both `[locale]` and `[slug]` resolve at the root, Next.js will throw a route conflict error at build time.

**Architecture implication:** The i18n route group and the tenant slug route cannot both be dynamic segments at the same level. One must be scoped differently.

### How to Avoid

**Option A (recommended for this project):** Scope the marketing i18n to a route group that does NOT conflict with the public tenant routes:

```
src/app/
├── (marketing)/          # Route group — no URL segment
│   ├── [locale]/         # /pt, /en (static locale list, not dynamic)
│   │   └── page.tsx      # Landing page in locale
│   └── page.tsx          # / (default, redirects to /pt or /en, or renders EN)
├── (public)/
│   └── [slug]/           # /{tenantSlug} — existing, unchanged
│       └── page.tsx
```

**Option B (simpler):** Keep the landing page at `/` with no locale in the URL. Use a language toggle component that stores the preference in a cookie. Simpler routing, no conflict, but URLs are not locale-specific (worse for SEO with PT/EN audiences).

**If using next-intl:** Follow the `setRequestLocale` pattern for static generation. Without it, every locale page falls back to dynamic rendering:

```typescript
// src/app/(marketing)/[locale]/page.tsx
import { setRequestLocale } from 'next-intl/server'

export function generateStaticParams() {
  return [{ locale: 'pt' }, { locale: 'en' }]
}

export default function LandingPage({ params: { locale } }) {
  setRequestLocale(locale) // Required for static generation
  // ...
}
```

**In middleware:** Explicitly match locale prefixes before they reach the `[slug]` handler. The reserved path list from Pitfall 1 must include `'pt'` and `'en'`.

### Warning Signs

- `next build` throws "You cannot use the same segment name twice in the same route" or similar route conflict.
- Visiting `/pt` returns a tenant menu page (demo tenant with slug `pt`) instead of the Portuguese landing page.
- `generateStaticParams` is missing — the locale pages are dynamically rendered instead of statically generated, hurting Lighthouse.

### Phase to Address

Phase 12 (Landing Page Build) — architecture decision (Option A or B) must be made before any routing code is written.

---

## Pitfall 8: `sitemap.ts` Lists Tenant URLs but Tenant Slugs Are Private Data

### What Goes Wrong

A `src/app/sitemap.ts` that automatically enumerates all active tenants and lists `/{slug}` URLs in the sitemap leaks the existence and slugs of all tenant restaurants — including restaurants that have not publicly announced their digital menu, restaurants still in onboarding, and internal test tenants. A competitor or data harvester can extract the complete tenant list from the public sitemap.

Additionally, tenant menu pages already have their own metadata (via `generateMetadata` in `(public)/[slug]/page.tsx`) and are indexed individually by crawlers visiting them. Adding them to the sitemap provides marginal SEO benefit but measurable privacy cost.

### How to Avoid

**Landing page sitemap only:** `src/app/sitemap.ts` should list only marketing URLs:

```typescript
// src/app/sitemap.ts
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://xmartmenu.skale.club/', lastModified: new Date(), priority: 1.0 },
    { url: 'https://xmartmenu.skale.club/pt', lastModified: new Date(), priority: 0.9 },
    { url: 'https://xmartmenu.skale.club/en', lastModified: new Date(), priority: 0.9 },
  ]
}
```

Do not query the `tenants` table from `sitemap.ts`. Tenant menus are public but are not the platform's SEO content — restaurant owners have their own QR code distribution strategy.

**`robots.txt`:** Explicitly disallow admin, superadmin, and API routes:

```typescript
// src/app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', disallow: ['/dashboard', '/settings', '/tenants', '/overview', '/api/'] },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: 'https://xmartmenu.skale.club/sitemap.xml',
  }
}
```

### Warning Signs

- `sitemap.xml` contains URLs for active tenants like `xmartmenu.skale.club/pizza-joe`.
- A competitor can extract all tenant slugs by fetching the sitemap.
- Internal test tenants (slug: `test`, `demo2`, `qa-restaurant`) appear in the sitemap.

### Phase to Address

Phase 13 (SEO + Analytics).

---

## Integration Gotchas Quick Reference

| Area | Common Mistake | Correct Approach |
|------|---------------|------------------|
| Middleware | `supabase.auth.getUser()` fires on every request including `/` | Add public-path bypass before any Supabase call; marketing routes return `NextResponse.next()` immediately |
| Tenant namespace | Landing page sections at `/pricing`, `/about` don't exist as page files | Create `src/app/pricing/page.tsx` etc. OR keep single-page layout with hash sections but guard reserved slugs at middleware + onboarding API |
| OG image | `ImageResponse` with background image > 300 KB → silent WhatsApp drop | Use static `.jpg` or pure-CSS `ImageResponse`; verify with `curl -I` before shipping |
| OG image | `metadataBase` not set → relative OG URLs that crawlers can't resolve | Set `metadataBase: new URL('https://xmartmenu.skale.club')` in root layout metadata |
| JSON-LD | Added to `layout.tsx` → appears on every page including tenant menus | JSON-LD only in page files, inline `<script dangerouslySetInnerHTML>`, never via `next/script` |
| i18n | `[locale]` route group at root conflicts with `[slug]` dynamic route | Use `(marketing)/[locale]/` route group to keep i18n scoped to marketing |
| i18n | Missing `setRequestLocale()` → locale pages fall back to dynamic rendering | Call `setRequestLocale(locale)` at top of every page and layout that uses translations |
| Performance | Hero section uses `'use client'` for animation or state | Server Component hero; move interactivity to below-the-fold; CTA is a plain `<a>` tag |
| Performance | Vercel Analytics/Speed Insights added as blocking scripts | Wrap in `<Suspense>`, add as last children in body; both packages are async by default |
| CTA flow | Demo tenant slug not provisioned before landing page ships | Provision `demo` tenant via superadmin + AI seeding before Phase 12 is marked complete |
| Sitemap | `sitemap.ts` queries all tenants → leaks tenant list | Sitemap lists only marketing routes (`/`, `/pt`, `/en`) |
| Font | Inter font with no `display: 'swap'` → FOIT or CLS | `Inter({ subsets: ['latin'], display: 'swap', preload: true })` |

---

## Acceptance Criteria by Phase

### Phase 12 (Landing Page Build)

- [ ] Reserved path list (`RESERVED_PATHS`) added to `src/middleware.ts` and `src/app/api/onboarding/route.ts` — includes all marketing section paths and locale prefixes.
- [ ] Middleware bypass for marketing routes implemented — `/` request does not trigger `supabase.auth.getUser()`.
- [ ] `demo` tenant provisioned in production DB: `is_active: true`, has default menu with categories and products.
- [ ] CTA flow verified end-to-end in production: `/` → `/auth/register` → email confirm → `/onboarding` → `/dashboard`.
- [ ] Hero section is a Server Component — no `'use client'` above the fold.
- [ ] Landing page Lighthouse mobile performance ≥ 90 (preliminary gate before Phase 13 SEO tuning).

### Phase 13 (SEO + Analytics)

- [ ] `metadataBase` set to `https://xmartmenu.skale.club` in root layout.
- [ ] OG image file size verified under 300 KB via `curl -I`.
- [ ] OG image preview tested by pasting landing page URL into WhatsApp — image renders.
- [ ] JSON-LD validated at [https://search.google.com/test/rich-results](https://search.google.com/test/rich-results) — no errors.
- [ ] JSON-LD does NOT appear on `/{tenantSlug}` or `/auth/*` pages.
- [ ] `sitemap.xml` contains only marketing URLs — no tenant slugs.
- [ ] `robots.txt` disallows `/dashboard`, `/settings`, `/tenants`, `/overview`, `/api/`.
- [ ] Lighthouse mobile performance ≥ 95 (final gate).
- [ ] Vercel Analytics and Speed Insights added and reporting in dashboard.

---

## "Looks Done But Isn't" Checklist

- [ ] **Namespace collision:** Verify by attempting to register a tenant named "Pricing" via onboarding — confirm slug is forced to `pricing-{suffix}` and `/pricing` marketing route is unaffected.
- [ ] **Middleware bypass:** Verify with Vercel function logs that `/` requests do NOT appear in `updateSession` Supabase call logs.
- [ ] **OG image WhatsApp:** Paste the production URL into WhatsApp (not a WhatsApp Business simulator) and confirm the image appears.
- [ ] **JSON-LD isolation:** View source on `xmartmenu.skale.club/demo` — confirm no `application/ld+json` tag from the marketing page appears on the tenant menu page.
- [ ] **Demo tenant:** Visit `xmartmenu.skale.club/demo` from an incognito browser — confirm a real-looking menu renders with products and images.
- [ ] **CTA flow:** From the production landing page, complete the full registration and onboarding in under 5 minutes.
- [ ] **i18n static:** Run `next build` and confirm `/pt` and `/en` appear in the build output as static pages (not dynamic).
- [ ] **Font:** Run Lighthouse mobile and confirm CLS score < 0.05 (no layout shift from Inter font loading).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Steps if Shipped Broken |
|---------|---------------|-------------------------|
| Tenant slug collision (a tenant already named "pricing") | MEDIUM | Rename the offending tenant's slug in DB; add reserved path guard to prevent recurrence; 301 redirect from `/pricing/{old-slug}` if the tenant had printed QR codes |
| Middleware TTFB — Lighthouse below 90 | LOW | Add bypass in middleware (one-line fix); redeploy; rescore |
| OG image too large — no WhatsApp preview | LOW | Replace with static JPEG under 100 KB; redeploy; test in WhatsApp |
| JSON-LD on wrong pages | LOW | Move `<script>` from `layout.tsx` to `page.tsx`; redeploy |
| Demo tenant 404 | LOW | Provision tenant via superadmin panel; activate; add content via AI seeding |
| CTA flow broken in production | HIGH | Requires debugging Supabase Auth email settings, redirect URLs, and CORS config — plan 2–4 hours to resolve; do not ship without pre-launch CTA walkthrough |

---

## Sources

### Primary (HIGH confidence — verified against live codebase)
- `src/middleware.ts` + `src/lib/supabase/middleware.ts` — middleware runs `getUser()` on all routes including `/`; no marketing bypass exists
- `src/app/(public)/[slug]/page.tsx` — `[slug]` catches any first-segment path; no reserved path check
- `src/app/api/onboarding/route.ts` — `slugify()` does not filter reserved words; only deduplicates against existing DB tenants
- `src/lib/utils.ts` — `slugify()` implementation confirmed: no reserved word list
- `src/app/layout.tsx` — `metadataBase` not currently set; `Inter` font missing `display` option

### Primary (HIGH confidence — official docs)
- [Next.js opengraph-image file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image)
- [Next.js JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld)
- [Next.js sitemap.xml](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Next.js robots.txt](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots)
- [Next.js internationalization guide](https://nextjs.org/docs/app/guides/internationalization)
- [next-intl static rendering / setRequestLocale](https://next-intl.dev/docs/getting-started/app-router)

### Secondary (MEDIUM confidence — verified GitHub issues)
- [next.js #60366 — ImageResponse PNG too heavy for WhatsApp](https://github.com/vercel/next.js/discussions/60366)
- [next.js #80088 — JSON-LD hydration duplication in App Router](https://github.com/vercel/next.js/discussions/80088)
- [supabase/discussions #20905 — getUser() in middleware causes lag](https://github.com/orgs/supabase/discussions/20905)

### Secondary (MEDIUM confidence — community, multiple sources agree)
- [WhatsApp OG pitfalls with Next.js](https://medium.com/@eduardojs999/how-to-use-whatsapp-open-graph-preview-with-next-js-avoiding-common-pitfalls-88fea4b7c949)
- [next-intl setRequestLocale requirement for static generation](https://next-intl.dev/docs/routing/configuration)
- [Achieving 95+ Lighthouse on Next.js 15](https://medium.com/@sureshdotariya/achieving-95-lighthouse-scores-in-next-js-15-modern-web-application-part1-e2183ba25fc1)

---

*Pitfalls research for: v1.3 Marketing Landing Page — xmartmenu.skale.club*  
*Researched: 2026-05-07*
