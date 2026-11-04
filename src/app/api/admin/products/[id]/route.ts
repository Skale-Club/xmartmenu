import { ownedProductHttp } from '@/lib/admin/owned-product-http'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownedProductHttp(request, 'patch', (await params).id)
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownedProductHttp(request, 'delete', (await params).id)
}
