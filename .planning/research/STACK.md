# Stack Research — v1.3 Landing Page (NEW Capabilities Only)

**Researched:** 2026-05-07
**Domain:** Marketing landing page — Vercel Analytics, JSON-LD, sitemap/robots, OG image, middleware reserved paths
**Confidence:** HIGH (all versions verified from npm registry and official Vercel/Next.js docs as of 2026-05-07)

## Context

This is a SUBSEQUENT MILESTONE on an existing Next.js 16.2 + Supabase + Vercel app. The existing stack (App Router, TypeScript, Tailwind CSS 4, Supabase RLS, Sharp, ISR, metadata API) is validated and NOT reconsidered here. This document covers ONLY the new capabilities needed for v1.3.

**No i18n packages are needed.** The landing page will be English-only. The PROJECT.md mentions PT/EN as a goal, but the milestone scope narrows this: copy will be written in English (and Portuguese inline in JSX if needed as static strings). No `next-intl` or path-based locale routing (`/pt`, `/en`) is in scope for this milestone.

---

## New Packages to Add

### Core (runtime dependencies)

| Package | Version (verified) | Purpose | Why This, Not Alternative |
|---------|-------------------|---------|--------------------------|
| `@vercel/analytics` | `2.0.1` | Page view tracking + custom events | First-party, zero-config on Vercel; adds `<Analytics />` component to root layout; no GDPR consent gate needed for aggregate analytics (no PII stored) |
| `@vercel/speed-insights` | `2.0.0` | Real-user Web Vitals (CLS, LCP, FID, INP) | Pairs with Analytics in same Vercel dashboard; `<SpeedInsights />` in root layout; needed for Lighthouse 95+ goal monitoring post-launch |
| `schema-dts` | `2.0.0` | TypeScript types for schema.org JSON-LD | Dev-time type safety for `Organization` + `SoftwareApplication` objects; zero runtime footprint — types only, stripped at build |

**Installation:**

```bash
npm install @vercel/analytics @vercel/speed-insights
npm install --save-dev schema-dts
```

### No New Packages Needed For

| Feature | Approach | Reason |
|---------|----------|--------|
| `sitemap.xml` | `app/sitemap.ts` (built-in Next.js convention) | No external package — Next.js generates sitemap natively from `MetadataRoute.Sitemap` |
| `robots.txt` | `app/robots.ts` (built-in Next.js convention) | Same — native `MetadataRoute.Robots` type, no package |
| OG image | Static file `app/opengraph-image.png` OR `app/opengraph-image.tsx` using `ImageResponse` from `next/og` | `next/og` is bundled with Next.js; no install needed |
| JSON-LD | Inline `<script type="application/ld+json">` in server component | Official Next.js recommendation; no library needed |
| Reserved paths middleware | Extend existing `src/middleware.ts` | Already has Supabase auth middleware; add slug blocklist check in same file |
| Metadata (title, OG tags, Twitter) | Existing `metadata` export API | Already in use in `src/app/(public)/[slug]/page.tsx` and `src/app/layout.tsx` |

---

## Integration Patterns (App Router, Next.js 16.2)

### 1. Vercel Analytics + Speed Insights

**Location:** `src/app/layout.tsx` (root layout, affects all pages)

**Import paths (verified from official Vercel docs):**
- Analytics: `import { Analytics } from '@vercel/analytics/next'`
- Speed Insights: `import { SpeedInsights } from '@vercel/speed-insights/next'`

**Pattern:**

```tsx
// src/app/layout.tsx
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className={`${inter.className} min-h-full`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
```

**Prerequisites:**
- Enable Web Analytics in Vercel dashboard (Analytics tab → Enable)
- Enable Speed Insights in Vercel dashboard (Speed Insights tab → Enable)
- Both add routes at `/_vercel/insights/*` after next deploy — no env vars needed

**Important:** Use `/next` subpath imports, not `/react`. The `/next` entrypoint includes App Router route-change detection. Using the wrong subpath breaks page-view tracking on client-side navigation.

---

### 2. JSON-LD Structured Data

**Official pattern (from nextjs.org/docs/app/guides/json-ld, verified 2026-05-07):**

Use a native `<script>` tag — NOT `next/script`. `next/script` is for executable JS; JSON-LD is structured data.

```tsx
// src/app/page.tsx (landing page server component)
import type { WithContext, Organization, SoftwareApplication } from 'schema-dts'

export default function LandingPage() {
  const organization: WithContext<Organization> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'XmartMenu',
    url: 'https://xmartmenu.skale.club',
    description: 'Digital menu platform for restaurants via QR code',
  }

  const software: WithContext<SoftwareApplication> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'XmartMenu',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organization).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(software).replace(/</g, '\\u003c'),
        }}
      />
      {/* page content */}
    </>
  )
}
```

**Security note:** The `.replace(/</g, '\\u003c')` call is mandatory — `JSON.stringify` does not sanitize `<` characters, which enables XSS if any string field contains HTML. This is the pattern from the official Next.js guide.

**Do NOT use** `next/script` for JSON-LD — it delays injection and can produce duplicates in RSC hydration.

