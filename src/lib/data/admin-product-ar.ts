/**
 * Augmented reality: a dish's 3D model (product_ar_models) in the owned
 * database, reached through the product detail operations
 * (POST /api/admin/products/[id]/catalog, entity 'ar').
 *
 *   list    the model, or null
 *   patch   create or update: glb_* (required to create), usdz_*, poster_url,
 *           real_scale. usdz_* null clears the hand-made iOS file.
 *   delete  remove the model (storage objects are kept)
 *
 * The caller (mutateProductDetail) has already checked the role, taken the
 * tenant lock and found the product in this tenant. Until the schema step
 * creates the table, list answers null and writes are refused with a 409.
 */
import type { ProductArModel } from '@/types/database'
import { MAX_AR_MODEL_BYTES } from '@/lib/ar/model-file'
import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

export const AR_MODEL_COLUMNS = 'id product_id tenant_id glb_url glb_storage_path glb_bytes usdz_url usdz_storage_path usdz_bytes poster_url real_scale created_at updated_at'

const PATCH_FIELDS = ['glb_url', 'glb_storage_path', 'glb_bytes', 'usdz_url', 'usdz_storage_path', 'usdz_bytes', 'poster_url', 'real_scale'] as const
type ArPatch = Partial<Record<(typeof PATCH_FIELDS)[number], string | number | boolean | null>>

const bad = (message = 'Invalid 3D model') => new AdminMenuError(400, message)

function url(value: unknown, nullable: boolean): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || value.length > 2048) throw bad('Invalid 3D model URL')
  try {
    const target = new URL(value)
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw bad('Invalid 3D model URL')
  } catch { throw bad('Invalid 3D model URL') }
  return value
}

function storagePath(value: unknown, context: AdminMenuContext): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(`${context.tenantId}/ar/`)
    || value.includes('\0') || value.split('/').includes('..')) throw bad('Invalid 3D model path')
  return value
}

function bytes(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_AR_MODEL_BYTES) throw bad('Invalid 3D model size')
  return value
}

/** Validates a patch body; only known fields, each checked for its kind. */
export function arModelPatch(value: unknown, context: AdminMenuContext): ArPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad()
  const body = value as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length === 0 || keys.some(key => !(PATCH_FIELDS as readonly string[]).includes(key))) throw bad()
  const patch: ArPatch = {}
  if ('glb_url' in body) patch.glb_url = url(body.glb_url, false)
  if ('usdz_url' in body) patch.usdz_url = url(body.usdz_url, true)
  if ('poster_url' in body) patch.poster_url = url(body.poster_url, true)
  if ('glb_storage_path' in body) patch.glb_storage_path = storagePath(body.glb_storage_path, context)
  if ('usdz_storage_path' in body) patch.usdz_storage_path = storagePath(body.usdz_storage_path, context)
  if ('glb_bytes' in body) patch.glb_bytes = bytes(body.glb_bytes)
  if ('usdz_bytes' in body) patch.usdz_bytes = bytes(body.usdz_bytes)
  if ('real_scale' in body) {
    if (typeof body.real_scale !== 'boolean') throw bad()
    patch.real_scale = body.real_scale
  }
  return patch
}

async function tableReady(query: AdminMenuQuery): Promise<boolean> {
  const result = await query("SELECT to_regclass('public.product_ar_models') IS NOT NULL AS present")
  return result.rows[0]?.present === true
}

async function readModel(query: AdminMenuQuery, context: AdminMenuContext, productId: string, lock = false): Promise<ProductArModel | null> {
  const columns = AR_MODEL_COLUMNS.split(' ').map(column => `a.${column}`).join(',')
  const result = await query(`SELECT to_jsonb((SELECT projected FROM (SELECT ${columns}) projected)) AS row FROM public.product_ar_models a
    WHERE a.tenant_id=$1 AND a.product_id=$2 LIMIT 2${lock ? ' FOR UPDATE' : ''}`, [context.tenantId, productId])
  if (result.rows.length > 1) throw new AdminMenuError(409, 'Ambiguous 3D model')
  return (result.rows[0]?.row as ProductArModel | undefined) ?? null
}

export async function mutateArModel(query: AdminMenuQuery, context: AdminMenuContext, productId: string, action: string, values: unknown): Promise<ProductArModel | null> {
  const ready = await tableReady(query)
  if (action === 'list') return ready ? readModel(query, context, productId) : null
  if (!ready) throw new AdminMenuError(409, '3D models are not enabled on this database yet')

  if (action === 'delete') {
    await query('DELETE FROM public.product_ar_models WHERE tenant_id=$1 AND product_id=$2', [context.tenantId, productId])
    return null
  }
  if (action !== 'patch') throw bad()

  const patch = arModelPatch(values, context)
  const current = await readModel(query, context, productId, true)
  const entries = Object.entries(patch)
  if (!current) {
    if (typeof patch.glb_url !== 'string') throw bad('Upload the 3D model (.glb) first')
    await query(`INSERT INTO public.product_ar_models(tenant_id,product_id,${entries.map(([key]) => key).join(',')})
      VALUES($1,$2,${entries.map((_, index) => `$${index + 3}`).join(',')})`, [context.tenantId, productId, ...entries.map(([, value]) => value)])
  } else {
    await query(`UPDATE public.product_ar_models SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(',')},updated_at=now()
      WHERE tenant_id=$1 AND product_id=$2`, [context.tenantId, productId, ...entries.map(([, value]) => value)])
  }
  return readModel(query, context, productId)
}
