'use client'
const keys=new Map<string,string>()
/** Only an idempotency UUID is persisted; form credentials and identity tokens
 * never enter storage. Keep the UUID on uncertain network/action outcomes. */
export async function withNativeBlogActionKey<T extends {ok:boolean}>(slot:string,input:unknown,enabled:boolean,operation:(key?:string)=>Promise<T>):Promise<T>{
 if(!enabled)return operation()
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({slot,input})))
 const label='xmartmenu-blog:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')
 let key=keys.get(label);if(!key){try{key=sessionStorage.getItem(label)??undefined}catch{}}
 if(!key){key=crypto.randomUUID();keys.set(label,key);try{sessionStorage.setItem(label,key)}catch{}}
 const result=await operation(key)
 if(result.ok){keys.delete(label);try{sessionStorage.removeItem(label)}catch{}}
 return result
}
