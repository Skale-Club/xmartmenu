import { accessRequestAdminHttp } from '@/lib/access-requests/admin-http'

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => accessRequestAdminHttp('list', request)
