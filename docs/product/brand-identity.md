# Xprout brand identity

Source of truth for the product's own name and colours. Decided by the owner on 2026-11-12.

## Name

**Xprout** ("es-prout" = sprout), main address **https://xprout.app**. Why and how it was chosen: [brand-name-decision.md](brand-name-decision.md). Code constant: `src/lib/brand.ts`.

## Colours

The red `#F52323` is retired. The brand has two colours:

| Role | Name | Hex | Use |
|---|---|---|---|
| Primary | Burnt forest green (verde floresta queimado) | `#283F32` | Buttons, calls to action, links, active states, the logo mark, the PWA `theme_color` |
| Base | Warm ivory (marfim quente) | `#F3EFE5` | Page and card backgrounds on light screens, text and icons on top of the green, the PWA `background_color` |

- Contrast: ivory on green (and green on ivory) is about **9.9:1**, which passes WCAG AAA for normal text.
- Text on the primary green is ivory `#F3EFE5`, not pure white.
- Hover/pressed states and borders are derived from these two colours (e.g. a darker or lighter green); no third brand colour is introduced without the owner.

## Scope: what the brand colours cover

The brand colours belong to **Xprout itself**: the marketing site and pricing, sign-in and registration, the restaurant admin and superadmin chrome, e-mails and notifications sent by the platform, the PWA manifest, the Open Graph image, the app icon and favicon.

They **never override a restaurant's own colours**. A restaurant's menu, feed, dish sheet, cart, checkout and AR views use that restaurant's `primary_color` and `accent_color` (see [design-consistency.md](design-consistency.md)).

## Where the old red lives (to change in the colour rollout)

As of release `3c34545` (2026-11-12):

- `src/app/globals.css`: `--primary: #F52323` and `--primary-foreground: #ffffff` (platform theme tokens).
- `src/app/manifest.ts`: `theme_color: '#F52323'`, `background_color: '#ffffff'`.
- Database, `platform_settings`: `cta_color = #F52323` (landing CTA), `default_accent_color = #FF5722`, `default_primary_color = #000000`.
- Fallbacks `?? '#F52323'` in `src/app/(admin)/layout.tsx`, `src/app/(marketing)/layout.tsx`, `src/app/(admin)/settings/seo/SeoClient.tsx`, `src/app/(admin)/settings/branding/BrandingClient.tsx` (the "Default" preset), `src/app/(public)/[slug]/[menuSlug]/page.tsx`, `src/app/(public)/[slug]/me/page.tsx`, `src/app/(public)/[slug]/opengraph-image.tsx`.

The fallbacks in the public menu files only apply to a restaurant with no colour of its own. On 2026-11-12 all 3 production restaurants have their own `primary_color`, so their menus do not change. Open decision for the owner: whether new restaurants start with the Xprout green as their default colour (recommended) or keep a neutral default.

## Rollout checklist

1. Add brand colour constants next to the name in `src/lib/brand.ts` (`BRAND_PRIMARY = '#283F32'`, `BRAND_BASE = '#F3EFE5'`) and use them for the platform fallbacks above.
2. `globals.css` platform tokens and `manifest.ts` colours.
3. `platform_settings.cta_color` (and the default accent) through the superadmin settings or an audited update.
4. Logo, icons, favicon and Open Graph image in the new colours.
5. Check the marketing site, sign-in, admin and an e-mail on phone and desktop; restaurant menus must look exactly as before.
