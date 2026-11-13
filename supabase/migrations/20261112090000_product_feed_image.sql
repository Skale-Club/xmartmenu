-- Dedicated portrait still for the visual feed; ordinary galleries stay unchanged.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS feed_image_url text NULL;
COMMENT ON COLUMN public.products.feed_image_url IS 'Optional authored portrait scene for the visual feed; excluded from ordinary product galleries.';
