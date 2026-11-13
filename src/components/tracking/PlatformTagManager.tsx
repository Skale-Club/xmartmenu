import Script from 'next/script'
import { BRAND_GTM_ID } from '@/lib/brand'

/** Milliseconds after window load before Tag Manager starts on its own when the visitor has not interacted yet. */
export const GTM_IDLE_DELAY_MS = 5000

/**
 * Inline bootstrap: Tag Manager starts on the first interaction (scroll, pointer, key, touch)
 * or GTM_IDLE_DELAY_MS after window load, whichever comes first, and only once.
 * GA4 + Clarity are heavy third-party scripts; keeping them off the critical window
 * keeps the landing inside its Lighthouse mobile budget (CI minimum 0.88).
 */
export function gtmBootstrap(containerId: string, delayMs = GTM_IDLE_DELAY_MS): string {
  return `(function(w,d,i,ms){var done=false,ev=['scroll','pointerdown','keydown','touchstart'];function go(){if(done)return;done=true;ev.forEach(function(e){w.removeEventListener(e,go,true)});w.dataLayer=w.dataLayer||[];w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});var j=d.createElement('script');j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;d.head.appendChild(j)}ev.forEach(function(e){w.addEventListener(e,go,{capture:true,passive:true,once:true})});function later(){setTimeout(go,ms)}if(d.readyState==='complete')later();else w.addEventListener('load',later,{once:true})})(window,document,'${containerId}',${delayMs});`
}

/**
 * Google Tag Manager for Xprout's own marketing pages (landing, pricing, blog).
 * Restaurant menus never load it: their guests are not Xprout's visitors.
 */
export function PlatformTagManager({ containerId = BRAND_GTM_ID }: { containerId?: string }) {
  if (!/^GTM-[A-Z0-9]+$/.test(containerId)) return null
  return (
    <>
      <Script id="platform-gtm" strategy="afterInteractive">
        {gtmBootstrap(containerId)}
      </Script>
      <noscript>
        <iframe src={`https://www.googletagmanager.com/ns.html?id=${containerId}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} />
      </noscript>
    </>
  )
}
