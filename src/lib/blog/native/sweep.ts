import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {AdminMenuError} from '../../data/admin-menus'
import {UUID} from '../../auth/owned-principal'
import {requireNativeBlogConfiguration} from './selected'
import {generateNativeBlogPost} from './generation'
import {fetchNativeBlogRss} from './rss'
import {drainNativeDraftNotifications} from './telegram'
import type {SweepSummary} from '../sweep'
import {describeScope} from '../scope'
export async function nativeBlogEnabledScopes(rss=false){
 requireNativeBlogConfiguration()
 const rows=await ownedAdminTransaction(false,async query=>(await query(`SELECT tenant_id FROM public.blog_settings WHERE enabled=true ${rss?'AND rss_enabled=true':''} ORDER BY tenant_id NULLS FIRST LIMIT 1001`)).rows)
 if(rows.length>1000)throw new AdminMenuError(409,'Blog scope inventory exceeds the supported limit')
 return rows.map(row=>row.tenant_id===null?null:String(row.tenant_id))
}
export async function runNativeBlogSweep(trigger:'cron'|'manual',requestKey?:string):Promise<SweepSummary>{
 if(trigger==='manual'&&(!requestKey||!UUID.test(requestKey)))throw new AdminMenuError(400,'Explicit manual cron Idempotency-Key UUID required')
 const scopes=await nativeBlogEnabledScopes(),summary:SweepSummary={scopesConsidered:scopes.length,generated:0,skipped:0,failed:0,entries:[]}
 const key=trigger==='manual'?`manual:${requestKey}`:`cron:${Math.floor(Date.now()/900000)}`
 for(const scope of scopes){
  try{
   await drainNativeDraftNotifications({kind:'cron',scope}).catch(()=>{})
   const result=await generateNativeBlogPost({kind:'cron',scope},{trigger,requestKey:key})
   if(result.status==='generated')summary.generated++;else if(result.status==='failed')summary.failed++;else summary.skipped++
   summary.entries.push({scope:describeScope(scope),status:result.status,...(result.status==='generated'?{title:result.title}:result.status==='failed'?{error:result.error}:{reason:result.reason})})
  }catch{summary.failed++;summary.entries.push({scope:describeScope(scope),status:'failed',error:'Native blog scope is unavailable'})}
 }
 return summary
}
export async function runNativeRssSweep(){
 const scopes=await nativeBlogEnabledScopes(true),summary={scopesConsidered:scopes.length,sourcesProcessed:0,itemsUpserted:0,errors:[] as Array<{scope:string;sourceName:string;message:string}>}
 for(const scope of scopes){
  try{const result=await fetchNativeBlogRss({kind:'cron',scope});summary.sourcesProcessed+=result.sourcesProcessed;summary.itemsUpserted+=result.itemsUpserted;summary.errors.push(...result.errors.map(row=>({scope:describeScope(scope),sourceName:row.sourceName,message:row.message})))}catch{summary.errors.push({scope:describeScope(scope),sourceName:'(sweep)',message:'Native RSS scope is unavailable'})}
 }
 return summary
}
