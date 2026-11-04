import type { AdminMenuContext } from './admin-menus'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { mutateAdminCategory, readAdminCategoriesPage, type CategoryMutation } from './admin-categories'

export const readOwnedCategoriesPage = (context: AdminMenuContext, selectedMenuId?: string) =>
  ownedAdminTransaction(false, query => readAdminCategoriesPage(query, context, selectedMenuId))
export const mutateOwnedCategory = (context: AdminMenuContext, mutation: CategoryMutation) =>
  ownedAdminTransaction(true, query => mutateAdminCategory(query, context, mutation))
