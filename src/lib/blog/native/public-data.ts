import type {AdminMenuQuery} from '../../data/admin-menus'
import {AdminMenuError} from '../../data/admin-menus'
import {readNativeTenantPlan} from '../../data/tenant-plan'
import {UUID} from '../../auth/owned-principal'
import type {PublicPostCard,ArchiveEntry} from '../public-queries'
import {parseTags,tagSlug} from '../public-queries'

export async function readNativeBlogTenant(query:AdminMenuQuery,slug:string) {
 if(!slug||slug.length>100)return null
 const row=(await query('SELECT id,name,slug,is_active FROM public.tenants WHERE slug=$1',[slug])).rows[0]
 if(!row||row.is_active!==true)return null
 const plan=await readNativeTenantPlan(query,String(row.id))
 return plan?.features.includes('blog')?{tenantId:String(row.id),name:String(row.name),slug:String(row.slug)}:null
}
export async function assertNativePublicBlogScope(query:AdminMenuQuery,scope:string|null) {
 if(scope===null)return true
 if(!UUID.test(scope))throw new AdminMenuError(400,'Invalid blog scope')
 const row=(await query('SELECT slug FROM public.tenants WHERE id=$1',[scope])).rows[0]
 return !!row&&!!await readNativeBlogTenant(query,String(row.slug))
}
const card=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])) as unknown as PublicPostCard
export async function readNativePublishedPosts(query:AdminMenuQuery,scope:string|null,limit=50,period?:{year:number;month?:number}) {
 if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new AdminMenuError(400,'Invalid blog limit')
 if(!await assertNativePublicBlogScope(query,scope))return []
 let from:Date|null=null,to:Date|null=null
 if(period){
  if(!Number.isInteger(period.year)||period.year<1||period.year>9999||(period.month!==undefined&&(!Number.isInteger(period.month)||period.month<1||period.month>12)))return []
  from=new Date(Date.UTC(period.year,period.month?period.month-1:0,1));to=new Date(Date.UTC(period.month?period.year:period.year+1,period.month??0,1))
 }
 return (await query(`SELECT slug,title,excerpt,published_at,reading_time_minutes,cover_image_url,tags FROM public.blog_posts
  WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='published' AND published_at<=clock_timestamp()
  AND ($2::timestamptz IS NULL OR published_at>=$2) AND ($3::timestamptz IS NULL OR published_at<$3)
  ORDER BY published_at DESC,id LIMIT $4`,[scope,from,to,limit])).rows.map(card)
}
export async function readNativePublishedPost(query:AdminMenuQuery,scope:string|null,slug:string) {
 if(slug.length>300||!await assertNativePublicBlogScope(query,scope))return null
 const row=(await query(`SELECT * FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND slug=$2
  AND status='published' AND published_at<=clock_timestamp()`,[scope,slug])).rows[0]
 return row?Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])):null
}
export async function readNativeBlogTags(query:AdminMenuQuery,scope:string|null) {
 if(!await assertNativePublicBlogScope(query,scope))return []
 const rows=(await query("SELECT tags FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='published' AND published_at<=clock_timestamp() LIMIT 10001",[scope])).rows
 if(rows.length>10000)throw new AdminMenuError(409,'Blog tag inventory exceeds the supported limit')
 const counts=new Map<string,{name:string;count:number}>()
 for(const row of rows)for(const tag of parseTags(typeof row.tags==='string'?row.tags:null)){const slug=tagSlug(tag);if(slug){const value=counts.get(slug)??{name:tag,count:0};value.count++;counts.set(slug,value)}}
 return [...counts].map(([slug,value])=>({slug,...value})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))
}
export async function readNativeBlogArchive(query:AdminMenuQuery,scope:string|null):Promise<ArchiveEntry[]> {
 if(!await assertNativePublicBlogScope(query,scope))return []
 return (await query(`SELECT extract(year FROM published_at AT TIME ZONE 'UTC')::int AS year,
  extract(month FROM published_at AT TIME ZONE 'UTC')::int AS month,count(*)::int AS count FROM public.blog_posts
  WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='published' AND published_at<=clock_timestamp()
  GROUP BY 1,2 ORDER BY 1 DESC,2 DESC LIMIT 12000`,[scope])).rows as unknown as ArchiveEntry[]
}
