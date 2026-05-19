export type UserRole = 'superadmin' | 'store-admin' | 'store-staff' | 'customer'

// ============================================================
// Plan types (SEED-009 Phase A - v2.0 Monetization)
// ============================================================

// Plan lookup table row
export interface Plan {
  id: string
  name: string
  slug: string
  description: string | null
  monthly_price: number
  annual_price: number
  transaction_fee_pct: number
  features: string[]
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// Effective plan with resolved overrides (returned by getTenantPlan)
export interface EffectivePlan {
  id: string
  name: string
  slug: string
  description: string | null
  monthly_price: number
  annual_price: number
  transaction_fee_pct: number
  features: string[]
  billing_cycle: 'monthly' | 'annual'
  status: 'active' | 'cancelled' | 'trial' | 'past_due'
  is_grandfathered: boolean
}

// Per-tenant subscription with override support
export interface TenantSubscription {
  id: string
  tenant_id: string
  plan_id: string
  billing_cycle: 'monthly' | 'annual'
  status: 'active' | 'cancelled' | 'trial' | 'past_due'
  override_monthly_price: number | null
  override_annual_price: number | null
  override_transaction_fee_pct: number | null
  override_notes: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
  // Joined fields
  plan?: Plan
}

// Per-tenant Stripe Connect account
export interface StripeConnection {
  id: string
  tenant_id: string
  stripe_account_id: string
  scope: string
  connected_at: string
  is_active: boolean
  disconnected_at: string | null
  created_at: string
  updated_at: string
}

// Webhook idempotency tracking
export interface ProcessedStripeEvent {
  event_id: string
  event_type: string
  processed_at: string
}

export interface Tenant {
  id: string
  slug: string
  name: string
  plan: Plan
  is_active: boolean
  created_at: string
  updated_at: string
  custom_domain: string | null
  custom_domain_verified: boolean
}

export interface TenantSettings {
  id: string
  tenant_id: string
  logo_url: string | null
  primary_color: string
  accent_color: string
  banner_url: string | null
  address: string | null
  phone: string | null
  instagram: string | null
  whatsapp: string | null
  business_hours: BusinessHours | null
  custom_tags: string[] | null
  currency: string
  language: string
  whatsapp_orders_enabled: boolean
  orders_enabled: boolean
  direct_orders_enabled: boolean
  item_notes_enabled: boolean  // NOTE-01: per-item notes feature flag (migration 025)
  ingredient_customization_enabled: boolean  // INGR-03: ingredient customization opt-in (migration 026)
  amber_threshold_minutes: number  // KDS-07: amber urgency threshold in minutes (default 10)
  red_threshold_minutes: number    // KDS-07: red urgency threshold in minutes (default 20)
  dine_in_enabled: boolean          // ORD-01: dine-in mode flag (migration 034, default true)
  pickup_enabled: boolean           // ORD-01: pick-up mode flag (migration 034, default false)
  delivery_enabled: boolean         // ORD-01: delivery mode flag (migration 034, default false)
  pickup_eta_minutes: number        // ORD-02: estimated pick-up time in minutes (default 20)
  delivery_fee_cents: number        // ORD-03: delivery fee in cents (default 0)
  tips_enabled: boolean             // SEED-017: tip feature flag (migration 038, default false)
  tip_percentage_1: number          // SEED-017: first tip preset % (default 15)
  tip_percentage_2: number          // SEED-017: second tip preset % (default 18)
  tip_percentage_3: number          // SEED-017: third tip preset % (default 20)
  table_management_enabled: boolean // SEED-023: table management feature flag (migration 043, default false)
  updated_at: string
  // AI-04: New fields added in migration 022
  business_type: string | null
  tagline: string | null
  about: string | null
}

export interface BusinessHours {
  mon?: string
  tue?: string
  wed?: string
  thu?: string
  fri?: string
  sat?: string
  sun?: string
}

export interface Profile {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string | null
  must_change_password: boolean
  password_changed_at: string | null
  created_at: string
}

export interface Category {
  id: string
  tenant_id: string
  menu_id: string | null
  name: string
  translations?: Record<string, { name?: string; description?: string }>
  description: string | null
  position: number
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  tenant_id: string
  menu_id: string | null
  category_id: string | null
  name: string
  translations?: Record<string, { name?: string; description?: string }>
  description: string | null
  price: number
  original_price: number | null
  image_url: string | null
  image_urls: string[]
  is_available: boolean
  is_featured: boolean
  tags: string[]
  position: number
  created_at: string
  updated_at: string
}

export interface QRCode {
  id: string
  tenant_id: string
  label: string | null
  target_url: string
  scans: number
  created_at: string
}

export interface ScanEvent {
  id: string
  tenant_id: string
  qr_code_id: string | null
  scanned_at: string
  user_agent: string | null
  country: string | null
}

// Joined types
export interface ProductWithCategory extends Product {
  category: Category | null
}

export interface TenantWithSettings extends Tenant {
  tenant_settings: TenantSettings | null
}

export interface Menu {
  id: string
  tenant_id: string
  name: string
  slug: string
  description: string | null
  language: string
  supported_languages: string[]
  translations: Record<string, { name?: string; description?: string }>
  purpose: string
  is_active: boolean
  is_default: boolean
  is_private: boolean        // SEED-019: private menu requires customer OTP login (migration 040)
  price_multiplier: number   // SEED-019: multiply product prices (1.0 = base, 1.15 = +15%)
  position: number
  created_at: string
}

export interface Location {
  id: string
  tenant_id: string
  name: string
  slug: string
  address: string | null
  city: string | null
  phone: string | null
  business_hours: Record<string, string> | null
  menu_id: string | null           // LOC-05: null = shared/default menu (migration 037)
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  tenant_id: string
  customer_name: string
  customer_phone: string
  status: 'pending' | 'paid' | 'payment_failed' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled'
  total: number
  payment_intent_id: string | null
  order_type: 'dine_in' | 'pickup' | 'delivery'   // ORD-06 (migration 035, default 'dine_in')
  delivery_address: string | null                   // ORD-05 (migration 035, null for non-delivery)
  location_id: string | null                        // LOC-06 (migration 037, null = no branch)
  tip_cents: number                                  // SEED-017 (migration 038, always 0 when no tip)
  delivery_street: string | null                     // SEED-020 (migration 041)
  delivery_complement: string | null                 // SEED-020 (migration 041)
  delivery_zipcode: string | null                    // SEED-020 (migration 041)
  delivery_city: string | null                       // SEED-020 (migration 041)
  delivery_notes: string | null                      // SEED-020 (migration 041)
  delivery_zone_id: string | null                    // SEED-020 (migration 041)
  table_name: string | null                           // SEED-023 (migration 043)
  notes: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  selected_options: Record<string, unknown> | null
  notes: string | null
  ingredient_modifications: IngredientModifications | null  // INGR-04: structured modifications (migration 026)
}

export interface DeliveryZone {
  id: string
  tenant_id: string
  name: string
  fee_cents: number
  zipcode_prefixes: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

// SEED-021: per-product media item (image or video)
export interface ProductMedia {
  id: string
  product_id: string
  tenant_id: string
  type: 'image' | 'video'
  url: string
  storage_path: string | null
  display_order: number
  created_at: string
}

// SEED-023: restaurant table in the table catalog
export interface RestaurantTable {
  id: string
  tenant_id: string
  name: string
  position: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CustomerProfile {
  id: string        // auth user ID
  phone: string     // E.164 format
  name: string | null
  created_at: string
}

export interface AiUsage {
  id: string
  tenant_id: string
  feature_key: string   // e.g. 'text_seed', 'image_seed', 'ocr'
  date: string          // 'YYYY-MM-DD'
  call_count: number
  token_count: number
  created_at: string
}

export interface AiJob {
  id: string
  tenant_id: string
  feature_key: string                                    // e.g. 'image_seeding', 'image_single'
  status: 'pending' | 'running' | 'complete' | 'failed'
  created_at: string
  completed_at: string | null
  error_message: string | null
}

export type OptionGroupType = 'single' | 'multiple' | 'half_and_half'
export type PriceRule = 'max' | 'average' | 'sum' | 'fixed'

export interface ProductOptionGroup {
  id: string
  product_id: string
  tenant_id: string
  name: string
  type: OptionGroupType
  required: boolean
  min_selections: number
  max_selections: number | null
  price_rule: PriceRule
  position: number
  translations: Record<string, { name?: string }>
  created_at: string
  updated_at: string
}

export interface ProductOption {
  id: string
  group_id: string
  tenant_id: string
  name: string
  base_price: number | null
  price_modifier: number
  is_available: boolean
  position: number
  translations: Record<string, { name?: string }>
  created_at: string
  updated_at: string
}

// ============================================================
// Ingredient Catalog types (v1.7 | migration 026)
// ============================================================

// INGR-01: Ingredient catalog entry per tenant
export interface Ingredient {
  id: string
  tenant_id: string
  name: string
  image_url: string | null
  default_extra_price: number
  default_add_price: number
  is_available: boolean
  position: number
  translations: Record<string, { name?: string }>
  created_at: string
  updated_at: string
}

// INGR-02: Product–ingredient association with per-product price overrides
export interface ProductIngredient {
  product_id: string
  ingredient_id: string
  tenant_id: string
  is_default: boolean
  extra_price_override: number | null
  add_price_override: number | null
  position: number
}

// Joined type: product_ingredient row with its ingredient details
export interface ProductIngredientWithIngredient extends ProductIngredient {
  ingredient: Ingredient
}

// INGR-04: Structured ingredient modification types for order_items JSONB
export interface IngredientRemoval {
  ingredient_id: string
  name: string
}

export interface IngredientExtra {
  ingredient_id: string
  name: string
  qty: number
  unit_price: number
}

export interface IngredientModifications {
  removed: IngredientRemoval[]
  extras: IngredientExtra[]
  added: IngredientExtra[]
}
