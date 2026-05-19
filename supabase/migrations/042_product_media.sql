-- SEED-021: Product Media Gallery (Multi-Photo + Video)
-- Creates product_media table for multi-image and video per product.
-- products.image_url stays as backward-compat primary thumbnail.

CREATE TABLE IF NOT EXISTS product_media (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (type IN ('image', 'video')),
  url              TEXT        NOT NULL,
  storage_path     TEXT        NULL,       -- bucket path for uploaded files; NULL for external video embeds
  display_order    INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_media_product_id_idx  ON product_media (product_id);
CREATE INDEX IF NOT EXISTS product_media_tenant_id_idx   ON product_media (tenant_id);

-- Seed one image row from existing image_url for products that have one
INSERT INTO product_media (product_id, tenant_id, type, url, display_order)
SELECT id, tenant_id, 'image', image_url, 0
FROM products
WHERE image_url IS NOT NULL
  AND image_url <> ''
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;

-- Public read: any authenticated or anonymous user can read product_media
-- (the public menu page uses the service client, so this covers the read path)
CREATE POLICY "product_media_public_read"
  ON product_media FOR SELECT
  USING (true);

-- Tenant write: only the owning tenant's admin/staff can insert/update/delete
CREATE POLICY "product_media_tenant_write"
  ON product_media FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );
