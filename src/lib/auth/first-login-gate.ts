import type { AccountRef } from './identity-policy'

type Lookups = {
  googleClaim: (googleSub: string) => Promise<AccountRef | null>
  phoneOwners: (phone: string) => Promise<AccountRef[]>
}

/**
 * First-sign-in lookups (imported Google subject, phone match) exist only while
 * native authentication is selected. GOOGLE_AUTH_ENABLED alone (the pilot, or
 * the legacy-authority deployment) never auto-binds anything.
 */
export function gateFirstLogin(store: Lookups, selected: () => boolean): Lookups {
  return {
    googleClaim: async sub => selected() ? store.googleClaim(sub) : null,
    phoneOwners: async phone => selected() ? store.phoneOwners(phone) : [],
  }
}
