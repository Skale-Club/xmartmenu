#!/usr/bin/env node
/**
 * Prints a Markdown summary of a test run for the GitHub Actions run page:
 *   node scripts/ci-summary.mjs <title> <junit.xml> [coverage-summary.json]
 * Lists every failed test with its message, so the run page alone says what
 * broke. Missing files are reported instead of failing the job.
 */
import { existsSync, readFileSync } from 'node:fs'

const [title = 'tests', junitPath, coveragePath] = process.argv.slice(2)
const out = [`## ${title}`]

if (junitPath && existsSync(junitPath)) {
  const xml = readFileSync(junitPath, 'utf8')
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)]
  const attr = (raw, name) => raw.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let failed = 0
  let skipped = 0
  const failures = []
  for (const [, attrs, , body = ''] of cases) {
    if (/<skipped/.test(body)) skipped++
    const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/)
    if (failure) {
      failed++
      const message = decode(attr(failure[2] ?? failure[5] ?? '', 'message') || (failure[3] ?? '')).split('\n')[0].slice(0, 300)
      failures.push(`- ❌ **${decode(attr(attrs, 'classname'))}** › ${decode(attr(attrs, 'name'))}${message ? ` — ${message}` : ''}`)
    }
  }
  const passed = cases.length - failed - skipped
  out.push(`${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed, ${skipped} skipped (${cases.length} total)`)
  if (failures.length) out.push('', ...failures)
} else {
  out.push(`⚠️ No JUnit report at \`${junitPath}\` — the run stopped before the tests finished.`)
}

if (coveragePath && existsSync(coveragePath)) {
  const total = JSON.parse(readFileSync(coveragePath, 'utf8')).total ?? {}
  const pct = key => (total[key]?.pct ?? 0).toFixed(1)
  out.push('', `Coverage (src/lib, src/components/menu): lines ${pct('lines')}% · statements ${pct('statements')}% · functions ${pct('functions')}% · branches ${pct('branches')}%`)
}

console.log(out.join('\n'))
