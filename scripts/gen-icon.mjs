import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Two identical solid bars rotated ±45°, crossing at the exact image midpoint.
// Equal visual weight on all four arms = no perceived shift at any render size.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#F52323"/>
  <g transform="translate(256 256)">
    <rect transform="rotate(45)"  x="-10" y="-120" width="20" height="240" rx="10" fill="white"/>
    <rect transform="rotate(-45)" x="-10" y="-120" width="20" height="240" rx="10" fill="white"/>
  </g>
</svg>`

const buf = await sharp(Buffer.from(svg)).png().toBuffer()

const appIcon = resolve(root, 'src/app/icon.png')
const publicIcon = resolve(root, 'public/icon.png')

writeFileSync(appIcon, buf)
writeFileSync(publicIcon, buf)

console.log('Generated', appIcon)
console.log('Generated', publicIcon)
