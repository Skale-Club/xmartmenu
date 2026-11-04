import type { Location, TenantSettings } from '@/types/database'
import type { TenantCapabilities } from './service-modes'
import { buildSystemPrompt, formatMenuContext, parseCartSnapshot, type MenuCatalog } from './chat-agent'
import { computeOpenStatus, describeOrdering, describeProfile, resolveTimeZone, type DeliveryZone } from './chat-context'
import { MENU_LANGUAGE_CODES, menuLanguage } from '@/components/menu/menu-i18n'

export interface PublicChatBody {
  menu_id?: unknown; location_id?: unknown; table_id?: unknown; cart?: unknown; language?: unknown; voice_token?: unknown
}
export type ChatSettings = Omit<Partial<TenantSettings>, 'business_hours'> & { business_hours?: Record<string, string | null | undefined> | null }
export type ChatLocation = Pick<Location, 'id' | 'name' | 'address' | 'city' | 'region' | 'postal_code' | 'country' | 'phone' | 'business_hours'>
export interface PublicChatPromptContext {
  tenantName: string; settingsRow: ChatSettings; capabilities: TenantCapabilities; catalog: MenuCatalog | null
  locations: ChatLocation[]; zones: DeliveryZone[]; onlinePayment: boolean; canAddToCart: boolean; body: PublicChatBody | null
}
/** Same pure prompt assembly for legacy/native data; no DB or provider access. */
export function buildPublicChatPrompt(input: PublicChatPromptContext, now = new Date()) {
  const { tenantName, settingsRow, capabilities, catalog, locations, zones, onlinePayment, canAddToCart, body } = input
  const locationId = typeof body?.location_id === 'string' ? body.location_id : null
  const location = locationId ? locations.find(row => row.id === locationId) ?? null : null
  const hours = location?.business_hours && Object.values(location.business_hours).some(Boolean) ? location.business_hours : settingsRow.business_hours
  const country = location?.country ?? settingsRow.country
  const region = location?.region ?? settingsRow.region
  const timeZone = resolveTimeZone({ country, region, currency: settingsRow.currency })
  const profile = describeProfile({
    name: tenantName, locationName: location?.name ?? null, tagline: settingsRow.tagline, about: settingsRow.about,
    cuisine: settingsRow.business_type, priceRange: settingsRow.price_range, address: location?.address ?? settingsRow.address,
    city: location?.city ?? settingsRow.city, region, postalCode: location?.postal_code ?? settingsRow.postal_code,
    country, phone: location?.phone ?? settingsRow.phone, whatsapp: settingsRow.whatsapp, instagram: settingsRow.instagram,
    hours, otherLocations: locations.filter(row => row.id !== location?.id),
  }, computeOpenStatus(hours, now, timeZone))
  return buildSystemPrompt({
    name: tenantName, profile, menuContext: formatMenuContext(catalog),
    ordering: describeOrdering(settingsRow, { onlinePayment, deliveryZones: zones, capabilities, atTable: typeof body?.table_id === 'string' && body.table_id.length > 0 }),
    canAddToCart, cart: body?.cart === undefined ? null : parseCartSnapshot(body.cart),
    guestLanguage: typeof body?.language === 'string' && (MENU_LANGUAGE_CODES as readonly string[]).includes(body.language) ? menuLanguage(body.language).englishName : null,
  })
}
