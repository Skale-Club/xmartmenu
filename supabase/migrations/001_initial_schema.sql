-- ============================================================
-- Skale QR Menu — Schema inicial
-- ============================================================

-- TENANTS
CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- TENANT SETTINGS (branding)
CREATE TABLE tenant_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url       TEXT,
  primary_color  TEXT DEFAULT '#000000',
  accent_color   TEXT DEFAULT '#FF5722',
  banner_url     TEXT,
  address        TEXT,
  phone          TEXT,
  instagram      TEXT,
  whatsapp       TEXT,
  business_hours JSONB,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- PROFILES (espelha auth.users)
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
  full_name  TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CATEGORIES
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- PRODUCTS
CREATE TABLE products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id    UUID REFERENCES categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  price          NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  image_url      TEXT,
  is_available   BOOLEAN DEFAULT true,
  is_featured    BOOLEAN DEFAULT false,
  tags           TEXT[] DEFAULT '{}',
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- QR CODES
CREATE TABLE qr_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label      TEXT,
  target_url TEXT NOT NULL,
  scans      INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SCAN EVENTS
CREATE TABLE scan_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  qr_code_id  UUID REFERENCES qr_codes(id) ON DELETE SET NULL,
  scanned_at  TIMESTAMPTZ DEFAULT now(),
  user_agent  TEXT,
  country     TEXT
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_categories_tenant ON categories(tenant_id);
CREATE INDEX idx_scan_events_tenant ON scan_events(tenant_id);
CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ============================================================
-- TRIGGER: atualiza updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: cria profile automaticamente ao cadastrar usuário
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

-- Helper: retorna tenant_id do usuário autenticado
CREATE OR REPLACE FUNCTION auth_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Helper: verifica se é superadmin
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- TENANTS: superadmin vê tudo, admin vê só o próprio
CREATE POLICY "tenants_superadmin" ON tenants FOR ALL
  USING (is_superadmin());
CREATE POLICY "tenants_self" ON tenants FOR SELECT
  USING (id = auth_tenant_id());

-- TENANT_SETTINGS: mesma lógica
CREATE POLICY "settings_superadmin" ON tenant_settings FOR ALL
  USING (is_superadmin());
CREATE POLICY "settings_self" ON tenant_settings
  USING (tenant_id = auth_tenant_id());

-- PROFILES
CREATE POLICY "profiles_self" ON profiles FOR SELECT
  USING (id = auth.uid() OR is_superadmin());
CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- CATEGORIES: admins gerenciam as próprias, página pública lê todas ativas
CREATE POLICY "categories_admin" ON categories
  USING (tenant_id = auth_tenant_id() OR is_superadmin());
CREATE POLICY "categories_public" ON categories FOR SELECT
  USING (is_active = true);

-- PRODUCTS: admins gerenciam os próprios, página pública lê disponíveis
CREATE POLICY "products_admin" ON products
  USING (tenant_id = auth_tenant_id() OR is_superadmin());
CREATE POLICY "products_public" ON products FOR SELECT
  USING (is_available = true);

-- QR CODES
CREATE POLICY "qrcodes_admin" ON qr_codes
  USING (tenant_id = auth_tenant_id() OR is_superadmin());

-- SCAN EVENTS: qualquer um insere (anon), admin lê os próprios
CREATE POLICY "scan_insert_anon" ON scan_events FOR INSERT
  WITH CHECK (true);
CREATE POLICY "scan_read_admin" ON scan_events FOR SELECT
  USING (tenant_id = auth_tenant_id() OR is_superadmin());
