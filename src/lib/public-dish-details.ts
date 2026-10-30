/**
 * Ingredient and allergen notes shown with a dish (after its description) for
 * restaurants that publish them outside the catalog. Keyed by the restaurant's
 * slug, then by the dish's name; a dish without an entry shows none.
 *
 * Celes Confections: the website publishes one ingredient list and one allergen
 * list for its crêpe cakes, and a short component list per dish. Each crêpe cake
 * therefore shows that base list plus what its own flavor adds; the puddings show
 * their own components, with allergens worked out from those components (the
 * website gives no allergen list for them).
 */
export interface DishDetail {
  label: string
  text: string
}

const CREPE_BASE =
  'Milk, Flour (Wheat), Eggs, Butter (Cream, Salt), Sugar, Water, Whipping Cream (Cream, Stabilizers [Carrageenan]), Corn Starch, Pastry Cream (Base: Milk, Egg Yolks, Sugar, Corn Starch, Vanilla Extract)'
const CREPE_ALLERGENS = 'Milk, Eggs, Wheat'
const TRACES = 'May contain traces of Nuts, Soy.'

function crepe(flavorAdds: string, extraAllergens = ''): DishDetail[] {
  return [
    { label: 'Ingredients', text: `${CREPE_BASE}. This flavor also has: ${flavorAdds}.` },
    { label: 'Allergens', text: `${CREPE_ALLERGENS}${extraAllergens}. ${TRACES}` },
  ]
}

/** Allergens here are worked out from the components the website lists for the pudding (it publishes no allergen list for them). */
function pudding(components: string, allergens: string): DishDetail[] {
  return [
    { label: 'Ingredients', text: components },
    { label: 'Allergens', text: `${allergens}. ${TRACES}` },
  ]
}

const CELES: Record<string, DishDetail[]> = {
  Classic: crepe('vanilla crêpes, diplomat cream'),
  Lemon: crepe('lemon crêpes, lemon curd mousse'),
  Matcha: crepe('matcha crêpes, matcha white chocolate mousse'),
  Tiramisu: crepe('tiramisu crêpes, mascarpone coffee filling'),
  Strawberry: crepe('vanilla crêpes, strawberry whipped cream', ', Strawberries'),
  'Dulce de Leche': crepe('vanilla crêpes, caramelized condensed milk whipped cream'),
  Passion: crepe('vanilla crêpes, passion fruit white chocolate mousse'),
  Mango: crepe('vanilla crêpes, mango white chocolate mousse'),
  'Ube · Purple Yam': crepe('vanilla crêpes, purple yam white chocolate mousse'),
  'Dark Chocolate': crepe('chocolate crêpes, dark chocolate mousse'),
  Raspberry: crepe('vanilla crêpes, raspberry white chocolate mousse'),
  'Black Sesame': crepe('black sesame crêpes, black sesame white chocolate mousse', ', Sesame'),
  'Ube Coconut Pudding Tray': pudding('Purple yam, coconut cream, toasted coconut.', 'Coconut'),
  'Banana Pudding Tray': pudding('Vanilla custard, ripe banana, vanilla wafer.', 'Milk, Eggs, Wheat'),
  'Strawberry Shortcake Pudding Tray': pudding('Vanilla custard, fresh strawberry, buttery shortcake crumble.', 'Milk, Eggs, Wheat, Strawberries'),
  'Pistachio Pudding Tray': pudding('Silky pistachio custard, toasted pistachio crumble.', 'Milk, Eggs, Tree nuts (Pistachio)'),
  'Pumpkin Spice Pudding Tray': pudding('Spiced pumpkin custard, cinnamon cream, gingersnap crumble.', 'Milk, Eggs, Wheat'),
  'Dulce de Leche Pudding Tray': pudding('Vanilla custard, caramelized condensed milk, toasted wafer.', 'Milk, Eggs, Wheat'),
}

const DETAILS_BY_SLUG: Record<string, Record<string, DishDetail[]>> = {
  'celes-confections': CELES,
}

export function dishDetailsFor(
  slug: string | null | undefined,
  product: { name: string },
): DishDetail[] {
  return (slug && DETAILS_BY_SLUG[slug]?.[product.name]) || []
}
