import { ownedIngredientHttp } from '@/lib/admin/owned-ingredient-http'

export const GET = (request: Request) => ownedIngredientHttp(request, 'list')
export const POST = (request: Request) => ownedIngredientHttp(request, 'create')
