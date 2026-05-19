/**
 * Serves the Apple Pay domain association file required by Apple to verify
 * ownership of any domain where Apple Pay buttons are displayed.
 *
 * The actual file content must be downloaded from the Stripe Dashboard under
 * Settings → Payment methods → Apple Pay → Add domain, then stored in the
 * APPLE_PAY_DOMAIN_ASSOCIATION_FILE environment variable.
 *
 * Without this file at /.well-known/apple-developer-merchantid-domain-association,
 * the Apple Pay button will not appear even if PaymentElement is configured.
 *
 * Setup:
 *  1. Go to Stripe Dashboard → Settings → Payment methods → Apple Pay
 *  2. Add your domain (e.g. xmartmenu.skale.club)
 *  3. Download the domain association file content
 *  4. Set APPLE_PAY_DOMAIN_ASSOCIATION_FILE env var to that content
 */
export async function GET() {
  const fileContent = process.env.APPLE_PAY_DOMAIN_ASSOCIATION_FILE

  if (!fileContent) {
    return new Response('Not configured', { status: 404 })
  }

  return new Response(fileContent, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
