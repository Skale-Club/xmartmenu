/**
 * phone.ts — canonical key for matching a customer's typed checkout phone with
 * their OTP-verified session phone.
 *
 * At checkout the customer types a free-text phone ("11 99999-8888"); the OTP
 * login yields an E.164 value ("5511999998888"). An exact string match never
 * lines these up, so the /me order panel showed nothing. We key both sides on
 * the last 8 digits (the local subscriber number), which is stable across
 * formatting and country/area-code prefixes.
 */
export function phoneMatchKey(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.slice(-8)
}
