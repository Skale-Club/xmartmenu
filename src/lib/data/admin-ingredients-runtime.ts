import type { AdminMenuContext } from './admin-menus'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { mutateAdminIngredient, readAdminIngredients, readIngredientsPage, type IngredientMutation } from './admin-ingredients'

export const readOwnedIngredientsPage = (context: AdminMenuContext) => ownedAdminTransaction(false, query => readIngredientsPage(query, context))
export const listOwnedIngredients = (context: AdminMenuContext) => ownedAdminTransaction(false, query => readAdminIngredients(query, context))
export const mutateOwnedIngredient = (context: AdminMenuContext, mutation: IngredientMutation) => ownedAdminTransaction(true, query => mutateAdminIngredient(query, context, mutation))
