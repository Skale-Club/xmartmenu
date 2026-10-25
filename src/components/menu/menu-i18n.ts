/**
 * Everything the public menu says, in every language a menu can be offered
 * in. A restaurant writes its dishes in one language; the guest picks the
 * interface language (?lang=), and every label, button, error and hint
 * follows — nothing customer-facing is written inline in the components.
 *
 * Prices are formatted with the guest's language conventions but always in
 * the restaurant's currency (R$ 78,00 in pt, R$78.00 in en).
 */

export interface MenuLanguage {
  code: string
  /** Name in its own script, shown in the language picker. */
  nativeName: string
  /** English name, for the admin. */
  englishName: string
  /** BCP 47 tag for Intl formatting and the lang attribute. */
  locale: string
}

export const MENU_LANGUAGES: MenuLanguage[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', locale: 'en-US' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', locale: 'pt-BR' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', locale: 'es' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', locale: 'fr-FR' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', locale: 'de-DE' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', locale: 'it-IT' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', locale: 'nl-NL' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', locale: 'pl-PL' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', locale: 'tr-TR' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', locale: 'ru-RU' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', locale: 'hi-IN' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', locale: 'ja-JP' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', locale: 'ko-KR' },
  { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', locale: 'zh-CN' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', locale: 'zh-TW' },
]

/** Every code a menu may be offered in, for validation. */
export const MENU_LANGUAGE_CODES = MENU_LANGUAGES.map((l) => l.code) as [string, ...string[]]

const LANGUAGE_BY_CODE = new Map(MENU_LANGUAGES.map((l) => [l.code, l]))

export function menuLanguage(code: string | null | undefined): MenuLanguage {
  return (code && LANGUAGE_BY_CODE.get(code)) || LANGUAGE_BY_CODE.get('en')!
}

export function localeFor(code: string | null | undefined): string {
  return menuLanguage(code).locale
}

/**
 * The menu language that best matches the device's languages
 * (navigator.languages), among the ones this menu offers. "pt-BR" → pt,
 * "zh-Hant"/"zh-TW"/"zh-HK" → zh-TW, any other "zh" → zh. Null: no match.
 */
export function matchDeviceLanguage(deviceLanguages: readonly string[], supported: readonly string[]): string | null {
  const offered = new Set(supported)
  for (const raw of deviceLanguages) {
    const tag = raw.toLowerCase()
    const base = tag.split('-')[0]
    let code = base
    if (base === 'zh') code = /hant|tw|hk|mo/.test(tag) ? 'zh-TW' : 'zh'
    if (offered.has(code)) return code
  }
  return null
}

