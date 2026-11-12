import { NextResponse } from 'next/server'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { NativeOnboardingDenied } from '@/lib/auth/native-onboarding'
import { ownedAdminTransaction } from '@/lib/data/admin-menus-runtime'
import { rateLimit } from '@/lib/rate-limit'
import { ownedApplicantContext } from '@/lib/access-requests/applicant-context'
import { notifyAccessRequestSubmitted } from '@/lib/access-requests/notify'
import { AccessRequestError, isMissingAccessRequestsTable, readApplicantState, saveAccessRequestDraft, submitAccessRequest } from '@/lib/access-requests/store'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
const notFound = () => json({ error: 'Not found' }, 404)

function failure(error: unknown) {
  if (error instanceof AccessRequestError) return json({ error: error.message }, error.status)
  if (error instanceof NativeOnboardingDenied) return json({ error: 'Access requests are unavailable.' }, 403)
  if (error instanceof SyntaxError) return json({ error: 'Invalid request body.' }, 400)
  if (isMissingAccessRequestsTable(error)) return json({ error: 'Access requests are unavailable.' }, 503)
  console.error('access_request.failed', error instanceof Error ? error.name : 'unknown')
  return json({ error: 'Access requests are unavailable.' }, 503)
}

async function readJson(request: Request) {
  const body = await request.text()
  if (body.length > 12000) throw new AccessRequestError(400, 'Request too large')
  return JSON.parse(body) as unknown
}

export async function GET(request: Request) {
  if (!ownedAuthSelected()) return notFound()
  try {
    const context = await ownedApplicantContext(request)
    return json(await ownedAdminTransaction(false, query => readApplicantState(query, context)))
  } catch (error) { return failure(error) }
}

export async function PUT(request: Request) {
  if (!ownedAuthSelected()) return notFound()
  try {
    const context = await ownedApplicantContext(request)
    if (!(await rateLimit('access-request-save', context.userId, 120, '10 m')).ok) return json({ error: 'Too many requests. Please try again later.' }, 429)
    const input = await readJson(request)
    return json(await ownedAdminTransaction(true, query => saveAccessRequestDraft(query, context, input)))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  if (!ownedAuthSelected()) return notFound()
  try {
    const context = await ownedApplicantContext(request)
    if (!(await rateLimit('access-request-submit', context.userId, 20, '10 m')).ok) return json({ error: 'Too many requests. Please try again later.' }, 429)
    const input = await readJson(request)
    const current = await ownedApplicantContext(request)
    if (current.userId !== context.userId || current.sessionHash !== context.sessionHash) throw new NativeOnboardingDenied('Applicant changed')
    const result = await ownedAdminTransaction(true, query => submitAccessRequest(query, current, input))
    if (result.lead) {
      // After commit and fail-open: a Telegram problem never undoes or delays the answer.
      try { await notifyAccessRequestSubmitted(result.lead) }
      catch (error) { console.warn('access_request.notify_failed', error instanceof Error ? error.message : 'unknown') }
    }
    return json({ status: 'pending' })
  } catch (error) { return failure(error) }
}
