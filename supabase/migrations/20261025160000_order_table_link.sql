-- Orders know which table they came from.
--
-- Each table has its own menu link (…/{slug}?table=<id>) for its QR code or
-- NFC tag. A guest ordering from it — or a waiter ordering for it — stores
-- the table here; table_name keeps the name as it was when ordered, for the
-- kitchen ticket and history, even if the table is renamed or removed.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_table_id_created_idx
  ON public.orders (table_id, created_at DESC)
  WHERE table_id IS NOT NULL;
