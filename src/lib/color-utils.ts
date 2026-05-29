/**
 * Computes the text-on-primary foreground color using relative luminance (WCAG 2.1).
 * Returns '#ffffff' for dark primary colors and '#09090b' for light ones.
 * Threshold: L > 0.4 → dark foreground, L ≤ 0.4 → white foreground.
 */
export function computePrimaryForeground(hex: string): string {
  // Strip leading # and handle 3-char shorthand
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean

  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255

  // sRGB linearisation
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  const L = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)

  return L > 0.4 ? '#09090b' : '#ffffff'
}

const HEX_COLOR = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * Returns `value` only if it is a safe CSS hex color (#rgb, #rgba, #rrggbb,
 * #rrggbbaa); otherwise returns `fallback`. Use whenever a (potentially
 * user-controlled) color is interpolated into a <style> block or inline style,
 * to prevent CSS/markup injection from stored tenant branding (e.g. a color
 * value containing `</style>...`).
 */
export function safeCssColor(value: string | null | undefined, fallback = '#000000'): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback
}
