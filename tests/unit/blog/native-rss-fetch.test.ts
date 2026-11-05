import {EventEmitter} from 'node:events'
import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({lookup:vi.fn(),http:vi.fn(),https:vi.fn()}))
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}))
vi.mock('node:http',()=>({default:{get:mocks.http}}))
vi.mock('node:https',()=>({default:{get:mocks.https}}))
import {publicRssAddress,fetchNativeRssXml,RSS_MAX_REDIRECTS} from '@/lib/blog/native/rss-fetch'
describe('embedded-IPv4 IPv6 ranges are not public RSS hosts',()=>{
 for(const address of ['2002:7f00:1::1','2002:c0a8:101::1','2002::','2001::1','2001:0000:4136:e378:8000:63bf:3fff:fdd2','2001:0:4136:e378:8000:63bf:3fff:fdd2'])it(address,()=>expect(publicRssAddress(address)).toBe(false))
 it('ordinary global IPv6 and IPv4 are unchanged',()=>{
  expect(publicRssAddress('2606:4700:4700::1111')).toBe(true);expect(publicRssAddress('2a00:1450:4001::200e')).toBe(true);expect(publicRssAddress('8.8.8.8')).toBe(true)
  expect(publicRssAddress('2001:db8::1')).toBe(false);expect(publicRssAddress('::ffff:127.0.0.1')).toBe(false)
 })
})
type Step={status:number;location?:string;body?:string}
function script(steps:Step[],seen:string[]){
 return (url:URL,_options:unknown,callback:(response:EventEmitter)=>void)=>{
  seen.push(url.href)
  const step=steps.shift();if(!step)throw new Error('unexpected request')
  const request=Object.assign(new EventEmitter(),{destroy:vi.fn()})
  setImmediate(()=>{
   const response=Object.assign(new EventEmitter(),{statusCode:step.status,headers:{...(step.location?{location:step.location}:{})},destroy:vi.fn()})
   callback(response)
   if(step.body!==undefined){response.emit('data',Buffer.from(step.body));response.emit('end')}
   request.emit('close')
  })
  return request
 }
}
describe('redirects are followed a few hops, every hop revalidated',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}])})
 it('follows a 301 from http to https and returns the feed',async()=>{
  const seen:string[]=[]
  mocks.http.mockImplementation(script([{status:301,location:'https://feed.example/rss.xml'}],seen))
  mocks.https.mockImplementation(script([{status:200,body:'<rss/>'}],seen))
  expect(await fetchNativeRssXml('http://feed.example/rss')).toBe('<rss/>')
  expect(seen).toEqual(['http://feed.example/rss','https://feed.example/rss.xml']);expect(mocks.lookup).toHaveBeenCalledTimes(2)
 })
 it('resolves a relative Location',async()=>{
  const seen:string[]=[]
  mocks.https.mockImplementation(script([{status:302,location:'/new.xml'},{status:200,body:'<rss/>'}],seen))
  await fetchNativeRssXml('https://feed.example/old.xml')
  expect(seen[1]).toBe('https://feed.example/new.xml')
 })
 it('stops after the third redirect',async()=>{
  const seen:string[]=[]
  mocks.https.mockImplementation(script(Array.from({length:RSS_MAX_REDIRECTS+1},(_,index)=>({status:301,location:'https://feed.example/'+(index+1)})),seen))
  await expect(fetchNativeRssXml('https://feed.example/0')).rejects.toThrow('too many')
  expect(seen).toHaveLength(RSS_MAX_REDIRECTS+1)
 })
 it('a redirect into a private destination is refused before any request to it',async()=>{
  const seen:string[]=[]
  mocks.https.mockImplementation(script([{status:301,location:'https://internal.example/rss'}],seen))
  mocks.lookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValueOnce([{address:'10.0.0.5',family:4}])
  await expect(fetchNativeRssXml('https://feed.example/rss')).rejects.toMatchObject({status:400})
  expect(seen).toEqual(['https://feed.example/rss'])
 })
 it('a redirect to an embedded-IPv4 6to4 host is refused',async()=>{
  const seen:string[]=[]
  mocks.https.mockImplementation(script([{status:307,location:'https://tunnel.example/rss'}],seen))
  mocks.lookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValueOnce([{address:'2002:7f00:1::1',family:6}])
  await expect(fetchNativeRssXml('https://feed.example/rss')).rejects.toMatchObject({status:400})
 })
 it('a redirect to a non-HTTP scheme, credentials or a custom port is refused',async()=>{
  for(const location of ['ftp://feed.example/rss','https://user:pass@feed.example/rss','https://feed.example:8443/rss']){
   const seen:string[]=[]
   mocks.https.mockImplementation(script([{status:301,location}],seen))
   await expect(fetchNativeRssXml('https://feed.example/rss')).rejects.toBeTruthy()
   expect(seen).toEqual(['https://feed.example/rss'])
  }
 })
})
