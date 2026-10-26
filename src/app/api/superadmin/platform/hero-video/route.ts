/**
 * POST { path } — encode a landing background video with the `hero` profile
 * (src/lib/media/video.ts) and publish it, with a poster frame.
 *
 * `path` is either the staging key the browser just uploaded to (see
 * video-upload-url) or the published key itself, to re-encode in place a
 * video that was uploaded before encoding existed. Superadmin only.
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getStorageClient } from '@/lib/storage'
import { convertBufferToWebP } from '@/lib/upload'
import { transcodeVideo } from '@/lib/media/video'
import { HERO_POSTER_PATH, HERO_VIDEO_BUCKET, HERO_VIDEO_PATH, isEncodableHeroPath } from '@/lib/media/hero-video'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

// ffmpeg on a long 1080p source takes a while; Coolify has no request cap,
// this only matters on hosts that enforce one.
export const maxDuration = 300

async function handlePOST(request: Request) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { path?: unknown } | null
  const path = typeof body?.path === 'string' ? body.path : ''
  if (!isEncodableHeroPath(path)) {
    return NextResponse.json({ error: 'Not a hero video key' }, { status: 400 })
  }

  const storage = getStorageClient()
  try {
    const source = await storage.download(HERO_VIDEO_BUCKET, path)
    const mimeType = path.endsWith('.webm') ? 'video/webm' : path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
    const result = await transcodeVideo(source, mimeType, { profile: 'hero' })
    if (!result.transcoded) {
      return NextResponse.json({ error: 'ffmpeg is not available on this server; the video was left as uploaded.' }, { status: 503 })
    }

    const url = await storage.upload(HERO_VIDEO_BUCKET, HERO_VIDEO_PATH, result.video, { contentType: 'video/mp4', upsert: true })
    const posterUrl = result.poster
      ? await storage.upload(HERO_VIDEO_BUCKET, HERO_POSTER_PATH, await convertBufferToWebP(result.poster), { contentType: 'image/webp', upsert: true })
      : null

    const version = Date.now()
    log.info('hero_video.encoded', { source_path: path, original_bytes: source.length, bytes: result.video.length })
    return NextResponse.json({
      url: `${url}?v=${version}`,
      poster_url: posterUrl ? `${posterUrl}?v=${version}` : null,
      bytes: result.video.length,
      original_bytes: source.length,
    })
  } catch (err) {
    log.error('POST /api/superadmin/platform/hero-video', { err, path })
    return NextResponse.json({ error: 'Could not encode the video' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/superadmin/platform/hero-video', handlePOST)
