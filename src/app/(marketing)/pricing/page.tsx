import type { Metadata } from 'next'
import PricingClient from './PricingClient'
import { LAUNCH_SLOTS, PROJECTS, PLANS, formatUsd } from '@/lib/marketing/pricing'

const title = 'Pricing — XmartMenu'
const description = `Menu websites for restaurants from ${formatUsd(PROJECTS.diy.launch)} and plans from ${formatUsd(PLANS.menu.monthly)}/month. We build it, you approve it, we keep it updated. Launch pricing for our first ${LAUNCH_SLOTS} restaurants.`

export const metadata: Metadata = {
  // Absolute: the title already carries the brand (see the marketing layout).
  title: { absolute: title },
  description,
  alternates: { canonical: '/pricing' },
  openGraph: { title, description, url: '/pricing', type: 'website', images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: title }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/opengraph-image'] },
}

export default function PricingPage() {
  return <PricingClient />
}
