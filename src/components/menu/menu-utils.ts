import type { Product, IngredientModifications } from '@/types/database'

export function getProductImages(product: Product) {
  const fromArray = (product.image_urls ?? []).map(url => url?.trim()).filter(Boolean) as string[]
  const fromSingle = product.image_url?.trim() ? [product.image_url.trim()] : []
  return Array.from(new Set([...fromArray, ...fromSingle]))
}

export function isProductVisibleInFeed(product: { show_in_feed?: boolean | null }) {
  return product.show_in_feed !== false
}

export type UICopyEntry = {
  search: string; all: string; featured: string; noItems: string; tryAnother: string;
  other: string; createAccount: string; hoursBtn: string; hoursTitle: string;
  viewFeed: string; viewMenu: string; feedEmptyTitle: string; feedEmptyDescription: string;
  required: string; chooseUpTo: string; chooseAtLeast: string; chooseBetween: string;
  firstHalf: string; secondHalf: string;
  orderPlaced: string; orderNumber: string; orderThankYou: string;
}

export const UI_COPY: Record<string, UICopyEntry> = {
  en: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'Schedule', hoursTitle: 'Opening hours', viewFeed: 'View feed', viewMenu: 'View menu', feedEmptyTitle: 'The visual feed is being prepared', feedEmptyDescription: 'Explore the full menu to see every available item.', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}-{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  pt: { search: 'Buscar no cardápio...', all: 'Todos', featured: 'Destaques', noItems: 'Nenhum item encontrado', tryAnother: 'Tente outro termo de busca', other: 'Outro', createAccount: 'Criar conta', hoursBtn: 'Schedule', hoursTitle: 'Horário de funcionamento', viewFeed: 'Ver feed', viewMenu: 'Ver cardápio', feedEmptyTitle: 'O feed visual está sendo preparado', feedEmptyDescription: 'Explore o cardápio completo para ver todos os itens disponíveis.', required: 'Obrigatório', chooseUpTo: 'Escolha até {max}', chooseAtLeast: 'Escolha pelo menos {min}', chooseBetween: 'Escolha {min}-{max}', firstHalf: '1º tempo', secondHalf: '2º tempo', orderPlaced: 'Pedido realizado!', orderNumber: 'Pedido', orderThankYou: 'Obrigado pelo seu pedido.' },
  es: { search: 'Buscar en el menú...', all: 'Todos', featured: 'Destacados', noItems: 'No se encontraron artículos', tryAnother: 'Intenta otro término de búsqueda', other: 'Otro', createAccount: 'Crear cuenta', hoursBtn: 'Schedule', hoursTitle: 'Horario de atención', viewFeed: 'Ver feed', viewMenu: 'Ver menú', feedEmptyTitle: 'El feed visual se está preparando', feedEmptyDescription: 'Explora el menú completo para ver todos los artículos disponibles.', required: 'Requerido', chooseUpTo: 'Elige hasta {max}', chooseAtLeast: 'Elige al menos {min}', chooseBetween: 'Elige {min}-{max}', firstHalf: '1er tiempo', secondHalf: '2do tiempo', orderPlaced: '¡Pedido realizado!', orderNumber: 'Pedido', orderThankYou: 'Gracias por tu pedido.' },
  fr: { search: 'Rechercher dans le menu...', all: 'Tous', featured: 'À la une', noItems: 'Aucun article trouvé', tryAnother: 'Essayez un autre terme', other: 'Autre', createAccount: 'Créer un compte', hoursBtn: 'Schedule', hoursTitle: "Heures d'ouverture", viewFeed: 'Voir le feed', viewMenu: 'Voir le menu', feedEmptyTitle: 'Le feed visuel est en préparation', feedEmptyDescription: 'Consultez le menu complet pour voir tous les articles disponibles.', required: 'Obligatoire', chooseUpTo: "Choisissez jusqu'à {max}", chooseAtLeast: 'Choisissez au moins {min}', chooseBetween: 'Choisissez {min}-{max}', firstHalf: '1ère mi-temps', secondHalf: '2ème mi-temps', orderPlaced: 'Commande passée !', orderNumber: 'Commande', orderThankYou: 'Merci pour votre commande.' },
  de: { search: 'Menü durchsuchen...', all: 'Alle', featured: 'Empfohlen', noItems: 'Keine Artikel gefunden', tryAnother: 'Versuchen Sie einen anderen Suchbegriff', other: 'Sonstiges', createAccount: 'Konto erstellen', hoursBtn: 'Schedule', hoursTitle: 'Öffnungszeiten', viewFeed: 'Feed ansehen', viewMenu: 'Menü ansehen', feedEmptyTitle: 'Der visuelle Feed wird vorbereitet', feedEmptyDescription: 'Im vollständigen Menü finden Sie alle verfügbaren Artikel.', required: 'Pflichtfeld', chooseUpTo: 'Bis zu {max} wählen', chooseAtLeast: 'Mindestens {min} wählen', chooseBetween: '{min}-{max} wählen', firstHalf: '1. Halbzeit', secondHalf: '2. Halbzeit', orderPlaced: 'Bestellung aufgegeben!', orderNumber: 'Bestellung', orderThankYou: 'Danke für Ihre Bestellung.' },
  it: { search: 'Cerca nel menu...', all: 'Tutti', featured: 'In evidenza', noItems: 'Nessun articolo trovato', tryAnother: 'Prova un termine di ricerca diverso', other: 'Altro', createAccount: 'Crea account', hoursBtn: 'Schedule', hoursTitle: 'Orari di apertura', viewFeed: 'Vedi feed', viewMenu: 'Vedi menu', feedEmptyTitle: 'Il feed visivo è in preparazione', feedEmptyDescription: 'Esplora il menu completo per vedere tutti gli articoli disponibili.', required: 'Obbligatorio', chooseUpTo: 'Scegli fino a {max}', chooseAtLeast: 'Scegli almeno {min}', chooseBetween: 'Scegli {min}-{max}', firstHalf: '1° tempo', secondHalf: '2° tempo', orderPlaced: 'Ordine effettuato!', orderNumber: 'Ordine', orderThankYou: 'Grazie per il tuo ordine.' },
}

