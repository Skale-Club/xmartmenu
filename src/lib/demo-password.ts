import { randomBytes } from 'node:crypto'

// No password lives in the code. The password is set and used inside the same
// request, so by default it is a fresh random one per hit; DEMO_OWNER_PASSWORD
// (>= 12 chars) only pins it when an operator wants that.
export function demoPassword(env: Record<string, string | undefined> = process.env, random: () => string = () => randomBytes(24).toString('base64url')) {
  const pinned = env.DEMO_OWNER_PASSWORD
  return pinned && pinned.length >= 12 ? pinned : random()
}