---

### 3. sitemap.ts

**Convention:** `src/app/sitemap.ts` — Next.js generates `/sitemap.xml` automatically.

```typescript
// src/app/sitemap.ts
import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://xmartmenu.skale.club',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    // Add /demo, /pricing anchor sections as separate entries if needed
  ]
}
```

**Key facts (verified from Next.js 16.2.5 docs):**
- File is a special Route Handler, cached by default at build time
- `MetadataRoute.Sitemap` type is imported from `'next'` — no external types needed
- Tenant URLs (`/{slug}`) are NOT included — tenant menus are not landing page content
- `generateSitemaps()` is available for large multi-sitemap scenarios — not needed here (single-page landing)

---

### 4. robots.ts

**Convention:** `src/app/robots.ts` — Next.js generates `/robots.txt` automatically.

```typescript
// src/app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/(admin)/', '/(superadmin)/'],
    },
    sitemap: 'https://xmartmenu.skale.club/sitemap.xml',
  }
}
```

**Key fact:** Cached at build time by default. No external package needed. `MetadataRoute.Robots` from `'next'`.

---

### 5. OG Image

Two valid approaches — choose based on design complexity:

**Option A — Static file (simplest, recommended for v1.3):**

Place `src/app/opengraph-image.png` (1200×630px) directly in the app directory. Next.js auto-generates `og:image` tags.

No code needed. No runtime cost. Fastest possible. Design the image in Figma/Canva, export as PNG, commit to repo.

**Option B — Generated via `opengraph-image.tsx` (if branded text overlay is needed):**

```tsx
// src/app/opengraph-image.tsx
import { ImageResponse } from 'next/og'

export const alt = 'XmartMenu — Digital menus for restaurants'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    <div style={{ background: '#0f172a', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ color: 'white', fontSize: 64 }}>XmartMenu</h1>
    </div>,
    { ...size }
  )
}
```

`ImageResponse` is from `next/og` — bundled with Next.js, no install needed.

**Recommendation:** Start with Option A (static PNG). Upgrade to Option B only if the static image needs to show dynamic data (it does not for a landing page).

---

### 6. Reserved Paths Middleware

**Problem:** `src/app/(public)/[slug]/page.tsx` catches ALL top-level paths. Pages like `/about`, `/pricing` (if added as separate routes later), and internal paths like `/api`, `/auth` must not be intercepted by the tenant resolver.

**Current App Router structure resolves this differently:** The `(public)` route group contains `[slug]` — but the landing page lives at `src/app/page.tsx` (root), not inside `(public)`. So the landing page at `/` does NOT conflict with `[slug]`.

**What does need middleware protection:** Specific slugs that would shadow reserved marketing paths or system routes. Since all marketing content lives on `/` (single page, no sub-routes), the risk is limited.

**Middleware pattern to add to `src/middleware.ts`:**

```typescript
// src/middleware.ts — extend updateSession call with blocklist
const RESERVED_SLUGS = new Set([
  'api', 'auth', 'onboarding', '_next', 'favicon.ico',
  'sitemap.xml', 'robots.txt',
  // Add 'demo' here if /demo is a dedicated page rather than a tenant slug
])

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const firstSegment = pathname.split('/')[1]

  if (firstSegment && RESERVED_SLUGS.has(firstSegment)) {
    // Let Next.js routing handle it — return early from Supabase session update
    // OR redirect to 404 if a tenant registered a conflicting slug
    return NextResponse.next()
  }

  return await updateSession(request)
}
```

**Key constraint:** The RESERVED_SLUGS set must be maintained as the application grows. Tenant registration should validate the slug against this list at write time (API-layer guard, not just middleware).

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `next-intl` | No i18n in scope — English only; adding next-intl now would require restructuring the entire app route tree | Inline bilingual copy if needed, or a later dedicated i18n milestone |
| `next-sitemap` (npm package) | External package; Next.js 13+ has native sitemap.ts — the package is for legacy Pages Router | Native `app/sitemap.ts` |
| `react-schemaorg` / `@google/model-viewer` | Heavyweight; JSON-LD via `<script>` tag is the official recommendation | Native script tag with schema-dts types |
| `next/script` for JSON-LD | Wrong abstraction — designed for executable scripts; causes RSC hydration issues with JSON-LD | Native `<script dangerouslySetInnerHTML>` |
| Plausible Analytics / PostHog | Third-party services adding external dependency and cookie consent overhead; Vercel Analytics is already available, self-contained, and GDPR-aggregate-friendly | `@vercel/analytics` |
| `web-vitals` npm package (manual) | `@vercel/speed-insights` wraps web-vitals automatically and reports to Vercel dashboard | `@vercel/speed-insights` |
| `schema-dts` as a runtime dependency | Types only — zero runtime footprint needed | `npm install --save-dev schema-dts` |

---

## Integration Points with Existing Code

