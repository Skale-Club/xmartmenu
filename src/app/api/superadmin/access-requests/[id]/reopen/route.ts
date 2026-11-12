import { accessRequestAdminHttp } from '@/lib/access-requests/admin-http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return accessRequestAdminHttp('reopen', request, (await params).id)
}
