# v2.3 Requirements — Brand & Marketing Refresh

## In Scope

### Icon Resolver (SEED-025)

- [ ] **ICON-01**: `ClientPage.tsx` has a `getIcon(name)` function that maps DB icon name strings to Lucide components — DB-driven feature and step icons actually render correctly on the marketing page
- [ ] **ICON-02**: A `FoodDrinkCombo` component (Sandwich + CupSoda side by side) is registered under `'FoodDrink'` in `getIcon()`
- [ ] **ICON-03**: `Sandwich` and `CupSoda` are added to `ICON_OPTIONS` in `SettingsClient.tsx` so they appear in the admin icon picker

### Color Rebrand (SEED-026)

- [ ] **COLOR-01**: Platform primary color is changed from `#EEFF00` (yellow-lime) to `#F52323` (red) across the entire application
- [ ] **COLOR-02**: `--primary-foreground` is updated to `#ffffff` — all text on primary-colored elements is white
- [ ] **COLOR-03**: All 14 hardcoded `#EEFF00` fallback hex values are replaced with `#F52323`
- [ ] **COLOR-04**: All 50 instances of `bg-primary text-zinc-950` are replaced with `bg-primary text-primary-foreground`
- [ ] **COLOR-05**: Hero "built for service." heading gradient preserves its fade-out effect: `from-primary via-red-200 to-white`
- [ ] **COLOR-06**: Admin default `cta_color` and branding palette default are updated to `#F52323`

### Features Section (SEED-027)

- [ ] **FEAT-01**: Features grid is 1-column on phone, 2-column on tablet, 4-column on desktop
- [ ] **FEAT-02**: Card padding and title size reduce at desktop 4-wide breakpoint only — mobile/tablet unchanged
- [ ] **FEAT-03**: Online Ordering card icon is replaced with Sandwich + CupSoda combo (`FoodDrinkCombo`)
- [ ] **FEAT-04**: Features section subtitle is reduced by 15% (`text-xl` 20px → `text-[17px]`)

### CTA Section (SEED-028)

- [ ] **CTA-01**: Footer CTA card extends to full viewport width with no side gaps
- [ ] **CTA-02**: Restaurant background image (aerial dark moody restaurant, `public/images/cta-bg.jpg`) is visible behind the text on all breakpoints
- [ ] **CTA-03**: Card glass/shadow effect (`backdrop-blur-xl border border-white/10 rounded-[2rem]`) is preserved
- [ ] **CTA-04**: Heading, subtext, and button classes are byte-for-byte identical to before — zero text modifications
- [ ] **CTA-05**: Dark overlay adjusts per breakpoint (phone: `/60`, tablet: `/50`, desktop: `/40`) for readability
- [ ] **CTA-06**: Superadmin can override the CTA background image via a `bg_image_url` field in the landing settings panel

### DB Seeds (SEED-029)

- [ ] **SEED-01**: `platform_settings.cta_color` seed value is `#F52323`
- [ ] **SEED-02**: Default tenant `primary_color` seed value is `#F52323`
- [ ] **SEED-03**: Default landing JSONB Online Ordering icon is `'FoodDrink'`

---

## Execution order

| Wave | Phase | Seeds | Constraint |
|---|---|---|---|
| 1 | 45 | SEED-025 | Must land before Wave 3 icon swap |
| 2 | 46 | SEED-026 | Atomic — one commit, all 50+ files together |
| 3 | 47 | SEED-027 | After Wave 1 complete |
| 4 | 48 | SEED-028 | Independent — can run in parallel with others |
| 5 | 49 | SEED-029 | After Waves 1–4 visually confirmed |

---

## Out of Scope

- Any text content changes — only colors, layout, and icons change
- Admin panel layout or navigation — superadmin settings panel only gains one new field (CTA bg_image_url)
- Public customer-facing menu pages — color changes only via CSS variable; no layout changes
- FAQ section — intentionally hardcoded, out of scope for this milestone
