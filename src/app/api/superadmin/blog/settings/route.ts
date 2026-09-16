/**
 * Auto-blog settings (autoblog-parity XM-09). Superadmin only: this is the
 * platform's own blog, not a tenant feature, so there is no tenant-scoped
 * variant of this route by design.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { encryptApiKey, maskApiKey, decryptApiKey } from '@/lib/crypto'
import { nextScheduledRun } from '@/lib/blog/schedule'

const MASKED = '••••'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  postsPerDay: z.number().int().min(0).max(24).optional(),
  postingHour: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
  seoKeywords: z.string().max(2000).optional(),
  promptStyle: z.string().max(4000).optional(),
  systemPrompt: z.string().max(8000).optional(),
  enableTrendAnalysis: z.boolean().optional(),
  rssEnabled: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  textModel: z.string().max(200).optional(),
  imageModel: z.string().max(200).optional(),
  // The masked sentinel (or an omitted field) keeps the stored key.
  openrouterApiKey: z.string().max(400).optional(),
})

export async function GET() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data } = await service.from('blog_settings').select('*').eq('id', 1).maybeSingle()
  if (!data) return NextResponse.json({ settings: null, nextScheduledRunAt: null })

  const row = data as Record<string, unknown> & {
    openrouter_api_key: string | null
    posting_hour: number | null
    posts_per_day: number
    timezone: string
  }

  // The key NEVER leaves the server. The panel gets a mask so it can show that
  // one is configured without ever holding it.
  let maskedKey: string | null = null
  if (row.openrouter_api_key) {
    try {
      maskedKey = maskApiKey(decryptApiKey(row.openrouter_api_key))
    } catch {
      // A key that will not decrypt is usually a rotated ENCRYPTION_KEY. Saying
      // so is far more useful than showing a mask of nothing.
      maskedKey = '(não foi possível descriptografar — a chave de criptografia mudou?)'
    }
  }

  // Destructured out, not filtered: this is what keeps the ciphertext from ever
  // reaching a response body, and it should fail loudly if the column is renamed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { openrouter_api_key: _omitted, ...safe } = row
  return NextResponse.json({
    settings: { ...safe, openrouter_api_key_masked: maskedKey, has_openrouter_key: !!row.openrouter_api_key },
    // Computed from the SAME helper the cron gate uses, so the time the panel
    // promises is the time the job will actually fire.
    nextScheduledRunAt:
      nextScheduledRun({
        now: new Date(),
        timeZone: row.timezone || 'UTC',
        postingHour: row.posting_hour,
        postsPerDay: row.posts_per_day,
      })?.toISOString() ?? null,
  })
}

export async function PATCH(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: existing } = await service
    .from('blog_settings')
    .select('openrouter_api_key')
    .eq('id', 1)
    .maybeSingle()

  const update: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
  const map: Record<string, string> = {
    enabled: 'enabled',
    postsPerDay: 'posts_per_day',
    postingHour: 'posting_hour',
    timezone: 'timezone',
    seoKeywords: 'seo_keywords',
    promptStyle: 'prompt_style',
    systemPrompt: 'system_prompt',
    enableTrendAnalysis: 'enable_trend_analysis',
    rssEnabled: 'rss_enabled',
    autoPublish: 'auto_publish',
    textModel: 'text_model',
    imageModel: 'image_model',
  }
  for (const [key, column] of Object.entries(map)) {
    if (key in parsed.data) update[column] = (parsed.data as Record<string, unknown>)[key]
  }

  const incoming = parsed.data.openrouterApiKey?.trim()
  if (incoming !== undefined && incoming !== MASKED) {
    // Empty clears the key; anything else is encrypted before it touches the row.
    update.openrouter_api_key = incoming ? encryptApiKey(incoming) : null
  } else if (existing) {
    update.openrouter_api_key = (existing as { openrouter_api_key: string | null }).openrouter_api_key
  }

  const { error } = await service.from('blog_settings').upsert(update, { onConflict: 'id' })
  if (error) {
    console.error('PATCH /api/superadmin/blog/settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
