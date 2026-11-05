// Loaded with `node --import` (through NODE_OPTIONS) by scripts/dev.mjs into every
// process of the development server, including Next's workers. Installs the fail-closed
// network guard before any application code runs.
import { installDevOutboundGuard } from './dev-outbound-guard.mjs'

if (process.env.NODE_ENV === 'development') installDevOutboundGuard(process.env)
