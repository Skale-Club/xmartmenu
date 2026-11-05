import {nativeBlogSelected,legacyBlogWritesBlocked,LEGACY_BLOG_WRITES_MESSAGE} from '@/lib/blog/native/selected'
import {nativeBlogAdminHttp} from '@/lib/blog/native/admin-http'
/**
 * Generate now (autoblog-parity XM-09), bypassing the cadence gates. The
 * database lock still applies, so this cannot collide with the scheduled run.
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { generateBlogPost } from '@/lib/blog/generator'
import { revalidatePath } from 'next/cache'
import { withApi } from '@/lib/observability/with-api'

async function handlePOST(request: Request) {
  if(nativeBlogSelected())return nativeBlogAdminHttp('generate',request)
  if(legacyBlogWritesBlocked())return NextResponse.json({error:LEGACY_BLOG_WRITES_MESSAGE},{status:503})
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await generateBlogPost({ trigger: 'manual' })
  revalidatePath('/blog')
  if (result.status === 'failed') return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}

export const POST = withApi('POST /api/superadmin/blog/generate', handlePOST)
