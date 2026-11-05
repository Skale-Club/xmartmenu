// Private per-request state; no HTTP header or JSON field can set this result.
const invalidOrigins=new WeakSet<Request>()
export const markInvalidMcpOrigin=(request:Request)=>{ invalidOrigins.add(request) }
export const invalidMcpOrigin=(request:Request)=>invalidOrigins.has(request)
