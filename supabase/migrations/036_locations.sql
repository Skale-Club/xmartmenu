-- Migration 036: locations table for multi-branch support
-- Phase 40 adds admin CRUD only; routing + QR codes come in Phase 41

CREATE TABLE IF NOT EXISTS locations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  address        TEXT,
  city           TEXT,
  phone          TEXT,
  business_hours JSONB,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT locations_tenant_slug_unique UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS locations_tenant_id_idx ON locations(tenant_id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Tenant staff/admin can read their own locations
CREATE POLICY "locations_select_own" ON locations
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Only store-admin and above can write
CREATE POLICY "locations_insert_own" ON locations
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "locations_update_own" ON locations
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "locations_delete_own" ON locations
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
