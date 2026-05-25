## RESEARCH COMPLETE

# Phase 45: Icon Resolver Fix — Research

**Date:** 2026-05-25
**Phase requirements:** ICON-01, ICON-02, ICON-03

---

## Current State (Broken Icon Resolution)

**ClientPage.tsx** ignores the `icon` string from the DB and resolves by array index only:

**resolvedFeatures** (lines 304-310):
```tsx
const resolvedFeatures = data?.items?.length
  ? data.items.map((f, i) => ({
      icon: [Globe, QrCode, Sparkles, ShoppingCart, Globe, QrCode][i] ?? Globe,
      title: f.title,
      body: f.desc,
    }))
  : features
```
→ `f.icon` from DB **completely ignored**

**resolvedSteps** (lines 253-260):
```tsx
const resolvedSteps = data?.steps?.length
  ? data.steps.map((s, i) => ({
      num: i + 1,
      icon: [UserPlus, UtensilsCrossed, QrCode][i] ?? QrCode,
      title: s.title,
      body: s.desc,
    }))
  : steps
```
→ `s.icon` from DB **completely ignored**

---

## Type Definitions (Already Correct)

Both interfaces already have `icon?: string` — no type changes needed:

```tsx
interface HowItWorksData {
  steps?: Array<{ step?: string; icon?: string; title: string; desc: string }>
}

interface FeaturesData {
  items?: Array<{ icon?: string; title: string; desc: string }>
}
```

---

## Reference Implementation in SettingsClient.tsx (lines 43-66)

```tsx
const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
  { name: 'ClipboardList', icon: ClipboardList },
  { name: 'Palette', icon: Palette },
  { name: 'QrCode', icon: QrCode },
  { name: 'Smartphone', icon: Smartphone },
  { name: 'Link2', icon: Link2 },
  { name: 'MessageCircle', icon: MessageCircle },
  { name: 'BarChart2', icon: BarChart2 },
  { name: 'Search', icon: Search },
  { name: 'ChefHat', icon: ChefHat },
  { name: 'UtensilsCrossed', icon: UtensilsCrossed },
  { name: 'Globe', icon: Globe },
  { name: 'Zap', icon: Zap },
  { name: 'Star', icon: Star },
  { name: 'CreditCard', icon: CreditCard },
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Bell', icon: Bell },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Coffee', icon: Coffee },
]

function getIcon(name: string): LucideIcon {
  return ICON_OPTIONS.find(o => o.name === name)?.icon ?? ClipboardList
}
```

**Key difference for ClientPage.tsx:** Return type must be `React.ComponentType<{ className?: string }>` (not `LucideIcon`) because `FoodDrinkCombo` is a custom component, not a Lucide icon. Both `LucideIcon` and the custom component satisfy this looser type.

---

## Icon Rendering — Exact className Values

**Features grid icon box** (`w-12 h-12` container):
```tsx
<Icon className="w-6 h-6 text-primary" />
```

**Steps section icon:**
```tsx
<Icon className="w-8 h-8" />
```

**FoodDrinkCombo must** strip `w-*` and `h-*` from the incoming `className` and apply its own sizes (`w-4 h-4` each), passing the remaining classes (like `text-primary`) through.

---

## Lucide-react Availability

- Version: `^0.475.0`
- `Sandwich` ✓ confirmed in this version
- `CupSoda` ✓ confirmed in this version

---

## SettingsClient.tsx — What Needs Adding

Add to `ICON_OPTIONS` array:
```tsx
{ name: 'Sandwich', icon: Sandwich },
{ name: 'CupSoda', icon: CupSoda },
```

Add to imports:
```tsx
import { ..., Sandwich, CupSoda } from 'lucide-react'
```

Note: `FoodDrink` combo does NOT need to appear in `ICON_OPTIONS` — it's a special internal name registered only in ClientPage's `getIcon()`. Admins pick `Sandwich` or `CupSoda` individually via the picker; `FoodDrink` is set programmatically.

---

## Implementation Notes

1. **FoodDrinkCombo implementation:**
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
   This strips size classes, preserves color classes like `text-primary`, and fits in the `w-12 h-12` icon box.

2. **getIcon() in ClientPage.tsx:**
   - Return type: `React.ComponentType<{ className?: string }>` (not `LucideIcon`)
   - Map must include all icons already used in the hardcoded arrays: `Globe, QrCode, Sparkles, ShoppingCart, UserPlus, UtensilsCrossed`
   - Also include icons from SettingsClient's map for consistency: `MessageCircle, Zap, Star, ChefHat, CreditCard, BookOpen, Coffee, BarChart2, Search`
   - Add new: `Sandwich, CupSoda`
   - Register `FoodDrink: FoodDrinkCombo`
   - Fallback: `Globe`

3. **No changes to hardcoded `features` and `steps` fallback arrays** — those are the static defaults used when DB returns nothing. Only the `resolvedFeatures` and `resolvedSteps` maps need fixing.

4. **Zero visual change** — the DB currently stores the same icons that the array-index fallback would have picked. After this fix, the page looks identical but admin changes will now take effect.

---

## Verification Approach

1. Dev server: marketing page renders identically before and after
2. Superadmin settings: change a feature icon → marketing page updates on refresh
3. Admin icon picker: `Sandwich` and `CupSoda` appear as options
4. TypeScript build: no errors on `getIcon()` return type (`React.ComponentType<{ className?: string }>`)
