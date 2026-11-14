# Platform brand assets

Runtime edition `v1` publishes the owner-approved Xprout v7 symbol and outlined
wordmark from `docs/brand/xprout/v1`. No paths, letters, proportions, or fonts are
redrawn. `node scripts/generate-xprout-runtime-assets.mjs` reproduces the assets
with the installed Sharp dependency, using only versioned canonical SVGs,
geometry and layouts. It does not depend on ignored `output/` source files.

The script checks the canonical SVG paths against versioned geometry and the
approved symbol path SHA-256 before rendering. Horizontal and symbol signatures
are copied byte-for-byte. Raster placements match the approved brand-pack build:
ivory symbol on forest square, symbol width 328 of 512 for app icons, 288 for
maskable icons. The maskable symbol's bounding rectangle fits inside the central
40%-radius safe circle (conservative corner-radius test); no symbol points move.
Apple touch icon uses the same approved tile at 180px.

## Published profiles

| Consumer | Format and dimensions | Actual encoded maximum | Reason |
| --- | --- | --- | --- |
| Header/auth signatures | SVG, original canonical viewBox | 40 KiB | Exact outlined vector paths, resolution-independent |
| App/PWA icon | PNG 192 or 512 square | 40 KiB | PWA consumers require PNG; approved tile and alpha semantics |
| Maskable icon | PNG 192 or 512 square | 40 KiB | Approved safe-zone tile for OS masks |
| Apple touch icon | PNG 180 square | 40 KiB | Native platform metadata format |
| Favicons | PNG 16/32; ICO with 16/32/48 PNG entries | PNG 40 KiB; ICO 16 KiB | Browser compatibility |
| General social card | WebP 1200×630 | 100 KiB | Optimized approved horizontal artwork |
| Static Open Graph response | PNG 1200×630 | 180 KiB | Metadata consumers and Next static image route support; format-specific exception to icon dimensions, within wide-image byte budget |

These are explicit format profiles under the application media policy. Every
encoded output is checked before writing; SVG/PNG assets stay within their
consumer-specific budget. Sharp concurrency is one; the local build processes
only bounded checked-in vectors, with no guest-triggered conversion or remote
fetch. Runtime paths are versioned under `/brand/xprout/v1/` and are static,
cacheable assets. Deploying a new edition should use a new versioned directory.

## Compatibility paths

The generator also updates `public/icon.png`, `public/icons/{icon-192.png,
icon-512.png,icon-maskable-192.png,icon-maskable-512.png,apple-touch-icon.png}`,
`src/app/icon.png` and `src/app/apple-icon.png`. Older cached manifest and icon
references therefore resolve to the approved forest/ivory tile after deployment.
The versioned ICO is available for explicit metadata; no legacy source favicon
existed to overwrite.

The horizontal signature's original viewBox is
`0 0 1176.5155165075823 326.6565102866406`; preserve this aspect ratio. Visible
artwork is 1075.5155165075823×225.65651028664055, with 50.5 units of clearspace
around it. The manual's 160px visible horizontal minimum needs about 175px total
SVG width. SVG image sizing must not stretch it into a square tile.

## Verification

`output/branding/runtime-v1/verification.json` records actual bytes, decoded
dimensions, MIME expectations, SHA-256 for every artifact and symbol-path hash
preservation. This edition measured app PNGs at most 13,491 bytes, favicon ICO
2,390 bytes, social WebP 16,162 bytes and social PNG 28,581 bytes. App 512,
maskable 512, favicon ICO and social WebP were also compared byte-for-byte with
the approved pack and matched. Signatures are direct canonical copies.

Platform components and metadata use the versioned assets; custom platform logos stay explicit. The default horizontal signature renders only for the Xprout name and default icon. Restaurant colors, tenant logos and menu typography stay unchanged.

The operator `scripts/ops/update-xprout-platform-brand.mjs` is read-only by default. It records a public configuration backup and tenant palette digest. After deploy, `--apply --expected-release <full SHA>` verifies the published icon bytes, production container/release/database identity, singleton and original favicon under the existing advisory lock, then changes only `favicon_url` and its timestamp. Read-back proves the palette digest is unchanged. `--rollback --expected-release <full SHA>` restores the backed-up reference. Receipts are ignored operational evidence, never secrets.

A browser refresh fetches the new HTML and versioned assets. An existing installed PWA may refresh its OS icon on its platform schedule. The Journal records actual deployment and visual validation; generated files alone are not deployment proof.