export function formatMoney(amount: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(localeFor(lang), { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/** "23:00" in pt, "11:00 PM" in en — from minutes after midnight. */
export function formatClock(minutes: number, lang: string): string {
  const m = ((minutes % 1440) + 1440) % 1440
  const date = new Date(Date.UTC(2024, 0, 1, Math.floor(m / 60), m % 60))
  const locale = localeFor(lang)
  // 24-hour locales read "00:00", not "0:00"; 12-hour ones keep "9:00 AM".
  const probe = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
  const twentyFourHour = probe.hourCycle === 'h23' || probe.hourCycle === 'h24'
  return new Intl.DateTimeFormat(locale, { hour: twentyFourHour ? '2-digit' : 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

/** Weekday name in the guest's language. 0 = Sunday. */
export function formatWeekday(dayIndex: number, lang: string): string {
  // 2024-01-07 was a Sunday.
  const date = new Date(Date.UTC(2024, 0, 7 + dayIndex, 12))
  return new Intl.DateTimeFormat(localeFor(lang), { weekday: 'long', timeZone: 'UTC' }).format(date)
}

/** Replaces {name} placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`))
}

export interface MenuCopy {
  // Navigation
  search: string; searchOpen: string; searchClose: string; featured: string; other: string
  noItems: string; tryAnother: string; viewFeed: string; viewMenu: string; language: string
  feedEmptyTitle: string; feedEmptyDescription: string
  // Hours
  hoursTitle: string; openUntil: string; closedOpensToday: string; closedOpensTomorrow: string
  closedOpensOn: string; closed: string; today: string
  // Cards and cart
  add: string; addNamed: string; removeNamed: string; decrease: string; increase: string
  viewOrder: string; yourOrder: string; cartEmpty: string; subtotal: string
  itemsOne: string; itemsMany: string; itemsFew?: string
  checkout: string; edit: string; closeCart: string; expandCart: string; shrinkCart: string
  // Dish details
  required: string; optional: string; chooseOne: string; chooseUpTo: string; chooseAtLeast: string
  chooseBetween: string; firstHalf: string; secondHalf: string; halfPrice: string
  ingredients: string; ingredientsHint: string; extras: string
  withoutNamed: string; extraNamed: string; addedNamed: string
  notes: string; notesPlaceholder: string; notesLimit: string
  addToOrder: string; updateItem: string; chooseRequired: string; orderWhatsApp: string
  whatsappMessage: string; close: string; previousDish: string; nextDish: string
  previousPhoto: string; nextPhoto: string; quantity: string
  // Checkout
  checkoutTitle: string; backToCart: string; orderType: string; dineIn: string; pickup: string
  delivery: string; deliveryAddress: string; street: string; complement: string; zipcode: string
  city: string; deliveryNotes: string; noDeliveryZone: string; tip: string; tipCustom: string
  tipAmount: string; paymentSummary: string; deliveryFee: string; total: string
  yourDetails: string; yourName: string; phone: string; placeOrder: string; placingOrder: string
  orderPlaced: string; orderNumber: string; orderThankYou: string
  errNamePhone: string; errCartEmpty: string; errStreet: string; errSubmit: string
  // Feed
  dishesCount: string; swipeNext: string; chefPick: string; customize: string; orderNow: string
  viewDish: string; openOrderCount: string
  // Complete your order
  upsellTitle: string; upsellAdded: string; upsellPairs: string; upsellSide: string; upsellDrink: string; upsellDessert: string; upsellSkip: string; upsellContinue: string; upsellDone: string; upsellChoose: string; upsellInOrder: string; upsellStep: string
  // Table links (QR / NFC)
  yourTable: string; tableServed: string
  // Footer
  poweredBy: string
}

const en: MenuCopy = {
  search: 'Search the menu', searchOpen: 'Search the menu', searchClose: 'Close search', featured: 'Featured', other: 'Other',
  noItems: 'Nothing found', tryAnother: 'Try a different word', viewFeed: 'Visual feed', viewMenu: 'Menu', language: 'Language',
  feedEmptyTitle: 'The visual feed is on its way', feedEmptyDescription: 'Browse the full menu to see every dish.',
  hoursTitle: 'Opening hours', openUntil: 'Open until {time}', closedOpensToday: 'Closed · opens at {time}',
  closedOpensTomorrow: 'Closed · opens tomorrow at {time}', closedOpensOn: 'Closed · opens {day} at {time}', closed: 'Closed', today: 'Today',
  add: 'Add', addNamed: 'Add {name}', removeNamed: 'Remove {name}', decrease: 'Decrease', increase: 'Increase',
  viewOrder: 'View order', yourOrder: 'Your order', cartEmpty: 'Your order is empty', subtotal: 'Subtotal',
  itemsOne: '{count} item', itemsMany: '{count} items',
  checkout: 'Checkout', edit: 'Edit', closeCart: 'Close order', expandCart: 'Expand order', shrinkCart: 'Shrink order',
  required: 'Required', optional: 'Optional', chooseOne: 'Choose 1', chooseUpTo: 'Choose up to {max}', chooseAtLeast: 'Choose at least {min}',
  chooseBetween: 'Choose {min} to {max}', firstHalf: 'First half', secondHalf: 'Second half', halfPrice: 'Price: {price}',
  ingredients: 'Ingredients', ingredientsHint: 'Adjust as you like', extras: 'Add-ons',
  withoutNamed: 'No {name}', extraNamed: 'Extra {name}', addedNamed: '+ {name}',
  notes: 'Notes', notesPlaceholder: 'E.g. no ice, well done…', notesLimit: 'Up to 140 characters',
  addToOrder: 'Add', updateItem: 'Update', chooseRequired: 'Choose the required options', orderWhatsApp: 'Order on WhatsApp',
  whatsappMessage: "Hi! I'd like to order: {item}", close: 'Close', previousDish: 'Previous dish', nextDish: 'Next dish',
  previousPhoto: 'Previous photo', nextPhoto: 'Next photo', quantity: 'Quantity',
  checkoutTitle: 'Checkout', backToCart: 'Back to order', orderType: 'How would you like it?', dineIn: 'Dine in', pickup: 'Pickup',
  delivery: 'Delivery', deliveryAddress: 'Delivery address', street: 'Street and number', complement: 'Apt, floor (optional)',
  zipcode: 'ZIP code', city: 'City', deliveryNotes: 'Notes for the driver (optional)',
  noDeliveryZone: 'We could not find a delivery area for this ZIP code — the standard fee applies', tip: 'Tip', tipCustom: 'Other',
  tipAmount: 'Tip amount', paymentSummary: 'Summary', deliveryFee: 'Delivery fee', total: 'Total',
  yourDetails: 'Your details', yourName: 'Your name', phone: 'Phone number', placeOrder: 'Place order', placingOrder: 'Placing order…',
  orderPlaced: 'Order placed!', orderNumber: 'Order', orderThankYou: 'Thank you! The restaurant has received your order.',
  errNamePhone: 'Please enter your name and phone number', errCartEmpty: 'Your order is empty',
  errStreet: 'Please enter the delivery address', errSubmit: 'We could not place your order. Please try again.',
  dishesCount: '{count} dishes', swipeNext: 'Swipe for the next dish', chefPick: "Chef's pick", customize: 'Customize', orderNow: 'Add to order',
  viewDish: 'View dish', openOrderCount: 'Open order with {count} items',
  upsellTitle: 'Complete your order', upsellAdded: '{name} added', upsellPairs: 'Goes well with {name}', upsellSide: 'Add a side?', upsellDrink: 'Something to drink?', upsellDessert: 'Room for dessert?', upsellSkip: 'No, thanks', upsellContinue: 'Continue', upsellDone: 'Done', upsellChoose: 'Choose', upsellInOrder: 'In your order', upsellStep: 'Step {current} of {total}',
  yourTable: 'Your table', tableServed: "We'll bring your order to this table.",
  poweredBy: 'Powered by',
}

const pt: MenuCopy = {
  search: 'Buscar no cardápio', searchOpen: 'Buscar no cardápio', searchClose: 'Fechar busca', featured: 'Destaques', other: 'Outros',
  noItems: 'Nada encontrado', tryAnother: 'Tente outra palavra', viewFeed: 'Feed visual', viewMenu: 'Cardápio', language: 'Idioma',
  feedEmptyTitle: 'O feed visual está a caminho', feedEmptyDescription: 'Veja o cardápio completo para conhecer todos os pratos.',
  hoursTitle: 'Horário de funcionamento', openUntil: 'Aberto até {time}', closedOpensToday: 'Fechado · abre às {time}',
  closedOpensTomorrow: 'Fechado · abre amanhã às {time}', closedOpensOn: 'Fechado · abre {day} às {time}', closed: 'Fechado', today: 'Hoje',
  add: 'Adicionar', addNamed: 'Adicionar {name}', removeNamed: 'Remover {name}', decrease: 'Diminuir', increase: 'Aumentar',
  viewOrder: 'Ver pedido', yourOrder: 'Seu pedido', cartEmpty: 'Seu pedido está vazio', subtotal: 'Subtotal',
  itemsOne: '{count} item', itemsMany: '{count} itens',
  checkout: 'Finalizar pedido', edit: 'Editar', closeCart: 'Fechar pedido', expandCart: 'Expandir pedido', shrinkCart: 'Reduzir pedido',
  required: 'Obrigatório', optional: 'Opcional', chooseOne: 'Escolha 1', chooseUpTo: 'Escolha até {max}', chooseAtLeast: 'Escolha pelo menos {min}',
  chooseBetween: 'Escolha de {min} a {max}', firstHalf: 'Primeira metade', secondHalf: 'Segunda metade', halfPrice: 'Preço: {price}',
  ingredients: 'Ingredientes', ingredientsHint: 'Ajuste à vontade', extras: 'Adicionais',
  withoutNamed: 'Sem {name}', extraNamed: 'Extra de {name}', addedNamed: '+ {name}',
  notes: 'Observações', notesPlaceholder: 'Ex.: sem gelo, bem passado…', notesLimit: 'Até 140 caracteres',
  addToOrder: 'Adicionar', updateItem: 'Atualizar', chooseRequired: 'Escolha as opções obrigatórias', orderWhatsApp: 'Pedir pelo WhatsApp',
  whatsappMessage: 'Olá! Gostaria de pedir: {item}', close: 'Fechar', previousDish: 'Prato anterior', nextDish: 'Próximo prato',
  previousPhoto: 'Foto anterior', nextPhoto: 'Próxima foto', quantity: 'Quantidade',
  checkoutTitle: 'Finalizar pedido', backToCart: 'Voltar ao pedido', orderType: 'Como você prefere?', dineIn: 'No local', pickup: 'Retirada',
  delivery: 'Entrega', deliveryAddress: 'Endereço de entrega', street: 'Rua e número', complement: 'Apto, bloco (opcional)',
  zipcode: 'CEP', city: 'Cidade', deliveryNotes: 'Observações para o entregador (opcional)',
  noDeliveryZone: 'Não encontramos área de entrega para este CEP — vale a taxa padrão', tip: 'Gorjeta', tipCustom: 'Outro valor',
  tipAmount: 'Valor da gorjeta', paymentSummary: 'Resumo', deliveryFee: 'Taxa de entrega', total: 'Total',
  yourDetails: 'Seus dados', yourName: 'Seu nome', phone: 'Telefone', placeOrder: 'Fazer pedido', placingOrder: 'Enviando pedido…',
  orderPlaced: 'Pedido feito!', orderNumber: 'Pedido', orderThankYou: 'Obrigado! O restaurante já recebeu seu pedido.',
  errNamePhone: 'Informe seu nome e telefone', errCartEmpty: 'Seu pedido está vazio',
  errStreet: 'Informe o endereço de entrega', errSubmit: 'Não conseguimos enviar seu pedido. Tente de novo.',
  dishesCount: '{count} pratos', swipeNext: 'Deslize para o próximo prato', chefPick: 'Escolha do chef', customize: 'Personalizar', orderNow: 'Adicionar ao pedido',
  viewDish: 'Ver prato', openOrderCount: 'Abrir pedido com {count} itens',
  upsellTitle: 'Complete seu pedido', upsellAdded: '{name} adicionado', upsellPairs: 'Combina com {name}', upsellSide: 'Que tal um acompanhamento?', upsellDrink: 'Algo para beber?', upsellDessert: 'Uma sobremesa?', upsellSkip: 'Não, obrigado', upsellContinue: 'Continuar', upsellDone: 'Pronto', upsellChoose: 'Escolher', upsellInOrder: 'No pedido', upsellStep: 'Etapa {current} de {total}',
  yourTable: 'Sua mesa', tableServed: 'Levamos seu pedido até esta mesa.',
  poweredBy: 'Feito com',
}

const es: MenuCopy = {
  search: 'Buscar en el menú', searchOpen: 'Buscar en el menú', searchClose: 'Cerrar búsqueda', featured: 'Destacados', other: 'Otros',
  noItems: 'No encontramos nada', tryAnother: 'Prueba con otra palabra', viewFeed: 'Feed visual', viewMenu: 'Menú', language: 'Idioma',
  feedEmptyTitle: 'El feed visual está en camino', feedEmptyDescription: 'Mira el menú completo para ver todos los platos.',
  hoursTitle: 'Horario', openUntil: 'Abierto hasta las {time}', closedOpensToday: 'Cerrado · abre a las {time}',
  closedOpensTomorrow: 'Cerrado · abre mañana a las {time}', closedOpensOn: 'Cerrado · abre el {day} a las {time}', closed: 'Cerrado', today: 'Hoy',
  add: 'Añadir', addNamed: 'Añadir {name}', removeNamed: 'Quitar {name}', decrease: 'Disminuir', increase: 'Aumentar',
  viewOrder: 'Ver pedido', yourOrder: 'Tu pedido', cartEmpty: 'Tu pedido está vacío', subtotal: 'Subtotal',
  itemsOne: '{count} artículo', itemsMany: '{count} artículos',
  checkout: 'Finalizar pedido', edit: 'Editar', closeCart: 'Cerrar pedido', expandCart: 'Ampliar pedido', shrinkCart: 'Reducir pedido',
  required: 'Obligatorio', optional: 'Opcional', chooseOne: 'Elige 1', chooseUpTo: 'Elige hasta {max}', chooseAtLeast: 'Elige al menos {min}',
  chooseBetween: 'Elige de {min} a {max}', firstHalf: 'Primera mitad', secondHalf: 'Segunda mitad', halfPrice: 'Precio: {price}',
  ingredients: 'Ingredientes', ingredientsHint: 'Ajústalo a tu gusto', extras: 'Extras',
  withoutNamed: 'Sin {name}', extraNamed: 'Extra de {name}', addedNamed: '+ {name}',
  notes: 'Notas', notesPlaceholder: 'Ej.: sin hielo, bien hecho…', notesLimit: 'Hasta 140 caracteres',
  addToOrder: 'Añadir', updateItem: 'Actualizar', chooseRequired: 'Elige las opciones obligatorias', orderWhatsApp: 'Pedir por WhatsApp',
  whatsappMessage: '¡Hola! Me gustaría pedir: {item}', close: 'Cerrar', previousDish: 'Plato anterior', nextDish: 'Plato siguiente',
  previousPhoto: 'Foto anterior', nextPhoto: 'Foto siguiente', quantity: 'Cantidad',
  checkoutTitle: 'Finalizar pedido', backToCart: 'Volver al pedido', orderType: '¿Cómo lo prefieres?', dineIn: 'Para comer aquí', pickup: 'Para recoger',
  delivery: 'A domicilio', deliveryAddress: 'Dirección de entrega', street: 'Calle y número', complement: 'Piso, puerta (opcional)',
  zipcode: 'Código postal', city: 'Ciudad', deliveryNotes: 'Notas para el repartidor (opcional)',
  noDeliveryZone: 'No encontramos zona de reparto para este código postal: se aplica la tarifa estándar', tip: 'Propina', tipCustom: 'Otra cantidad',
  tipAmount: 'Importe de la propina', paymentSummary: 'Resumen', deliveryFee: 'Gastos de envío', total: 'Total',
  yourDetails: 'Tus datos', yourName: 'Tu nombre', phone: 'Teléfono', placeOrder: 'Hacer pedido', placingOrder: 'Enviando pedido…',
  orderPlaced: '¡Pedido hecho!', orderNumber: 'Pedido', orderThankYou: '¡Gracias! El restaurante ya recibió tu pedido.',
  errNamePhone: 'Indica tu nombre y teléfono', errCartEmpty: 'Tu pedido está vacío',
  errStreet: 'Indica la dirección de entrega', errSubmit: 'No pudimos enviar tu pedido. Inténtalo de nuevo.',
  dishesCount: '{count} platos', swipeNext: 'Desliza para ver el siguiente plato', chefPick: 'Recomendación del chef', customize: 'Personalizar', orderNow: 'Añadir al pedido',
  viewDish: 'Ver plato', openOrderCount: 'Abrir pedido con {count} artículos',
  upsellTitle: 'Completa tu pedido', upsellAdded: '{name} añadido', upsellPairs: 'Combina con {name}', upsellSide: '¿Un acompañamiento?', upsellDrink: '¿Algo de beber?', upsellDessert: '¿Un postre?', upsellSkip: 'No, gracias', upsellContinue: 'Continuar', upsellDone: 'Listo', upsellChoose: 'Elegir', upsellInOrder: 'En tu pedido', upsellStep: 'Paso {current} de {total}',
  yourTable: 'Tu mesa', tableServed: 'Llevaremos tu pedido a esta mesa.',
  poweredBy: 'Hecho con',
}

const fr: MenuCopy = {
  search: 'Rechercher dans le menu', searchOpen: 'Rechercher dans le menu', searchClose: 'Fermer la recherche', featured: 'À la une', other: 'Autres',
  noItems: 'Aucun résultat', tryAnother: 'Essayez un autre mot', viewFeed: 'Feed visuel', viewMenu: 'Menu', language: 'Langue',
  feedEmptyTitle: 'Le feed visuel arrive bientôt', feedEmptyDescription: 'Parcourez le menu complet pour voir tous les plats.',
  hoursTitle: "Horaires d'ouverture", openUntil: "Ouvert jusqu'à {time}", closedOpensToday: 'Fermé · ouvre à {time}',
  closedOpensTomorrow: 'Fermé · ouvre demain à {time}', closedOpensOn: 'Fermé · ouvre {day} à {time}', closed: 'Fermé', today: "Aujourd'hui",
  add: 'Ajouter', addNamed: 'Ajouter {name}', removeNamed: 'Retirer {name}', decrease: 'Diminuer', increase: 'Augmenter',
  viewOrder: 'Voir la commande', yourOrder: 'Votre commande', cartEmpty: 'Votre commande est vide', subtotal: 'Sous-total',
  itemsOne: '{count} article', itemsMany: '{count} articles',
  checkout: 'Valider la commande', edit: 'Modifier', closeCart: 'Fermer la commande', expandCart: 'Agrandir la commande', shrinkCart: 'Réduire la commande',
  required: 'Obligatoire', optional: 'Facultatif', chooseOne: 'Choisissez 1', chooseUpTo: "Choisissez jusqu'à {max}", chooseAtLeast: 'Choisissez au moins {min}',
  chooseBetween: 'Choisissez de {min} à {max}', firstHalf: 'Première moitié', secondHalf: 'Deuxième moitié', halfPrice: 'Prix : {price}',
  ingredients: 'Ingrédients', ingredientsHint: 'Ajustez à votre goût', extras: 'Suppléments',
  withoutNamed: 'Sans {name}', extraNamed: 'Supplément {name}', addedNamed: '+ {name}',
  notes: 'Remarques', notesPlaceholder: 'Ex. : sans glaçons, bien cuit…', notesLimit: "Jusqu'à 140 caractères",
  addToOrder: 'Ajouter', updateItem: 'Mettre à jour', chooseRequired: 'Choisissez les options obligatoires', orderWhatsApp: 'Commander sur WhatsApp',
  whatsappMessage: 'Bonjour ! Je voudrais commander : {item}', close: 'Fermer', previousDish: 'Plat précédent', nextDish: 'Plat suivant',
  previousPhoto: 'Photo précédente', nextPhoto: 'Photo suivante', quantity: 'Quantité',
  checkoutTitle: 'Valider la commande', backToCart: 'Retour à la commande', orderType: 'Comment souhaitez-vous ?', dineIn: 'Sur place', pickup: 'À emporter',
  delivery: 'Livraison', deliveryAddress: 'Adresse de livraison', street: 'Rue et numéro', complement: 'Appartement, étage (facultatif)',
  zipcode: 'Code postal', city: 'Ville', deliveryNotes: 'Instructions pour le livreur (facultatif)',
  noDeliveryZone: "Aucune zone de livraison trouvée pour ce code postal — le tarif standard s'applique", tip: 'Pourboire', tipCustom: 'Autre montant',
  tipAmount: 'Montant du pourboire', paymentSummary: 'Récapitulatif', deliveryFee: 'Frais de livraison', total: 'Total',
  yourDetails: 'Vos coordonnées', yourName: 'Votre nom', phone: 'Téléphone', placeOrder: 'Commander', placingOrder: 'Envoi de la commande…',
  orderPlaced: 'Commande passée !', orderNumber: 'Commande', orderThankYou: 'Merci ! Le restaurant a bien reçu votre commande.',
  errNamePhone: 'Indiquez votre nom et votre téléphone', errCartEmpty: 'Votre commande est vide',
  errStreet: "Indiquez l'adresse de livraison", errSubmit: "Nous n'avons pas pu envoyer votre commande. Réessayez.",
  dishesCount: '{count} plats', swipeNext: 'Faites glisser pour le plat suivant', chefPick: 'Choix du chef', customize: 'Personnaliser', orderNow: 'Ajouter à la commande',
  viewDish: 'Voir le plat', openOrderCount: 'Ouvrir la commande ({count} articles)',
  upsellTitle: 'Complétez votre commande', upsellAdded: '{name} ajouté', upsellPairs: 'Se marie bien avec {name}', upsellSide: 'Un accompagnement ?', upsellDrink: 'Quelque chose à boire ?', upsellDessert: 'Une petite douceur ?', upsellSkip: 'Non, merci', upsellContinue: 'Continuer', upsellDone: 'Terminé', upsellChoose: 'Choisir', upsellInOrder: 'Dans la commande', upsellStep: 'Étape {current} sur {total}',
  yourTable: 'Votre table', tableServed: 'Nous apporterons votre commande à cette table.',
  poweredBy: 'Propulsé par',
}

const de: MenuCopy = {
  search: 'Speisekarte durchsuchen', searchOpen: 'Speisekarte durchsuchen', searchClose: 'Suche schließen', featured: 'Empfehlungen', other: 'Weiteres',
  noItems: 'Nichts gefunden', tryAnother: 'Versuchen Sie ein anderes Wort', viewFeed: 'Visueller Feed', viewMenu: 'Speisekarte', language: 'Sprache',
  feedEmptyTitle: 'Der visuelle Feed kommt bald', feedEmptyDescription: 'In der vollständigen Speisekarte finden Sie alle Gerichte.',
  hoursTitle: 'Öffnungszeiten', openUntil: 'Geöffnet bis {time}', closedOpensToday: 'Geschlossen · öffnet um {time}',
  closedOpensTomorrow: 'Geschlossen · öffnet morgen um {time}', closedOpensOn: 'Geschlossen · öffnet {day} um {time}', closed: 'Geschlossen', today: 'Heute',
  add: 'Hinzufügen', addNamed: '{name} hinzufügen', removeNamed: '{name} entfernen', decrease: 'Weniger', increase: 'Mehr',
  viewOrder: 'Bestellung ansehen', yourOrder: 'Ihre Bestellung', cartEmpty: 'Ihre Bestellung ist leer', subtotal: 'Zwischensumme',
  itemsOne: '{count} Artikel', itemsMany: '{count} Artikel',
  checkout: 'Zur Kasse', edit: 'Bearbeiten', closeCart: 'Bestellung schließen', expandCart: 'Bestellung vergrößern', shrinkCart: 'Bestellung verkleinern',
  required: 'Pflicht', optional: 'Optional', chooseOne: '1 wählen', chooseUpTo: 'Bis zu {max} wählen', chooseAtLeast: 'Mindestens {min} wählen',
  chooseBetween: '{min} bis {max} wählen', firstHalf: 'Erste Hälfte', secondHalf: 'Zweite Hälfte', halfPrice: 'Preis: {price}',
  ingredients: 'Zutaten', ingredientsHint: 'Nach Wunsch anpassen', extras: 'Extras',
  withoutNamed: 'Ohne {name}', extraNamed: 'Extra {name}', addedNamed: '+ {name}',
  notes: 'Anmerkungen', notesPlaceholder: 'Z. B. ohne Eis, gut durch…', notesLimit: 'Bis zu 140 Zeichen',
  addToOrder: 'Hinzufügen', updateItem: 'Aktualisieren', chooseRequired: 'Pflichtoptionen auswählen', orderWhatsApp: 'Über WhatsApp bestellen',
  whatsappMessage: 'Hallo! Ich möchte bestellen: {item}', close: 'Schließen', previousDish: 'Vorheriges Gericht', nextDish: 'Nächstes Gericht',
  previousPhoto: 'Vorheriges Foto', nextPhoto: 'Nächstes Foto', quantity: 'Menge',
  checkoutTitle: 'Bestellung abschließen', backToCart: 'Zurück zur Bestellung', orderType: 'Wie möchten Sie es?', dineIn: 'Vor Ort', pickup: 'Abholung',
  delivery: 'Lieferung', deliveryAddress: 'Lieferadresse', street: 'Straße und Hausnummer', complement: 'Wohnung, Etage (optional)',
  zipcode: 'Postleitzahl', city: 'Stadt', deliveryNotes: 'Hinweise für den Fahrer (optional)',
  noDeliveryZone: 'Für diese Postleitzahl gibt es kein Liefergebiet – es gilt die Standardgebühr', tip: 'Trinkgeld', tipCustom: 'Anderer Betrag',
  tipAmount: 'Trinkgeldbetrag', paymentSummary: 'Übersicht', deliveryFee: 'Liefergebühr', total: 'Gesamt',
  yourDetails: 'Ihre Angaben', yourName: 'Ihr Name', phone: 'Telefonnummer', placeOrder: 'Bestellen', placingOrder: 'Bestellung wird gesendet…',
  orderPlaced: 'Bestellung aufgegeben!', orderNumber: 'Bestellung', orderThankYou: 'Danke! Das Restaurant hat Ihre Bestellung erhalten.',
  errNamePhone: 'Bitte Name und Telefonnummer angeben', errCartEmpty: 'Ihre Bestellung ist leer',
  errStreet: 'Bitte die Lieferadresse angeben', errSubmit: 'Die Bestellung konnte nicht gesendet werden. Bitte erneut versuchen.',
  dishesCount: '{count} Gerichte', swipeNext: 'Wischen für das nächste Gericht', chefPick: 'Empfehlung des Küchenchefs', customize: 'Anpassen', orderNow: 'Zur Bestellung',
  viewDish: 'Gericht ansehen', openOrderCount: 'Bestellung mit {count} Artikeln öffnen',
  upsellTitle: 'Bestellung vervollständigen', upsellAdded: '{name} hinzugefügt', upsellPairs: 'Passt gut zu {name}', upsellSide: 'Eine Beilage dazu?', upsellDrink: 'Etwas zu trinken?', upsellDessert: 'Noch ein Dessert?', upsellSkip: 'Nein, danke', upsellContinue: 'Weiter', upsellDone: 'Fertig', upsellChoose: 'Auswählen', upsellInOrder: 'In der Bestellung', upsellStep: 'Schritt {current} von {total}',
  yourTable: 'Ihr Tisch', tableServed: 'Wir bringen Ihre Bestellung an diesen Tisch.',
  poweredBy: 'Bereitgestellt von',
}

const it: MenuCopy = {
  search: 'Cerca nel menu', searchOpen: 'Cerca nel menu', searchClose: 'Chiudi ricerca', featured: 'In evidenza', other: 'Altro',
  noItems: 'Nessun risultato', tryAnother: "Prova con un'altra parola", viewFeed: 'Feed visivo', viewMenu: 'Menu', language: 'Lingua',
  feedEmptyTitle: 'Il feed visivo è in arrivo', feedEmptyDescription: 'Sfoglia il menu completo per vedere tutti i piatti.',
  hoursTitle: 'Orari di apertura', openUntil: 'Aperto fino alle {time}', closedOpensToday: 'Chiuso · apre alle {time}',
  closedOpensTomorrow: 'Chiuso · apre domani alle {time}', closedOpensOn: 'Chiuso · apre {day} alle {time}', closed: 'Chiuso', today: 'Oggi',
  add: 'Aggiungi', addNamed: 'Aggiungi {name}', removeNamed: 'Rimuovi {name}', decrease: 'Diminuisci', increase: 'Aumenta',
  viewOrder: "Vedi l'ordine", yourOrder: 'Il tuo ordine', cartEmpty: 'Il tuo ordine è vuoto', subtotal: 'Subtotale',
  itemsOne: '{count} articolo', itemsMany: '{count} articoli',
  checkout: "Completa l'ordine", edit: 'Modifica', closeCart: "Chiudi l'ordine", expandCart: "Espandi l'ordine", shrinkCart: "Riduci l'ordine",
  required: 'Obbligatorio', optional: 'Facoltativo', chooseOne: 'Scegli 1', chooseUpTo: 'Scegli fino a {max}', chooseAtLeast: 'Scegli almeno {min}',
  chooseBetween: 'Scegli da {min} a {max}', firstHalf: 'Prima metà', secondHalf: 'Seconda metà', halfPrice: 'Prezzo: {price}',
  ingredients: 'Ingredienti', ingredientsHint: 'Personalizza a piacere', extras: 'Aggiunte',
  withoutNamed: 'Senza {name}', extraNamed: 'Extra {name}', addedNamed: '+ {name}',
  notes: 'Note', notesPlaceholder: 'Es.: senza ghiaccio, ben cotto…', notesLimit: 'Fino a 140 caratteri',
  addToOrder: 'Aggiungi', updateItem: 'Aggiorna', chooseRequired: 'Scegli le opzioni obbligatorie', orderWhatsApp: 'Ordina su WhatsApp',
  whatsappMessage: 'Ciao! Vorrei ordinare: {item}', close: 'Chiudi', previousDish: 'Piatto precedente', nextDish: 'Piatto successivo',
  previousPhoto: 'Foto precedente', nextPhoto: 'Foto successiva', quantity: 'Quantità',
  checkoutTitle: "Completa l'ordine", backToCart: "Torna all'ordine", orderType: 'Come preferisci?', dineIn: 'Al tavolo', pickup: 'Da asporto',
  delivery: 'Consegna', deliveryAddress: 'Indirizzo di consegna', street: 'Via e numero civico', complement: 'Interno, piano (facoltativo)',
  zipcode: 'CAP', city: 'Città', deliveryNotes: 'Note per il fattorino (facoltativo)',
  noDeliveryZone: 'Nessuna zona di consegna per questo CAP: si applica la tariffa standard', tip: 'Mancia', tipCustom: 'Altro importo',
  tipAmount: 'Importo della mancia', paymentSummary: 'Riepilogo', deliveryFee: 'Costo di consegna', total: 'Totale',
  yourDetails: 'I tuoi dati', yourName: 'Il tuo nome', phone: 'Telefono', placeOrder: 'Invia ordine', placingOrder: "Invio dell'ordine…",
  orderPlaced: 'Ordine inviato!', orderNumber: 'Ordine', orderThankYou: 'Grazie! Il ristorante ha ricevuto il tuo ordine.',
  errNamePhone: 'Inserisci nome e telefono', errCartEmpty: 'Il tuo ordine è vuoto',
  errStreet: "Inserisci l'indirizzo di consegna", errSubmit: "Non siamo riusciti a inviare l'ordine. Riprova.",
  dishesCount: '{count} piatti', swipeNext: 'Scorri per il piatto successivo', chefPick: 'Scelta dello chef', customize: 'Personalizza', orderNow: "Aggiungi all'ordine",
  viewDish: 'Vedi il piatto', openOrderCount: "Apri l'ordine con {count} articoli",
  upsellTitle: "Completa l'ordine", upsellAdded: '{name} aggiunto', upsellPairs: 'Si abbina a {name}', upsellSide: 'Un contorno?', upsellDrink: 'Qualcosa da bere?', upsellDessert: 'Un dolce?', upsellSkip: 'No, grazie', upsellContinue: 'Continua', upsellDone: 'Fatto', upsellChoose: 'Scegli', upsellInOrder: "Nell'ordine", upsellStep: 'Passo {current} di {total}',
  yourTable: 'Il tuo tavolo', tableServed: "Ti porteremo l'ordine a questo tavolo.",
  poweredBy: 'Realizzato con',
}

const nl: MenuCopy = {
  search: 'Zoeken in het menu', searchOpen: 'Zoeken in het menu', searchClose: 'Zoeken sluiten', featured: 'Aanraders', other: 'Overig',
  noItems: 'Niets gevonden', tryAnother: 'Probeer een ander woord', viewFeed: 'Visuele feed', viewMenu: 'Menu', language: 'Taal',
  feedEmptyTitle: 'De visuele feed komt eraan', feedEmptyDescription: 'Bekijk het volledige menu voor alle gerechten.',
  hoursTitle: 'Openingstijden', openUntil: 'Open tot {time}', closedOpensToday: 'Gesloten · opent om {time}',
  closedOpensTomorrow: 'Gesloten · opent morgen om {time}', closedOpensOn: 'Gesloten · opent {day} om {time}', closed: 'Gesloten', today: 'Vandaag',
  add: 'Toevoegen', addNamed: '{name} toevoegen', removeNamed: '{name} verwijderen', decrease: 'Minder', increase: 'Meer',
  viewOrder: 'Bestelling bekijken', yourOrder: 'Je bestelling', cartEmpty: 'Je bestelling is leeg', subtotal: 'Subtotaal',
  itemsOne: '{count} artikel', itemsMany: '{count} artikelen',
  checkout: 'Afrekenen', edit: 'Wijzigen', closeCart: 'Bestelling sluiten', expandCart: 'Bestelling vergroten', shrinkCart: 'Bestelling verkleinen',
  required: 'Verplicht', optional: 'Optioneel', chooseOne: 'Kies 1', chooseUpTo: 'Kies maximaal {max}', chooseAtLeast: 'Kies minimaal {min}',
  chooseBetween: 'Kies {min} tot {max}', firstHalf: 'Eerste helft', secondHalf: 'Tweede helft', halfPrice: 'Prijs: {price}',
  ingredients: 'Ingrediënten', ingredientsHint: 'Pas naar wens aan', extras: 'Extra’s',
  withoutNamed: 'Zonder {name}', extraNamed: 'Extra {name}', addedNamed: '+ {name}',
  notes: 'Opmerkingen', notesPlaceholder: 'Bijv. zonder ijs, goed doorbakken…', notesLimit: 'Maximaal 140 tekens',
  addToOrder: 'Toevoegen', updateItem: 'Bijwerken', chooseRequired: 'Kies de verplichte opties', orderWhatsApp: 'Bestellen via WhatsApp',
  whatsappMessage: 'Hallo! Ik wil graag bestellen: {item}', close: 'Sluiten', previousDish: 'Vorig gerecht', nextDish: 'Volgend gerecht',
  previousPhoto: 'Vorige foto', nextPhoto: 'Volgende foto', quantity: 'Aantal',
  checkoutTitle: 'Afrekenen', backToCart: 'Terug naar bestelling', orderType: 'Hoe wil je het?', dineIn: 'Hier eten', pickup: 'Afhalen',
  delivery: 'Bezorgen', deliveryAddress: 'Bezorgadres', street: 'Straat en huisnummer', complement: 'Toevoeging, verdieping (optioneel)',
  zipcode: 'Postcode', city: 'Plaats', deliveryNotes: 'Opmerkingen voor de bezorger (optioneel)',
  noDeliveryZone: 'Geen bezorggebied gevonden voor deze postcode — het standaardtarief geldt', tip: 'Fooi', tipCustom: 'Ander bedrag',
  tipAmount: 'Fooibedrag', paymentSummary: 'Overzicht', deliveryFee: 'Bezorgkosten', total: 'Totaal',
  yourDetails: 'Je gegevens', yourName: 'Je naam', phone: 'Telefoonnummer', placeOrder: 'Bestellen', placingOrder: 'Bestelling wordt verstuurd…',
  orderPlaced: 'Bestelling geplaatst!', orderNumber: 'Bestelling', orderThankYou: 'Bedankt! Het restaurant heeft je bestelling ontvangen.',
  errNamePhone: 'Vul je naam en telefoonnummer in', errCartEmpty: 'Je bestelling is leeg',
  errStreet: 'Vul het bezorgadres in', errSubmit: 'Je bestelling kon niet worden verstuurd. Probeer het opnieuw.',
  dishesCount: '{count} gerechten', swipeNext: 'Veeg voor het volgende gerecht', chefPick: 'Keuze van de chef', customize: 'Aanpassen', orderNow: 'Aan bestelling toevoegen',
  viewDish: 'Gerecht bekijken', openOrderCount: 'Bestelling met {count} artikelen openen',
  upsellTitle: 'Maak je bestelling compleet', upsellAdded: '{name} toegevoegd', upsellPairs: 'Past goed bij {name}', upsellSide: 'Een bijgerecht erbij?', upsellDrink: 'Iets te drinken?', upsellDessert: 'Nog een dessert?', upsellSkip: 'Nee, bedankt', upsellContinue: 'Doorgaan', upsellDone: 'Klaar', upsellChoose: 'Kiezen', upsellInOrder: 'In je bestelling', upsellStep: 'Stap {current} van {total}',
  yourTable: 'Je tafel', tableServed: 'We brengen je bestelling naar deze tafel.',
  poweredBy: 'Mogelijk gemaakt door',
}

const pl: MenuCopy = {
  search: 'Szukaj w menu', searchOpen: 'Szukaj w menu', searchClose: 'Zamknij wyszukiwanie', featured: 'Polecane', other: 'Inne',
  noItems: 'Nic nie znaleziono', tryAnother: 'Spróbuj innego słowa', viewFeed: 'Feed wizualny', viewMenu: 'Menu', language: 'Język',
  feedEmptyTitle: 'Feed wizualny wkrótce', feedEmptyDescription: 'Przejrzyj pełne menu, aby zobaczyć wszystkie dania.',
  hoursTitle: 'Godziny otwarcia', openUntil: 'Otwarte do {time}', closedOpensToday: 'Zamknięte · otwarcie o {time}',
  closedOpensTomorrow: 'Zamknięte · otwarcie jutro o {time}', closedOpensOn: 'Zamknięte · otwarcie: {day}, {time}', closed: 'Zamknięte', today: 'Dziś',
  add: 'Dodaj', addNamed: 'Dodaj {name}', removeNamed: 'Usuń {name}', decrease: 'Mniej', increase: 'Więcej',
  viewOrder: 'Zobacz zamówienie', yourOrder: 'Twoje zamówienie', cartEmpty: 'Twoje zamówienie jest puste', subtotal: 'Suma częściowa',
  itemsOne: '{count} pozycja', itemsFew: '{count} pozycje', itemsMany: '{count} pozycji',
  checkout: 'Do kasy', edit: 'Edytuj', closeCart: 'Zamknij zamówienie', expandCart: 'Rozwiń zamówienie', shrinkCart: 'Zwiń zamówienie',
  required: 'Wymagane', optional: 'Opcjonalne', chooseOne: 'Wybierz 1', chooseUpTo: 'Wybierz do {max}', chooseAtLeast: 'Wybierz co najmniej {min}',
  chooseBetween: 'Wybierz od {min} do {max}', firstHalf: 'Pierwsza połowa', secondHalf: 'Druga połowa', halfPrice: 'Cena: {price}',
  ingredients: 'Składniki', ingredientsHint: 'Dostosuj według uznania', extras: 'Dodatki',
  withoutNamed: 'Bez: {name}', extraNamed: 'Więcej: {name}', addedNamed: '+ {name}',
  notes: 'Uwagi', notesPlaceholder: 'Np. bez lodu, dobrze wysmażone…', notesLimit: 'Do 140 znaków',
  addToOrder: 'Dodaj', updateItem: 'Zaktualizuj', chooseRequired: 'Wybierz wymagane opcje', orderWhatsApp: 'Zamów przez WhatsApp',
  whatsappMessage: 'Dzień dobry! Chciałbym zamówić: {item}', close: 'Zamknij', previousDish: 'Poprzednie danie', nextDish: 'Następne danie',
  previousPhoto: 'Poprzednie zdjęcie', nextPhoto: 'Następne zdjęcie', quantity: 'Ilość',
  checkoutTitle: 'Złóż zamówienie', backToCart: 'Wróć do zamówienia', orderType: 'Jak chcesz odebrać?', dineIn: 'Na miejscu', pickup: 'Na wynos',
  delivery: 'Dostawa', deliveryAddress: 'Adres dostawy', street: 'Ulica i numer', complement: 'Mieszkanie, piętro (opcjonalnie)',
  zipcode: 'Kod pocztowy', city: 'Miasto', deliveryNotes: 'Uwagi dla kuriera (opcjonalnie)',
  noDeliveryZone: 'Brak strefy dostawy dla tego kodu — obowiązuje opłata standardowa', tip: 'Napiwek', tipCustom: 'Inna kwota',
  tipAmount: 'Kwota napiwku', paymentSummary: 'Podsumowanie', deliveryFee: 'Opłata za dostawę', total: 'Razem',
  yourDetails: 'Twoje dane', yourName: 'Imię', phone: 'Numer telefonu', placeOrder: 'Złóż zamówienie', placingOrder: 'Wysyłanie zamówienia…',
  orderPlaced: 'Zamówienie złożone!', orderNumber: 'Zamówienie', orderThankYou: 'Dziękujemy! Restauracja otrzymała Twoje zamówienie.',
  errNamePhone: 'Podaj imię i numer telefonu', errCartEmpty: 'Twoje zamówienie jest puste',
  errStreet: 'Podaj adres dostawy', errSubmit: 'Nie udało się wysłać zamówienia. Spróbuj ponownie.',
  dishesCount: 'Dania: {count}', swipeNext: 'Przesuń, aby zobaczyć kolejne danie', chefPick: 'Wybór szefa kuchni', customize: 'Dostosuj', orderNow: 'Dodaj do zamówienia',
  viewDish: 'Zobacz danie', openOrderCount: 'Otwórz zamówienie (pozycje: {count})',
  upsellTitle: 'Uzupełnij zamówienie', upsellAdded: 'Dodano {name}', upsellPairs: 'Pasuje do {name}', upsellSide: 'Dodatek do dania?', upsellDrink: 'Coś do picia?', upsellDessert: 'Może deser?', upsellSkip: 'Nie, dziękuję', upsellContinue: 'Dalej', upsellDone: 'Gotowe', upsellChoose: 'Wybierz', upsellInOrder: 'W zamówieniu', upsellStep: 'Krok {current} z {total}',
  yourTable: 'Twój stolik', tableServed: 'Przyniesiemy zamówienie do tego stolika.',
  poweredBy: 'Obsługiwane przez',
}

const tr: MenuCopy = {
  search: 'Menüde ara', searchOpen: 'Menüde ara', searchClose: 'Aramayı kapat', featured: 'Öne çıkanlar', other: 'Diğer',
  noItems: 'Sonuç bulunamadı', tryAnother: 'Başka bir kelime deneyin', viewFeed: 'Görsel akış', viewMenu: 'Menü', language: 'Dil',
  feedEmptyTitle: 'Görsel akış hazırlanıyor', feedEmptyDescription: 'Tüm yemekleri görmek için menünün tamamına göz atın.',
  hoursTitle: 'Çalışma saatleri', openUntil: '{time} saatine kadar açık', closedOpensToday: 'Kapalı · {time} açılıyor',
  closedOpensTomorrow: 'Kapalı · yarın {time} açılıyor', closedOpensOn: 'Kapalı · {day} {time} açılıyor', closed: 'Kapalı', today: 'Bugün',
  add: 'Ekle', addNamed: '{name} ekle', removeNamed: '{name} kaldır', decrease: 'Azalt', increase: 'Artır',
  viewOrder: 'Siparişi gör', yourOrder: 'Siparişiniz', cartEmpty: 'Siparişiniz boş', subtotal: 'Ara toplam',
  itemsOne: '{count} ürün', itemsMany: '{count} ürün',
  checkout: 'Siparişi tamamla', edit: 'Düzenle', closeCart: 'Siparişi kapat', expandCart: 'Siparişi genişlet', shrinkCart: 'Siparişi küçült',
  required: 'Zorunlu', optional: 'İsteğe bağlı', chooseOne: '1 seçin', chooseUpTo: 'En fazla {max} seçin', chooseAtLeast: 'En az {min} seçin',
  chooseBetween: '{min}–{max} arası seçin', firstHalf: 'İlk yarım', secondHalf: 'İkinci yarım', halfPrice: 'Fiyat: {price}',
  ingredients: 'İçindekiler', ingredientsHint: 'Dilediğiniz gibi ayarlayın', extras: 'Ekstralar',
  withoutNamed: '{name} olmadan', extraNamed: 'Ekstra {name}', addedNamed: '+ {name}',
  notes: 'Notlar', notesPlaceholder: 'Örn. buzsuz, iyi pişmiş…', notesLimit: 'En fazla 140 karakter',
  addToOrder: 'Ekle', updateItem: 'Güncelle', chooseRequired: 'Zorunlu seçenekleri seçin', orderWhatsApp: 'WhatsApp ile sipariş ver',
  whatsappMessage: 'Merhaba! Sipariş vermek istiyorum: {item}', close: 'Kapat', previousDish: 'Önceki yemek', nextDish: 'Sonraki yemek',
  previousPhoto: 'Önceki fotoğraf', nextPhoto: 'Sonraki fotoğraf', quantity: 'Adet',
  checkoutTitle: 'Siparişi tamamla', backToCart: 'Siparişe dön', orderType: 'Nasıl istersiniz?', dineIn: 'Restoranda', pickup: 'Gel al',
  delivery: 'Teslimat', deliveryAddress: 'Teslimat adresi', street: 'Sokak ve numara', complement: 'Daire, kat (isteğe bağlı)',
  zipcode: 'Posta kodu', city: 'Şehir', deliveryNotes: 'Kurye için notlar (isteğe bağlı)',
  noDeliveryZone: 'Bu posta kodu için teslimat bölgesi bulunamadı — standart ücret uygulanır', tip: 'Bahşiş', tipCustom: 'Başka tutar',
  tipAmount: 'Bahşiş tutarı', paymentSummary: 'Özet', deliveryFee: 'Teslimat ücreti', total: 'Toplam',
  yourDetails: 'Bilgileriniz', yourName: 'Adınız', phone: 'Telefon numarası', placeOrder: 'Sipariş ver', placingOrder: 'Sipariş gönderiliyor…',
  orderPlaced: 'Sipariş alındı!', orderNumber: 'Sipariş', orderThankYou: 'Teşekkürler! Restoran siparişinizi aldı.',
  errNamePhone: 'Lütfen adınızı ve telefon numaranızı girin', errCartEmpty: 'Siparişiniz boş',
  errStreet: 'Lütfen teslimat adresini girin', errSubmit: 'Siparişiniz gönderilemedi. Lütfen tekrar deneyin.',
  dishesCount: '{count} yemek', swipeNext: 'Sonraki yemek için kaydırın', chefPick: 'Şefin seçimi', customize: 'Özelleştir', orderNow: 'Siparişe ekle',
  viewDish: 'Yemeği gör', openOrderCount: 'Siparişi aç ({count} ürün)',
  upsellTitle: 'Siparişini tamamla', upsellAdded: '{name} eklendi', upsellPairs: '{name} ile çok iyi gider', upsellSide: 'Yanına bir garnitür?', upsellDrink: 'İçecek bir şey?', upsellDessert: 'Tatlıya yer var mı?', upsellSkip: 'Hayır, teşekkürler', upsellContinue: 'Devam', upsellDone: 'Tamam', upsellChoose: 'Seç', upsellInOrder: 'Siparişte', upsellStep: 'Adım {current}/{total}',
  yourTable: 'Masanız', tableServed: 'Siparişinizi bu masaya getireceğiz.',
  poweredBy: 'Altyapı:',
}

const ru: MenuCopy = {
  search: 'Поиск по меню', searchOpen: 'Поиск по меню', searchClose: 'Закрыть поиск', featured: 'Рекомендуем', other: 'Другое',
  noItems: 'Ничего не найдено', tryAnother: 'Попробуйте другое слово', viewFeed: 'Визуальная лента', viewMenu: 'Меню', language: 'Язык',
  feedEmptyTitle: 'Визуальная лента скоро появится', feedEmptyDescription: 'Откройте полное меню, чтобы увидеть все блюда.',
  hoursTitle: 'Часы работы', openUntil: 'Открыто до {time}', closedOpensToday: 'Закрыто · откроется в {time}',
  closedOpensTomorrow: 'Закрыто · откроется завтра в {time}', closedOpensOn: 'Закрыто · откроется: {day}, {time}', closed: 'Закрыто', today: 'Сегодня',
  add: 'Добавить', addNamed: 'Добавить: {name}', removeNamed: 'Убрать: {name}', decrease: 'Меньше', increase: 'Больше',
  viewOrder: 'Открыть заказ', yourOrder: 'Ваш заказ', cartEmpty: 'Ваш заказ пуст', subtotal: 'Промежуточный итог',
  itemsOne: '{count} позиция', itemsFew: '{count} позиции', itemsMany: '{count} позиций',
  checkout: 'Оформить заказ', edit: 'Изменить', closeCart: 'Закрыть заказ', expandCart: 'Развернуть заказ', shrinkCart: 'Свернуть заказ',
  required: 'Обязательно', optional: 'По желанию', chooseOne: 'Выберите 1', chooseUpTo: 'Выберите до {max}', chooseAtLeast: 'Выберите не менее {min}',
  chooseBetween: 'Выберите от {min} до {max}', firstHalf: 'Первая половина', secondHalf: 'Вторая половина', halfPrice: 'Цена: {price}',
  ingredients: 'Состав', ingredientsHint: 'Настройте по вкусу', extras: 'Добавки',
  withoutNamed: 'Без: {name}', extraNamed: 'Больше: {name}', addedNamed: '+ {name}',
  notes: 'Комментарий', notesPlaceholder: 'Например: без льда, хорошо прожарить…', notesLimit: 'До 140 символов',
  addToOrder: 'Добавить', updateItem: 'Обновить', chooseRequired: 'Выберите обязательные опции', orderWhatsApp: 'Заказать в WhatsApp',
  whatsappMessage: 'Здравствуйте! Хочу заказать: {item}', close: 'Закрыть', previousDish: 'Предыдущее блюдо', nextDish: 'Следующее блюдо',
  previousPhoto: 'Предыдущее фото', nextPhoto: 'Следующее фото', quantity: 'Количество',
  checkoutTitle: 'Оформление заказа', backToCart: 'Вернуться к заказу', orderType: 'Как вам удобнее?', dineIn: 'В зале', pickup: 'Самовывоз',
  delivery: 'Доставка', deliveryAddress: 'Адрес доставки', street: 'Улица и дом', complement: 'Квартира, этаж (необязательно)',
  zipcode: 'Индекс', city: 'Город', deliveryNotes: 'Комментарий для курьера (необязательно)',
  noDeliveryZone: 'Для этого индекса нет зоны доставки — действует стандартный тариф', tip: 'Чаевые', tipCustom: 'Другая сумма',
  tipAmount: 'Сумма чаевых', paymentSummary: 'Итого по заказу', deliveryFee: 'Доставка', total: 'Итого',
  yourDetails: 'Ваши данные', yourName: 'Ваше имя', phone: 'Номер телефона', placeOrder: 'Оформить заказ', placingOrder: 'Отправляем заказ…',
  orderPlaced: 'Заказ оформлен!', orderNumber: 'Заказ', orderThankYou: 'Спасибо! Ресторан получил ваш заказ.',
  errNamePhone: 'Укажите имя и номер телефона', errCartEmpty: 'Ваш заказ пуст',
  errStreet: 'Укажите адрес доставки', errSubmit: 'Не удалось отправить заказ. Попробуйте ещё раз.',
  dishesCount: 'Блюд: {count}', swipeNext: 'Листайте к следующему блюду', chefPick: 'Выбор шефа', customize: 'Настроить', orderNow: 'В заказ',
  viewDish: 'Открыть блюдо', openOrderCount: 'Открыть заказ (позиций: {count})',
  upsellTitle: 'Дополните заказ', upsellAdded: '{name} добавлено', upsellPairs: 'Хорошо сочетается с {name}', upsellSide: 'Добавить гарнир?', upsellDrink: 'Что-нибудь выпить?', upsellDessert: 'Может, десерт?', upsellSkip: 'Нет, спасибо', upsellContinue: 'Дальше', upsellDone: 'Готово', upsellChoose: 'Выбрать', upsellInOrder: 'В заказе', upsellStep: 'Шаг {current} из {total}',
  yourTable: 'Ваш столик', tableServed: 'Мы принесём заказ к этому столику.',
  poweredBy: 'Работает на',
}

const hi: MenuCopy = {
  search: 'मेन्यू में खोजें', searchOpen: 'मेन्यू में खोजें', searchClose: 'खोज बंद करें', featured: 'ख़ास पसंद', other: 'अन्य',
  noItems: 'कुछ नहीं मिला', tryAnother: 'कोई दूसरा शब्द आज़माएँ', viewFeed: 'विज़ुअल फ़ीड', viewMenu: 'मेन्यू', language: 'भाषा',
  feedEmptyTitle: 'विज़ुअल फ़ीड जल्द आ रहा है', feedEmptyDescription: 'सभी व्यंजन देखने के लिए पूरा मेन्यू देखें।',
  hoursTitle: 'खुलने का समय', openUntil: '{time} तक खुला', closedOpensToday: 'बंद · {time} बजे खुलेगा',
  closedOpensTomorrow: 'बंद · कल {time} बजे खुलेगा', closedOpensOn: 'बंद · {day} {time} बजे खुलेगा', closed: 'बंद', today: 'आज',
  add: 'जोड़ें', addNamed: '{name} जोड़ें', removeNamed: '{name} हटाएँ', decrease: 'घटाएँ', increase: 'बढ़ाएँ',
  viewOrder: 'ऑर्डर देखें', yourOrder: 'आपका ऑर्डर', cartEmpty: 'आपका ऑर्डर खाली है', subtotal: 'उप-योग',
  itemsOne: '{count} आइटम', itemsMany: '{count} आइटम',
  checkout: 'ऑर्डर पूरा करें', edit: 'बदलें', closeCart: 'ऑर्डर बंद करें', expandCart: 'ऑर्डर बड़ा करें', shrinkCart: 'ऑर्डर छोटा करें',
  required: 'ज़रूरी', optional: 'वैकल्पिक', chooseOne: '1 चुनें', chooseUpTo: 'अधिकतम {max} चुनें', chooseAtLeast: 'कम से कम {min} चुनें',
  chooseBetween: '{min} से {max} चुनें', firstHalf: 'पहला आधा', secondHalf: 'दूसरा आधा', halfPrice: 'कीमत: {price}',
  ingredients: 'सामग्री', ingredientsHint: 'अपनी पसंद से बदलें', extras: 'अतिरिक्त',
  withoutNamed: '{name} के बिना', extraNamed: 'अतिरिक्त {name}', addedNamed: '+ {name}',
  notes: 'नोट', notesPlaceholder: 'जैसे: बिना बर्फ़, अच्छी तरह पका हुआ…', notesLimit: '140 अक्षरों तक',
  addToOrder: 'जोड़ें', updateItem: 'अपडेट करें', chooseRequired: 'ज़रूरी विकल्प चुनें', orderWhatsApp: 'WhatsApp पर ऑर्डर करें',
  whatsappMessage: 'नमस्ते! मैं ऑर्डर करना चाहता/चाहती हूँ: {item}', close: 'बंद करें', previousDish: 'पिछला व्यंजन', nextDish: 'अगला व्यंजन',
  previousPhoto: 'पिछली फ़ोटो', nextPhoto: 'अगली फ़ोटो', quantity: 'मात्रा',
  checkoutTitle: 'ऑर्डर पूरा करें', backToCart: 'ऑर्डर पर वापस जाएँ', orderType: 'आप कैसे लेना चाहेंगे?', dineIn: 'यहीं खाएँगे', pickup: 'ले जाएँगे',
  delivery: 'डिलीवरी', deliveryAddress: 'डिलीवरी का पता', street: 'गली और मकान नंबर', complement: 'फ़्लैट, मंज़िल (वैकल्पिक)',
  zipcode: 'पिन कोड', city: 'शहर', deliveryNotes: 'डिलीवरी के लिए नोट (वैकल्पिक)',
  noDeliveryZone: 'इस पिन कोड के लिए डिलीवरी क्षेत्र नहीं मिला — सामान्य शुल्क लगेगा', tip: 'टिप', tipCustom: 'दूसरी राशि',
  tipAmount: 'टिप की राशि', paymentSummary: 'सारांश', deliveryFee: 'डिलीवरी शुल्क', total: 'कुल',
  yourDetails: 'आपकी जानकारी', yourName: 'आपका नाम', phone: 'फ़ोन नंबर', placeOrder: 'ऑर्डर करें', placingOrder: 'ऑर्डर भेजा जा रहा है…',
  orderPlaced: 'ऑर्डर हो गया!', orderNumber: 'ऑर्डर', orderThankYou: 'धन्यवाद! रेस्टोरेंट को आपका ऑर्डर मिल गया है।',
  errNamePhone: 'कृपया अपना नाम और फ़ोन नंबर दें', errCartEmpty: 'आपका ऑर्डर खाली है',
  errStreet: 'कृपया डिलीवरी का पता दें', errSubmit: 'आपका ऑर्डर नहीं भेजा जा सका। कृपया फिर से कोशिश करें।',
  dishesCount: '{count} व्यंजन', swipeNext: 'अगले व्यंजन के लिए स्वाइप करें', chefPick: 'शेफ़ की पसंद', customize: 'अपनी पसंद से बनाएँ', orderNow: 'ऑर्डर में जोड़ें',
  viewDish: 'व्यंजन देखें', openOrderCount: 'ऑर्डर खोलें ({count} आइटम)',
  upsellTitle: 'अपना ऑर्डर पूरा करें', upsellAdded: '{name} जोड़ा गया', upsellPairs: '{name} के साथ खूब जमता है', upsellSide: 'साथ में कुछ साइड?', upsellDrink: 'कुछ पीने को?', upsellDessert: 'मीठे में कुछ?', upsellSkip: 'नहीं, धन्यवाद', upsellContinue: 'आगे बढ़ें', upsellDone: 'हो गया', upsellChoose: 'चुनें', upsellInOrder: 'ऑर्डर में', upsellStep: 'चरण {current} / {total}',
  yourTable: 'आपकी टेबल', tableServed: 'हम आपका ऑर्डर इसी टेबल पर लाएँगे।',
  poweredBy: 'संचालित:',
}

const ja: MenuCopy = {
  search: 'メニューを検索', searchOpen: 'メニューを検索', searchClose: '検索を閉じる', featured: 'おすすめ', other: 'その他',
  noItems: '見つかりませんでした', tryAnother: '別のキーワードでお試しください', viewFeed: 'ビジュアルフィード', viewMenu: 'メニュー', language: '言語',
  feedEmptyTitle: 'ビジュアルフィードは準備中です', feedEmptyDescription: 'すべての料理はメニューからご覧いただけます。',
  hoursTitle: '営業時間', openUntil: '{time}まで営業', closedOpensToday: '営業時間外 · {time}開店',
  closedOpensTomorrow: '営業時間外 · 明日{time}開店', closedOpensOn: '営業時間外 · {day}{time}開店', closed: '定休日', today: '今日',
  add: '追加', addNamed: '{name}を追加', removeNamed: '{name}を削除', decrease: '減らす', increase: '増やす',
  viewOrder: '注文を見る', yourOrder: 'ご注文', cartEmpty: 'ご注文はまだありません', subtotal: '小計',
  itemsOne: '{count}点', itemsMany: '{count}点',
  checkout: '注文手続きへ', edit: '編集', closeCart: '注文を閉じる', expandCart: '注文を広げる', shrinkCart: '注文を縮める',
  required: '必須', optional: '任意', chooseOne: '1つ選択', chooseUpTo: '{max}つまで選択', chooseAtLeast: '{min}つ以上選択',
  chooseBetween: '{min}〜{max}つ選択', firstHalf: 'ハーフ1', secondHalf: 'ハーフ2', halfPrice: '価格：{price}',
  ingredients: '具材', ingredientsHint: 'お好みで調整できます', extras: 'トッピング',
  withoutNamed: '{name}抜き', extraNamed: '{name}増量', addedNamed: '+ {name}',
  notes: 'ご要望', notesPlaceholder: '例：氷なし、よく焼きで…', notesLimit: '140文字まで',
  addToOrder: '追加', updateItem: '更新', chooseRequired: '必須項目を選択してください', orderWhatsApp: 'WhatsAppで注文',
  whatsappMessage: 'こんにちは！注文をお願いします：{item}', close: '閉じる', previousDish: '前の料理', nextDish: '次の料理',
  previousPhoto: '前の写真', nextPhoto: '次の写真', quantity: '数量',
  checkoutTitle: 'ご注文手続き', backToCart: '注文に戻る', orderType: 'お受け取り方法', dineIn: '店内', pickup: 'お持ち帰り',
  delivery: 'デリバリー', deliveryAddress: 'お届け先', street: '番地・建物名', complement: '部屋番号・階（任意）',
  zipcode: '郵便番号', city: '市区町村', deliveryNotes: '配達員へのメモ（任意）',
  noDeliveryZone: 'この郵便番号の配達エリアが見つかりません。通常料金が適用されます', tip: 'チップ', tipCustom: 'その他の金額',
  tipAmount: 'チップの金額', paymentSummary: 'お支払い内容', deliveryFee: '配達料', total: '合計',
  yourDetails: 'お客様情報', yourName: 'お名前', phone: '電話番号', placeOrder: '注文する', placingOrder: '送信中…',
  orderPlaced: 'ご注文を承りました！', orderNumber: '注文番号', orderThankYou: 'ありがとうございます。お店にご注文が届きました。',
  errNamePhone: 'お名前と電話番号を入力してください', errCartEmpty: 'ご注文はまだありません',
  errStreet: 'お届け先を入力してください', errSubmit: '注文を送信できませんでした。もう一度お試しください。',
  dishesCount: '{count}品', swipeNext: 'スワイプで次の料理へ', chefPick: 'シェフのおすすめ', customize: 'カスタマイズ', orderNow: '注文に追加',
  viewDish: '料理を見る', openOrderCount: '注文を開く（{count}点）',
  upsellTitle: 'ご注文を仕上げましょう', upsellAdded: '{name}を追加しました', upsellPairs: '{name}によく合います', upsellSide: 'サイドメニューはいかがですか？', upsellDrink: 'お飲み物はいかがですか？', upsellDessert: 'デザートはいかがですか？', upsellSkip: 'いいえ、結構です', upsellContinue: '次へ', upsellDone: '完了', upsellChoose: '選ぶ', upsellInOrder: '注文に追加済み', upsellStep: 'ステップ {current}/{total}',
  yourTable: 'お席', tableServed: 'ご注文はこちらのお席までお持ちします。',
  poweredBy: 'Powered by',
}

const ko: MenuCopy = {
  search: '메뉴 검색', searchOpen: '메뉴 검색', searchClose: '검색 닫기', featured: '추천 메뉴', other: '기타',
  noItems: '검색 결과가 없습니다', tryAnother: '다른 단어로 검색해 보세요', viewFeed: '비주얼 피드', viewMenu: '메뉴', language: '언어',
  feedEmptyTitle: '비주얼 피드를 준비 중입니다', feedEmptyDescription: '전체 메뉴에서 모든 요리를 확인하세요.',
  hoursTitle: '영업시간', openUntil: '{time}까지 영업', closedOpensToday: '영업 종료 · {time}에 오픈',
  closedOpensTomorrow: '영업 종료 · 내일 {time}에 오픈', closedOpensOn: '영업 종료 · {day} {time}에 오픈', closed: '휴무', today: '오늘',
  add: '담기', addNamed: '{name} 담기', removeNamed: '{name} 빼기', decrease: '줄이기', increase: '늘리기',
  viewOrder: '주문 보기', yourOrder: '내 주문', cartEmpty: '주문 내역이 없습니다', subtotal: '소계',
  itemsOne: '{count}개', itemsMany: '{count}개',
  checkout: '주문하기', edit: '변경', closeCart: '주문 닫기', expandCart: '주문 펼치기', shrinkCart: '주문 접기',
  required: '필수', optional: '선택', chooseOne: '1개 선택', chooseUpTo: '최대 {max}개 선택', chooseAtLeast: '최소 {min}개 선택',
  chooseBetween: '{min}~{max}개 선택', firstHalf: '하프 1', secondHalf: '하프 2', halfPrice: '가격: {price}',
  ingredients: '재료', ingredientsHint: '취향대로 조절하세요', extras: '추가 토핑',
  withoutNamed: '{name} 빼기', extraNamed: '{name} 추가', addedNamed: '+ {name}',
  notes: '요청사항', notesPlaceholder: '예: 얼음 빼고, 웰던으로…', notesLimit: '최대 140자',
  addToOrder: '담기', updateItem: '변경하기', chooseRequired: '필수 옵션을 선택하세요', orderWhatsApp: 'WhatsApp으로 주문',
  whatsappMessage: '안녕하세요! 주문하고 싶어요: {item}', close: '닫기', previousDish: '이전 요리', nextDish: '다음 요리',
  previousPhoto: '이전 사진', nextPhoto: '다음 사진', quantity: '수량',
  checkoutTitle: '주문하기', backToCart: '주문으로 돌아가기', orderType: '어떻게 받으시겠어요?', dineIn: '매장 식사', pickup: '포장',
  delivery: '배달', deliveryAddress: '배달 주소', street: '도로명 주소', complement: '동·호수 (선택)',
  zipcode: '우편번호', city: '도시', deliveryNotes: '배달 요청사항 (선택)',
  noDeliveryZone: '이 우편번호의 배달 지역을 찾지 못했습니다. 기본 요금이 적용됩니다', tip: '팁', tipCustom: '직접 입력',
  tipAmount: '팁 금액', paymentSummary: '결제 요약', deliveryFee: '배달비', total: '합계',
  yourDetails: '주문자 정보', yourName: '이름', phone: '전화번호', placeOrder: '주문하기', placingOrder: '주문 전송 중…',
  orderPlaced: '주문이 완료되었습니다!', orderNumber: '주문 번호', orderThankYou: '감사합니다! 매장에서 주문을 접수했습니다.',
  errNamePhone: '이름과 전화번호를 입력하세요', errCartEmpty: '주문 내역이 없습니다',
  errStreet: '배달 주소를 입력하세요', errSubmit: '주문을 보내지 못했습니다. 다시 시도해 주세요.',
  dishesCount: '{count}가지 요리', swipeNext: '밀어서 다음 요리 보기', chefPick: '셰프 추천', customize: '옵션 선택', orderNow: '주문에 담기',
  viewDish: '요리 보기', openOrderCount: '주문 열기 ({count}개)',
  upsellTitle: '주문을 완성해 보세요', upsellAdded: '{name} 추가됨', upsellPairs: '{name}와(과) 잘 어울려요', upsellSide: '사이드 메뉴도 추가할까요?', upsellDrink: '음료도 하시겠어요?', upsellDessert: '디저트도 드실래요?', upsellSkip: '괜찮아요', upsellContinue: '계속', upsellDone: '완료', upsellChoose: '선택', upsellInOrder: '주문에 담김', upsellStep: '{current}/{total}단계',
  yourTable: '내 테이블', tableServed: '주문하신 메뉴를 이 테이블로 가져다 드릴게요.',
  poweredBy: 'Powered by',
}

const zh: MenuCopy = {
  search: '搜索菜单', searchOpen: '搜索菜单', searchClose: '关闭搜索', featured: '推荐', other: '其他',
  noItems: '没有找到相关菜品', tryAnother: '试试其他关键词', viewFeed: '图片浏览', viewMenu: '菜单', language: '语言',
  feedEmptyTitle: '图片浏览即将上线', feedEmptyDescription: '可在完整菜单中查看所有菜品。',
  hoursTitle: '营业时间', openUntil: '营业至 {time}', closedOpensToday: '休息中 · {time} 开始营业',
  closedOpensTomorrow: '休息中 · 明天 {time} 开始营业', closedOpensOn: '休息中 · {day} {time} 开始营业', closed: '休息', today: '今天',
  add: '加入', addNamed: '加入{name}', removeNamed: '移除{name}', decrease: '减少', increase: '增加',
  viewOrder: '查看订单', yourOrder: '我的订单', cartEmpty: '订单还是空的', subtotal: '小计',
  itemsOne: '{count} 件', itemsMany: '{count} 件',
  checkout: '去结算', edit: '修改', closeCart: '关闭订单', expandCart: '展开订单', shrinkCart: '收起订单',
  required: '必选', optional: '可选', chooseOne: '选 1 项', chooseUpTo: '最多选 {max} 项', chooseAtLeast: '至少选 {min} 项',
  chooseBetween: '选 {min} 至 {max} 项', firstHalf: '第一半', secondHalf: '第二半', halfPrice: '价格：{price}',
  ingredients: '配料', ingredientsHint: '按口味调整', extras: '加料',
  withoutNamed: '不要{name}', extraNamed: '多加{name}', addedNamed: '+ {name}',
  notes: '备注', notesPlaceholder: '例如：去冰、全熟…', notesLimit: '最多 140 字',
  addToOrder: '加入', updateItem: '更新', chooseRequired: '请选择必选项', orderWhatsApp: '通过 WhatsApp 点餐',
  whatsappMessage: '你好！我想点：{item}', close: '关闭', previousDish: '上一道菜', nextDish: '下一道菜',
  previousPhoto: '上一张', nextPhoto: '下一张', quantity: '数量',
  checkoutTitle: '结算', backToCart: '返回订单', orderType: '用餐方式', dineIn: '堂食', pickup: '自取',
  delivery: '外送', deliveryAddress: '送餐地址', street: '街道和门牌号', complement: '楼层、房号（选填）',
  zipcode: '邮政编码', city: '城市', deliveryNotes: '给骑手的备注（选填）',
  noDeliveryZone: '该邮编不在配送区域内，将收取标准配送费', tip: '小费', tipCustom: '其他金额',
  tipAmount: '小费金额', paymentSummary: '费用明细', deliveryFee: '配送费', total: '合计',
  yourDetails: '联系信息', yourName: '姓名', phone: '电话号码', placeOrder: '提交订单', placingOrder: '正在提交…',
  orderPlaced: '下单成功！', orderNumber: '订单号', orderThankYou: '谢谢！餐厅已收到您的订单。',
  errNamePhone: '请填写姓名和电话号码', errCartEmpty: '订单还是空的',
  errStreet: '请填写送餐地址', errSubmit: '订单提交失败，请重试。',
  dishesCount: '{count} 道菜', swipeNext: '滑动查看下一道菜', chefPick: '主厨推荐', customize: '选规格', orderNow: '加入订单',
  viewDish: '查看菜品', openOrderCount: '打开订单（{count} 件）',
  upsellTitle: '完善您的订单', upsellAdded: '已添加{name}', upsellPairs: '与{name}很搭', upsellSide: '来份配菜吗？', upsellDrink: '来点喝的吗？', upsellDessert: '来份甜点吗？', upsellSkip: '不用了，谢谢', upsellContinue: '继续', upsellDone: '完成', upsellChoose: '选择', upsellInOrder: '已在订单中', upsellStep: '第 {current}/{total} 步',
  yourTable: '您的餐桌', tableServed: '我们会将餐点送到这张餐桌。',
  poweredBy: '技术支持',
}

const zhTW: MenuCopy = {
  search: '搜尋菜單', searchOpen: '搜尋菜單', searchClose: '關閉搜尋', featured: '推薦', other: '其他',
  noItems: '找不到相關餐點', tryAnother: '試試其他關鍵字', viewFeed: '圖片瀏覽', viewMenu: '菜單', language: '語言',
  feedEmptyTitle: '圖片瀏覽即將推出', feedEmptyDescription: '可在完整菜單中查看所有餐點。',
  hoursTitle: '營業時間', openUntil: '營業至 {time}', closedOpensToday: '休息中 · {time} 開始營業',
  closedOpensTomorrow: '休息中 · 明天 {time} 開始營業', closedOpensOn: '休息中 · {day} {time} 開始營業', closed: '公休', today: '今天',
  add: '加入', addNamed: '加入{name}', removeNamed: '移除{name}', decrease: '減少', increase: '增加',
  viewOrder: '查看訂單', yourOrder: '我的訂單', cartEmpty: '訂單還是空的', subtotal: '小計',
  itemsOne: '{count} 件', itemsMany: '{count} 件',
  checkout: '去結帳', edit: '修改', closeCart: '關閉訂單', expandCart: '展開訂單', shrinkCart: '收合訂單',
  required: '必選', optional: '可選', chooseOne: '選 1 項', chooseUpTo: '最多選 {max} 項', chooseAtLeast: '至少選 {min} 項',
  chooseBetween: '選 {min} 至 {max} 項', firstHalf: '第一半', secondHalf: '第二半', halfPrice: '價格：{price}',
  ingredients: '配料', ingredientsHint: '依口味調整', extras: '加料',
  withoutNamed: '不要{name}', extraNamed: '多加{name}', addedNamed: '+ {name}',
  notes: '備註', notesPlaceholder: '例如：去冰、全熟…', notesLimit: '最多 140 字',
  addToOrder: '加入', updateItem: '更新', chooseRequired: '請選擇必選項目', orderWhatsApp: '透過 WhatsApp 點餐',
  whatsappMessage: '你好！我想點：{item}', close: '關閉', previousDish: '上一道菜', nextDish: '下一道菜',
  previousPhoto: '上一張', nextPhoto: '下一張', quantity: '數量',
  checkoutTitle: '結帳', backToCart: '返回訂單', orderType: '用餐方式', dineIn: '內用', pickup: '外帶自取',
  delivery: '外送', deliveryAddress: '外送地址', street: '街道與門牌號碼', complement: '樓層、房號（選填）',
  zipcode: '郵遞區號', city: '城市', deliveryNotes: '給外送員的備註（選填）',
  noDeliveryZone: '此郵遞區號不在外送範圍內，將收取標準外送費', tip: '小費', tipCustom: '其他金額',
  tipAmount: '小費金額', paymentSummary: '費用明細', deliveryFee: '外送費', total: '總計',
  yourDetails: '聯絡資訊', yourName: '姓名', phone: '電話號碼', placeOrder: '送出訂單', placingOrder: '正在送出…',
  orderPlaced: '訂單已送出！', orderNumber: '訂單編號', orderThankYou: '謝謝！餐廳已收到您的訂單。',
  errNamePhone: '請填寫姓名和電話號碼', errCartEmpty: '訂單還是空的',
  errStreet: '請填寫外送地址', errSubmit: '訂單送出失敗，請再試一次。',
  dishesCount: '{count} 道菜', swipeNext: '滑動查看下一道菜', chefPick: '主廚推薦', customize: '選規格', orderNow: '加入訂單',
  viewDish: '查看餐點', openOrderCount: '開啟訂單（{count} 件）',
  upsellTitle: '完成您的訂單', upsellAdded: '已加入{name}', upsellPairs: '和{name}很搭', upsellSide: '來份配菜嗎？', upsellDrink: '來點喝的嗎？', upsellDessert: '來份甜點嗎？', upsellSkip: '不用了，謝謝', upsellContinue: '繼續', upsellDone: '完成', upsellChoose: '選擇', upsellInOrder: '已在訂單中', upsellStep: '第 {current}/{total} 步',
  yourTable: '您的餐桌', tableServed: '我們會將餐點送到這張餐桌。',
  poweredBy: '技術支援',
}

const COPY: Record<string, MenuCopy> = { en, pt, es, fr, de, it, nl, pl, tr, ru, hi, ja, ko, zh, 'zh-TW': zhTW }

export function getMenuCopy(lang: string | null | undefined): MenuCopy {
  return (lang && COPY[lang]) || en
}

/** "1 item" / "3 items", with the plural rules of the guest's language. */
export function itemsLabel(copy: MenuCopy, count: number, lang: string): string {
  const rule = new Intl.PluralRules(localeFor(lang)).select(count)
  const template = rule === 'one' ? copy.itemsOne : rule === 'few' ? (copy.itemsFew ?? copy.itemsMany) : copy.itemsMany
  return fill(template, { count })
}

// Dish tags the admin offers. A free-text tag shows as typed.
const TAG_COPY: Record<string, Record<string, string>> = {
  'Vegetarian': { en: 'Vegetarian', pt: 'Vegetariano', es: 'Vegetariano', fr: 'Végétarien', de: 'Vegetarisch', it: 'Vegetariano', nl: 'Vegetarisch', pl: 'Wegetariańskie', tr: 'Vejetaryen', ru: 'Вегетарианское', hi: 'शाकाहारी', ja: 'ベジタリアン', ko: '채식', zh: '素食', 'zh-TW': '素食' },
  'Vegan': { en: 'Vegan', pt: 'Vegano', es: 'Vegano', fr: 'Végan', de: 'Vegan', it: 'Vegano', nl: 'Veganistisch', pl: 'Wegańskie', tr: 'Vegan', ru: 'Веганское', hi: 'वीगन', ja: 'ヴィーガン', ko: '비건', zh: '纯素', 'zh-TW': '全素' },
  'Gluten-Free': { en: 'Gluten-free', pt: 'Sem glúten', es: 'Sin gluten', fr: 'Sans gluten', de: 'Glutenfrei', it: 'Senza glutine', nl: 'Glutenvrij', pl: 'Bezglutenowe', tr: 'Glutensiz', ru: 'Без глютена', hi: 'ग्लूटेन-मुक्त', ja: 'グルテンフリー', ko: '글루텐 프리', zh: '无麸质', 'zh-TW': '無麩質' },
  'Spicy': { en: 'Spicy', pt: 'Picante', es: 'Picante', fr: 'Épicé', de: 'Scharf', it: 'Piccante', nl: 'Pittig', pl: 'Ostre', tr: 'Acılı', ru: 'Острое', hi: 'तीखा', ja: '辛口', ko: '매운맛', zh: '辣', 'zh-TW': '辣' },
  "Chef's special": { en: "Chef's special", pt: 'Especial do chef', es: 'Especial del chef', fr: 'Spécialité du chef', de: 'Spezialität des Hauses', it: 'Specialità dello chef', nl: 'Specialiteit van de chef', pl: 'Specjalność szefa', tr: 'Şefin özel tabağı', ru: 'Фирменное блюдо', hi: 'शेफ़ स्पेशल', ja: 'シェフのスペシャル', ko: '셰프 스페셜', zh: '主厨特选', 'zh-TW': '主廚特選' },
  'Recommended': { en: 'Recommended', pt: 'Recomendado', es: 'Recomendado', fr: 'Recommandé', de: 'Empfohlen', it: 'Consigliato', nl: 'Aanbevolen', pl: 'Polecane', tr: 'Önerilen', ru: 'Рекомендуем', hi: 'सुझाया गया', ja: 'おすすめ', ko: '추천', zh: '推荐', 'zh-TW': '推薦' },
}

export function translateTag(tag: string, lang: string): string {
  return TAG_COPY[tag]?.[lang] ?? tag
}
