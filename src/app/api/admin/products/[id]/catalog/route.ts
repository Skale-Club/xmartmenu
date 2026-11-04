import { ownedProductDetailHttp } from '@/lib/admin/owned-product-detail-http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownedProductDetailHttp(request, (await params).id)
}
