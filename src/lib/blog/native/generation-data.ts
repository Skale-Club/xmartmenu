import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {readPlatformAiRecord,readTenantAiRecord} from '../../data/ai-access'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import {decryptApiKey} from '../../crypto'
import {planAiAccess,parseBillingMode,clampMarkup,type KeyChoice} from '../../ai/billing-rules'
import {platformOpenRouterKey} from '../../ai/openrouter'
import type {BlogSettingsRow,BlogEditorialFacts} from '../generator'
import type {TenantBlogContext} from '../tenant-context'
import {scoreItem,MIN_RSS_SCORE,type RssItemRow} from '../rss'
import {nativeBlogScope,requireNativeBlogContext,type NativeBlogContext} from './authority'
const decrypt=(value:unknown)=>{if(typeof value!=='string'||!value)return null;try{return decryptApiKey(value)||null}catch{return null}}
const dto=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value]))
export async function readNativeBlogGenerationFacts(query:AdminMenuQuery,context:NativeBlogContext){
 const scope=nativeBlogScope(context),tenant=await requireNativeBlogContext(query,context)
 const raw=(await query('SELECT * FROM public.blog_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[scope])).rows[0]
 if(!raw)return null
 const settings=dto(raw) as unknown as BlogSettingsRow
 settings.openrouter_api_key=decrypt(raw.openrouter_api_key)
 const platform=await readPlatformAiRecord(query),tenantAi=scope?await readTenantAiRecord(query,scope):null,envKey=platformOpenRouterKey()
 const access=planAiAccess({feature:'blog',tenantId:scope,tenantMode:parseBillingMode(tenantAi?.billing_mode),tenantKey:decrypt(tenantAi?.openrouter_api_key),tenantMarkupPct:tenantAi?.markup_pct==null?null:Number(tenantAi.markup_pct),platformKey:decrypt(platform?.openrouter_api_key)??envKey,defaultMode:parseBillingMode(platform?.default_billing_mode)??'platform',defaultMarkupPct:clampMarkup(Number(platform?.default_markup_pct??30))})
 // Preserve the existing generator's primary choice; do not invent paid retries
 // or enable a fallback the old blog pipeline did not execute.
 const choice:KeyChoice|null=settings.openrouter_api_key?{apiKey:settings.openrouter_api_key,keySource:scope?'tenant':'platform',billable:false,markupPct:0}:access?.primary??null
 let tenantContext:TenantBlogContext|null=null
 if(scope){
  const store=(await query('SELECT address,business_type,tagline,about,whatsapp,delivery_enabled,pickup_enabled,dine_in_enabled,whatsapp_orders_enabled FROM public.tenant_settings WHERE tenant_id=$1',[scope])).rows[0]??{}
  const categories=(await query('SELECT name FROM public.categories WHERE tenant_id=$1 AND is_active=true ORDER BY position,id LIMIT 30',[scope])).rows.map(row=>String(row.name)).filter(Boolean)
  const dishes=(await query(`SELECT p.name,p.description,c.name AS category FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=p.tenant_id
   WHERE p.tenant_id=$1 AND p.is_available=true ORDER BY p.position,p.id LIMIT 60`,[scope])).rows.map(row=>({name:String(row.name),description:typeof row.description==='string'?row.description:null,category:typeof row.category==='string'?row.category:null}))
  tenantContext={tenantId:scope,slug:tenant.slug,name:tenant.name,businessType:typeof store.business_type==='string'?store.business_type:null,tagline:typeof store.tagline==='string'?store.tagline:null,about:typeof store.about==='string'?store.about:null,address:typeof store.address==='string'?store.address:null,categories,dishes,channels:{delivery:store.delivery_enabled===true,pickup:store.pickup_enabled===true,dineIn:store.dine_in_enabled!==false,whatsapp:store.whatsapp_orders_enabled===true&&!!store.whatsapp},timezone:settings.timezone||'America/Sao_Paulo'}
 }
 const posts=(await query('SELECT title,slug,status,focus_keyword FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at DESC,id LIMIT 12',[scope])).rows as unknown as BlogEditorialFacts['posts']
 const feedback=(await query('SELECT post_title,verdict,reason FROM public.blog_post_feedback WHERE tenant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at DESC,id LIMIT 16',[scope])).rows as unknown as BlogEditorialFacts['feedback']
 const recentPillars=(await query('SELECT pillar_id FROM public.blog_generation_jobs WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND pillar_id IS NOT NULL ORDER BY created_at DESC,id LIMIT 8',[scope])).rows.map(row=>String(row.pillar_id))
 let rssItem:RssItemRow|null=null,bestScore=-Infinity
 if(settings.rss_enabled){
  const candidates=(await query("SELECT id,source_id,guid,url,title,summary,published_at,status FROM public.blog_rss_items WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='pending' ORDER BY published_at DESC NULLS LAST,id LIMIT 50",[scope])).rows.map(dto) as unknown as RssItemRow[]
  for(const candidate of candidates){const score=scoreItem(candidate,settings.seo_keywords);if(score>bestScore){rssItem=candidate;bestScore=score}}
  if(bestScore<MIN_RSS_SCORE)rssItem=null
 }
 // The digest guards what the paid call depends on to be authorised: settings,
 // key and billing. Editorial context (menu, recent posts, feedback) is the
 // snapshot taken at the start; editing a dish mid-generation must not discard
 // an already paid post.
 const stableSettings={...raw};delete stableSettings.last_run_at;delete stableSettings.lock_acquired_at;delete stableSettings.updated_at
 const digest=tenantEffectDigest({settings:stableSettings,platform,tenantAi:tenantAi?{billing_mode:tenantAi.billing_mode,openrouter_api_key:tenantAi.openrouter_api_key,markup_pct:tenantAi.markup_pct}:null,environmentKeyDigest:envKey?tenantEffectDigest(envKey):null})
 return {scope,settings,choice,tenantContext,editorial:{posts,feedback},recentPillars,rssItem,digest}
}
export async function requireNativeBlogFacts(query:AdminMenuQuery,context:NativeBlogContext,digest:string){
 const facts=await readNativeBlogGenerationFacts(query,context)
 if(!facts||facts.digest!==digest)throw new AdminMenuError(409,'Blog configuration, content or capability changed; review the paid operation')
 return facts
}
