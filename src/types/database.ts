export type UserRole = 'superadmin' | 'admin'
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
  created_at: string
}

export interface Category {
  id: string
  tenant_id: string
  name: string
  description: string | null
  position: number
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  tenant_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  original_price: number | null
  image_url: string | null
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
