import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function getSafeRedirect(value: unknown) {
  if (typeof value !== 'string') return '/'
  return value.startsWith('/') ? value : '/'
}

function generateCustomerCredentials() {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  const email = `customer.${suffix}@xmartmenu.local`
  const password = `${crypto.randomUUID()}Aa1!`
  return { email, password }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, email, phone, password, redirectTo } = body
  const safeRedirectTo = getSafeRedirect(redirectTo)

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phone?.trim()) return NextResponse.json({ error: 'Phone is required' }, { status: 400 })

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const rawPassword = typeof password === 'string' ? password : ''
  const hasEmail = normalizedEmail.length > 0
  const hasPassword = rawPassword.length > 0

  if (hasEmail !== hasPassword) {
    return NextResponse.json({ error: 'Email and password must be provided together.' }, { status: 400 })
  }

  // Quick customer flow (QR): only name + phone.
  if (!hasEmail && !hasPassword) {
    const { email: generatedEmail, password: generatedPassword } = generateCustomerCredentials()
    const service = await createServiceClient()
    const { data: createdUser, error: createError } = await service.auth.admin.createUser({
      email: generatedEmail,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: {
        full_name: name.trim(),
        phone: phone.trim(),
      },
    })

    if (createError || !createdUser.user) {
      return NextResponse.json({ error: createError?.message ?? 'Failed to create customer account' }, { status: 400 })
    }

    await service.from('profiles').upsert({
      id: createdUser.user.id,
      role: 'customer',
      full_name: name.trim(),
      phone: phone.trim(),
    }, { onConflict: 'id' })

    const supabase = await createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: generatedEmail,
      password: generatedPassword,
    })

    if (signInError) {
      return NextResponse.json({
        ok: true,
        signed_in: false,
        redirect_to: safeRedirectTo,
      })
    }

    return NextResponse.json({
      ok: true,
      signed_in: true,
      redirect_to: safeRedirectTo,
    })
  }

  if (rawPassword.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

  const { origin } = new URL(request.url)
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: rawPassword,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeRedirectTo)}`,
    },
  })

  if (error) {
    if (error.message.includes('already registered')) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (!data.user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

  const service = await createServiceClient()
  await service.from('profiles').upsert({
    id: data.user.id,
    full_name: name.trim(),
    phone: phone.trim(),
  }, { onConflict: 'id' })

  return NextResponse.json({ ok: true })
}
