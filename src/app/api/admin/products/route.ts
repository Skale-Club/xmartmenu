import { ownedProductHttp } from '@/lib/admin/owned-product-http'

export const POST = (request: Request) => ownedProductHttp(request, 'create')
