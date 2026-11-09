import { createLucideIcon } from 'lucide-react'

/**
 * "Add to bag": a shopping bag with handles and a plus on its body, drawn on
 * lucide's 24px grid and stroke so it sits with the other icons. lucide has no
 * bag-plus, and a bare "+" reads as "more" to guests who do not use delivery
 * apps (owner decision, 2026-11-09).
 */
const BagPlus = createLucideIcon('BagPlus', [
  ['path', { d: 'M16 10V6a4 4 0 0 0-8 0v4', key: 'handles' }],
  ['path', { d: 'M3.5 8h17l-1.3 11.6a2.6 2.6 0 0 1-2.6 2.4H7.4a2.6 2.6 0 0 1-2.6-2.4Z', key: 'bag' }],
  ['path', { d: 'M12 12.5v6', key: 'plus-v' }],
  ['path', { d: 'M9 15.5h6', key: 'plus-h' }],
])

export default BagPlus
