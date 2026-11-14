/** One-field platform icon migration; plan by default, guarded apply/rollback. */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
const app = 'gmaayluj11x1m6j7baogonfn'
const newIcon = 'https://xprout.app/brand/xprout/v1/icon-512.png'
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rollback') ? 'rollback' : 'plan'
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const receiptFile = path.resolve(argument('--receipt') || 'output/branding/runtime-v1/production-platform-before.json')
const expectedRelease = argument('--expected-release')
const target = process.env.AR_PROD_SSH || 'root@188.245.112.3'
if (!/^[a-z0-9_-]+@[a-z0-9.:-]+$/i.test(target)) throw Error('Invalid operator SSH target')
if (mode !== 'plan' && !/^[a-f0-9]{40}$/.test(expectedRelease || '')) throw Error('A full expected release SHA is required')

function ssh(command, input) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', target, command], {
    input, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024,
  })
  if (result.status !== 0) {
    const safe = result.stderr?.match(/Brand check failed: [A-Za-z0-9 _.-]+/g)?.join('; ')
    throw Error(safe || 'Brand operator SSH/SQL operation refused; diagnostics suppressed')
  }
  return result.stdout.trim()
}

// Never store a favicon reference before the exact, bounded approved bytes exist.
if (mode === 'apply') {
  const response = await fetch(newIcon, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw Error('Published icon unavailable')
  const local = await fs.readFile('public/brand/xprout/v1/icon-512.png')
  if (local.length > 40 * 1024 || Number(response.headers.get('content-length') || 0) > 40 * 1024) throw Error('Icon budget exceeded')
  const reader = response.body.getReader(); const chunks = []; let size = 0
  for (;;) {
    const { value, done } = await reader.read(); if (done) break
    size += value.length
    if (size > 40 * 1024) { await reader.cancel(); throw Error('Published icon budget exceeded') }
    chunks.push(value)
  }
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  if (digest(Buffer.concat(chunks)) !== digest(local)) throw Error('Published icon differs from the approved local asset')
}

const backup = mode === 'plan' ? null : JSON.parse(await fs.readFile(receiptFile, 'utf8'))
if (backup && (backup.app !== app || backup.before?.app_name !== 'Xprout')) throw Error('Wrong migration receipt')
const names = ssh(`docker ps --filter name=app-${app}- --format '{{.Names}}'`).split(/\r?\n/).filter(Boolean)
if (names.length !== 1 || !new RegExp(`^app-${app}-[a-zA-Z0-9-]+$`).test(names[0])) throw Error('Production container identity mismatch')

const input = { mode, app, newIcon, expectedRelease, backup }
const program = `
const { Client } = require('pg'); const assert = require('node:assert/strict');
const input = ${JSON.stringify(input)};
let checkpoint='owned mode';
(async () => {
  assert.equal(process.env.OWNED_ADMIN_MENUS_ENABLED, 'true');
  checkpoint='release identity';
  const healthResponse=await fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(5000)});
  assert.ok(healthResponse.ok); const health=await healthResponse.json();
  assert.ok(/^[a-f0-9]{40}$/.test(health.release));
  if (input.mode !== 'plan') assert.equal(health.release, input.expectedRelease);
  const client = new Client({ connectionString:process.env.ADMIN_MENUS_DATABASE_URL,
    connectionTimeoutMillis:5000, statement_timeout:5000, query_timeout:6000,
    application_name:'xprout-brand-operator', options:'-c lock_timeout=2000' });
  checkpoint='connect'; await client.connect();
  try {
    await client.query(input.mode === 'plan' ? 'BEGIN READ ONLY' : 'BEGIN');
    checkpoint='database identity'; assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'xmartmenu');
    if (input.mode !== 'plan') await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['xmartmenu-mcp-platform']);
    const sql='SELECT id,app_name,brand_name,cta_color,favicon_url FROM public.platform_settings';
    checkpoint='platform singleton'; const rows=(await client.query(sql+(input.mode === 'plan' ? '' : ' FOR UPDATE'))).rows;
    assert.equal(rows.length,1); const before=rows[0]; assert.equal(before.app_name,'Xprout');
    if (before.favicon_url) {
      const old=new URL(before.favicon_url); assert.equal(old.hash,'');
      assert.ok(!old.search || /^\\?v=\\d+$/.test(old.search));
    }
    const colorsSql="SELECT md5(coalesce(string_agg(tenant_id::text||':'||coalesce(primary_color,'')||':'||coalesce(accent_color,''),'|' ORDER BY tenant_id),'')) AS digest FROM public.tenant_settings";
    checkpoint='tenant palette digest'; const colors=(await client.query(colorsSql)).rows[0].digest;
    if (input.mode !== 'plan') {
      assert.equal(before.id,input.backup.before.id);
      const expected=input.mode === 'apply' ? input.backup.before.favicon_url : input.newIcon;
      const desired=input.mode === 'apply' ? input.newIcon : input.backup.before.favicon_url;
      if (before.favicon_url !== desired) {
        assert.equal(before.favicon_url,expected);
        assert.equal((await client.query('UPDATE public.platform_settings SET favicon_url=$1,updated_at=now() WHERE id=$2',[desired,before.id])).rowCount,1);
      }
    }
    const after=(await client.query(sql)).rows[0];
    assert.equal(after.cta_color,before.cta_color); assert.equal(after.brand_name,before.brand_name);
    assert.equal((await client.query(colorsSql)).rows[0].digest,colors);
    await client.query('COMMIT');
    console.log(JSON.stringify({app:input.app,mode:input.mode,release:health.release,before,after,tenantPaletteDigest:colors,tenantPalettesUnchanged:true}));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
})().catch(error => { console.error('Brand check failed: '+checkpoint+' '+(/^[A-Z0-9_]+$/.test(error.code||'') ? error.code : 'refused')); process.exit(1); });
`
const proof = JSON.parse(ssh(`docker exec -i ${names[0]} node -`, program))
await fs.mkdir(path.dirname(receiptFile), { recursive: true })
if (mode === 'plan') {
  try { await fs.writeFile(receiptFile, JSON.stringify(proof, null, 2), { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error; throw Error('Receipt already exists; choose a new path to preserve the original backup') }
} else {
  await fs.writeFile(receiptFile.replace(/\.json$/, '') + `.${mode}.json`, JSON.stringify(proof, null, 2))
}
console.log(JSON.stringify(proof))
