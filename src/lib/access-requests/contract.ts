import { z } from 'zod'

/**
 * Access-request onboarding (docs/product/access-request-onboarding.md,
 * XMM-D-2026-11-12-access-request-onboarding).
 *
 * A business that signs up on the main Xprout site answers these questions
 * and waits for the team. Submitting never grants access: only a platform
 * administrator's approval links the account to a restaurant.
 *
 * Client-safe: no server imports. The server validates every write with the
 * same schemas.
 */

export const ACCESS_REQUEST_STATUSES = ['draft', 'pending', 'approved', 'declined'] as const
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number]

export const ANSWERS_SCHEMA_VERSION = 1

export const LANGUAGES = ['en', 'pt', 'es'] as const
export const BUSINESS_TYPES = ['restaurant', 'bar', 'cafe', 'bakery', 'pizzeria', 'food_truck', 'hotel', 'other'] as const
export const LOCATION_COUNTS = ['1', '2-5', '6+'] as const
export const CURRENT_MENUS = ['printed', 'pdf_qr', 'other_app', 'none'] as const
export const INTERESTS = ['qr_menu', 'table_ordering', 'takeout_delivery', 'ai_chat', 'ar_dishes', 'website_domain', 'multi_language'] as const
export const MENU_SIZES = ['up_to_30', '30_80', '80_plus'] as const
export const CONTACT_TIMES = ['morning', 'afternoon', 'evening'] as const

/** One question per screen, in this order. `contact` holds phone + e-mail. */
export const ACCESS_REQUEST_STEPS = [
  'language', 'businessName', 'businessType', 'location', 'contact',
  'locations', 'currentMenu', 'interests', 'menuSize', 'socialUrl', 'contactTime',
] as const
export type AccessRequestStep = (typeof ACCESS_REQUEST_STEPS)[number]
/** Stored once the request is submitted. */
export const SUBMITTED_STEP = 'done'

export const REQUIRED_STEPS: readonly AccessRequestStep[] = ['language', 'businessName', 'businessType', 'location', 'contact']

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)
const phone = z.string().trim().min(6).max(40).regex(/^\+?[0-9 ()\-.]{6,40}$/, 'Enter a valid phone number')
const email = z.string().trim().max(200).email()
const url = z.string().trim().max(300)

/** Every answer, all optional: what a draft may hold at any step. */
export const draftAnswersSchema = z.object({
  language: z.enum(LANGUAGES).optional(),
  businessName: z.string().trim().max(120).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
  businessTypeOther: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.string().trim().max(200).optional(),
  locations: z.enum(LOCATION_COUNTS).optional(),
  currentMenu: z.enum(CURRENT_MENUS).optional(),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional(),
  menuSize: z.enum(MENU_SIZES).optional(),
  socialUrl: url.optional(),
  contactTime: z.enum(CONTACT_TIMES).optional(),
}).strict()
export type AccessRequestAnswers = z.infer<typeof draftAnswersSchema>

/** What a submitted request must hold. Optional questions may be skipped. */
export const submittedAnswersSchema = draftAnswersSchema.extend({
  language: z.enum(LANGUAGES),
  businessName: trimmed(2, 120),
  businessType: z.enum(BUSINESS_TYPES),
  location: trimmed(2, 200),
  contactPhone: phone,
  contactEmail: z.union([email, z.literal('')]).optional(),
}).strict()

export const saveDraftSchema = z.object({
  step: z.enum(ACCESS_REQUEST_STEPS),
  answers: draftAnswersSchema,
}).strict()

export const submitSchema = z.object({
  answers: submittedAnswersSchema,
  whatsappOptIn: z.boolean(),
}).strict()

/** What /api/access-request returns to the applicant. */
export type ApplicantState =
  | { status: 'has_restaurant' }
  | {
      status: 'none' | AccessRequestStatus
      step: AccessRequestStep | typeof SUBMITTED_STEP
      answers: AccessRequestAnswers
      prefill: { fullName: string | null; phone: string | null }
      submittedAt: string | null
    }

/** Superadmin review: approve into a new restaurant or an existing one, or decline. */
export const approveNewSchema = z.object({
  mode: z.literal('new'),
  name: trimmed(1, 200),
  slug: trimmed(1, 100),
  plan_id: z.string().uuid(),
}).strict()
export const approveExistingSchema = z.object({
  mode: z.literal('existing'),
  tenant_id: z.string().uuid(),
}).strict()
export const approveSchema = z.discriminatedUnion('mode', [approveNewSchema, approveExistingSchema])
export const declineSchema = z.object({ note: z.string().trim().max(2000).optional() }).strict()
