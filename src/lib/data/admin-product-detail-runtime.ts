import type { AdminMenuContext } from './admin-menus'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { mutateProductDetail, readProductDetailPage, type DetailOperation } from './admin-product-detail'

export const readOwnedProductDetailPage = (context: AdminMenuContext, id: string, selectedMenuId?: string) => ownedAdminTransaction(false, query => readProductDetailPage(query, context, id, selectedMenuId))
export const mutateOwnedProductDetail = (context: AdminMenuContext, id: string, operation: DetailOperation) => ownedAdminTransaction(operation.action !== 'list', query => mutateProductDetail(query, context, id, operation))
