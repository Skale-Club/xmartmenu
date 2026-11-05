import {revalidatePath} from 'next/cache'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
/** Public pages of a blog scope: tenant blogs live under /<slug>/blog (slug path),
 * the platform blog under /blog. A publish, approval or edit must refresh the
 * list, the feed and (when known) the post page. */
export async function nativeBlogPublicPaths(scope:string|null,postId?:string):Promise<string[]>{
 const found=await ownedAdminTransaction(false,async query=>({
  tenant:scope===null?undefined:(await query('SELECT slug FROM public.tenants WHERE id=$1',[scope])).rows[0],
  post:postId?(await query('SELECT slug FROM public.blog_posts WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid',[postId,scope])).rows[0]:undefined,
 }))
 if(scope!==null&&!found.tenant?.slug)return []
 const base=scope===null?'/blog':'/'+String(found.tenant?.slug)+'/blog'
 return [base,base+'/rss.xml',...(found.post?.slug?[base+'/'+String(found.post.slug)]:[])]
}
/** Best effort: a cache refresh failure must never turn a committed publish into an error. */
export async function revalidateNativeBlogPublic(scope:string|null,postId?:string){
 try{for(const path of await nativeBlogPublicPaths(scope,postId))revalidatePath(path)}catch{}
}
