-- Migration 046: rebrand default color #EEFF00 → #F52323
-- Phase 49: Update cta_color column default and existing platform_settings row.
-- The landing JSONB features icon (FoodDrink) is managed via the superadmin settings panel.

-- 1. Change column default so new installs use red
ALTER TABLE platform_settings
  ALTER COLUMN cta_color SET DEFAULT '#F52323';

-- 2. Update the existing singleton row if it still has the old yellow default
UPDATE platform_settings
SET cta_color = '#F52323'
WHERE cta_color = '#EEFF00' OR cta_color = '#CBFF00';
