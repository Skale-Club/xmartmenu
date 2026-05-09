import type { Product, IngredientModifications } from '@/types/database'

export function getProductImages(product: Product) {
  const fromArray = (product.image_urls ?? []).map(url => url?.trim()).filter(Boolean) as string[]
  const fromSingle = product.image_url?.trim() ? [product.image_url.trim()] : []
  return Array.from(new Set([...fromArray, ...fromSingle]))
}

export type UICopyEntry = {
  search: string; all: string; featured: string; noItems: string; tryAnother: string;
  other: string; createAccount: string; hoursBtn: string; hoursTitle: string;
  required: string; chooseUpTo: string; chooseAtLeast: string; chooseBetween: string;
  firstHalf: string; secondHalf: string;
  orderPlaced: string; orderNumber: string; orderThankYou: string;
}

export const UI_COPY: Record<string, UICopyEntry> = {
  en: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  pt: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  es: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  fr: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  de: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  it: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
}

export interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string
  note?: string  // per-item customer note | does NOT affect buildCartKey
  ingredientModifications?: IngredientModifications | null  // INGR-09: per D-07 slot metadata
}

export function buildCartKey(productId: string, selectedOptions: Record<string, unknown>): string {
  return `${productId}::${JSON.stringify(
    Object.fromEntries(Object.entries(selectedOptions).sort(([a], [b]) => a.localeCompare(b)))
  )}`
}
