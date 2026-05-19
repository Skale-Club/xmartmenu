/**
 * Probes OpenRouter with a candidate API key + model.
 * Returns { ok: true } if the probe completes successfully.
 *
 * The client sends a plaintext API key here (never persisted by this endpoint).
 * Persistence goes through PUT /api/admin/chat-addon/settings which encrypts.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

export async function POST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { api_key, model } = await request.json() as { api_key?: string; model?: string }
  if (!api_key || !model) return NextResponse.json({ error: 'api_key and model are required' }, { status: 400 })

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, status: res.status, error: text.slice(0, 200) }, { status: 200 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Network error' }, { status: 200 })
  }
}
