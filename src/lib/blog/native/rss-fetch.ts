import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import http from 'node:http'
import https from 'node:https'
import {AdminMenuError} from '../../data/admin-menus'
/** Public RSS URLs only. Pin a validated DNS answer into the request lookup,
 * keeping TLS hostname validation and preventing a second/rebound DNS answer. */
export function publicRssAddress(address:string){
 const family=isIP(address)
 if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address)
 if(family!==4)return false
 const [a,b,c]=address.split('.').map(Number)
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||(b===0&&(c===0||c===2))))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19))
}
export async function fetchNativeRssXml(raw:string):Promise<string>{
 const url=new URL(raw)
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||(url.port&&!['80','443'].includes(url.port)))throw new AdminMenuError(400,'Public HTTP(S) RSS URL required')
 let timer:ReturnType<typeof setTimeout>|undefined
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('RSS DNS lookup timed out')),15000)})
 let addresses:Array<{address:string;family:number}>
 try{addresses=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),deadline])}finally{clearTimeout(timer)}
 if(!addresses.length||addresses.some(row=>!publicRssAddress(row.address)))throw new AdminMenuError(400,'RSS destination is not a public address')
 const selected=addresses[0]
 return new Promise((resolve,reject)=>{
  const requester=url.protocol==='https:'?https:http
  const request=requester.get(url,({agent:false,autoSelectFamily:false,lookup:(_hostname,_options,callback)=>callback(null,selected.address,selected.family),headers:{'User-Agent':'Xmartmenu RSS Fetcher/1.0'}} as http.RequestOptions&{autoSelectFamily:boolean}),response=>{
   if(response.statusCode!==200){response.destroy();reject(new Error('RSS returned an unsuccessful response'));return}
   if(Number(response.headers['content-length']??0)>2097152){response.destroy();reject(new Error('RSS response exceeds 2MB'));return}
   const chunks:Buffer[]=[];let length=0
   response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>2097152){response.destroy(new Error('RSS response exceeds 2MB'));return}chunks.push(chunk)})
   response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')))
  })
  const timeout=setTimeout(()=>request.destroy(new Error('RSS request timed out')),15000)
  request.on('error',reject);request.on('close',()=>clearTimeout(timeout))
 })
}
