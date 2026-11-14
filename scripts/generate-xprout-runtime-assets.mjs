import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Exact approved v7 paths; only approved pack placement and raster encoding vary.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const canonical = path.join(root, 'docs/brand/xprout/v1')
const destination = path.join(root, 'public/brand/xprout/v1')
const geometry = JSON.parse(await fs.readFile(path.join(canonical, 'geometry.json'), 'utf8'))
const layouts = JSON.parse(await fs.readFile(path.join(canonical, 'layouts.json'), 'utf8'))
sharp.concurrency(1)
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const manifest = []
const sourcePaths = {}
for (const kind of ['symbol', 'wordmark']) {
  const svg = await fs.readFile(path.join(canonical, `xprout-${kind}-ivory.svg`), 'utf8')
  sourcePaths[kind] = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]).join('')
  if (sourcePaths[kind] !== geometry[kind].d) throw Error(`${kind}: canonical geometry mismatch`)
}
if (hash(sourcePaths.symbol) !== geometry.symbolProvenance.pathSha256) throw Error('Approved v7 symbol hash mismatch')
function artwork(layout, color, x = 0, y = 0) {
  return layout.items.map(item => {
    const shape = geometry[item.kind]
    return `<g transform="translate(${x + item.x} ${y + item.y}) scale(${item.scale}) translate(${-shape.bounds[0]} ${-shape.bounds[1]})"><path fill="${color}" fill-rule="evenodd" d="${sourcePaths[item.kind]}"/></g>`
  }).join('')
}
function icon(width = 328) {
  const bounds = geometry.symbol.bounds
  const height = width * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0])
  const scale = width / (bounds[2] - bounds[0])
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Xprout"><rect width="512" height="512" rx="0" fill="${geometry.colors.forest}"/>${artwork({ items: [{ kind: 'symbol', x: 0, y: 0, scale }] }, geometry.colors.ivory, (512 - width) / 2, (512 - height) / 2)}</svg>`
}
async function save(relative, buffer, profile) {
  const file = path.join(root, relative)
  const maxBytes = profile === 'ico' ? 16 * 1024 : profile === 'social' ? 100 * 1024 : profile === 'og-png' ? 180 * 1024 : 40 * 1024
  if (buffer.length > maxBytes) throw Error(`Encoded byte budget exceeded: ${relative}`)
  let metadata = {}
  if (profile !== 'ico') {
    const image = await sharp(buffer).metadata()
    metadata = { format: image.format, width: image.width, height: image.height }
    if (profile === 'png' && (image.format !== 'png' || Math.max(image.width, image.height) > 512)) throw Error(`PNG profile: ${relative}`)
    if (profile === 'social' && (image.format !== 'webp' || image.width !== 1200 || image.height !== 630)) throw Error('Social profile')
    if (profile === 'og-png' && (image.format !== 'png' || image.width !== 1200 || image.height !== 630)) throw Error('OG PNG profile')
  } else if (buffer.readUInt32LE(0) !== 65536) throw Error('ICO signature')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, buffer)
  manifest.push({ file: relative.replaceAll('\\', '/'), bytes: buffer.length, maxBytes, mime: profile === 'ico' ? 'image/x-icon' : profile === 'svg' ? 'image/svg+xml' : profile === 'social' ? 'image/webp' : 'image/png', sha256: hash(buffer), ...metadata })
}
const versioned = name => `public/brand/xprout/v1/${name}`
for (const kind of ['horizontal', 'symbol']) {
  for (const color of ['forest', 'ivory']) {
    const name = `xprout-${kind}-${color}.svg`
    await save(versioned(name), await fs.readFile(path.join(canonical, name)), 'svg')
  }
}
// Approved pack app tile: symbol width 328px; maskable tile: 288px.
const appSvg = Buffer.from(icon())
const maskableSvg = Buffer.from(icon(288))
const generated = {}
for (const [name, size, source] of [
  ['icon-512.png', 512, appSvg], ['icon-192.png', 192, appSvg],
  ['icon-maskable-512.png', 512, maskableSvg], ['icon-maskable-192.png', 192, maskableSvg],
  ['apple-touch-icon.png', 180, appSvg], ['favicon-16.png', 16, appSvg], ['favicon-32.png', 32, appSvg],
]) {
  const png = await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  generated[name] = png
  await save(versioned(name), png, 'png')
}
const icoImages = []
for (const size of [16, 32, 48]) icoImages.push({ size, data: await sharp(appSvg).resize(size, size).png({ compressionLevel: 9 }).toBuffer() })
const header = Buffer.alloc(6 + icoImages.length * 16)
header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4)
let offset = header.length
icoImages.forEach(({ size, data }, index) => {
  const base = 6 + index * 16
  header[base] = size; header[base + 1] = size; header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6)
  header.writeUInt32LE(data.length, base + 8); header.writeUInt32LE(offset, base + 12); offset += data.length
})
await save(versioned('favicon.ico'), Buffer.concat([header, ...icoImages.map(image => image.data)]), 'ico')
const layout = layouts.horizontal, scale = 980 / layout.w
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${geometry.colors.ivory}"/><g transform="translate(110 ${(630 - layout.h * scale) / 2}) scale(${scale})">${artwork(layout, geometry.colors.forest)}</g></svg>`
await save(versioned('social-card-1200x630.webp'), await sharp(Buffer.from(social)).webp({ quality: 92 }).toBuffer(), 'social')
await save(versioned('social-card-1200x630.png'), await sharp(Buffer.from(social)).png({ compressionLevel: 9 }).toBuffer(), 'og-png')
for (const [name, target] of [
  ['icon-512.png', 'public/icon.png'], ['icon-512.png', 'src/app/icon.png'], ['apple-touch-icon.png', 'src/app/apple-icon.png'],
  ...['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].map(name => [name, `public/icons/${name}`]),
]) await save(target, generated[name], 'png')
const report = { generatedAt: new Date().toISOString(), source: 'docs/brand/xprout/v1; owner-approved v7', symbolPathSha256: hash(sourcePaths.symbol), approvedSymbolPathSha256: geometry.symbolProvenance.pathSha256, unchangedSymbolPath: true, wordmarkPathSha256: hash(sourcePaths.wordmark), placement: { appSymbolWidth: 328, maskableSymbolWidth: 288, maskableMaxRadius: Math.hypot(144, 144 * (geometry.symbol.bounds[3] - geometry.symbol.bounds[1]) / (geometry.symbol.bounds[2] - geometry.symbol.bounds[0])), safeCircleRadius: 204.8 }, assets: manifest }
if (report.placement.maskableMaxRadius > report.placement.safeCircleRadius) throw Error('Maskable safe zone exceeded')
await fs.mkdir(path.join(root, 'output/branding/runtime-v1'), { recursive: true })
await fs.writeFile(path.join(root, 'output/branding/runtime-v1/verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ assets: manifest.length, unchangedSymbolPath: true, maximumPngBytes: Math.max(...manifest.filter(item => item.mime === 'image/png').map(item => item.bytes)), socialBytes: manifest.find(item => item.mime === 'image/webp').bytes, verification: 'output/branding/runtime-v1/verification.json' }))
