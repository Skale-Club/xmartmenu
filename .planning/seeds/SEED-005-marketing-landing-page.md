---
id: SEED-005
status: completed
completed: 2026-05-07
completed_in: v1.3 (Landing Page milestone — phases 12-13)
planted: 2026-05-05
planted_during: pre-GSD (no .planning/STATE.md yet)
trigger_when: ready for real customer acquisition, starting marketing, public launch, paid traffic, or applying to launchpads
scope: medium
domain: xmartmenu.skale.club
---

# SEED-005: Marketing landing page (xmartmenu.skale.club)

## Why This Matters

There is no marketing landing page. [src/app/page.tsx](src/app/page.tsx) is a
single line:

```ts
export default function HomePage() {
  redirect('/auth/login')
}
```

Every visitor to **xmartmenu.skale.club** — every cold visitor from a referral,
every click from a future ad, every link shared on social — currently dead-ends
at a login screen. There is nowhere for a prospective restaurant owner to learn
what xmartmenu is, see it work, or decide to sign up.

This is the front door of the entire product. Until it exists, no acquisition
channel can produce real conversions, no paid traffic is rational to run, and
the brand has no online presence beyond the login form. Solving this unblocks
every growth lever.

## When to Surface

**Trigger:** ready for real customer acquisition, starting marketing, public launch, paid traffic, or applying to launchpads

This seed should be presented during `/gsd:new-milestone` when the milestone
scope matches any of these conditions:
- "Marketing" / "growth" / "acquisition" / "launch" milestones
- Public launch / GTM / brand milestones
- Paid traffic / SEO / content marketing milestones
- Any milestone that mentions xmartmenu.skale.club, the root URL, or homepage
- Pre-launch readiness milestones (pairs naturally with SEED-004 performance)

## Scope Estimate

**Medium** — single page, no backend complexity, but copywriting + design + i18n
+ SEO take real effort. Plan as ~3 phases:

1. **Design + copy** — wireframe, value prop, hero copy, feature copy. PT and EN
   from day one.
2. **Build** — implement page on `/` (move current redirect to a separate
   `/login` button), responsive, accessible, fast.
3. **SEO + analytics** — metadata, OG tags, sitemap.xml, robots.txt, structured
   data, analytics + RUM hooked up.

## Breadcrumbs

### What this replaces
- [src/app/page.tsx](src/app/page.tsx) — currently just
  `redirect('/auth/login')`. The marketing landing page lives here. The
  redirect logic moves to a "Log in" button in the new header.

### Hosting / domain
- **Production URL: `xmartmenu.skale.club`**
- DNS sits under the `skale.club` zone — likely already pointing to Vercel given
  the Next.js stack. Verify deployment target and TLS cert before launch.
