import { identityRoute } from '@/lib/auth/identity-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ operation: string }> }
export async function GET(request: Request, context: Context) {
  return identityRoute(request, (await context.params).operation)
}
export async function POST(request: Request, context: Context) {
  return identityRoute(request, (await context.params).operation)
}
