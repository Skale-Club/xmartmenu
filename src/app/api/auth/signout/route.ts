import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// P1-07 fix: signout is a POST endpoint so link-previews, prefetches, and
// cross-origin <img>/<iframe> loads cannot trigger a logout. The superadmin
// layout uses a <form method="post"> to drive this.
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(
    new URL('/auth/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    { status: 303 },
  )
}
