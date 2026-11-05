import type {MetadataRoute} from 'next'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {PLATFORM_BASE} from '../../seo'
import {requireNativeBlogConfiguration} from './selected'
import {readNativePublishedPosts,readNativeBlogTags,readNativeBlogArchive} from './public-data'
export async function nativePlatformSitemap():Promise<MetadataRoute.Sitemap>{
 requireNativeBlogConfiguration()
 return ownedAdminTransaction(false,async query=>{
  const entries:MetadataRoute.Sitemap=[{url:PLATFORM_BASE,lastModified:new Date(),changeFrequency:'weekly',priority:1}]
  const tenants=(await query('SELECT slug,updated_at,custom_domain,custom_domain_verified FROM public.tenants WHERE is_active=true ORDER BY updated_at DESC,id LIMIT 5000')).rows
  for(const row of tenants)if(!(row.custom_domain&&row.custom_domain_verified))entries.push({url:`${PLATFORM_BASE}/${row.slug}`,lastModified:row.updated_at instanceof Date?row.updated_at:new Date(),changeFrequency:'weekly',priority:0.8})
  entries.push({url:`${PLATFORM_BASE}/blog`,lastModified:new Date(),changeFrequency:'weekly',priority:0.7})
  const posts=await readNativePublishedPosts(query,null,1000),tags=await readNativeBlogTags(query,null),archive=await readNativeBlogArchive(query,null)
  for(const tag of tags)entries.push({url:`${PLATFORM_BASE}/blog/tag/${tag.slug}`,changeFrequency:'weekly',priority:0.5})
  for(const year of new Set(archive.map(row=>row.year)))entries.push({url:`${PLATFORM_BASE}/blog/archive/${year}`,changeFrequency:'monthly',priority:0.4})
  for(const row of archive)entries.push({url:`${PLATFORM_BASE}/blog/archive/${row.year}/${String(row.month).padStart(2,'0')}`,changeFrequency:'monthly',priority:0.3})
  for(const post of posts)entries.push({url:`${PLATFORM_BASE}/blog/${post.slug}`,lastModified:post.published_at?new Date(post.published_at):new Date(),changeFrequency:'monthly',priority:0.6})
  return entries
 })
}