- **Open question — tenant URL shape:** today public menus resolve at
  [src/app/(public)/[slug]/page.tsx](src/app/\(public\)/[slug]/page.tsx),
  i.e. `xmartmenu.skale.club/{tenantSlug}`. With a marketing page on `/`, the
  marketing copy and tenant slugs share the root namespace. Three options:
  1. Keep path-based: `xmartmenu.skale.club/{slug}` — simple, but reserves all
     top-level paths (e.g. a tenant can't be named `pricing` or `about`)
  2. Move tenants to `xmartmenu.skale.club/m/{slug}` — adds a path segment but
     frees marketing routes
  3. Subdomain per tenant: `{slug}.xmartmenu.skale.club` — cleanest separation,
     needs wildcard DNS + middleware rewrite
  Decide before launch — changing tenant URLs later breaks every printed QR code.

### Sections to build
- **Hero** — value prop ("the fastest way to put your menu online" or similar),
  primary CTA → `/auth/register` (which flows into onboarding, which flows into
  SEED-001 AI seeding when that ships)
- **Live demo** — embed or link a real example menu. Easiest: provision a `demo`
  tenant and link to `/demo`. Works as proof and as a sandbox.
- **Feature blocks** — what already ships:
  - Multi-language menu (i18n already in DB per migration 012)
  - QR code generation ([src/app/(admin)/settings/qrcode/](src/app/\(admin\)/settings/qrcode/))
  - Multi-tenant from day one
  Future blocks (gated by other seeds, ship as they land):
  - AI menu seeding (SEED-001)
  - Direct online ordering (SEED-002)
  - Stripe-direct payments (SEED-003)
- **Social proof** — testimonials + logos. Empty state ready, fill as customers
  arrive. Don't fake it.
- **Pricing** — TBD. Depends on SEED-003 application_fee decision (flat per-order
  vs % vs tiered). Until then, "Free during beta" is honest and good copy.
- **FAQ** — billing, data ownership, multi-language, QR codes, what happens to
  data if tenant cancels.
- **Footer** — Privacy Policy, Terms of Service, contact, X/IG/LinkedIn handles.
  **Legal docs themselves are out of scope for this seed but are a hard blocker
  for shipping** — flag during planning.

### SEO + analytics
- Next 16 metadata API in [src/app/layout.tsx](src/app/layout.tsx) — title,
  description, OG image, Twitter card
- `app/sitemap.ts` and `app/robots.ts` (Next 16 conventions)
- Structured data — `Organization` and `SoftwareApplication` schema.org JSON-LD
- Canonical URLs pointing to `https://xmartmenu.skale.club`
- Analytics — Plausible, PostHog, or Vercel Analytics (decide based on
  privacy posture; restaurants in EU-adjacent markets may need GDPR-friendly)
- Real-user metrics — Vercel Speed Insights or `web-vitals` reporter

### i18n
- Two languages minimum: **PT** (primary — Brazilian restaurant owners) + **EN**
- Two patterns possible:
  1. Path-based: `/pt`, `/en` — explicit but uglier URLs
  2. Cookie/header-based: detect `Accept-Language`, set cookie, no URL change
  Path-based is simpler for SEO (separate canonical per locale).
- Translation copy lives in JSON dictionaries; consider `next-intl` (already
  ecosystem-standard for App Router)

### Accessibility + responsive
- Mobile-first — restaurant owners browse on phones, tablets in kitchens
- WCAG AA — color contrast, keyboard nav, alt text on hero imagery
- Reduced-motion respect on any animation

## Notes

- **Performance gate (overlap with SEED-004):** the landing page must hit
  Lighthouse 95+ on mobile. It's the front door — slow front door = no
  customer makes it inside. Use Edge runtime, static generation where possible,
  zero client JS for above-the-fold. Plan the perf budget alongside the build,
  not after.
- **Don't ship faked metrics or testimonials.** Empty social-proof section beats
  fake one. The structure can be there with a "stories coming soon" placeholder.
- **CTA flows must work end-to-end before launch.** Sign-up → onboarding →
  populated menu in <5 min is the demo that sells the product. If any step in
  that chain is broken or slow, the landing page is worse than not having one
  (raises expectation, fails to deliver).
- **Domain decision before printing anything.** Whatever URL pattern you pick
  for tenants (`/{slug}` vs `/m/{slug}` vs `{slug}.xmartmenu.skale.club`)
  becomes physically printed on QR codes — irreversible at scale.
- **Legal docs are a hard prerequisite** but live outside this seed. Privacy
  Policy and Terms must exist before public launch. Generate-and-customize from
  a template service (Termly, iubenda, etc.) is fine for v1; lawyer review
  later.
- **Coordinates with:**
  - SEED-001 (AI onboarding) — landing page CTA promises "menu in minutes",
    AI onboarding makes that promise real
  - SEED-003 (Stripe Connect) — landing page pricing copy depends on application
    fee model
  - SEED-004 (performance) — Lighthouse budget for landing page should be the
    pilot for the wider perf budget initiative