| Existing File | What Changes |
|---------------|-------------|
| `src/app/layout.tsx` | Add `<Analytics />` and `<SpeedInsights />` imports + components in body |
| `src/app/page.tsx` | Replace `redirect('/auth/login')` with landing page server component + JSON-LD scripts + `export const metadata` |
| `src/middleware.ts` | Extend with RESERVED_SLUGS blocklist check before calling `updateSession` |
| `src/app/sitemap.ts` | **New file** — export `MetadataRoute.Sitemap` |
| `src/app/robots.ts` | **New file** — export `MetadataRoute.Robots` |
| `src/app/opengraph-image.png` OR `src/app/opengraph-image.tsx` | **New file** — static PNG or `ImageResponse` |

**No changes to:**
- Database schema
- Supabase configuration
- Tenant routes `(public)/[slug]` or `(public)/[slug]/[menuSlug]`
- Admin or superadmin routes
- AI tooling
- Existing API routes

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@vercel/analytics` | `2.0.1` | Next.js 16.2.2, React 19 | Version 2.x is the current generation; import from `/next` subpath for App Router |
| `@vercel/speed-insights` | `2.0.0` | Next.js 16.2.2, React 19 | Version 2.x is current; import from `/next` subpath |
| `schema-dts` | `2.0.0` | TypeScript 5 | Dev-only types; no peer dependency conflicts |
| `next/og` (`ImageResponse`) | Bundled with Next.js 16.2.2 | — | No install; already available |
| `MetadataRoute` (`sitemap`, `robots`) | Bundled with Next.js 16.2.2 | — | No install; already available |

---

## Vercel Dashboard Prerequisites

The following must be enabled in the Vercel project dashboard before the analytics/insights data flows. These are not code changes — they are one-time dashboard actions.

| Action | Location in Dashboard | When |
|--------|-----------------------|------|
| Enable Web Analytics | Project → Analytics tab → Enable | Before or after deploy; data flows on next deploy |
| Enable Speed Insights | Project → Speed Insights tab → Enable | Same |

Both features are available on Vercel's free Hobby tier (limited data retention) and full on Pro.

---

## Common Pitfalls

### Pitfall 1: Wrong Import Subpath for Analytics/Speed Insights

**What goes wrong:** Importing from `@vercel/analytics/react` instead of `@vercel/analytics/next` — route changes in the SPA client navigation are not tracked correctly.

**How to avoid:** Always use the `/next` subpath for App Router projects.

### Pitfall 2: Using `next/script` for JSON-LD

**What goes wrong:** `next/script` defers script injection and can cause duplicate tags during RSC hydration in React 19. The JSON-LD appears twice in the DOM, which confuses schema validators.

**How to avoid:** Use native `<script type="application/ld+json" dangerouslySetInnerHTML>` inside a server component.

### Pitfall 3: Missing `<` Sanitization in JSON-LD

**What goes wrong:** If any string in the JSON-LD payload contains `<`, it becomes an XSS vector. This can't be exploited in static data, but is a security hygiene issue if any field ever comes from user input (e.g., tenant name in page-level JSON-LD).

**How to avoid:** Always use `.replace(/</g, '\\u003c')` on `JSON.stringify` output. The official Next.js guide requires this.

### Pitfall 4: Tenant Slug Registering a Reserved Name

**What goes wrong:** A restaurant owner registers a tenant with slug `sitemap` or `api` — then `/{slug}` routing serves the tenant menu instead of the system route.

**How to avoid:** Validate slug against RESERVED_SLUGS at the API layer in `src/app/api/onboarding/route.ts` (tenant creation endpoint). Do not rely solely on middleware.

### Pitfall 5: `sitemap.ts` Becoming Dynamically Rendered Accidentally

**What goes wrong:** Adding any Request-time API call (cookies, headers, dynamic config) inside `sitemap.ts` removes the build-time cache, causing the sitemap to be regenerated on every crawler visit.

**How to avoid:** Keep `sitemap.ts` purely static — hardcode URLs, do not call Supabase from it. Tenant URLs are not included in the marketing sitemap.

---

## Sources

### Primary (HIGH confidence — official docs, versions from npm registry)

- [Next.js sitemap.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) — version 16.2.5, updated 2026-05-07
- [Next.js robots.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots) — version 16.2.5, updated 2026-05-07
- [Next.js opengraph-image docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) — version 16.2.5, updated 2026-05-07
- [Next.js JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld) — version 16.2.5, updated 2026-05-07
- [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart) — updated 2026-03-11
- [Vercel Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart) — updated 2026-03-11
- npm registry — `@vercel/analytics@2.0.1`, `@vercel/speed-insights@2.0.0`, `schema-dts@2.0.0` — verified via `npm view` 2026-05-07

### Secondary (MEDIUM confidence — cross-referenced with official sources)

- [Next.js JSON-LD discussion #56659](https://github.com/vercel/next.js/discussions/56659) — confirms `next/script` hydration issue with JSON-LD in App Router; aligns with official guide recommendation

---

*Stack research for: v1.3 Marketing Landing Page — xmartmenu.skale.club*
*Researched: 2026-05-07*
*Valid until: 2026-06-07 (stable packages; Next.js 16.x sitemap/robots API is stable)*
