import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { currentTenantEffectActor } from '../data/tenant-effect-authority-runtime'
import { operationRow,lockTenantOperation,claimTenantOperation,finishTenantOperation,tenantEffectDigest,tenantEffectByteDigest,type TenantOperation } from '../data/tenant-effect-operations'
import { readTenantEffectCatalog,applyTenantEffectCopy,applyTenantEffectSeed,applyTenantEffectImage,type NativeCatalogSnapshot } from '../data/tenant-effect-catalog'
import { prepareTenantEffectCall,recordTenantEffectCall,reconcileTenantEffectCall } from '../data/tenant-effect-calls'
import { prepareNativeImageStep,advanceNativeImageStep } from '../data/tenant-effect-image-jobs'
import { AdminMenuError } from '../data/admin-menus'
import { UUID } from '../auth/owned-principal'
import { nativeEffectAiAccess } from './ai-access'
import { generateNativeSeed,generateNativeOcr } from './recipes'
import { generateOpenRouterImage,imageModelId,parseImageEngine,cropToAspect } from '../ai/openrouter'
import { sanitizeForPrompt } from '../ai/sanitize'
import { getNativeStorageClient } from '../storage'
import { convertBufferToWebP,MAX_FILE_SIZE } from '../upload'
import { publishNativeTenantWork } from './queue'
import { revalidatePath } from 'next/cache'
import { consumeNativeOcrTicket } from '../data/tenant-effect-uploads'

