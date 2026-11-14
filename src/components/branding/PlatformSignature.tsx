import Image from 'next/image'
import { PLATFORM_BRAND_ASSETS } from '@/lib/platform-brand'

/** The approved signature is an asset, never a typeset approximation. */
export default function PlatformSignature({ tone = 'forest', className = '' }: {
  tone?: 'forest' | 'ivory'
  className?: string
}) {
  return <Image
    src={tone === 'ivory' ? PLATFORM_BRAND_ASSETS.horizontalIvory : PLATFORM_BRAND_ASSETS.horizontalForest}
    alt="Xprout"
    width={1177}
    height={327}
    style={{ aspectRatio: '1176.5155165075823 / 326.6565102866406' }}
    className={`h-auto w-[175px] min-w-[175px] shrink-0 object-contain sm:w-[195px] ${className}`}
  />
}