// Raw ProductModal selection state, kept on the cart item so the customer can
// re-open the customization flow ("Edit") with all choices pre-filled.
export interface CartEditorState {
  singleSelections: Record<string, string>
  halfSelections: Record<string, { half1: string | null; half2: string | null }>
  multiSelections: Record<string, string[]>
  ingredientSteppers: Record<string, number>
  addedIngredients: string[]
  note: string
}

export interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string
  note?: string  // per-item customer note | does NOT affect buildCartKey
  ingredientModifications?: IngredientModifications | null  // INGR-09: per D-07 slot metadata
  editorState?: CartEditorState | null  // raw selections for the Edit flow | does NOT affect buildCartKey
}

export function buildCartKey(productId: string, selectedOptions: Record<string, unknown>): string {
  return `${productId}::${JSON.stringify(
    Object.fromEntries(Object.entries(selectedOptions).sort(([a], [b]) => a.localeCompare(b)))
  )}`
}

// Compact "Key: value" list of the chosen option groups, skipping empty values.
export function summarizeOptions(selectedOptions: Record<string, unknown>): string {
  return Object.entries(selectedOptions)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

// Human-readable labels for ingredient changes, e.g. ["No Onion", "Extra Cheese", "+ Bacon"].
export function summarizeIngredientMods(mods: IngredientModifications | null | undefined): string[] {
  if (!mods) return []
  const labels: string[] = []
  for (const r of mods.removed ?? []) labels.push(`No ${r.name}`)
  for (const e of mods.extras ?? []) labels.push(`Extra ${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`)
  for (const a of mods.added ?? []) labels.push(`+ ${a.name}${a.qty > 1 ? ` ×${a.qty}` : ''}`)
  return labels
}
