---
id: SEED-028
status: ready
planted: 2026-05-25
planted_during: home-page-rebrand-planning
trigger_when: immediately — independent of other waves
scope: small
---

# SEED-028: Footer CTA Section Full-Bleed + Background Image (Wave 4)

## Why This Matters

The "Ready to get started?" section has a smaller card floating inside a larger section — a "table inside a table" effect. The card needs to extend edge-to-edge. A dark moody restaurant image placed behind the text adds atmosphere and reinforces the product context.

**Text is completely untouched** — not a single class, size, weight, color, spacing, or alignment changes on the heading, subtext, or button.

**Padding and full-width must be one atomic edit** — doing one without the other leaves side gaps or collapsed content.

---

## What To Build

### Current structure (for reference)
```tsx
<section className="py-24 px-8 relative overflow-hidden">
  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-zinc-950" />  {/* section gradient */}
  <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r ..." />             {/* top line */}

  <div className="max-w-[1320px] mx-auto relative z-10 bg-zinc-950/40 backdrop-blur-xl border border-white/10 p-12 sm:p-20 rounded-[2rem] text-center">
    {/* heading, text, button */}
  </div>
</section>
```

### Target structure (after changes)
```tsx
<section className="py-24 relative overflow-hidden">           {/* px-8 removed */}
  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-zinc-950" />  {/* stays on section */}
  <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r ..." />             {/* unchanged */}

  <div className="relative bg-zinc-950/40 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden">
    {/* z-0 — restaurant image */}
    <img
      src={data?.bg_image_url ?? '/images/cta-bg.jpg'}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 w-full h-full object-cover"
    />

    {/* z-10 — dark overlay, responsive opacity */}
    <div className="absolute inset-0 bg-zinc-950/60 md:bg-zinc-950/50 lg:bg-zinc-950/40" />

    {/* z-20 — text content, padding lives here */}
    <div className="relative z-20 max-w-[1320px] mx-auto px-8 sm:px-20 py-20 text-center">
      {/* heading, text, button — ZERO CLASS CHANGES */}
    </div>
  </div>
</section>
```

### Key changes explained

**Section:** Remove `px-8` only. Everything else stays.

**Card div:** Remove `max-w-[1320px] mx-auto`, `p-12 sm:p-20`, `text-center`, `relative z-10`. Add `overflow-hidden` (needed to clip the absolute image to rounded corners). Keep `bg-zinc-950/40 backdrop-blur-xl border border-white/10 rounded-[2rem]`.

**Image:** `absolute inset-0 w-full h-full object-cover` — no z-index class needed (stacks first in DOM = bottom). The `overflow-hidden` on the card clips it to the rounded corners.

**Overlay:** `absolute inset-0 bg-zinc-950/60 md:bg-zinc-950/50 lg:bg-zinc-950/40` — responsive opacity, sits above image.
- Phone: `/60` heavier — small viewport, image detail less visible, text protection priority
- Tablet: `/50`
- Desktop: `/40` — image breathes more

**Content wrapper:** New div wraps all text. Gets the padding and centering that was on the card: `relative z-20 max-w-[1320px] mx-auto px-8 sm:px-20 py-20 text-center`.

**Section gradient** (`from-primary/20 to-zinc-950`) stays on the section as-is. It will show through the card's semi-transparent `bg-zinc-950/40` backdrop, adding the primary color tint around the edges. This is intentional — keeps brand color continuity.

### Background image file
Save the provided restaurant image to: `public/images/cta-bg.jpg`
(Aerial dark moody restaurant — bar scene left, round dining table right. 2020×779px.)

### `CtaData` interface
**File:** `src/app/(marketing)/ClientPage.tsx` (~line 32–36)
Add: `bg_image_url?: string`

### Admin field
**File:** `src/app/(superadmin)/settings/SettingsClient.tsx` (~line 539–541)

Add inside the CTA section fields:
```tsx
<div className="md:col-span-2">
  <label className={label}>Background Image URL</label>
  <input
    className={input}
    value={cta.bg_image_url ?? ''}
    onChange={e => setCta({ ...cta, bg_image_url: e.target.value })}
    placeholder="/images/cta-bg.jpg"
  />
</div>
```

Add `bg_image_url: ''` to `DEFAULT_LANDING.cta` object (around line 222).

---

## Constraints

- **Zero text modifications** — heading (`text-4xl sm:text-6xl font-bold text-white`), subtext (`text-xl text-zinc-300`), button (`bg-primary ... px-10 py-5 rounded-full text-xl font-bold`) — untouched
- Padding and full-width must be done as one edit
- `overflow-hidden` on card is required to clip image to `rounded-[2rem]`
- Card glass/shadow effect preserved: `bg-zinc-950/40 backdrop-blur-xl border border-white/10 rounded-[2rem]`
- Image is decorative: `alt=""` `aria-hidden="true"`

---

## Verification

1. Card spans full viewport width, no side gaps
2. Restaurant image fills the card background on all breakpoints
3. Rounded corners clip the image cleanly
4. Text is fully readable on phone, tablet, and desktop
5. Heading, subtext, and button classes are byte-for-byte identical to before
6. Glass/border effect visible on card
7. Admin "Background Image URL" field updates the image in real time
