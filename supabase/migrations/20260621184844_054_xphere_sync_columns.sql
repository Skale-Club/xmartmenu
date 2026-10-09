ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS xphere_account_id     text,
  ADD COLUMN IF NOT EXISTS xphere_contact_id     text,
  ADD COLUMN IF NOT EXISTS xphere_opportunity_id text,
  ADD COLUMN IF NOT EXISTS xphere_synced_at      timestamptz,
  ADD COLUMN IF NOT EXISTS xphere_sync_error     text;

COMMENT ON COLUMN tenants.xphere_account_id     IS 'v2.4 FND-01: Xphere CRM Account id returned by /api/v1/sync (upsert by external_id = tenants.id).';
COMMENT ON COLUMN tenants.xphere_contact_id     IS 'v2.4 FND-01: Xphere CRM Contact id (store-admin owner) returned by /api/v1/sync.';
COMMENT ON COLUMN tenants.xphere_opportunity_id IS 'v2.4 FND-01: Xphere CRM Opportunity id (the subscription deal) returned by /api/v1/sync.';
COMMENT ON COLUMN tenants.xphere_synced_at      IS 'v2.4 FND-05: timestamp of the last successful sync; null = never synced.';
COMMENT ON COLUMN tenants.xphere_sync_error     IS 'v2.4 FND-05: last sync error message; cleared to null on the next success.';;
