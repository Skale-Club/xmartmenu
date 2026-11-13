# Public color review and theme coherence correction

Reviewed and corrected locally on 13 November 2026. Branch: `fix/public-color-coherence`. Production was reviewed at release `f0b5d275a1774473e111859aa4b2b95134f24fd6`; the source baseline was `d67281b3543bf53a81bd44c11691472273c80ab4`. This work has not been pushed or deployed.

## Outcome

The review confirmed a theme consistency problem, not a change to saved restaurant settings. Payment pages discarded tenant theme fields and used fixed purple/indigo; some controls forced white text; the shared foreground algorithm did not guarantee contrast. A global dashboard rule also silently replaced `--primary` inside dark ancestors. Marketing used dark forest text and focus rings on almost-black backgrounds, and its nested layout emitted a second `html` and `body`, causing hydration errors and unreliable theme boundaries.

These causes are corrected. Raw configured primary/accent values are preserved. Readable text, on-primary labels, focus and dark-surface variants have explicit roles and shared computations. The automatic dashboard reassignment of raw `--primary` and its paired foreground was removed. No database, payment, order, subscription, credentials or production settings were changed.

## Color authority

| Role | Source and rule |
| --- | --- |
| Platform identity | Approved forest `#283F32` and ivory `#F3EFE5`; `platformColors` validates settings and consistently projects the pair for both layouts |
| Restaurant identity | The restaurant's validated `primary_color` and `accent_color`; never replaced by platform forest or payment purple |
| Text on a fill | `computePrimaryForeground` compares actual WCAG ratios; supports short/full hex and alpha on an explicit surface |
| Light-surface unit price | Shared `readableTextColor(accent)` role across cards, detail, size/upsell and payment; raw accent remains unchanged |
| Focus and selection | Explicit contrast-safe surface roles; selected marks use the paired foreground and visible boundaries |
| Dark AR action | Validated primary, then accent, then an explicit visible variant; no camera gradient or scrim added |
| Hover | Shared menu feedback preserves the fill/label colors; no opacity/brightness change that invalidates a passing pair |

The difference between an identity value and a derived readable text role is intentional and explicit. The correction does not claim that every rendered pixel must use the raw accent regardless of its background. Restaurant colors remain independent of platform colors. Semantic error/success and provider identity colors remain meaningful exceptions; WhatsApp retains its service green with a readable dark label.

## Confirmed findings and local results

| Surface/state | Before production evidence | Local correction and result |
| --- | --- | --- |
| Pricing | 22 detected text-contrast failures on desktop; forest labels 1.39-1.75:1; normal supporting text 3.29:1 | Explicit ivory on-dark role, visible focus and readable muted text; 0 detected failures in final desktop check and mobile check |
| Home | Pink/yellow decoration, old red logo asset, footer 4.12:1; gradient text requires manual review | Palette decoration and footer corrected; 0 detected solid-text failures desktop/mobile; existing configured logo rollout remains separate |
| Pending | Back link became white on white on hover (1.00:1); supporting text 3.90:1 | Paired forest/ivory remains unchanged on hover; 0 detected failures |
| Login/identity | Recovery note 3.87:1, embedded terms 3.67:1, weak green focus on dark | Readable muted text, ivory on-dark focus, platform/guest branches kept separate; standalone local check 0 failures; embedded restaurant account-link credentials retain the tenant theme |
| Privacy/terms | Timestamp 2.62:1 on white | Full-width ivory with readable timestamp and return link; both final checks 0 failures |
| Offline | Retired red `#F52323`, white 13px Retry 4.08:1 | Forest/ivory, readable supporting text and focus; 0 detected failures |
| Aurora menu | Featured accent prices 3.66:1; footer 2.51:1 | Shared readable accent role and neutral supporting text; 0 detected failures desktop/mobile; raw primary remains `#1a1a2e` |
| Bella Vista menu | Featured accent prices 3.18:1; footer 2.51:1 | Same roles; 0 detected failures desktop; raw primary remains `#C1121F` |
| Celes menu | Featured accent prices 3.01:1 on desktop | Actual accent `#B28A58` covered by the shared contrast matrix; local `/celes` is unavailable in development, so no local Celes page is claimed verified |
| Payment/confirmation | Currency-only theme projection; fixed purple in Stripe and pay button, indigo totals/actions | Both data readers project tenant palette; actual route/Stripe renders tested with two distinct tenant palettes, including a pale primary; money and return behavior unchanged |
| Document/theme boundary | Nested marketing `html`/`body` caused a hydration mismatch | Valid nested `div` theme scope; browser confirms one root document, no nested document elements and no hydration errors in final checks |

Counts describe axe's `color-contrast` rule on captured states, not a full accessibility certification. Repeated nodes are not separate root causes. Gradients, photos and camera backgrounds have incomplete/manual cases; zero detected failures does not certify those pixels.

## Coverage

Source review covered home/pricing, platform blog index/post/tag/year/month templates, legal published/fallback views, owned and conditional legacy authentication, pending/registration/staff/identity, access-request phases and conditional old onboarding, consent, offline, not-found/error boundaries, public tenant menus and alternate menu routes, preview/private gates, customer account/login, tenant blog templates, list/feed/detail/options/size/upsell/cart/checkout and AR.

Production browser captures used 1440x1000 and 390x844. Additional states included pending hover, login focus, owned home login iframe, tenant login iframe, Aurora product detail, local cart and checkout form. Only local browser cart state was changed; no order, payment, message or authorization was submitted. Three tenant blog routes returned 404, the platform blog was empty, and account/onboarding states were authentication-gated. Those conditional templates were reviewed in source rather than represented as live authenticated screenshots.

## Verification

- 67 targeted tests passed in the combined run, followed by 6 passing final CSS/theme checks including the new immutable-primary regression: 71 distinct tests after three additional embedded existing-account-link theme checks. This includes contrast matrices, 256 grayscale fills, alpha/invalid inputs, raw palette preservation, actual payment/Stripe projection, legacy and owned readers, money arguments, access-request flow, private-menu boundaries and nested layout rendering.
- Full TypeScript `--noEmit --incremental false` passed. Scoped ESLint `--quiet` and whitespace checks passed.
- Final browser verification reopened privacy, terms and pricing, confirmed zero detected solid-text contrast failures, validated document ownership and checked pending hover colors/filter. Other local captures cover home, login, registration, offline and available menus in desktop/mobile.
- Both audit and local preview servers/browsers are task-owned and closed at completion. No dependency installation or production write was required.

Evidence is generated in `output/audits/public-colors/` and delivered to `N:\My Drive\Xprout\Reviews\2026-11-13 Public Colors` with this report, before/after captures, JSON measurements, specialist source reviews and the reviewable patch. Source tests and runtime corrections remain in Git.

## Remaining boundaries and release

The approved new logo/icon pack has not been installed by this color correction; production screenshots still show the configured old red logo tile. Private menus, individual product-option combinations, post-payment provider behavior and live AR camera contrast were not exercised against production state. Celes needs its development fixture/slug aligned separately; production data was not copied into development. Transparent brand fills over an unpredictable camera need device review even though explicit-surface alpha calculations are tested.

The changes are ready for owner review and the normal release flow. Production continues to run its existing release until that flow is authorized.

References: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines), the installed Next.js layout/CSS guides and [the shared customer-menu contract](design-consistency.md).
