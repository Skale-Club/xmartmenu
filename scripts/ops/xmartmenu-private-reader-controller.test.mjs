import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { privateFrames, assertAggregate, executeProof, appBootstrap, SERVER_BOOTSTRAP } from './xmartmenu-private-reader-controller.mjs'

function frame(value) { const raw=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32BE(raw.length);return Buffer.concat([header,raw]) }
const proof=()=>({privateSqlRead:true,roleReadOnly:true,runtimeLoginEnabled:false,counts:{profiles:7,tenants:3,products:56,orders:2,order_items:6},adapters:{publicMenu:true,orders:true,paymentCheckout:true},queryCount:30,sqlWrites:false,providerCalls:false,applicationCutover:false})

test('default controller and builder only print public offline plans',()=>{
 for(const path of ['scripts/ops/xmartmenu-private-reader-controller.mjs','scripts/ops/build-xmartmenu-private-reader.mjs']){
  const r=spawnSync(process.execPath,[path,'--plan'],{encoding:'utf8',timeout:4000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PLAN ONLY/)
 }
})
test('private binary frames survive fragmentation and no credential is logged',async()=>{
 const stream=new PassThrough(),frames=privateFrames(stream),packet={protocol:'fixture',nonce:'synthetic'}
 const encoded=frame(packet),next=frames.next(1000)
 stream.write(encoded.subarray(0,2));stream.write(encoded.subarray(2,9));stream.write(encoded.subarray(9))
 assert.deepEqual(await next,packet)
 const cleanup={revoked:true};stream.write(frame(cleanup));stream.end();assert.deepEqual(await frames.next(1000),cleanup)
 await assert.rejects(frames.next(50),/closed/)
})
test('oversized malformed or truncated private frame fails closed',async()=>{
 for(const payload of [Buffer.from([0,0,255,255]),Buffer.from([0,0,0,3,123]),Buffer.from([0,0,0,2,120,120])]){
  const stream=new PassThrough(),frames=privateFrames(stream),next=frames.next(1000)
  stream.end(payload);await assert.rejects(next,/closed/)
 }
})
test('aggregate allowlist rejects secret fields false flags and wrong snapshot',()=>{
 assert.deepEqual(assertAggregate(proof()),proof())
 for(const mutate of [v=>v.password='unexpected',v=>v.sqlWrites=true,v=>v.runtimeLoginEnabled=true,v=>v.counts.orders++,v=>v.adapters.orders=false]){
  const value=proof();mutate(value);assert.throws(()=>assertAggregate(value))
 }
})
test('execute cannot start any SSH with missing reviewed source image or hashes',async()=>{
 await assert.rejects(executeProof({commit:'main',image:'latest'}),/reviewed inputs/)
 await assert.rejects(executeProof({commit:'a'.repeat(40),image:'sha256:'+'b'.repeat(64),executeReviewed:false}),/reviewed inputs/)
})
test('all transmitted public Python bootstraps parse without executing Docker or role commands',()=>{
 for(const source of [SERVER_BOOTSTRAP,appBootstrap('a'.repeat(40),'sha256:'+'b'.repeat(64),false),appBootstrap('a'.repeat(40),'sha256:'+'b'.repeat(64),true)]){
  const python=process.platform==='win32'?'python':'python3'
  const r=spawnSync(python,['-B','-c','import ast,sys;ast.parse(sys.stdin.read());print("parsed")'],{input:source,encoding:'utf8',timeout:4000})
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/parsed/)
 }
})
