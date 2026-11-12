#!/usr/bin/env node
/**
 * Generates a dish's 3D model from its photo with the Hyper3D Rodin API
 * (Gen-2.5, image-to-3D) and downloads the result.
 *
 *   node scripts/ar/rodin-generate.mjs --image <photo> --out <dir> [--prompt "..."] [--tier Gen-2.5-High] [--faces 80000]
 *   node scripts/ar/rodin-generate.mjs --resume <dir>        # poll and download a task already submitted
 *
 * Reads RODIN_API_KEY from .env.local. Each submission spends credits (0.5 per
 * Gen-2.5 task below Extreme-High; see docs/product/augmented-reality.md), so
 * the task is saved to <dir>/task.json right after it is accepted and --resume
 * never submits again.
 *
 * The output GLB is not ready for AR yet: run scripts/ar/prepare-dish-model.py
 * (Blender) to place it on the table, scale it to real size and make the USDZ.
 */
import { config } from 'dotenv'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import sharp from 'sharp'

config({ path: resolve(process.cwd(), '.env.local'), quiet: true })

const API = 'https://api.hyper3d.com/api/v2'
const KEY = process.env.RODIN_API_KEY
if (!KEY) throw new Error('RODIN_API_KEY is missing from .env.local')

function args() {
  const out = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '')
    out[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return out
}

async function api(path, init) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, ...init?.headers } })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 500)}`)
  return { body, retryAfter: Number(response.headers.get('retry-after')) || 0 }
}

async function submit({ image, prompt, tier, faces, out }) {
  // Rodin's accepted image types are not documented for WebP; send JPEG.
  const jpeg = await sharp(await readFile(image)).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
  const form = new FormData()
  form.append('images', new Blob([jpeg], { type: 'image/jpeg' }), `${basename(image).replace(/\.\w+$/, '')}.jpg`)
  form.append('tier', tier)
  form.append('geometry_file_format', 'glb')
  form.append('material', 'PBR')
  form.append('mesh_mode', 'Raw')
  form.append('quality_override', String(faces))
  if (prompt) form.append('prompt', prompt)
  const { body } = await api('/rodin', { method: 'POST', body: form })
  if (body.error || !body.uuid) throw new Error(`Rodin refused the task: ${JSON.stringify(body)}`)
  const task = { image, prompt: prompt ?? null, tier, faces, submitted_at: new Date().toISOString(), uuid: body.uuid,
    subscription_key: body.jobs?.subscription_key, job_uuids: body.jobs?.uuids, consumed: body.consumed }
  await writeFile(join(out, 'task.json'), JSON.stringify(task, null, 2))
  console.log(`submitted ${task.uuid} (consumed ${task.consumed} credits)`)
  return task
}

async function waitDone(task, deadlineMinutes = 30) {
  const deadline = Date.now() + deadlineMinutes * 60_000
  let delay = 5_000
  while (Date.now() < deadline) {
    await new Promise(done => setTimeout(done, delay))
    const { body, retryAfter } = await api('/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription_key: task.subscription_key }),
    })
    const statuses = (body.jobs ?? []).map(job => job.status)
    console.log(`status: ${statuses.join(', ') || JSON.stringify(body)}`)
    if (statuses.includes('Failed')) throw new Error(`Rodin task ${task.uuid} failed`)
    if (statuses.length && statuses.every(status => status === 'Done')) return
    delay = Math.max(retryAfter * 1000, Math.min(delay * 1.5, 30_000))
  }
  throw new Error(`Rodin task ${task.uuid} not done after ${deadlineMinutes} minutes; run again with --resume`)
}

async function download(task, out) {
  const { body } = await api('/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_uuid: task.uuid }),
  })
  const files = body.list ?? []
  if (!files.length) throw new Error(`Rodin returned no files: ${JSON.stringify(body)}`)
  for (const file of files) {
    const name = basename(file.name)
    const response = await fetch(file.url)
    if (!response.ok) throw new Error(`download ${name}: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(join(out, name), data)
    console.log(`saved ${join(out, name)} (${(data.length / 1e6).toFixed(2)} MB)`)
  }
}

const a = args()
if (a.resume) {
  const out = resolve(a.resume)
  const task = JSON.parse(await readFile(join(out, 'task.json'), 'utf8'))
  await waitDone(task)
  await download(task, out)
} else {
  if (!a.image || !a.out) throw new Error('usage: --image <photo> --out <dir> [--prompt "..."]')
  const out = resolve(a.out)
  await mkdir(out, { recursive: true })
  if (existsSync(join(out, 'task.json'))) throw new Error(`${out}/task.json exists: use --resume instead of paying for a new task`)
  const task = await submit({ image: resolve(a.image), prompt: a.prompt, tier: a.tier ?? 'Gen-2.5-High', faces: Number(a.faces ?? 80000), out })
  await waitDone(task)
  await download(task, out)
}
