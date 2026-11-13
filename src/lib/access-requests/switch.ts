/**
 * Self-service restaurant onboarding (the old 4-step /onboarding form that
 * creates a restaurant with no approval) is kept in the code but OFF by
 * default: Xprout approves every business (XMM-D-2026-11-12-access-request-onboarding).
 * Set SELF_SERVICE_ONBOARDING_ENABLED=true to bring it back.
 */
export function selfServiceOnboardingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SELF_SERVICE_ONBOARDING_ENABLED === 'true'
}

/** Team WhatsApp number shown to applicants (E.164 digits). Unset hides the button. */
export function teamWhatsAppNumber(env: Record<string, string | undefined> = process.env): string | null {
  const digits = (env.ACCESS_REQUEST_TEAM_WHATSAPP ?? '').replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}
