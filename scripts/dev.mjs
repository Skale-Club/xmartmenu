import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { developmentEnvironment } from './lib/dev-environment.mjs'

dotenv.config({ path: ['.env.local', '.env'], quiet: true })
try {
  // Explicit development project only; provider credentials blanked; outbound network
  // restricted to loopback, the development database and the development Supabase project.
  const env = developmentEnvironment(process.env)
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env })
  child.on('error', () => { console.error('Development server failed to start'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
