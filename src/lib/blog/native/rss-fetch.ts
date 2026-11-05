import {lookup} from 'node:dns/promises'
import {BlockList,isIP} from 'node:net'
import http from 'node:http'
import https from 'node:https'
import {AdminMenuError} from '../../data/admin-menus'
/** Public RSS URLs only. Pin a validated DNS answer into the request lookup,
 * keeping TLS hostname validation and preventing a second/rebound DNS answer. */
/** 6to4 (2002::/16) and Teredo (2001::/32) embed arbitrary IPv4 destinations, so they are never public RSS hosts. */
const embeddedIpv4=new BlockList()
embeddedIpv4.addSubnet('2002::',16,'ipv6');embeddedIpv4.addSubnet('2001::',32,'ipv6')
export function publicRssAddress(address:string){
 const family=isIP(address)
 if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address)&&!embeddedIpv4.check(address,'ipv6')
 if(family!==4)return false
 const [a,b,c]=address.split('.').map(Number)
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||(b===0&&(c===0||c===2))))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19))
}
export const RSS_MAX_REDIRECTS=3
const REDIRECT_STATUS=new Set([301,302,303,307,308])
type Hop={xml:string}|{redirect:string}
async function fetchHop(url:URL):Promise<Hop>{
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
   if(REDIRECT_STATUS.has(response.statusCode??0)){
    const location=response.headers.location;response.destroy()
    if(!location||location.length>2048){reject(new Error('RSS redirect without a usable Location'));return}
    try{resolve({redirect:new URL(location,url).href})}catch{reject(new Error('RSS redirect target is invalid'))}
    return
   }
   if(response.statusCode!==200){response.destroy();reject(new Error('RSS returned an unsuccessful response'));return}
   if(Number(response.headers['content-length']??0)>2097152){response.destroy();reject(new Error('RSS response exceeds 2MB'));return}
   const chunks:Buffer[]=[];let length=0
   response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>2097152){response.destroy(new Error('RSS response exceeds 2MB'));return}chunks.push(chunk)})
   response.on('error',reject);response.on('end',()=>resolve({xml:Buffer.concat(chunks).toString('utf8')}))
  })
  const timeout=setTimeout(()=>request.destroy(new Error('RSS request timed out')),15000)
  request.on('error',reject);request.on('close',()=>clearTimeout(timeout))
 })
}
/** Follows at most RSS_MAX_REDIRECTS redirects. Every hop is re-validated from
 * scratch (scheme, port, credentials, DNS answer against the public filter), so a
 * 301 can never be used to reach a private or embedded-IPv4 destination. */
export async function fetchNativeRssXml(raw:string):Promise<string>{
 let url=new URL(raw)
 for(let hop=0;hop<=RSS_MAX_REDIRECTS;hop++){
  const result=await fetchHop(url)
  if('xml' in result)return result.xml
  url=new URL(result.redirect)
 }
 throw new Error('RSS redirected too many times')
}
