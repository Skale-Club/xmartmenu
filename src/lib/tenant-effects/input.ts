import { AdminMenuError } from '../data/admin-menus'
import { UUID } from '../auth/owned-principal'
import { parseImageEngine } from '../ai/openrouter'
import type { TenantOperationKind } from '../data/tenant-effect-operations'

export function nativeEffectInput(kind:TenantOperationKind,raw:unknown):Record<string,unknown> {
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || JSON.stringify(raw).length>32000)throw new AdminMenuError(400,'Invalid effect request')
  const body=raw as Record<string,unknown>,allowed=kind==='ocr'?['menuId','storagePath']:kind==='image-job'?['menuId','productId','businessType','companyName','engine']:['type','menuId','categoryId','productId','businessType','companyName','engine']
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw new AdminMenuError(400,'Unsupported effect fields')
  const output:Record<string,unknown>={}
  for(const key of ['menuId','categoryId','productId'])if(body[key]!==undefined){if(typeof body[key]!=='string' || !UUID.test(body[key]))throw new AdminMenuError(400,`Invalid ${key}`);output[key]=body[key]}
  if(!output.menuId && kind!=='image-job')throw new AdminMenuError(400,'Choose an exact menu')
  for(const key of ['businessType','companyName']){if(body[key]!==undefined && (typeof body[key]!=='string' || body[key].length>500))throw new AdminMenuError(400,'Invalid business description');if(kind!=='ocr')output[key]=body[key]??''}
  if(kind==='seed'){
    if(!['menu','categories','products','copy','single_category','single_product'].includes(String(body.type)))throw new AdminMenuError(400,'Choose a seed operation')
    if(body.type==='single_product'&&!output.categoryId)throw new AdminMenuError(400,'Choose an exact category')
    output.type=body.type
  }else if(kind==='image'){
    if(!['image_cover','image_products','image_single_product'].includes(String(body.type)))throw new AdminMenuError(400,'Choose an image operation')
    if(body.type==='image_single_product'&&!output.productId)throw new AdminMenuError(400,'Choose an exact product')
    output.type=body.type
  }else if(kind==='ocr'){
    if(typeof body.storagePath!=='string' || body.storagePath.length>256)throw new AdminMenuError(400,'An exact OCR upload path is required')
    output.storagePath=body.storagePath
  }
  if(kind==='image'||kind==='image-job'){
    if(body.engine!==undefined && body.engine!=='google'&&body.engine!=='openai')throw new AdminMenuError(400,'Invalid image engine')
    output.engine=parseImageEngine(body.engine)
  }
  return output
}
