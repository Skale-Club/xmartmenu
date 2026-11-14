# Xprout brand identity

Source of truth for the product's own name and colours. Decided by the owner on 2026-11-12.

## Name

**Xprout** ("es-prout" = sprout), main address **https://xprout.app**. Why and how it was chosen: [brand-name-decision.md](brand-name-decision.md). Code constant: `src/lib/brand.ts`.

## Logo pack v1

On 2026-11-13 the owner approved the minimally cleaned organic X symbol (v7) and requested a consolidated logo pack and brand manual. The logo reads **Xprout**, without `.app`; **xprout.app** remains the web address. Preserve the approved symbol path, inner spoon-bowl spaces, center opening and handle proportions. Do not redraw it to enforce symmetry or narrow its interior.

Versioned vector masters, outline/layout data and editable manual text live in [the v1 source folder](../brand/xprout/v1/README.md). The complete generated pack is `output/branding/xprout/xprout-brand-pack-v1.zip`, with a ten-page PDF manual, four-page vector print master, horizontal/stacked/wordmark/symbol versions, transparent PNGs, icons, favicon and licensed support fonts. Its SVG lettering is outlined from the selected reference and requires no installed font.

The manual defines clear space as one quarter of the visible symbol height, already included in the logo SVG artboards. Supporting editorial type is Fraunces Semibold; body/UI support is Inter. The runtime integration uses these exact outlined assets in platform navigation, auth/admin fallbacks, PWA icons, favicon and social metadata. See [runtime profiles and validation](platform-brand-assets.md). An explicit, guarded platform-settings migration replaces the old configured favicon after the versioned asset is deployed; customer-menu typography, tenant logos and restaurant palettes are preserved.

Owner-designated delivery location (2026-11-13): `N:\My Drive\Xprout\Brand`. The former `N:\My Drive\XmartMenu` folder was renamed to `Xprout`, preserving its existing contents. The complete extracted pack, ZIP, standalone manual and vector print PDF are stored under `Brand`; repository/output paths above remain the local source/build locations. Future brand deliverables belong in this Drive folder.

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
