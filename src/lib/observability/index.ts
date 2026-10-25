// Browser-safe entry point: only what client components may import. Server
// code imports the Node-only pieces directly (./log, ./context, ./with-api).
export { captureSecurityEvent } from './security'
