import Parser from 'rss-parser'
import {AdminMenuError} from '../../data/admin-menus'
import {resolveGuid,parsePublishedAt,stripHtml,type FetchSummary} from '../rss'
import {nativeBlogScope,type NativeBlogContext} from './authority'
import {nativeBlogPhase} from './runtime'
import {fetchNativeRssXml} from './rss-fetch'

/** Bounded source inventory, sequential as in the legacy sweep. Each response
 * contributes at most twenty items and 2MB. No queue or paid provider involved. */
export async function fetchNativeBlogRss(context:NativeBlogContext,fetchXml=fetchNativeRssXml):Promise<FetchSummary>{
 const scope=nativeBlogScope(context)
 const sources=await nativeBlogPhase(context,false,async query=>(await query(`SELECT id,name,url,last_fetched_at FROM public.blog_rss_sources
  WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND enabled=true ORDER BY last_fetched_at ASC NULLS FIRST,id LIMIT 1001`,[scope])).rows)
 if(sources.length>1000)throw new AdminMenuError(409,'RSS source inventory exceeds the supported limit')
 const summary:FetchSummary={sourcesProcessed:0,itemsUpserted:0,errors:[]}
 for(const source of sources){
  try{
   // Authority is refreshed immediately before every outbound fetch, outside TX.
   await nativeBlogPhase(context,false,async()=>undefined)
   const feed=await new Parser().parseString(await fetchXml(String(source.url)))
   const count=await nativeBlogPhase(context,true,async query=>{
    const current=(await query('SELECT id FROM public.blog_rss_sources WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND enabled=true AND url=$3 FOR UPDATE',[source.id,scope,source.url])).rows
    if(current.length!==1)throw new AdminMenuError(409,'RSS source changed during fetch')
    let inserted=0
    for(const item of feed.items.slice(0,20)){
     const published=parsePublishedAt(item)
     if(published&&source.last_fetched_at instanceof Date&&published<source.last_fetched_at)continue
     if(!item.link||!/^https?:\/\//i.test(item.link))continue
     const result=await query(`INSERT INTO public.blog_rss_items(tenant_id,source_id,guid,url,title,summary,published_at,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending') ON CONFLICT(source_id,guid) DO NOTHING RETURNING id`,[scope,source.id,resolveGuid(item,String(source.id)).slice(0,4000),item.link.slice(0,4000),(item.title??'(untitled)').slice(0,1000),stripHtml(item.contentSnippet??item.content??'').slice(0,1000)||null,published])
     inserted+=result.rows.length
    }
    await query("UPDATE public.blog_rss_sources SET last_fetched_at=clock_timestamp(),last_fetched_status='ok',error_message=NULL,updated_at=clock_timestamp() WHERE id=$1",[source.id])
    return inserted
   })
   summary.itemsUpserted+=count
  }catch(error){
   if(error instanceof AdminMenuError&&error.status===403)throw error
   await nativeBlogPhase(context,true,query=>query("UPDATE public.blog_rss_sources SET last_fetched_at=clock_timestamp(),last_fetched_status='error',error_message='RSS fetch failed',updated_at=clock_timestamp() WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND url=$3",[source.id,scope,source.url])).catch(()=>{})
   summary.errors.push({sourceId:String(source.id),sourceName:String(source.name),message:'RSS fetch failed'})
  }finally{summary.sourcesProcessed++}
 }
 return summary
}
