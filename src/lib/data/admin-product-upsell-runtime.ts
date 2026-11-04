import type { AdminMenuContext } from './admin-menus'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { updateAdminProductUpsellIds } from './admin-product-upsell'

export const updateOwnedProductUpsellIds = (context: AdminMenuContext, productId: string, value: unknown) =>
  ownedAdminTransaction(true, query => updateAdminProductUpsellIds(query, context, productId, value))
