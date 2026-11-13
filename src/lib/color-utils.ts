const HEX_COLOR = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
type Rgb = [number, number, number]
const WHITE: Rgb = [255, 255, 255]

/** Validate stored colours before interpolating them into CSS. */
export function safeCssColor(value: string | null | undefined, fallback = '#000000'): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback
}

function parse(hex: string): { rgb: Rgb; alpha: number } | null {
  if (!HEX_COLOR.test(hex.trim())) return null
  let value = hex.trim().slice(1)
  if (value.length <= 4) value = value.split('').map(c => c + c).join('')
  return {
    rgb: [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb,
    alpha: value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1,
  }
}

function composite(hex: string, background: Rgb): Rgb {
  const colour = parse(hex)
  return colour ? colour.rgb.map((c, i) => c * colour.alpha + background[i] * (1 - colour.alpha)) as Rgb : background
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map(value => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function ratio(a: Rgb, b: Rgb): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Alpha colours are composited onto the supplied surface (white by default). */
export function relativeLuminance(hex: string, surface = '#ffffff'): number {
  return parse(hex) ? luminance(composite(hex, composite(surface, WHITE))) : 0
}

/** Text over a background, with translucent backgrounds composited over surface. */
export function contrastRatio(foreground: string, background: string, surface = '#ffffff'): number {
  const bg = composite(background, composite(surface, WHITE))
  return ratio(composite(foreground, bg), bg)
}

/** Choose the most readable foreground; callers specify the real surface for alpha fills. */
export function computePrimaryForeground(hex: string, surface = '#ffffff'): string {
  const fill = safeCssColor(hex, '#09090b')
  const white = contrastRatio('#ffffff', fill, surface)
  const dark = contrastRatio('#09090b', fill, surface)
  // Near-black and white leave a tiny gap around middle grey; pure black closes it.
  if (white < 4.5 && dark < 4.5) return '#000000'
  return white >= dark ? '#ffffff' : '#09090b'
}

function toHex(rgb: Rgb): string {
  return '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
}

/** Explicit derived text role: preserve readable tenant colours, otherwise adjust toward a readable foreground. */
export function readableTextColor(colour: string, background = '#fafaf9', minimum = 4.5): string {
  const source = safeCssColor(colour, '#09090b')
  if (contrastRatio(source, background) >= minimum) return source
  const bg = composite(background, WHITE)
  const rgb = composite(source, bg)
  const target = parse(computePrimaryForeground(background))!.rgb
  for (let step = 1; step <= 100; step++) {
    const amount = step / 100
    const candidate = toHex(rgb.map((c, i) => c + (target[i] - c) * amount) as Rgb)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return toHex(target)
}

/** Filled-control role for dark sheets: primary, then accent, then a visible accent variant. */
export function visibleFillColor(primary: string, accent: string, surface = '#151819', minimum = 3): string {
  if (contrastRatio(primary, surface) >= minimum) return safeCssColor(primary, '#09090b')
  if (contrastRatio(accent, surface) >= minimum) return safeCssColor(accent, '#09090b')
  return readableTextColor(accent, surface, minimum)
}
