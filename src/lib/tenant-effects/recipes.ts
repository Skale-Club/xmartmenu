import { generateObject } from 'ai'
import { openRouterModel,textModelId,visionModelId } from '../ai/openrouter'
import { MenuSeedSchema,CopySeedSchema,SingleCategorySeedSchema,SingleProductSeedSchema,OcrMenuSchema } from '../ai/schemas'
import { sanitizeForPrompt } from '../ai/sanitize'
import { AdminMenuError } from '../data/admin-menus'
import type { NativeCatalogSnapshot,NativeSeedCategory } from '../data/tenant-effect-catalog'

export async function generateNativeSeed(snapshot:NativeCatalogSnapshot,input:Record<string,unknown>,apiKey:string,fetchImpl:typeof fetch) {
  const type=String(input.type),business=sanitizeForPrompt(String(input.businessType??''))||'restaurant',company=sanitizeForPrompt(String(input.companyName??''))||String(snapshot.tenant.name)
  const locales=Array.isArray(snapshot.menu.supported_languages)?snapshot.menu.supported_languages.filter(item=>typeof item==='string'&&item!=='en'):[]
  const languages=locales.length?` Also provide translations for ${locales.join(', ')} in the translations object with locale keys.`:''
  const model=openRouterModel(apiKey,textModelId(),fetchImpl),base={model,maxRetries:0,abortSignal:AbortSignal.timeout(60000)}
  if(type==='copy'){
    const {object}=await generateObject({...base,schema:CopySeedSchema,prompt:`Generate a short tagline (max 10 words) and a brief about-us paragraph (2-3 sentences) for a ${business} named """${company}""". Tone: warm, inviting, professional. Return ONLY valid JSON.`})
    return {copy:object,categories:[]}
  }
  if(type==='single_category'){
    const {object}=await generateObject({...base,schema:SingleCategorySeedSchema,prompt:`Generate one new menu category for a ${business} named """${company}""" that does not already exist. Existing categories: ${snapshot.categories.map(row=>sanitizeForPrompt(String(row.name))).join(', ')||'none'}. Return one category with name and description.${languages}`})
    return {categories:[{...object,products:[]}]}
  }
  if(type==='single_product'){
    const category=snapshot.categories.find(row=>row.id===input.categoryId)
    if(!category)throw new AdminMenuError(404,'Category not found for this menu')
    const {object}=await generateObject({...base,schema:SingleProductSeedSchema,prompt:`Generate one new menu item for the "${sanitizeForPrompt(String(category.name))}" category of a ${business} named """${company}""". Existing items: ${snapshot.products.filter(row=>row.category_id===category.id).map(row=>sanitizeForPrompt(String(row.name))).join(', ')||'none'}. Include a realistic name, description, and numeric price without currency.${languages}`})
    return {categories:[{name:String(category.name),products:[object]}]}
  }
  if(type==='products'&&!snapshot.categories.length)throw new AdminMenuError(400,'No categories found; seed categories first')
  const prompt=type==='products'?`Generate 3-5 menu items for each category of a ${business} named """${company}""": ${snapshot.categories.map(row=>sanitizeForPrompt(String(row.name))).join(', ')}. Use these exact category names. Include names, descriptions and numeric prices.`
    :type==='menu'?`Generate a realistic menu with 4-6 categories for a ${business} named """${company}""". Each category should contain 3-5 representative items with names, descriptions and numeric prices without currency symbols.`
    :`Generate 4-6 menu categories for a ${business} named """${company}""". Categories should be typical for this establishment. Include empty products arrays.`
  const {object}=await generateObject({...base,schema:MenuSeedSchema,prompt:prompt+languages+' Return ONLY valid JSON matching the schema.'})
  return {categories:object.categories as NativeSeedCategory[]}
}
export async function generateNativeOcr(bytes:Buffer,apiKey:string,fetchImpl:typeof fetch) {
  const {object}=await generateObject({model:openRouterModel(apiKey,visionModelId(),fetchImpl),schema:OcrMenuSchema,maxRetries:0,abortSignal:AbortSignal.timeout(60000),
    messages:[{role:'user',content:[{type:'image',image:new URL(`data:image/webp;base64,${bytes.toString('base64')}`),mediaType:'image/webp'},{type:'text',text:'Extract every category and menu item visible in this menu photo. Transcribe only visible names, descriptions and prices. Do not invent descriptions: use null when absent. Use price 0 when unreadable; do not omit the item. Return JSON matching the schema.'}]}]})
  return object.categories as NativeSeedCategory[]
}
