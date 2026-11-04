import { ownedIngredientHttp } from '@/lib/admin/owned-ingredient-http'

export const POST = (request: Request) => ownedIngredientHttp(request, 'reorder')
