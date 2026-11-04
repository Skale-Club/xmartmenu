import { ownedIngredientHttp } from '@/lib/admin/owned-ingredient-http'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownedIngredientHttp(request, 'patch', (await params).id)
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownedIngredientHttp(request, 'delete', (await params).id)
}
