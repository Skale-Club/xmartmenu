import { redirect } from 'next/navigation'

import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { nextScheduledRun } from '@/lib/blog/schedule'
import { scopeFilter } from '@/lib/blog/scope'
import BlogAutomationClient, { type BlogAutomationState } from './BlogAutomationClient'

export const dynamic = 'force-dynamic'

/**
 * Auto-blog console for the PLATFORM's own marketing blog (autoblog-parity
 * XM-09). This is xmartmenu.com's blog, not any tenant's — the whole feature is
 * single-site and superadmin-only by design (MASTER D-10), which is why there
 * is no tenant selector anywhere on this page.
 *
 * The initial state is read HERE rather than from an effect in the client: the
 * route is already superadmin-gated and already awaiting Supabase, so the panel
 * renders with real values instead of flashing empty.
 */
export default async function SuperadminBlogPage() {
  if (!(await assertSuperadmin())) redirect('/overview')

  const service = createServiceClient()

  const [{ data: settings }, { data: drafts }, { data: jobs }, { data: sources }, { count: pendingItems }, { data: telegram }] =
    await Promise.all([
      scopeFilter(service.from('blog_settings').select('*'), null).maybeSingle(),
      scopeFilter(service.from('blog_posts').select('id, title, excerpt, created_at'), null)
        .eq('status', 'draft')
        .eq('ai_generated', true)
        .order('created_at', { ascending: false })
        .limit(50),
      scopeFilter(service.from('blog_generation_jobs').select('id, status, trigger, source, pillar_id, topic, error_message, durations_ms, created_at'), null)
        .order('created_at', { ascending: false })
        .limit(20),
      scopeFilter(service.from('blog_rss_sources').select('id, name, url, enabled, last_fetched_at, last_fetched_status, error_message'), null)
        .order('created_at', { ascending: true }),
      scopeFilter(service.from('blog_rss_items').select('id', { count: 'exact', head: true }), null).eq(
        'status',
        'pending',
      ),
      scopeFilter(
        service
          .from('telegram_settings')
          .select('enabled, bot_token, chat_ids, approvals_enabled, approvals_bot_token, approvals_chat_ids'),
        null,
      ).maybeSingle(),
    ])

  const settingsRow = settings as (Record<string, unknown> & {
    openrouter_api_key: string | null
    posting_hour: number | null
    posts_per_day: number
    timezone: string
  }) | null

  // Destructured out, not filtered: the encrypted key must never reach a
  // response body or an RSC payload, and renaming the column should break here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { openrouter_api_key: _omitted, ...safeSettings } = settingsRow ?? { openrouter_api_key: null }

  const tg = telegram as {
    enabled: boolean | null
    bot_token: string | null
    chat_ids: string[] | null
    approvals_enabled: boolean | null
    approvals_bot_token: string | null
    approvals_chat_ids: string[] | null
  } | null

  const state: BlogAutomationState = {
    settings: settingsRow ? (safeSettings as Record<string, unknown>) : null,
    hasOpenrouterKey: Boolean(settingsRow?.openrouter_api_key),
    // Computed from the SAME helper the cron gate uses, so the time this page
    // promises is the time the job actually fires. null means no hour is
    // pinned and the cadence drifts — which has no predictable answer, and
    // saying so beats inventing one.
    nextScheduledRunAt: settingsRow
      ? (nextScheduledRun({
          now: new Date(),
          timeZone: settingsRow.timezone || 'UTC',
          postingHour: settingsRow.posting_hour,
          postsPerDay: settingsRow.posts_per_day,
        })?.toISOString() ?? null)
      : null,
    drafts: (drafts ?? []) as BlogAutomationState['drafts'],
    jobs: (jobs ?? []) as BlogAutomationState['jobs'],
    sources: (sources ?? []) as BlogAutomationState['sources'],
    pendingItems: pendingItems ?? 0,
    telegram: {
      enabled: tg?.enabled ?? false,
      approvalsEnabled: tg?.approvals_enabled ?? false,
      hasBotToken: Boolean(tg?.bot_token),
      hasApprovalsBotToken: Boolean(tg?.approvals_bot_token),
      chatIds: tg?.chat_ids ?? [],
      approvalsChatIds: tg?.approvals_chat_ids ?? [],
    },
  }

  return <BlogAutomationClient initialState={state} />
}
