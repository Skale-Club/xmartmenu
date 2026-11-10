import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {pilotInstallPlan,pilotBootstrapSql,pilotCleanupTimer,APP_IMAGE,PG_IMAGE,PILOT_DB} from './prepare-xmartmenu-identity-pilot-install.mjs'
const hex=()=>randomBytes(32).toString('hex'),nonce=()=>randomBytes(8).toString('hex')
const config=()=>({nonce:nonce(),appImage:APP_IMAGE,manifestSha256:hex()})
test('pure install rendering pins new names, isolation and admitted resource budgets without host ports or pull',()=>{
  const value=pilotInstallPlan(config()),commands=Object.values(value.commands)
  assert.equal(value.host,'188.245.112.3');assert.equal(value.capacity.minimumAvailableMiB,2048)
  assert.deepEqual(value.commands.pgCreate.slice(value.commands.pgCreate.indexOf('--network'),value.commands.pgCreate.indexOf('--network')+2),['--network','none'])
  assert.ok(value.commands.pgCreate.includes(PG_IMAGE));assert.ok(value.commands.pgCreate.includes('512m'));assert.ok(value.commands.pgCreate.includes('max_connections=10'))
  assert.ok(value.commands.network.includes('--internal'));assert.ok(value.commands.appCreate.includes('128m'));assert.ok(value.commands.appCreate.includes('1000:1000'))
  for(const args of commands)for(const forbidden of ['pull','--publish','--publish-all','-p','--privileged','--network=host','--env-file','--rm'])assert.ok(!args.includes(forbidden))
  const rule=value.commands.appCreate.find(part=>part.startsWith('traefik.http.routers.')&&part.includes('.rule='))
  assert.match(rule,/Host\(`xmartmenu\.skale\.club`\) && PathPrefix\(`\/__xmartmenu_identity_pilot\/`\)/)
  assert.ok(!JSON.stringify(value).includes('xmartmenu-stage'))
})
test('renderer refuses extra fields and values that could escape fixed names or argv boundaries',()=>{
  for(const change of [{nonce:'../existing'},{nonce:'x;id'},{appImage:'postgres:latest'},{manifestSha256:'missing'},{sourceDatabase:'xmartmenu'}])assert.throws(()=>pilotInstallPlan({...config(),...change}))
})
test('cleanup is a bounded same-host timer pinned to the private immutable receipt and public operator',()=>{
  const value={nonce:nonce(),operatorSha256:hex(),receiptSha256:hex()},args=pilotCleanupTimer(value)
  assert.equal(args[0],'/usr/bin/systemd-run');assert.ok(args.includes('--on-active=120m'))
  assert.ok(args.includes('--property=TimeoutStartSec=40s'));assert.ok(args.includes(value.receiptSha256));assert.ok(args.includes(value.operatorSha256))
  assert.ok(!args.includes('--user'));assert.ok(args.includes(`/opt/xmartmenu/identity-pilot/${value.nonce}/cleanup.py`))
  assert.throws(()=>pilotCleanupTimer({...value,nonce:'../source'}));assert.throws(()=>pilotCleanupTimer({...value,receiptSha256:'unreviewed'}))
})
test('bootstrap uses a fresh isolated cluster, SCRAM-only credential input and least privilege independent roles',()=>{
  const verifier=`SCRAM-SHA-256$4096:${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}:${randomBytes(32).toString('base64')}`
  const sql=pilotBootstrapSql(verifier)
  assert.match(sql.cluster,/Fresh isolated cluster required/);assert.match(sql.cluster,/xmartmenu_pilot_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2/)
  assert.match(sql.create,new RegExp(`CREATE DATABASE ${PILOT_DB} OWNER xmartmenu_pilot_owner`))
  assert.match(sql.prepare,/Empty isolated pilot required/);assert.match(sql.grant,/REVOKE CONNECT ON DATABASE xmartmenu_identity_pilot FROM PUBLIC/)
  assert.match(sql.grant,/GRANT SELECT ON public\.profiles,public\.tenants,supabase_migrations\.schema_migrations/)
  assert.doesNotMatch(sql.grant,/GRANT (?:ALL|INSERT|UPDATE|DELETE).*ON public\.(?:orders|profiles|tenants) /)
  for(const bad of ['',"x');SELECT 1;--",verifier.replace('4096','1')])assert.throws(()=>pilotBootstrapSql(bad))
})
