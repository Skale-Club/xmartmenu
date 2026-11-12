/** Shared by browser preprocessing and the authoritative server encoder. */
export const IMAGE_PROFILES = {
  photo: { maxSide: 1200, maxBytes: 100 * 1024 },
  wide: { maxSide: 1200, maxBytes: 180 * 1024 },
  logo: { maxSide: 512, maxBytes: 40 * 1024 },
} as const

export type ImageProfile = keyof typeof IMAGE_PROFILES

export interface ImageOptimizationOptions {
  profile?: ImageProfile
  /** Override the encoded byte budget. */
  maxSize?: number
  /** Override the longest side, without enlarging the source. */
  maxSide?: number
}

export function imagePolicy(options: ImageOptimizationOptions = {}) {
  const profile = IMAGE_PROFILES[options.profile ?? 'photo']
  return {
    maxSide: Math.max(1, Math.floor(options.maxSide ?? profile.maxSide)),
    maxBytes: Math.max(1, Math.floor(options.maxSize ?? profile.maxBytes)),
  }
}
