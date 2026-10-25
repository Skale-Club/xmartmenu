#!/usr/bin/env node
/**
 * A stand-in for OpenRouter in the e2e suite (the app gets
 * OPENROUTER_BASE_URL=http://localhost:3199/api/v1). It answers like the real
 * API, with usage.cost on every completion, and behaves by API key:
 *
 *   sk-test-nocredit   402 Insufficient credits (key valid, no balance)
 *   sk-test-invalid    401 (revoked / wrong key)
 *   anything else      200
 *
 * GET /__calls lists the calls seen (path + which key), POST /__reset clears it.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_OPENROUTER_PORT ?? 3199)
export const MOCK_COST_USD = 0.001

let calls = []

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function keyOf(req) {
  return (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
}

function rejection(key) {
  if (key === 'sk-test-nocredit') return [402, { error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/credits' } }]
  if (key === 'sk-test-invalid' || !key) return [401, { error: { code: 401, message: 'No auth credentials found' } }]
  return null
}

/** Builds a plausible answer: menu translations when the prompt asks for them. */
function answerFor(body) {
  const prompt = (body.messages ?? []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
  const into = prompt.match(/into: (.+?)\.\n/)
  const texts = prompt.match(/Texts \(JSON, key → text\):\n([\s\S]+)$/)
  if (into && texts) {
    let items = {}
    try { items = JSON.parse(texts[1]) } catch { /* keep empty */ }
    const languages = into[1].split(', ').map(part => part.split(' ')[0])
    return JSON.stringify({
      languages: languages.map(language => ({
        language,
        entries: Object.entries(items).map(([key, text]) => ({ key, text: `[${language}] ${text}` })),
      })),
    })
  }
  return 'OK'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')

  if (url.pathname === '/__health') return send(res, 200, { ok: true })
  if (url.pathname === '/__calls') return send(res, 200, { calls })
  if (url.pathname === '/__reset') { calls = []; return send(res, 200, { ok: true }) }

  const key = keyOf(req)
  const path = url.pathname.replace(/^\/api\/v1/, '')
  calls.push({ path, key, at: Date.now() })

  if (req.method === 'GET' && path === '/key') {
    if (key === 'sk-test-invalid' || !key) return send(res, 401, { error: { code: 401, message: 'Invalid key' } })
    return send(res, 200, { data: { label: `mock ${key.slice(0, 12)}`, limit_remaining: key === 'sk-test-nocredit' ? 0 : 10 } })
  }

  const rejected = rejection(key)
  if (rejected) return send(res, rejected[0], rejected[1])

  if (req.method === 'POST' && path === '/chat/completions') {
    let body = {}
    try { body = JSON.parse(raw) } catch { /* empty */ }
    return send(res, 200, {
      id: `gen-mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? 'mock/model',
      choices: [{ index: 0, message: { role: 'assistant', content: answerFor(body) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: MOCK_COST_USD },
    })
  }

  return send(res, 404, { error: { code: 404, message: `mock: no route for ${req.method} ${path}` } })
})

server.listen(PORT, () => console.log(`mock OpenRouter on http://localhost:${PORT}/api/v1`))
