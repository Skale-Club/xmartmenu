-- Make the visual feed available by default while the application limits the
-- experience itself to mobile viewports. Existing tenants are enabled once;
-- administrators can still disable the feature afterwards.

ALTER TABLE public.tenant_settings
  ALTER COLUMN visual_feed_enabled SET DEFAULT TRUE;

UPDATE public.tenant_settings
SET visual_feed_enabled = TRUE
WHERE visual_feed_enabled = FALSE;
