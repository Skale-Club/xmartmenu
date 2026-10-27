/**
 * Video re-encoding (ffmpeg, installed in the Docker image). Two profiles:
 *
 *   dish  Dish videos in the menu feed: whatever the owner uploads (phone
 *         MOV/MP4/WebM, often 50+ MB) becomes a small H.264 MP4, at most
 *         720p, ≤60 s, no audio (menu videos autoplay muted), moov atom up
 *         front so it starts before it finishes downloading. There are many
 *         of them and they load inside a list, so size wins over polish.
 *
 *   hero  The landing page's full-screen background: one brand piece, shown
 *         on wide screens only (src/app/(marketing)/ClientPage.tsx defers
 *         it). Up to 1080p, 24 fps, higher quality (CRF 24, slower preset)
 *         with a bitrate ceiling so a 30 s loop lands around 5–8 MB instead
 *         of the 17 MB a raw export weighs. Still muted and fast-start.
 *
 * Where ffmpeg is missing (local Windows dev), an MP4/WebM is stored as
 * uploaded instead — see `transcodeVideo`.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from '@/lib/observability/log'

export type VideoProfile = 'dish' | 'hero'

export interface VideoProfileSpec {
  /** Short side at most this many pixels. */
  maxHeight: number
  maxSeconds: number
  fps: number
  crf: number
  preset: 'veryfast' | 'fast' | 'medium' | 'slow'
  /** Bitrate ceiling (kbit/s); unset = CRF only. */
  maxrateKbps?: number
  /** Poster frame width. */
  posterWidth: number
  /** ffmpeg time budget. */
  timeoutMs: number
}

export const VIDEO_PROFILES: Record<VideoProfile, VideoProfileSpec> = {
  dish: { maxHeight: 720, maxSeconds: 60, fps: 30, crf: 28, preset: 'veryfast', posterWidth: 960, timeoutMs: 180_000 },
  hero: { maxHeight: 1080, maxSeconds: 45, fps: 24, crf: 24, preset: 'medium', maxrateKbps: 3000, posterWidth: 1920, timeoutMs: 420_000 },
}

export const MAX_VIDEO_UPLOAD_BYTES = 120 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60
export const VIDEO_MAX_HEIGHT = 720
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp']

/** ffmpeg arguments for the MP4 of a profile (pure, tested). `opts` override the profile. */
export function videoTranscodeArgs(
  input: string,
  output: string,
  opts: { profile?: VideoProfile; maxHeight?: number; maxSeconds?: number; crf?: number } = {},
): string[] {
  const spec = VIDEO_PROFILES[opts.profile ?? 'dish']
  const maxHeight = opts.maxHeight ?? spec.maxHeight
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-t', String(opts.maxSeconds ?? spec.maxSeconds),
    // Short side at most maxHeight (landscape or portrait), even sizes, capped fps.
    '-vf', `scale='if(gte(iw,ih),-2,min(${maxHeight},iw))':'if(gte(iw,ih),min(${maxHeight},ih),-2)',fps=${spec.fps}`,
    '-c:v', 'libx264', '-preset', spec.preset, '-crf', String(opts.crf ?? spec.crf),
    ...(spec.maxrateKbps ? ['-maxrate', `${spec.maxrateKbps}k`, '-bufsize', `${spec.maxrateKbps * 2}k`] : []),
    '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    output,
  ]
}

/** ffmpeg arguments for the poster frame (pure, tested). */
export function posterArgs(input: string, output: string, atSecond = 1, width = VIDEO_PROFILES.dish.posterWidth): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSecond), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', output]
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

/**
 * ffmpeg runs one encode at a time per process by default (EX-11): each encode
 * takes a full CPU for seconds to minutes, and the app shares one container
 * with every restaurant's menu. Extra uploads wait their turn instead of
 * starving page rendering. VIDEO_TRANSCODE_CONCURRENCY raises it.
 */
const MAX_CONCURRENT_ENCODES = Math.max(1, Number(process.env.VIDEO_TRANSCODE_CONCURRENCY ?? 1) || 1)
let activeEncodes = 0
const waiting: Array<() => void> = []

export async function withEncodeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeEncodes >= MAX_CONCURRENT_ENCODES) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  activeEncodes++
  try {
    return await task()
  } finally {
    activeEncodes--
    waiting.shift()?.()
  }
}

export async function transcodeVideo(input: Buffer, mimeType: string, opts: { profile?: VideoProfile } = {}): Promise<TranscodedVideo> {
  return withEncodeSlot(() => transcodeNow(input, mimeType, opts))
}

async function transcodeNow(input: Buffer, mimeType: string, opts: { profile?: VideoProfile }): Promise<TranscodedVideo> {
  const profile = opts.profile ?? 'dish'
  const spec = VIDEO_PROFILES[profile]
  const dir = await mkdtemp(join(tmpdir(), 'xm-video-'))
  const source = join(dir, 'source')
  const output = join(dir, 'out.mp4')
  const posterFile = join(dir, 'poster.jpg')
  try {
    await writeFile(source, input)
    try {
      await run(videoTranscodeArgs(source, output, { profile }), spec.timeoutMs)
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
      await run(posterArgs(output, posterFile, 1, spec.posterWidth), 30_000)
      poster = await readFile(posterFile)
    } catch (err) {
      log.warn('video.poster_failed', { err })
    }
    return { video: await readFile(output), contentType: 'video/mp4', poster, transcoded: true }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
