---
id: SEED-025
status: ready
planted: 2026-05-25
planted_during: home-page-rebrand-planning
trigger_when: immediately — prerequisite for SEED-027 icon swap
scope: small
---

# SEED-025: Icon Resolver Fix (Wave 1)

## Why This Matters

The marketing page (`ClientPage.tsx`) currently resolves feature and step icons by array index, completely ignoring the `icon` string field stored in the database. Admins can change icons in the superadmin settings panel but nothing updates on the marketing page — the bug is silent.

This is a zero-visual-change fix that must land before SEED-027 (features layout + icon swap).

---

## What To Build

### 1. Add `getIcon()` to `ClientPage.tsx`

The return type must be `React.ComponentType<{ className?: string }>` — not `LucideIcon` — because `FoodDrink` is a custom component, not a Lucide icon, and needs to fit the same slot.

```tsx
function getIcon(name: string): React.ComponentType<{ className?: string }> {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    Globe, QrCode, Sparkles, ShoppingCart, UserPlus, UtensilsCrossed,
    Globe2: Globe, MessageCircle, Zap, Star, ChefHat, CreditCard,
    BookOpen, Coffee, BarChart2, Search, Sandwich, CupSoda,
    FoodDrink: FoodDrinkCombo,
  }
  return map[name] ?? Globe
}
```

### 2. Add `FoodDrinkCombo` inline component

Before `getIcon()`, define:

```tsx
function FoodDrinkCombo({ className }: { className?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Sandwich className={className} />
      <CupSoda className={className} />
    </span>
  )
}
```

This renders two icons side by side inside the existing `w-12 h-12` icon box. Each icon inherits the `className` (which carries `w-6 h-6 text-primary` from the parent) — so use `w-4 h-4` explicitly inside the combo instead. Update the icon box render to pass `w-4 h-4` when the icon is `FoodDrink`:

Actually — simpler: hardcode sizes inside `FoodDrinkCombo`:
```tsx
function FoodDrinkCombo({ className }: { className?: string }) {
  const base = className?.replace(/w-\S+|h-\S+/g, '').trim()
  return (
    <span className="inline-flex items-center gap-0.5">
      <Sandwich className={`w-4 h-4 ${base ?? 'text-primary'}`} />
      <CupSoda className={`w-4 h-4 ${base ?? 'text-primary'}`} />
    </span>
  )
}
```

### 3. Fix `resolvedFeatures` map
**File:** `src/app/(marketing)/ClientPage.tsx`

Current (broken):
```tsx
icon: [Globe, QrCode, Sparkles, ShoppingCart, Globe, QrCode][i] ?? Globe,
```

Fixed:
```tsx
icon: getIcon(f.icon ?? ''),
```

### 4. Fix `resolvedSteps` map
Same fix for HowItWorks:

Current:
```tsx
icon: [UserPlus, UtensilsCrossed, QrCode][i] ?? QrCode,
```

Fixed:
```tsx
icon: getIcon(s.icon ?? ''),
```

### 5. Add imports to `ClientPage.tsx`
Add `Sandwich`, `CupSoda` to the lucide-react import at the top of the file.

### 6. Expand `ICON_OPTIONS` in `SettingsClient.tsx`
**File:** `src/app/(superadmin)/settings/SettingsClient.tsx` (lines 43–62)

Add:
```tsx
{ name: 'Sandwich', icon: Sandwich },
{ name: 'CupSoda', icon: CupSoda },
```

Add `Sandwich`, `CupSoda` to the import at the top of the file.

Note: `FoodDrinkCombo` lives only in `ClientPage.tsx` — it does not need to appear in `ICON_OPTIONS` because it is rendered automatically when `icon === 'FoodDrink'`. The admin can pick `Sandwich` or `CupSoda` individually; `FoodDrink` is set programmatically in SEED-027.

---

## Constraints

- Zero visual change on the marketing page after this ships
- Do not change any existing icon values in the hardcoded `features` or `steps` arrays — those still use direct component references and are untouched until SEED-027
- `getIcon()` fallback must be `Globe`
- Return type is `React.ComponentType<{ className?: string }>`, not `LucideIcon`

---

## Verification

1. Marketing page renders pixel-identically before and after
2. Changing a feature icon in superadmin settings now actually updates the marketing page
3. `Sandwich` and `CupSoda` appear in the admin icon picker
4. No TypeScript errors on `getIcon()` return type
