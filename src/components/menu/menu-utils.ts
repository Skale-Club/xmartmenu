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
  en: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours', required: 'Required', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}', chooseBetween: 'Choose {min}–{max}', firstHalf: '1st half', secondHalf: '2nd half', orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you for your order.' },
  pt: { search: 'Buscar no cardápio...', all: 'Todos', featured: 'Destaques', noItems: 'Nenhum item encontrado', tryAnother: 'Tente outro termo de busca', other: 'Outros', createAccount: 'Criar conta', hoursBtn: 'Veja nossos horários', hoursTitle: 'Horários de funcionamento', required: 'Obrigatório', chooseUpTo: 'Escolha até {max}', chooseAtLeast: 'Escolha pelo menos {min}', chooseBetween: 'Escolha {min}–{max}', firstHalf: '1ª metade', secondHalf: '2ª metade', orderPlaced: 'Pedido realizado!', orderNumber: 'Pedido', orderThankYou: 'Obrigado pelo seu pedido.' },
  es: { search: 'Buscar en el menú...', all: 'Todos', featured: 'Destacados', noItems: 'No se encontraron items', tryAnother: 'Prueba otro término de búsqueda', other: 'Otros', createAccount: 'Crear cuenta', hoursBtn: 'Ver nuestros horarios', hoursTitle: 'Horarios de atención', required: 'Obligatorio', chooseUpTo: 'Elige hasta {max}', chooseAtLeast: 'Elige al menos {min}', chooseBetween: 'Elige {min}–{max}', firstHalf: '1ª mitad', secondHalf: '2ª mitad', orderPlaced: '¡Pedido realizado!', orderNumber: 'Pedido', orderThankYou: 'Gracias por tu pedido.' },
  fr: { search: 'Rechercher dans le menu...', all: 'Tous', featured: 'En vedette', noItems: 'Aucun article trouvé', tryAnother: 'Essayez un autre terme', other: 'Autres', createAccount: 'Créer un compte', hoursBtn: 'Voir nos horaires', hoursTitle: 'Horaires d\'ouverture', required: 'Obligatoire', chooseUpTo: 'Choisissez jusqu\'à {max}', chooseAtLeast: 'Choisissez au moins {min}', chooseBetween: 'Choisissez {min}–{max}', firstHalf: '1re moitié', secondHalf: '2e moitié', orderPlaced: 'Commande passée !', orderNumber: 'Commande', orderThankYou: 'Merci pour votre commande.' },
  de: { search: 'Im Menü suchen...', all: 'Alle', featured: 'Empfohlen', noItems: 'Keine Artikel gefunden', tryAnother: 'Versuche einen anderen Suchbegriff', other: 'Andere', createAccount: 'Konto erstellen', hoursBtn: 'Öffnungszeiten', hoursTitle: 'Öffnungszeiten', required: 'Pflichtfeld', chooseUpTo: 'Wähle bis zu {max}', chooseAtLeast: 'Wähle mindestens {min}', chooseBetween: 'Wähle {min}–{max}', firstHalf: '1. Hälfte', secondHalf: '2. Hälfte', orderPlaced: 'Bestellung aufgegeben!', orderNumber: 'Bestellung', orderThankYou: 'Danke für Ihre Bestellung.' },
  it: { search: 'Cerca nel menu...', all: 'Tutti', featured: 'In evidenza', noItems: 'Nessun elemento trovato', tryAnother: 'Prova un altro termine', other: 'Altro', createAccount: 'Crea account', hoursBtn: 'Vedi i nostri orari', hoursTitle: 'Orari di apertura', required: 'Obbligatorio', chooseUpTo: 'Scegli fino a {max}', chooseAtLeast: 'Scegli almeno {min}', chooseBetween: 'Scegli {min}–{max}', firstHalf: '1a metà', secondHalf: '2a metà', orderPlaced: 'Ordine effettuato!', orderNumber: 'Ordine', orderThankYou: 'Grazie per il tuo ordine.' },
}

export interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string
  note?: string  // per-item customer note — does NOT affect buildCartKey
  ingredientModifications?: IngredientModifications | null  // INGR-09: per D-07 slot metadata
}

export function buildCartKey(productId: string, selectedOptions: Record<string, unknown>): string {
  return `${productId}::${JSON.stringify(
    Object.fromEntries(Object.entries(selectedOptions).sort(([a], [b]) => a.localeCompare(b)))
  )}`
}
