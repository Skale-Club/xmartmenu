/**
 * POST /api/superadmin/tenants/[id]/chat-addon-override
 *
 * Superadmin force-enable/disable of the chat addon for a specific tenant,
 * regardless of plan availability. Body: { override: true | false | null }.
 * NULL clears the override (follow the plan again).
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ok = await assertSuperadmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { override } = await request.json() as { override: boolean | null }
  if (override !== true && override !== false && override !== null) {
    return NextResponse.json({ error: 'override must be true, false, or null' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('tenant_subscriptions')
    .update({ chat_addon_override: override })
    .eq('tenant_id', id)

  if (error) return NextResponse.json({ error: 'Failed to update override' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
