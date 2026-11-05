import { z } from 'zod'
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'
import { LAUNCH_CHECKLIST_STATUSES } from '../launch-checklist'

const tenant=z.string().min(1).max(200),uuid=z.string().uuid(),text=z.string().max(10000),name=z.string().trim().min(1).max(500)
const position=z.number().int().min(-2147483648).max(2147483647),money=z.number().min(0).max(99999999.99),nullableText=text.nullable()
const role=z.enum(['superadmin','store-admin','store-staff','customer']),cycle=z.enum(['monthly','annual'])
const product={ name,price:money,description:nullableText.optional(),original_price:money.nullable().optional(),category_id:uuid.nullable().optional(),image_url:nullableText.optional(),
  is_available:z.boolean().optional(),is_featured:z.boolean().optional(),show_in_feed:z.boolean().optional(),tags:z.array(z.string().max(100)).max(50).optional(),position:position.optional() }
const location={ name,slug:z.string().min(1).max(200),address:nullableText.optional(),city:nullableText.optional(),phone:nullableText.optional(),business_hours:z.unknown().optional(),menu_id:uuid.nullable().optional(),
  region:nullableText.optional(),postal_code:nullableText.optional(),country:nullableText.optional(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),is_active:z.boolean().optional() }
const plan={ name,description:nullableText.optional(),monthly_price:money,annual_price:money,transaction_fee_pct:z.number().min(0).max(9.9999),features:z.array(z.string().max(100)).max(100).optional(),is_active:z.boolean().optional(),sort_order:position.optional() }
const optional=(fields:Record<string,z.ZodType>)=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.optional()]))
export interface NativeMcpTool { name:string; schema:z.ZodObject<z.ZodRawShape>; write:boolean; destructive:boolean; description:string }
const tool=(name:string,shape:z.ZodRawShape,write=false,description='',destructive=false):NativeMcpTool=>({ name,schema:z.object(shape).strict(),write,destructive,description:description || `${name.replaceAll('_',' ')} with current native administrator authority; tenant references are UUID or slug.` })
export const nativeMcpTools:NativeMcpTool[]=[
  tool('list_tenants',{ search:text.optional(),limit:z.number().int().min(1).max(1000).optional() }),
  tool('get_tenant',{ tenant }),
  tool('create_tenant',{ name,slug:z.string().min(1).max(100),owner_user_id:uuid,plan_id:uuid.optional() },true,'Create a restaurant for an exact independent verified owner account UUID. No email matching, temporary password or provider identity creation.'),
  tool('update_tenant',{ tenant,name:name.optional(),slug:z.string().min(1).max(100).optional(),is_active:z.boolean().optional() },true,'Update restaurant metadata. Use update_subscription for billing/plan changes.'),
  tool('update_tenant_settings',{ tenant,settings:z.record(z.string(),z.unknown()) },true),
  tool('set_chat_addon_override',{ tenant,override:z.boolean().nullable() },true),
  tool('xphere_resync',{ tenant },true,'Record a durable native CRM intention; a delivery outage leaves it pending without replaying a business action.'),
  tool('delete_tenant',{ tenant,confirm:z.boolean() },true,'Delete a restaurant through the reviewed native transaction. Destructive switch and confirm:true are required.',true),
  tool('list_users',{ search:text.optional(),role:role.optional(),limit:z.number().int().min(1).max(1000).optional() }),
  tool('update_user',{ user_id:uuid,role,tenant_id:uuid.nullable().optional() },true,'Change the current local account role/tenant by exact UUID and revoke old access. An explicit role is required.'),
  tool('delete_user',{ user_id:uuid,confirm:z.boolean() },true,'Disable and revoke a native account, preserving business history. Returns disabled:true, deleted:false; no provider user is deleted.',true),
  tool('list_plans',{}),tool('get_plan',{ plan_id:uuid }),
  tool('create_plan',plan,true),tool('update_plan',{ plan_id:uuid,...optional(plan) },true),
  tool('update_subscription',{ tenant,plan_id:uuid.optional(),status:z.enum(['active','trial','past_due','cancelled']).optional(),billing_cycle:cycle.optional(),override_monthly_price:money.nullable().optional(),override_annual_price:money.nullable().optional(),override_transaction_fee_pct:z.number().min(0).max(100).nullable().optional(),override_notes:nullableText.optional() },true,'Use native billing reconciliation and durable provider facts. Stripe-backed plan/cycle changes may prorate; ambiguous effects require reconciliation, never blind retry.'),
  tool('delete_plan',{ plan_id:uuid,confirm:z.boolean() },true,'Delete an unreferenced/unprovisioned plan; billing dependencies require deactivation instead.',true),
  tool('get_platform_settings',{}),tool('update_platform_settings',{ settings:z.record(z.string(),z.unknown()) },true),
  tool('list_menus',{ tenant }),tool('list_categories',{ tenant,menu_id:uuid.optional() }),tool('list_products',{ tenant,menu_id:uuid.optional(),category_id:uuid.optional(),limit:z.number().int().min(1).max(1000).optional() }),
  tool('create_menu',{ tenant,name,language:z.enum(MENU_LANGUAGE_CODES).optional(),supported_languages:z.array(z.string()).max(30).optional(),purpose:z.string().max(100).optional(),description:nullableText.optional() },true),
  tool('update_menu',{ tenant,menu_id:uuid,name:name.optional(),purpose:z.string().max(100).optional(),description:nullableText.optional(),is_active:z.boolean().optional(),is_default:z.boolean().optional(),is_private:z.boolean().optional(),price_multiplier:z.number().positive().optional(),position:position.optional() },true),
  tool('create_category',{ tenant,name,description:nullableText.optional(),position:position.optional(),menu_id:uuid.optional() },true),
  tool('update_category',{ tenant,category_id:uuid,name:name.optional(),description:nullableText.optional(),position:position.optional(),is_active:z.boolean().optional() },true),
  tool('create_product',{ tenant,...product,menu_id:uuid.optional() },true),tool('update_product',{ tenant,product_id:uuid,...optional(product) },true),
  ...(['menu','category','product'] as const).map(kind=>tool(`delete_${kind}`,{ tenant,[`${kind}_id`]:uuid,confirm:z.boolean() },true,`Delete the tenant's ${kind} through its native dependency guards; destructive switch and confirm:true required.`,true)),
  tool('list_locations',{ tenant }),tool('list_delivery_zones',{ tenant }),
  tool('create_location',{ tenant,...location },true),tool('update_location',{ tenant,location_id:uuid,...optional(location) },true),
  tool('create_delivery_zone',{ tenant,name,fee_cents:z.number().int().min(0).max(2147483647).optional(),zipcode_prefixes:z.array(z.string().max(100)).max(1000).optional() },true),
  tool('update_delivery_zone',{ tenant,zone_id:uuid,name:name.optional(),fee_cents:z.number().int().min(0).max(2147483647).optional(),zipcode_prefixes:z.array(z.string().max(100)).max(1000).optional(),is_active:z.boolean().optional() },true),
  tool('delete_location',{ tenant,location_id:uuid,confirm:z.boolean() },true,'Delete a tenant location with dependency and tenant checks; destructive switch and confirm:true required.',true),
  tool('delete_delivery_zone',{ tenant,zone_id:uuid,confirm:z.boolean() },true,'Delete a delivery zone with current entitlement and tenant checks; destructive switch and confirm:true required.',true),
  tool('list_orders',{ tenant,status:z.enum(['awaiting_payment','pending','paid','payment_failed','preparing','ready','out_for_delivery','done','cancelled']).optional(),since_hours:z.number().int().min(1).max(2160).optional(),limit:z.number().int().min(1).max(1000).optional() }),
  tool('get_order',{ order_id:uuid }),tool('list_staff',{ tenant }),
  tool('create_staff',{ tenant,recipient_user_id:uuid },true,'Issue a native one-use invitation to an exact verified account UUID; never creates a provider user or password.'),
  tool('reset_staff_password',{ tenant,staff_id:uuid },true,'Issue a native recovery link for this staff UUID and revoke old access. No password is created or disclosed.'),
  tool('demote_staff',{ tenant,staff_id:uuid,confirm:z.boolean() },true,'Revoke staff membership and sessions; destructive switch and confirm:true required.',true),
  tool('update_branding',{ tenant,primary_color:z.string().max(20),accent_color:z.string().max(20),logo_url:nullableText.optional(),banner_url:nullableText.optional(),instagram:nullableText.optional(),whatsapp:nullableText.optional(),tagline:nullableText.optional(),whatsapp_orders_enabled:z.boolean().optional(),orders_enabled:z.boolean().optional(),direct_orders_enabled:z.boolean().optional() },true),
  tool('update_seo',{ tenant,seo_title:nullableText.optional(),seo_description:nullableText.optional(),seo_keywords:nullableText.optional(),seo_og_image_url:nullableText.optional(),seo_noindex:z.boolean().optional() },true),
  tool('get_launch_checklist',{ tenant:tenant.optional() }),tool('set_launch_checklist_item',{ tenant,itemKey:z.string().min(1).max(100),status:z.enum(LAUNCH_CHECKLIST_STATUSES),note:z.string().max(2000).optional() },true),
  tool('scan_launch_checklist',{ tenant,apply:z.boolean().optional() },true,'Scan only the stored public restaurant URL outside SQL. With apply:true mark verified pending items done, retaining human notes/done/N-A states.'),
]
export function nativeTool(name:string,args:unknown) {
  const definition=nativeMcpTools.find(tool=>tool.name===name)
  if (!definition) throw new Error('Unknown MCP tool')
  return { definition,args:definition.schema.parse(args) as Record<string,unknown> }
}
