import { nativeOAuthHttp } from '@/lib/mcp/oauth-http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const POST=(request:Request)=>nativeOAuthHttp('decision',request)
