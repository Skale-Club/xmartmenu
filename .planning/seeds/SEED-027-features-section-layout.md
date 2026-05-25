---
id: SEED-027
status: ready
planted: 2026-05-25
planted_during: home-page-rebrand-planning
trigger_when: after SEED-025 (icon resolver) is complete
scope: small
---

# SEED-027: Features Section Layout, Icons & Subtitle (Wave 3)

## Why This Matters

The features section shows 4 cards in a 2×2 grid. On desktop this wastes horizontal space. Goal: 4 cards in one row on desktop, 2×2 on tablet, single stack on phone.

The Online Ordering icon (ShoppingCart) doesn't convey food/dining. Replacing it with a hamburger + fountain drink makes it immediately recognizable in a restaurant context.

The section subtitle is also slightly too large — 15% reduction improves proportion.

**Depends on SEED-025** — `FoodDrinkCombo` component must exist before this wave executes.

---

## What To Build

### 1. Grid layout — responsive 3-tier
**File:** `src/app/(marketing)/ClientPage.tsx:330`

```
grid grid-cols-1 md:grid-cols-2 gap-6
→
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6
```

Responsive breakdown:
- **Phone** (`< 640px`): 1 card per row — single column stack
- **Tablet** (`640px–1023px`): 2 cards per row — 2×2 grid
- **Desktop** (`≥ 1024px`): 4 cards in one row

### 2. Card sizing at 4-wide desktop only
Add `lg:` responsive variants — mobile/tablet sizes unchanged:
- Padding: add `lg:p-6` alongside existing `p-8` → final class: `p-8 lg:p-6`
- Title: add `lg:text-xl` alongside existing `text-2xl` → final class: `text-2xl lg:text-xl`

### 3. Online Ordering icon swap — hardcoded array
**File:** `src/app/(marketing)/ClientPage.tsx` (features array, ~line 82–85)

The hardcoded `features` array uses direct component references, not strings. Change:
```tsx
// Before
{
  icon: ShoppingCart,
  title: 'Online ordering',
  body: 'Let customers order directly from the table. Available as an add-on.',
}

// After
{
  icon: FoodDrinkCombo,   // ← actual component reference, not the string 'FoodDrink'
  title: 'Online ordering',
  body: 'Let customers order directly from the table. Available as an add-on.',
}
```

`FoodDrinkCombo` is the component defined in SEED-025. Import it — or since it lives in the same file, it's already available.

Remove `ShoppingCart` from the lucide-react import if it's no longer used elsewhere in `ClientPage.tsx`.

### 4. Subtitle size reduction
**File:** `src/app/(marketing)/ClientPage.tsx:327`

```
text-xl  →  text-[17px]
```

Exact 15% reduction: 20px × 0.85 = 17px.

---

## Constraints

- SEED-025 must be complete — `FoodDrinkCombo` must exist in `ClientPage.tsx`
- Mobile/tablet card padding and title stay at original sizes — only `lg:` variants added
- Do not change any text content — titles, descriptions, section heading/subtitle text unchanged
- Icon swap is a component reference change in the hardcoded array, NOT a string change

---

## Verification

1. Desktop (≥ 1024px): 4 cards in one row, evenly spaced, not cramped
2. Tablet (640px–1023px): 2 cards per row, 2×2 layout
3. Phone (< 640px): 1 card per row, full-width stack
4. Online Ordering card shows Sandwich + CupSoda icons side by side
5. Section subtitle visibly slightly smaller than before
6. Mobile/tablet card padding and title size identical to original
