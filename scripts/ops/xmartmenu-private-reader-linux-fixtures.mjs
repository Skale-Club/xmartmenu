// Run only with PUBLIC controller/bundle source on stdin. No role/SQL calls.
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { randomBytes, createHash } from 'node:crypto'
import Module from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const input = JSON.parse(readFileSync(0, 'utf8'))
const code = Buffer.from(input.controller, 'base64')
assert.equal(createHash('sha256').update(code).digest('hex'), input.controllerSha256)
const controller = await import(`data:text/javascript;base64,${code.toString('base64')}`)
const source = Buffer.from(input.bundle, 'base64')
assert.equal(createHash('sha256').update(source).digest('hex'), input.bundleSha256)
const compiled = new Module('/app/xmartmenu-reader-fixture.cjs')
compiled.filename = '/app/xmartmenu-reader-fixture.cjs'
compiled.paths = Module._nodeModulePaths('/app')
compiled._compile(source.toString('utf8'), compiled.filename)
const client = compiled.exports
const packet = () => ({ protocol: 'xmartmenu-private-read-v1', nonce: randomBytes(16).toString('hex'), password: randomBytes(32).toString('base64url'), validUntil: Date.now()+120000 })
const frame = value => { const raw=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32BE(raw.length);return Buffer.concat([header,raw]) }

test('Linux private frame fragmentation',async()=>{
 const stream=new PassThrough(),reader=controller.privateFrames(stream),value={fixture:true},raw=frame(value),next=reader.next(1000)
 stream.write(raw.subarray(0,1));stream.write(raw.subarray(1,5));stream.write(raw.subarray(5));assert.deepEqual(await next,value);stream.end()
})
test('Linux private cleanup frame remains consumable on EOF',async()=>{
 const stream=new PassThrough(),reader=controller.privateFrames(stream);stream.end(frame({revoked:true}));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await reader.next(1000),{revoked:true});await assert.rejects(reader.next(10))
})
test('Linux oversized private header fails closed',async()=>{
 const stream=new PassThrough(),reader=controller.privateFrames(stream),next=reader.next(1000);stream.end(Buffer.from([0,0,255,255]));await assert.rejects(next)
})
test('Linux malformed private JSON fails closed',async()=>{
 const stream=new PassThrough(),reader=controller.privateFrames(stream),next=reader.next(1000);stream.end(Buffer.from([0,0,0,2,120,120]));await assert.rejects(next)
})
test('Linux aggregate rejects any unexpected sensitive field',()=>{
 assert.throws(()=>controller.assertAggregate({password:'fixture'}))
})
test('Linux execution rejects missing reviewed inputs before SSH',async()=>{
 await assert.rejects(controller.executeProof({commit:'main',image:'latest'}))
})
test('Linux reader configuration has only fixed destination and no URI alias',()=>{
 const config=client.readerConfiguration(client.validatePacket(packet()));assert.equal(config.host,'10.0.4.1');assert.equal(config.port,15432);assert.equal(config.database,'xmartmenu');assert.equal(config.user,'xmartmenu_staging_reader');assert.equal(config.ssl,false);assert.equal(config.connectionString,undefined)
})
test('Linux reader rejects destination fields and mutating SQL',()=>{
 assert.throws(()=>client.validatePacket({...packet(),host:'other'}));assert.throws(()=>client.assertReadQuery('UPDATE public.orders SET status=$1'));assert.throws(()=>client.assertReadQuery('SELECT public.create_order_with_items($1,$2)'));client.assertReadQuery('SELECT id FROM public.orders')
})
test('Linux reader uses READ ONLY and rolls back/closes on wrong authority',async()=>{
 const calls=[],value=packet();let ended=false
 const fake={connect:async()=>{},query:async text=>{calls.push(text);return{rows:text.startsWith('SELECT')?[{database:'other'}]:[]}},end:async()=>{ended=true}}
 await assert.rejects(client.runReadProof(value,()=>fake));assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1),'ROLLBACK');assert.equal(ended,true);assert.equal(value.password,'')
})
