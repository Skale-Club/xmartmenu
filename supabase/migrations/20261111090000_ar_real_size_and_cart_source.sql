-- Augmented reality, second step (legacy Supabase counterpart of
-- docs/owned-schema/20261111090000_ar_real_size_and_cart_source.sql):
-- real-size correction of a dish's 3D model, and AR orders in the analytics.
--
--   product_ar_models.scale           1 = as modelled; real size / size in the file.
--   product_ar_models.model_width_cm  largest horizontal side as modelled (cm).
--   menu_events source CHECK          gains 'ar' (add_to_cart from the AR camera).

ALTER TABLE public.product_ar_models
  ADD COLUMN IF NOT EXISTS scale NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS model_width_cm NUMERIC NULL;

ALTER TABLE public.product_ar_models DROP CONSTRAINT IF EXISTS product_ar_models_scale_check;
ALTER TABLE public.product_ar_models ADD CONSTRAINT product_ar_models_scale_check CHECK (scale >= 0.05 AND scale <= 20);
ALTER TABLE public.product_ar_models DROP CONSTRAINT IF EXISTS product_ar_models_model_width_check;
ALTER TABLE public.product_ar_models ADD CONSTRAINT product_ar_models_model_width_check
  CHECK (model_width_cm IS NULL OR (model_width_cm > 0 AND model_width_cm < 10000));

ALTER TABLE public.menu_events DROP CONSTRAINT IF EXISTS menu_events_source_check;
ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_source_check CHECK (source IS NULL OR source IN (
  'grid', 'featured', 'detail', 'cart', 'checkout', 'feed', 'search', 'upsell', 'ar', 'unknown'
));
