import Script from 'next/script'
import { BRAND_GTM_ID } from '@/lib/brand'

/**
 * Google Tag Manager for Xprout's own marketing pages (landing, pricing, blog).
 * Loaded with lazyOnload (after the page is idle) so it never costs the landing its Lighthouse budget.
 * Restaurant menus never load it: their guests are not Xprout's visitors.
 */
export function PlatformTagManager({ containerId = BRAND_GTM_ID }: { containerId?: string }) {
  if (!/^GTM-[A-Z0-9]+$/.test(containerId)) return null
  return (
    <>
      <Script id="platform-gtm" strategy="lazyOnload">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${containerId}');`}
      </Script>
      <noscript>
        <iframe src={`https://www.googletagmanager.com/ns.html?id=${containerId}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} />
      </noscript>
    </>
  )
}
