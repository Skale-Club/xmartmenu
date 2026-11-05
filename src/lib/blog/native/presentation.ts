import type {BlogAutomationState} from '@/app/(superadmin)/admin/blog/BlogAutomationClient'
import type {readNativeBlogState} from './admin-data'
export function nativePlatformBlogState(state:Awaited<ReturnType<typeof readNativeBlogState>>):BlogAutomationState{
 const nullable=(value:unknown)=>typeof value==='string'?value:null
 return {settings:state.settings,hasOpenrouterKey:state.hasOpenrouterKey,nextScheduledRunAt:state.nextScheduledRunAt,pendingItems:state.pendingItems,telegram:state.telegram,
  drafts:state.drafts.map(row=>({id:String(row.id),title:String(row.title),excerpt:nullable(row.excerpt),created_at:String(row.created_at)})),
  sources:state.sources.map(row=>({id:String(row.id),name:String(row.name),url:String(row.url),enabled:row.enabled===true,last_fetched_at:nullable(row.last_fetched_at),last_fetched_status:nullable(row.last_fetched_status),error_message:nullable(row.error_message)})),
  jobs:state.jobs.map(row=>({id:String(row.id),status:String(row.status),source:nullable(row.source),pillar_id:nullable(row.pillar_id),topic:nullable(row.topic),error_message:nullable(row.error_message),durations_ms:row.durations_ms as BlogAutomationState['jobs'][number]['durations_ms'],created_at:String(row.created_at)}))}
}
