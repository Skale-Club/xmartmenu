import { describe, expect, it } from 'vitest'
import { posterArgs, VIDEO_PROFILES, videoTranscodeArgs } from '@/lib/media/video'
import { describeVideoSavings, heroSourcePath, heroVideoPathFromUrl, isEncodableHeroPath } from '@/lib/media/hero-video'

describe('video profiles', () => {
  it('keeps dish videos small: 720p, fast preset, no bitrate ceiling', () => {
    const args = videoTranscodeArgs('in', 'out.mp4')
    expect(args[args.indexOf('-vf') + 1]).toContain('min(720,ih)')
    expect(args[args.indexOf('-vf') + 1]).toContain('fps=30')
    expect(args).toEqual(expect.arrayContaining(['-preset', 'veryfast', '-crf', '28', '-t', '60', '-an', '-movflags', '+faststart']))
    expect(args).not.toContain('-maxrate')
  })

  it('gives the landing video its own profile: 1080p, higher quality, bitrate ceiling', () => {
    const args = videoTranscodeArgs('in', 'out.mp4', { profile: 'hero' })
    const filter = args[args.indexOf('-vf') + 1]
    expect(filter).toContain('min(1080,ih)')
    expect(filter).toContain('fps=24')
    expect(args).toEqual(expect.arrayContaining(['-preset', 'medium', '-crf', '24', '-t', '45', '-maxrate', '3000k', '-bufsize', '6000k', '-an', '-movflags', '+faststart']))
    expect(VIDEO_PROFILES.hero.crf).toBeLessThan(VIDEO_PROFILES.dish.crf)
    expect(VIDEO_PROFILES.hero.maxHeight).toBeGreaterThan(VIDEO_PROFILES.dish.maxHeight)
  })

  it('lets a caller override a profile value', () => {
    const args = videoTranscodeArgs('in', 'out.mp4', { profile: 'hero', maxSeconds: 20 })
    expect(args).toEqual(expect.arrayContaining(['-t', '20', '-crf', '24']))
  })

  it('cuts a wider poster for the hero', () => {
    expect(posterArgs('v.mp4', 'p.jpg')).toContain('scale=960:-2')
    expect(posterArgs('v.mp4', 'p.jpg', 1, VIDEO_PROFILES.hero.posterWidth)).toContain('scale=1920:-2')
  })
})

describe('hero video storage keys', () => {
  it('stages raw uploads by type and refuses other types', () => {
    expect(heroSourcePath('video/mp4')).toBe('_platform/hero-source.mp4')
    expect(heroSourcePath('video/quicktime')).toBe('_platform/hero-source.mov')
    expect(heroSourcePath('video/webm')).toBe('_platform/hero-source.webm')
    expect(heroSourcePath('image/png')).toBeNull()
  })

  it('only encodes staging keys and the published video', () => {
    expect(isEncodableHeroPath('_platform/hero-source.mov')).toBe(true)
    expect(isEncodableHeroPath('_platform/hero-bg-video.mp4')).toBe(true)
    expect(isEncodableHeroPath('_platform/cta-bg.webp')).toBe(false)
    expect(isEncodableHeroPath('tenants/x/video.mp4')).toBe(false)
    expect(isEncodableHeroPath('../etc/passwd')).toBe(false)
  })

  it('finds the published key behind a public URL with a cache-busting version', () => {
    expect(heroVideoPathFromUrl('https://xmartmenu-tenant-assets.skale.club/_platform/hero-bg-video.mp4?v=1779759383871')).toBe('_platform/hero-bg-video.mp4')
    expect(heroVideoPathFromUrl('https://x.supabase.co/storage/v1/object/public/tenant-assets/_platform/hero-bg-video.mp4')).toBe('_platform/hero-bg-video.mp4')
    expect(heroVideoPathFromUrl('https://example.com/other.mp4')).toBeNull()
    expect(heroVideoPathFromUrl('not a url')).toBeNull()
    expect(heroVideoPathFromUrl(null)).toBeNull()
  })

  it('describes the saving for the panel', () => {
    expect(describeVideoSavings(17.5 * 1024 * 1024, 5.2 * 1024 * 1024)).toBe('17.5 MB → 5.2 MB (−70%)')
    expect(describeVideoSavings(0, 5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
