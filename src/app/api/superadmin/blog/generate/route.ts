/**
 * Generate now (autoblog-parity XM-09), bypassing the cadence gates. The
 * database lock still applies, so this cannot collide with the scheduled run.
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { generateBlogPost } from '@/lib/blog/generator'
import { revalidatePath } from 'next/cache'

export async function POST() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await generateBlogPost({ trigger: 'manual' })
  revalidatePath('/blog')
  if (result.status === 'failed') return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
