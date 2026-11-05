import { randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'
import { requireTenantEffectActor,type TenantEffectActor } from './tenant-effect-authority'
import { tenantEffectDigest } from './tenant-effect-operations'

export type NativeCatalogSnapshot={tenantId:string;tenant:Record<string,unknown>;menu:Record<string,unknown>;settings:Record<string,unknown>|null;categories:Record<string,unknown>[];products:Record<string,unknown>[];digest:string}
export async function readTenantEffectCatalog(query:AdminMenuQuery,proof:TenantEffectActor,tenantId:string,menuId:string,write=false):Promise<NativeCatalogSnapshot> {
  await requireTenantEffectActor(query,proof,write)
  if(!UUID.test(tenantId) || !UUID.test(menuId))throw new AdminMenuError(400,'Choose an exact restaurant and menu')
  if(write)await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`xmartmenu-admin-menus:${tenantId}`])
  const tenants=(await query(`SELECT id,name,slug FROM public.tenants WHERE id=$1 ${write?'FOR NO KEY UPDATE':''}`,[tenantId])).rows
  if(tenants.length!==1)throw new AdminMenuError(404,'Restaurant not found')
  const menus=(await query(`SELECT id,slug,supported_languages FROM public.menus WHERE id=$1 AND tenant_id=$2 ${write?'FOR UPDATE':''}`,[menuId,tenantId])).rows
  if(menus.length!==1)throw new AdminMenuError(404,'Menu not found for this restaurant')
  const settings=(await query(`SELECT banner_url,tagline,about,business_type FROM public.tenant_settings WHERE tenant_id=$1 ${write?'FOR UPDATE':''}`,[tenantId])).rows
  const categories=(await query(`SELECT id,name,description,position FROM public.categories WHERE tenant_id=$1 AND menu_id=$2 ORDER BY position,id LIMIT 1001 ${write?'FOR UPDATE':''}`,[tenantId,menuId])).rows
  const products=(await query(`SELECT id,category_id,name,description,image_url,position FROM public.products WHERE tenant_id=$1 AND menu_id=$2 ORDER BY position,id LIMIT 2001 ${write?'FOR UPDATE':''}`,[tenantId,menuId])).rows
  if(categories.length>1000 || products.length>2000)throw new AdminMenuError(409,'Catalog exceeds the supported limit')
  const facts={tenantId,tenant:tenants[0],menu:menus[0],settings:settings[0]??null,categories,products}
  return {...facts,digest:tenantEffectDigest(facts)}
}
export type NativeSeedProduct={name:string;description?:string|null;price:number;translations?:Record<string,unknown>}
export type NativeSeedCategory={name:string;description?:string|null;translations?:Record<string,unknown>;products:NativeSeedProduct[]}
function label(value:unknown,max=500):string {if(typeof value!=='string' || !value.trim() || value.length>max)throw new AdminMenuError(503,'Generated catalog text is invalid');return value.trim()}
function description(value:unknown):string|null {if(value===undefined || value===null || value==='')return null;if(typeof value!=='string' || value.length>10000)throw new AdminMenuError(503,'Generated description is invalid');return value}
function translations(value:unknown):string {if(value===undefined)return '{}';if(!value || typeof value!=='object' || Array.isArray(value) || JSON.stringify(value).length>32000)throw new AdminMenuError(503,'Generated translations are invalid');return JSON.stringify(value)}
function productValues(value:NativeSeedProduct) {
  if(typeof value.price!=='number' || !Number.isFinite(value.price) || value.price<0 || value.price>99999999.99)throw new AdminMenuError(503,'Generated price is invalid')
  return {name:label(value.name),description:description(value.description),price:value.price,translations:translations(value.translations)}
}
export async function applyTenantEffectSeed(query:AdminMenuQuery,proof:TenantEffectActor,snapshot:NativeCatalogSnapshot,type:string,generated:NativeSeedCategory[],categoryId?:string) {
  const current=await readTenantEffectCatalog(query,proof,snapshot.tenantId,String(snapshot.menu.id),true)
  if(current.digest!==snapshot.digest)throw new AdminMenuError(409,'Catalog changed while generating. The paid request will not be repeated automatically.')
  if(!Array.isArray(generated) || generated.length>1000)throw new AdminMenuError(503,'Generated catalog exceeds the supported limit')
  let categoriesCreated=0,productsCreated=0,catPosition=Math.max(-1,...current.categories.map(row=>Number(row.position??-1)))+1,prodPosition=Math.max(-1,...current.products.map(row=>Number(row.position??-1)))+1
  const categoryNames=new Set(current.categories.map(row=>String(row.name).toLowerCase()))
  for(const candidate of generated){
    const name=label(candidate.name)
    if(!Array.isArray(candidate.products) || candidate.products.length>2000)throw new AdminMenuError(503,'Generated products exceed the supported limit')
    let target=current.categories.find(row=>String(row.name).toLowerCase()===name.toLowerCase())
    if(type==='single_product')target=current.categories.find(row=>row.id===categoryId)
    if(type==='products' || type==='single_product'){
      if(!target)throw new AdminMenuError(409,'Generated product category no longer exists')
    }else{
      // Preserve the legacy additive rule: menu/OCR products belong only to
      // newly added categories; an existing category is never overwritten.
      if(categoryNames.has(name.toLowerCase()))continue
      if(current.categories.length+categoriesCreated>=1000)throw new AdminMenuError(409,'Category limit reached')
      target={id:randomUUID(),name};categoryNames.add(name.toLowerCase())
      await query(`INSERT INTO public.categories(id,tenant_id,menu_id,name,description,translations,position,is_active)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,true)`,[target.id,current.tenantId,current.menu.id,name,description(candidate.description),translations(candidate.translations),catPosition++]);categoriesCreated++
    }
    if(type==='categories' || type==='single_category')continue
    if(!target)throw new AdminMenuError(409,'Product category is unavailable')
    const targetId=target.id
    const names=new Set(current.products.filter(row=>row.category_id===targetId).map(row=>String(row.name).toLowerCase()))
    for(const candidateProduct of candidate.products){
      const product=productValues(candidateProduct);if(names.has(product.name.toLowerCase()))continue
      if(current.products.length+productsCreated>=2000)throw new AdminMenuError(409,'Product limit reached')
      names.add(product.name.toLowerCase())
      await query(`INSERT INTO public.products(id,tenant_id,menu_id,category_id,name,description,translations,price,is_available,is_featured,tags,image_urls,position)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,true,false,ARRAY[]::text[],ARRAY[]::text[],$9)`,[randomUUID(),current.tenantId,current.menu.id,targetId,product.name,product.description,product.translations,product.price,prodPosition++]);productsCreated++
    }
  }
  await requireTenantEffectActor(query,proof,true)
  return {success:true,categoriesCreated,productsCreated}
}
export async function applyTenantEffectCopy(query:AdminMenuQuery,proof:TenantEffectActor,snapshot:NativeCatalogSnapshot,copy:{tagline:string;about:string}) {
  const current=await readTenantEffectCatalog(query,proof,snapshot.tenantId,String(snapshot.menu.id),true)
  if(current.digest!==snapshot.digest)throw new AdminMenuError(409,'Restaurant copy changed while generating')
  const tagline=label(copy.tagline,500),about=label(copy.about,10000)
  await query('INSERT INTO public.tenant_settings(tenant_id,tagline,about) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET tagline=EXCLUDED.tagline,about=EXCLUDED.about',[current.tenantId,tagline,about])
  await requireTenantEffectActor(query,proof,true);return {success:true,categoriesCreated:0,productsCreated:0}
}
export async function applyTenantEffectImage(query:AdminMenuQuery,proof:TenantEffectActor,snapshot:NativeCatalogSnapshot,productId:string|null,url:string) {
  const current=await readTenantEffectCatalog(query,proof,snapshot.tenantId,String(snapshot.menu.id),true)
  if(current.digest!==snapshot.digest)throw new AdminMenuError(409,'Catalog changed while generating the image. The paid request will not be repeated automatically.')
  const parsed=new URL(url)
  if(parsed.protocol!=='https:' || parsed.username || parsed.password || url.length>2048)throw new AdminMenuError(503,'Native image URL is invalid')
  if(productId){
    if(!UUID.test(productId))throw new AdminMenuError(400,'Invalid product')
    const result=(await query('UPDATE public.products SET image_url=$4 WHERE tenant_id=$1 AND menu_id=$2 AND id=$3 AND image_url IS NULL RETURNING id',[current.tenantId,current.menu.id,productId,url])).rows
    if(result.length!==1)throw new AdminMenuError(409,'Product image was already changed')
  }else{
    if(current.settings?.banner_url)throw new AdminMenuError(409,'Restaurant banner was already changed')
    const result=(await query(`INSERT INTO public.tenant_settings(tenant_id,banner_url) VALUES($1,$2)
      ON CONFLICT(tenant_id) DO UPDATE SET banner_url=EXCLUDED.banner_url WHERE public.tenant_settings.banner_url IS NULL RETURNING tenant_id`,[current.tenantId,url])).rows
    if(result.length!==1)throw new AdminMenuError(409,'Restaurant banner was already changed')
  }
  await requireTenantEffectActor(query,proof,true);return {success:true,imagesCreated:1,message:productId?'Product image generated and uploaded.':'Cover image generated and uploaded.'}
}
