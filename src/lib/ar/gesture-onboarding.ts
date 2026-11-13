/**
 * The "drag to move" hint after the dish first lands: once per browser,
 * independent of restaurant and dish. No browser reads at import.
 * v2: the old three-step intro (drag, twist, pinch) was replaced by this hint,
 * so browsers that saw v1 still see the new hint once.
 */
export const AR_GESTURE_ONBOARDING_KEY = 'xmartmenu:ar-move-hint:v2'

export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Create a claimant with an in-memory fallback when persistence is unavailable. */
export function createGestureOnboardingClaim() {
  let claimed = false
  return (storage?: OnboardingStorage | null): boolean => {
    if (claimed) return false
    try {
      if (storage?.getItem(AR_GESTURE_ONBOARDING_KEY)) {
        claimed = true
        return false
      }
    } catch { /* Private browsing may disable storage. */ }
    claimed = true
    try { storage?.setItem(AR_GESTURE_ONBOARDING_KEY, 'shown') } catch { /* Keep the memory claim. */ }
    return true
  }
}

/** Shared by component mounts in this page, including when storage is blocked. */
export const claimGestureOnboarding = createGestureOnboardingClaim()
