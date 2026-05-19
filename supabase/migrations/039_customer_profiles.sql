-- SEED-018: Customer Phone OTP Login + Customer Panel
-- customer_profiles: lightweight record per phone identity

CREATE TABLE IF NOT EXISTS customer_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: customers can only see/update their own profile
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_profiles_self"
  ON customer_profiles
  USING (id = auth.uid());

CREATE POLICY "customer_profiles_self_insert"
  ON customer_profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- Index for fast order lookup by phone (Phase D)
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON orders(customer_phone)
  WHERE customer_phone IS NOT NULL AND customer_phone != '';
