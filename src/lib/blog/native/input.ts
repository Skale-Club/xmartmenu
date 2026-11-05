import {z} from 'zod'
import {AdminMenuError} from '../../data/admin-menus'
export async function nativeEmptyBlogInput(request:Request){
 if(Number(request.headers.get('content-length')??0)>1024)throw new AdminMenuError(413,'Empty blog request exceeds limit')
 const reader=request.body?.getReader();if(!reader)return {}
 let raw='',size=0,timer:ReturnType<typeof setTimeout>|undefined;const decoder=new TextDecoder()
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new AdminMenuError(400,'Blog request timed out'))},5000)})
 try{for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.byteLength;if(size>1024)throw new AdminMenuError(413,'Empty blog request exceeds limit');raw+=decoder.decode(next.value,{stream:true})}raw+=decoder.decode()}
 finally{clearTimeout(timer);reader.releaseLock()}
 if(!raw.trim())return {}
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new AdminMenuError(400,'JSON body required')
 const body:unknown=JSON.parse(raw)
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new AdminMenuError(400,'Blog request body must be empty')
 return {}
}
export const nativeBlogSettingsSchema=z.object({enabled:z.boolean().optional(),postsPerDay:z.number().int().min(0).max(24).optional(),postingHour:z.number().int().min(0).max(23).nullable().optional(),timezone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}}).optional(),seoKeywords:z.string().max(2000).optional(),promptStyle:z.string().max(4000).optional(),systemPrompt:z.string().max(8000).optional(),enableTrendAnalysis:z.boolean().optional(),rssEnabled:z.boolean().optional(),autoPublish:z.boolean().optional(),textModel:z.string().max(200).optional(),imageModel:z.string().max(200).optional(),openrouterApiKey:z.string().max(400).optional()}).strict()
export const nativeBlogDecisionSchema=z.object({postId:z.string().uuid(),action:z.enum(['approve','reject']),reason:z.string().max(1000).optional()}).strict()
export const nativeBlogEditSchema=z.object({postId:z.string().uuid(),title:z.string().trim().min(1).max(300),excerpt:z.string().max(1000).optional(),content:z.string().min(1).max(100000)}).strict()
export const nativeBlogRssSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('add'),name:z.string().trim().min(1).max(200),url:z.string().url().max(2000).refine(value=>/^https?:\/\//i.test(value))}).strict(),
 z.object({action:z.literal('toggle'),id:z.string().uuid(),enabled:z.boolean()}).strict(),
 z.object({action:z.literal('delete'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('fetch')}).strict(),
])
export const nativeBlogTelegramSchema=z.object({enabled:z.boolean().optional(),approvalsEnabled:z.boolean().optional(),botToken:z.string().max(400).optional(),approvalsBotToken:z.string().max(400).optional(),chatIds:z.array(z.string().max(120)).max(20).optional(),approvalsChatIds:z.array(z.string().max(120)).max(20).optional()}).strict()
