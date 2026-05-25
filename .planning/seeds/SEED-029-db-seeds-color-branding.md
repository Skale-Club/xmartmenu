---
id: SEED-029
status: blocked
planted: 2026-05-25
planted_during: home-page-rebrand-planning
trigger_when: after SEED-025, SEED-026, SEED-027, SEED-028 are all visually confirmed and committed
scope: small
---

# SEED-029: DB Seeds for New Color and Branding Defaults (Wave 5)

## Why This Matters

After the visual changes land, seed/default data still references the old yellow color. New tenants onboarded after the rebrand should receive red as the default primary color. The platform settings landing JSONB also needs the Online Ordering icon updated to `FoodDrink`.

**Do not run before Waves 1–4 are confirmed deployed** — the `FoodDrink` icon name is only valid once SEED-025 exists in the codebase.

---

## What To Build

### 1. Locate existing seed files first
Before writing anything, check:
- `supabase/seed.sql`
- `supabase/seeds/` directory
- Migration files with `INSERT INTO platform_settings` or `INSERT INTO tenant_settings`

Find every occurrence of `EEFF00`, `CBFF00`, `#000000` (old default_primary_color), and update in place. Use UPSERT or `ON CONFLICT DO UPDATE` — do not INSERT duplicate rows.

### 2. Update `platform_settings` defaults
- `cta_color = '#F52323'`
- `default_primary_color = '#F52323'` (if column exists)
- In `landing` JSONB: set `features.items[3].icon = 'FoodDrink'` (0-indexed, position 3 = Online Ordering card)

For the JSONB update:
```sql
UPDATE platform_settings
SET landing = jsonb_set(
  landing,
  '{features,items,3,icon}',
  '"FoodDrink"'
);
```

### 3. Update default tenant branding seed
- `primary_color = '#F52323'` in the default `tenant_settings` row

### 4. Verify no stale yellow references remain
After updating, grep all seed and migration files for:
- `EEFF00`
- `CBFF00`
- `yellow` (in color context)

Confirm zero matches before closing this seed.

---

## Constraints

- Do not run before all visual waves are confirmed deployed
- UPSERT / UPDATE only — do not INSERT duplicate platform_settings rows
- Do not modify existing tenant data — only seed/default rows
- `FoodDrink` icon name is only valid after SEED-025 is deployed

---

## Verification

1. Fresh onboarding produces a tenant with `primary_color = '#F52323'`
2. Platform settings page shows red as the default CTA color
3. Default landing JSONB Online Ordering feature has `icon: 'FoodDrink'`
4. No `#EEFF00` or `#CBFF00` anywhere in seed or migration files
