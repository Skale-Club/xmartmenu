-- Migration 005: Update role system
-- Renames 'admin' to 'store-admin' and adds 'store-staff' and 'customer' roles

-- 1. Drop existing CHECK constraint
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Rename existing 'admin' roles to 'store-admin'
UPDATE profiles SET role = 'store-admin' WHERE role = 'admin';

-- 3. Add new CHECK constraint with updated role values
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'store-admin', 'store-staff', 'customer'));

-- 4. Update column default
ALTER TABLE profiles
  ALTER COLUMN role SET DEFAULT 'store-admin';
