-- Migration 029: custom_domain on tenants
-- Adds unique nullable TEXT column + verified flag for tenant-owned custom domains
-- Idempotent: drops and re-adds constraints/columns if re-running

-- Step 1: Drop existing constraint if re-running
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_custom_domain_key'
  ) THEN
    ALTER TABLE tenants DROP CONSTRAINT tenants_custom_domain_key;
  END IF;
END $$;

-- Step 2: Drop verified constraint if re-running
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_custom_domain_verified_key'
  ) THEN
    ALTER TABLE tenants DROP CONSTRAINT tenants_custom_domain_verified_key;
  END IF;
END $$;

-- Step 3: Drop column if re-applying
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'custom_domain'
  ) THEN
    ALTER TABLE tenants DROP COLUMN custom_domain;
  END IF;
END $$;

-- Step 4: Drop verified column if re-applying
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'custom_domain_verified'
  ) THEN
    ALTER TABLE tenants DROP COLUMN custom_domain_verified;
  END IF;
END $$;

-- Step 5: Add columns
ALTER TABLE tenants ADD COLUMN custom_domain TEXT;
ALTER TABLE tenants ADD COLUMN custom_domain_verified BOOLEAN NOT NULL DEFAULT false;

-- Step 6: Add unique constraint on custom_domain (NULL-safe: SQL UNIQUE allows multiple NULLs)
ALTER TABLE tenants ADD CONSTRAINT tenants_custom_domain_key UNIQUE (custom_domain);

-- Step 7: Create index for fast hostname lookup (partial: only non-null values)
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain ON tenants(custom_domain)
  WHERE custom_domain IS NOT NULL;
