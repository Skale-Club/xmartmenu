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
