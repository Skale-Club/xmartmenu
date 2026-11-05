'use client'

const memory=new Map<string,string>()
async function requestSlot(url:string,init:RequestInit) {
  const raw=JSON.stringify({url,method:init.method??'GET',body:typeof init.body==='string'?init.body:null})
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))
  return 'xmartmenu-native-effect:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')
}
export async function completeNativeEffectRequest(url:string,init:RequestInit) {
  const slot=await requestSlot(url,init);memory.delete(slot);try{sessionStorage.removeItem(slot)}catch{}
}
/** The UUID is an idempotency label, never an auth token or a transferable
 * capability. The server still verifies the current HttpOnly session each time. */
export async function nativeEffectFetch(url:string,init:RequestInit,enabled:boolean,options:{retainOnSuccess?:boolean;completeOnAccepted?:boolean}={}) {
  if(!enabled)return fetch(url,init)
  const slot=await requestSlot(url,init)
  let key=memory.get(slot)
  if(!key){try{key=sessionStorage.getItem(slot)??undefined}catch{}}
  if(!key){key=crypto.randomUUID();memory.set(slot,key);try{sessionStorage.setItem(slot,key)}catch{}}
  const headers=new Headers(init.headers);headers.set('Idempotency-Key',key)
  const response=await fetch(url,{...init,headers})
  // An uncertain response keeps the same key across refresh/retry. Only a
  // confirmed completion (or confirmed durable queue intention) opens a new one.
  if(response.ok&&!options.retainOnSuccess&&(response.status!==202||options.completeOnAccepted))await completeNativeEffectRequest(url,init)
  return response
}
export async function browserImageDigest(file:File) {
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
}
