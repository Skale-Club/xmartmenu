import type {MetadataRoute} from 'next'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {PLATFORM_BASE,tenantOwnHost} from '../../seo'
import {requireNativeBlogConfiguration} from './selected'
import {readNativePublishedPosts,readNativeBlogTags,readNativeBlogArchive} from './public-data'
type Entries=MetadataRoute.Sitemap
async function tenantEntries():Promise<Entries>{
 return ownedAdminTransaction(false,async query=>{
  const entries:Entries=[]
  // A restaurant on its own host (verified custom domain or subdomain) lists itself there.
  const tenants=(await query(`SELECT t.slug,t.updated_at,t.custom_domain,t.custom_domain_verified,to_jsonb(t)->>'subdomain' AS subdomain FROM public.tenants t WHERE t.is_active=true ORDER BY t.updated_at DESC,t.id LIMIT 5000`)).rows
  for(const row of tenants)if(!tenantOwnHost({slug:String(row.slug),custom_domain:row.custom_domain as string|null,custom_domain_verified:row.custom_domain_verified===true,subdomain:row.subdomain as string|null}))entries.push({url:`${PLATFORM_BASE}/${row.slug}`,lastModified:row.updated_at instanceof Date?row.updated_at:new Date(),changeFrequency:'weekly',priority:0.8})
  return entries
 })
}
async function blogEntries():Promise<Entries>{
 return ownedAdminTransaction(false,async query=>{
  const entries:Entries=[{url:`${PLATFORM_BASE}/blog`,lastModified:new Date(),changeFrequency:'weekly',priority:0.7}]
  const posts=await readNativePublishedPosts(query,null,1000),tags=await readNativeBlogTags(query,null),archive=await readNativeBlogArchive(query,null)
  for(const tag of tags)entries.push({url:`${PLATFORM_BASE}/blog/tag/${tag.slug}`,changeFrequency:'weekly',priority:0.5})
  for(const year of new Set(archive.map(row=>row.year)))entries.push({url:`${PLATFORM_BASE}/blog/archive/${year}`,changeFrequency:'monthly',priority:0.4})
  for(const row of archive)entries.push({url:`${PLATFORM_BASE}/blog/archive/${row.year}/${String(row.month).padStart(2,'0')}`,changeFrequency:'monthly',priority:0.3})
  for(const post of posts)entries.push({url:`${PLATFORM_BASE}/blog/${post.slug}`,lastModified:post.published_at?new Date(post.published_at):new Date(),changeFrequency:'monthly',priority:0.6})
  return entries
 })
}
/** Degrades block by block, like the legacy sitemap: a failing tenant or blog
 * read costs only that block, and the landing entry is always returned. */
export async function nativePlatformSitemap():Promise<Entries>{
 const entries:Entries=[{url:PLATFORM_BASE,lastModified:new Date(),changeFrequency:'weekly',priority:1},{url:`${PLATFORM_BASE}/pricing`,lastModified:new Date(),changeFrequency:'monthly',priority:0.8}]
 try{requireNativeBlogConfiguration()}catch{return entries}
 try{entries.push(...await tenantEntries())}catch{}
 try{entries.push(...await blogEntries())}catch{}
 return entries
}
