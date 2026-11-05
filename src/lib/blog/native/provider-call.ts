import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {OPENROUTER_BASE_URL} from '../../ai/openrouter'
import {AdminMenuError} from '../../data/admin-menus'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import type {KeyChoice} from '../../ai/billing-rules'
import {nativeBlogPhase} from './runtime'
import {requireNativeBlogFacts} from './generation-data'
import {prepareNativeBlogCall,recordNativeBlogCall,recordNativeBlogCallFailure,reconcileNativeBlogOperation} from './operations'
import {NativeBlogDefinitiveError,NativeBlogUnknownOutcomeError,definitiveHttpStatus} from './outcome'
import type {NativeBlogContext} from './authority'
export async function nativeBlogResponseJson(response:Response,maxBytes=25165824):Promise<Record<string,unknown>>{
 if(Number(response.headers.get('content-length')??0)>maxBytes)throw new NativeBlogDefinitiveError('Provider response exceeds the size limit')
 const reader=response.body?.getReader();if(!reader)throw new NativeBlogDefinitiveError('Provider response had no body')
 let size=0,raw='';const decoder=new TextDecoder()
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maxBytes){await reader.cancel();throw new NativeBlogDefinitiveError('Provider response exceeds the size limit')}raw+=decoder.decode(next.value,{stream:true})}}finally{reader.releaseLock()}
 let body:unknown
 try{body=JSON.parse(raw+decoder.decode())}catch{throw new NativeBlogDefinitiveError('Provider response was not valid JSON')}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new NativeBlogDefinitiveError('Provider response was not a JSON object')
 return body as Record<string,unknown>
}
export function nativeBlogUsage(body:Record<string,unknown>){
 const usage=body.usage as Record<string,unknown>|undefined,cost=usage?.cost
 if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)throw new Error('Actual provider cost is required')
 const token=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
 const inputTokens=token(usage?.prompt_tokens),outputTokens=token(usage?.completion_tokens),total=token(usage?.total_tokens)
 const tokens=total??((inputTokens!==null&&outputTokens!==null)?inputTokens+outputTokens:null)
 return {costUsd:cost,generationId:typeof body.id==='string'?body.id:null,tokens,inputTokens,outputTokens}
}
export async function callNativeBlogAi(input:{context:NativeBlogContext;operationId:string;claimId:string;index:number;settingsDigest:string;choice:KeyChoice;body:Record<string,unknown>;image?:boolean;/** Optional work (the cover): an unknown outcome stays on the call and does not reconcile the whole operation. */optional?:boolean},send:typeof fetch=fetch){
 const endpoint=new URL(OPENROUTER_BASE_URL+'/chat/completions')
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new AdminMenuError(503,'AI provider configuration unavailable')
 const request:Record<string,unknown>={...input.body,usage:{include:true}},model=String(request.model??'')
 await nativeBlogPhase(input.context,true,async(query,current)=>{
  await requireNativeBlogFacts(query,current,input.settingsDigest)
  await prepareNativeBlogCall(query,current,input.operationId,input.claimId,input.index,'ai',request,input.choice,model)
 })
 let status=0
 try{
  const response=await send(endpoint,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${input.choice.apiKey}`,'Content-Type':'application/json','HTTP-Referer':process.env.NEXT_PUBLIC_SITE_URL||'https://xmartmenu.com','X-Title':'XmartMenu'},body:JSON.stringify(request),signal:AbortSignal.timeout(input.image?90000:60000)})
  status=response.status
  if(definitiveHttpStatus(status)){await response.body?.cancel().catch(()=>{});throw new NativeBlogDefinitiveError(`AI provider refused the request (HTTP ${status})`)}
  const body=await nativeBlogResponseJson(response)
  const providerError=body.error as {code?:unknown}|undefined
  if(providerError&&typeof providerError.code==='number'&&definitiveHttpStatus(providerError.code))throw new NativeBlogDefinitiveError(`AI provider refused the request (HTTP ${providerError.code})`)
  if(!response.ok||body.error)throw new Error('AI provider outcome requires review')
  const fact=nativeBlogUsage(body)
  await ownedAdminTransaction(true,query=>recordNativeBlogCall(query,input.operationId,input.claimId,input.index,{bodyDigest:tenantEffectDigest(body),httpStatus:response.status},fact))
  return body
 }catch(error){
  if(error instanceof NativeBlogDefinitiveError){
   // A known refusal: close the call as known so nothing stays 'sending'.
   await ownedAdminTransaction(true,query=>recordNativeBlogCallFailure(query,input.operationId,input.claimId,input.index,{httpStatus:status||null})).catch(()=>{})
   throw error
  }
  if(!input.optional)await ownedAdminTransaction(true,query=>reconcileNativeBlogOperation(query,input.operationId,input.claimId)).catch(()=>{})
  throw new NativeBlogUnknownOutcomeError('AI outcome needs reconciliation; the paid request will not be repeated automatically')
 }
}
