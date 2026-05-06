export type UserRole = 'superadmin' | 'store-admin' | 'store-staff' | 'customer'
export type Plan = 'free' | 'pro' | 'enterprise'

export interface Tenant {
  id: string
  slug: string
  name: string
  plan: Plan
  is_active: boolean
  created_at: string
  updated_at: string
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
  updated_at: string
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
  position: number
  created_at: string
}

export interface Order {
  id: string
  tenant_id: string
  customer_name: string
  customer_phone: string
  status: 'pending' | 'preparing' | 'ready' | 'done' | 'cancelled'
  total: number
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