const actor=(operation:TenantOperation)=>currentTenantEffectActor({actorId:operation.actorId,sessionHash:operation.sessionHash})
function invalidate(snapshot:NativeCatalogSnapshot){try{revalidatePath('/tenants');revalidatePath(`/${snapshot.tenant.slug}`);revalidatePath(`/${snapshot.tenant.slug}/${snapshot.menu.slug}`)}catch{}}
async function unresolved(operation:TenantOperation,claimId:string,index=0) {
  await ownedAdminTransaction(true,query=>reconcileTenantEffectCall(query,operation.id,claimId,index)).catch(()=>{})
}
async function claimSnapshot(operation:TenantOperation) {
  const proof=await actor(operation)
  return ownedAdminTransaction(true,async query=>{
    const current=await lockTenantOperation(query,proof,operation.id)
    if(current.status!=='reserved')throw new AdminMenuError(409,'Operation already started. Inspect its status instead of repeating provider work.')
    const snapshot=await readTenantEffectCatalog(query,proof,current.tenantId,String(current.input.menuId),true)
    if(current.input.categoryId&&!snapshot.categories.some(row=>row.id===current.input.categoryId))throw new AdminMenuError(404,'Category not found for this menu')
    if(current.input.productId&&!snapshot.products.some(row=>row.id===current.input.productId))throw new AdminMenuError(404,'Product not found for this menu')
    if(current.input.type==='products'&&!snapshot.categories.length)throw new AdminMenuError(400,'No categories found; seed categories first')
    const claimed=await claimTenantOperation(query,proof,current.id,snapshot.digest)
    if(!claimed.claimId)throw new AdminMenuError(503,'Operation claim is unavailable')
    return {operation:claimed,claimId:claimed.claimId,snapshot}
  })
}
export async function executeNativeSeed(operation:TenantOperation) {
  await nativeEffectAiAccess(operation,'','seed') // Configuration check before any claim/provider call.
  const claim=await claimSnapshot(operation)
  try{
    const access=await nativeEffectAiAccess(claim.operation,claim.claimId,'seed')
    const generated=await generateNativeSeed(claim.snapshot,claim.operation.input,access.apiKey,access.fetchImpl)
    const proof=await actor(operation)
    const applied=await ownedAdminTransaction(true,async query=>{
      await lockTenantOperation(query,proof,operation.id)
      const result='copy'in generated&&generated.copy?await applyTenantEffectCopy(query,proof,claim.snapshot,generated.copy)
        :await applyTenantEffectSeed(query,proof,claim.snapshot,String(operation.input.type),generated.categories,typeof operation.input.categoryId==='string'?operation.input.categoryId:undefined)
      return finishTenantOperation(query,proof,operation.id,claim.claimId,result)
    })
    invalidate(claim.snapshot);return applied
  }catch{await unresolved(operation,claim.claimId);throw new AdminMenuError(409,'Seeding was not applied. Inspect this operation before starting another paid request.')}
}
async function generatedImage(operation:TenantOperation,claimId:string,snapshot:NativeCatalogSnapshot,product:Record<string,unknown>|null,index=0,workerNonce?:string) {
  const engine=parseImageEngine(operation.input.engine),business=sanitizeForPrompt(String(operation.input.businessType??snapshot.settings?.business_type??''))||'restaurant',company=sanitizeForPrompt(String(operation.input.companyName??snapshot.tenant.name))
  const prompt=product?`Professional food photography of ${sanitizeForPrompt(String(product.name))}. ${sanitizeForPrompt(String(product.description??''))}. Prepared at a ${business} named ${company}. Appetizing presentation, natural lighting, no text or watermarks.`
    :`A professional high-quality restaurant banner photo for a ${business} named ${company}. Wide-angle view, warm ambient lighting, food photography style. No text or watermarks.`
  const access=await nativeEffectAiAccess(operation,claimId,'seed_image',index,fetch,workerNonce)
  const image=await generateOpenRouterImage({apiKey:access.apiKey,model:imageModelId(engine),prompt,aspectRatio:product?'1:1':'4:1',fetchImpl:access.fetchImpl,timeoutMs:120000})
  return convertBufferToWebP(await cropToAspect(image.bytes,product?'1:1':'4:1'))
}
async function storeImage(operation:TenantOperation,claimId:string,bytes:Buffer,path:string,index:number) {
  const storage=getNativeStorageClient(),proof=await actor(operation),digest=tenantEffectByteDigest(bytes)
  await ownedAdminTransaction(true,query=>prepareTenantEffectCall(query,proof,operation.id,claimId,index,'storage',{path,digest,contentType:'image/webp'}))
  try{
    const url=await storage.upload('tenant-assets',path,bytes,{contentType:'image/webp',upsert:true,signal:AbortSignal.timeout(30000)})
    await ownedAdminTransaction(true,query=>recordTenantEffectCall(query,operation.id,claimId,index,{feature:'storage',model:null,generationId:null,costUsd:null,tokens:0,responseDigest:tenantEffectDigest({ack:true,path,url,digest})}))
    return url
  }catch{await unresolved(operation,claimId,index);throw new AdminMenuError(409,'Storage outcome requires reconciliation; the generated image will not be requested again')}
}
export async function executeNativeSingleImage(operation:TenantOperation) {
  getNativeStorageClient()
  await nativeEffectAiAccess(operation,'','seed_image')
  const claim=await claimSnapshot(operation),productId=typeof operation.input.productId==='string'?operation.input.productId:null
  const product=productId?claim.snapshot.products.find(row=>row.id===productId)??null:null
  if((product&&product.image_url)||(!product&&claim.snapshot.settings?.banner_url)){
    const proof=await actor(operation)
    return ownedAdminTransaction(true,query=>finishTenantOperation(query,proof,operation.id,claim.claimId,{success:true,skipped:true,imagesCreated:0,message:'Image already set. Clear it in settings before generating another.'}))
  }
  try{
    const bytes=await generatedImage(claim.operation,claim.claimId,claim.snapshot,product)
    const path=`${operation.tenantId}/native/${operation.id}/${productId?`products/${productId}`:'banner'}.webp`
    const url=await storeImage(operation,claim.claimId,bytes,path,1),proof=await actor(operation)
    const applied=await ownedAdminTransaction(true,async query=>{
      await lockTenantOperation(query,proof,operation.id)
      const result=await applyTenantEffectImage(query,proof,claim.snapshot,productId,url)
      return finishTenantOperation(query,proof,operation.id,claim.claimId,result)
    })
    invalidate(claim.snapshot);return applied
  }catch{await unresolved(operation,claim.claimId);throw new AdminMenuError(409,'Image was not applied. Inspect the operation before starting another paid request.')}
}
export async function executeNativeImageJob(id:string) {
  if(!UUID.test(id))throw new AdminMenuError(400,'Invalid operation ID')
  getNativeStorageClient()
  // Only a verified queue payload reaches this internal lookup. Browser actor
  // IDs/hashes are never accepted, persisted as session tokens or returned.
  const operation=await ownedAdminTransaction(false,async query=>{
    const rows=(await query("SELECT * FROM public.app_tenant_operations WHERE id=$1 AND kind='image-job'",[id])).rows
    if(rows.length!==1)throw new AdminMenuError(404,'Image job not found')
    return operationRow(rows[0])
  })
  const proof=await actor(operation),step=await ownedAdminTransaction(true,query=>prepareNativeImageStep(query,proof,id))
  if(step.state==='continue'){await publishNativeTenantWork('ai',id,step.nextIndex);return {status:'running'}}
  if(step.state!=='ready')return {status:step.state}
  try{
    const bytes=await generatedImage(step.operation,step.claimId,step.snapshot,step.product,step.index*2,step.workerNonce)
    const path=`${operation.tenantId}/native/${operation.id}/products/${String(step.product.id)}.webp`
    const url=await storeImage(operation,step.claimId,bytes,path,step.index*2+1),current=await actor(operation)
    const progress=await ownedAdminTransaction(true,async query=>{
      await lockTenantOperation(query,current,id)
      await applyTenantEffectImage(query,current,step.snapshot,String(step.product.id),url)
      return advanceNativeImageStep(query,current,id,step.claimId,step.index)
    })
    invalidate(step.snapshot)
    if(progress.state==='continue'){
      // A publish failure leaves durable next_index intact. Re-enqueueing the
      // same operation resumes only an unprepared slot, never a paid call.
      try{await publishNativeTenantWork('ai',id,progress.nextIndex)}catch{return {status:'pending-dispatch'}}
    }
    return {status:progress.state==='applied'?'complete':'running'}
  }catch{await unresolved(operation,step.claimId,step.index*2);return {status:'reconcile'}}
}
export async function executeNativeOcr(operation:TenantOperation) {
  await nativeEffectAiAccess(operation,'','ocr')
  const storage=getNativeStorageClient(),claim=await claimSnapshot(operation)
  try{
    const proof=await actor(operation),path=String(operation.input.storagePath)
    const ticket=await ownedAdminTransaction(true,query=>consumeNativeOcrTicket(query,proof,operation,path))
    const downloaded=await storage.download('tenant-assets',path,MAX_FILE_SIZE,AbortSignal.timeout(30000))
    if(downloaded.length!==Number(ticket.byte_length))throw new AdminMenuError(400,'OCR upload size does not match its ticket')
    if(tenantEffectByteDigest(downloaded)!==ticket.content_digest)throw new AdminMenuError(400,'OCR upload bytes do not match the authorized ticket')
    const bytes=await convertBufferToWebP(downloaded),access=await nativeEffectAiAccess(operation,claim.claimId,'ocr')
    const categories=await generateNativeOcr(bytes,access.apiKey,access.fetchImpl),current=await actor(operation)
    const applied=await ownedAdminTransaction(true,async query=>{
      await lockTenantOperation(query,current,operation.id)
      const result=await applyTenantEffectSeed(query,current,claim.snapshot,'ocr',categories)
      return finishTenantOperation(query,current,operation.id,claim.claimId,result)
    })
    invalidate(claim.snapshot);return applied
  }catch{await unresolved(operation,claim.claimId);throw new AdminMenuError(409,'OCR was not applied. Inspect the operation before requesting another extraction.')}
}
export async function executeNativeUpload(operation:TenantOperation,bytes:Buffer,type:string) {
  getNativeStorageClient()
  const proof=await actor(operation),claim=await ownedAdminTransaction(true,query=>claimTenantOperation(query,proof,operation.id,tenantEffectDigest(operation.input)))
  if(!claim.claimId)throw new AdminMenuError(503,'Upload claim is unavailable')
  const claimId=claim.claimId
  try{
    const path=`${operation.tenantId}/native/${operation.id}/${type}.webp`,url=await storeImage(operation,claimId,bytes,path,0),current=await actor(operation)
    return await ownedAdminTransaction(true,query=>finishTenantOperation(query,current,operation.id,claimId,{url}))
  }catch{await unresolved(operation,claimId);throw new AdminMenuError(409,'Upload outcome requires review; existing assets were preserved')}
}
