/**
 * Dish videos: whatever the owner uploads (phone MOV/MP4/WebM, often 50+ MB)
 * is re-encoded to a small MP4 that plays everywhere: H.264, at most 720p,
 * no audio (menu videos autoplay muted), moov atom up front so it starts
 * before it finishes downloading. A poster frame is cut for the feed.
 *
 * Runs ffmpeg (installed in the Docker image). Where ffmpeg is missing (local
 * Windows dev), an MP4/WebM is stored as uploaded instead — see `transcodeVideo`.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from '@/lib/observability/log'

export const MAX_VIDEO_UPLOAD_BYTES = 120 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60
export const VIDEO_MAX_HEIGHT = 720
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp']

/** ffmpeg arguments for the menu MP4 (pure, tested). */
export function videoTranscodeArgs(input: string, output: string, opts: { maxHeight?: number; maxSeconds?: number; crf?: number } = {}): string[] {
  const maxHeight = opts.maxHeight ?? VIDEO_MAX_HEIGHT
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-t', String(opts.maxSeconds ?? MAX_VIDEO_SECONDS),
    // Short side at most maxHeight (720p landscape or portrait), even sizes, ≤30 fps.
    '-vf', `scale='if(gte(iw,ih),-2,min(${maxHeight},iw))':'if(gte(iw,ih),min(${maxHeight},ih),-2)',fps=30`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(opts.crf ?? 28),
    '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    output,
  ]
}

/** ffmpeg arguments for the poster frame (pure, tested). */
export function posterArgs(input: string, output: string, atSecond = 1): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSecond), '-i', input, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', output]
}

function run(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000) })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffmpeg timed out')) }, timeoutMs)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`))
    })
  })
}

export interface TranscodedVideo {
  video: Buffer
  contentType: 'video/mp4' | 'video/webm'
  poster: Buffer | null
  /** false when ffmpeg was unavailable and the upload is stored as is. */
  transcoded: boolean
}

export async function transcodeVideo(input: Buffer, mimeType: string): Promise<TranscodedVideo> {
  const dir = await mkdtemp(join(tmpdir(), 'xm-video-'))
  const source = join(dir, 'source')
  const output = join(dir, 'out.mp4')
  const posterFile = join(dir, 'poster.jpg')
  try {
    await writeFile(source, input)
    try {
      await run(videoTranscodeArgs(source, output), 180_000)
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (missing && (mimeType === 'video/mp4' || mimeType === 'video/webm')) {
        log.warn('video.ffmpeg_missing', { note: 'stored as uploaded' })
        return { video: input, contentType: mimeType, poster: null, transcoded: false }
      }
      throw err
    }
    let poster: Buffer | null = null
    try {
      await run(posterArgs(output, posterFile), 30_000)
      poster = await readFile(posterFile)
    } catch (err) {
      log.warn('video.poster_failed', { err })
    }
    return { video: await readFile(output), contentType: 'video/mp4', poster, transcoded: true }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
