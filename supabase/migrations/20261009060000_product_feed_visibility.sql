-- Per-product control for the mobile visual feed.
-- Existing products remain visible so enabling the feature does not change a menu unexpectedly.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS show_in_feed BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.products.show_in_feed IS
  'Controls whether the product appears in the mobile visual feed. It remains visible in the classic menu.';
