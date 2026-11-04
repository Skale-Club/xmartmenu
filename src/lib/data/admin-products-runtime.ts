import type { AdminMenuContext } from './admin-menus'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { mutateAdminProduct, readProductsPage, type ProductMutation } from './admin-products'

export const readOwnedProductsPage = (context: AdminMenuContext, selectedMenuId?: string) => ownedAdminTransaction(false, query => readProductsPage(query, context, selectedMenuId))
export const mutateOwnedProduct = (context: AdminMenuContext, mutation: ProductMutation) => ownedAdminTransaction(true, query => mutateAdminProduct(query, context, mutation))
