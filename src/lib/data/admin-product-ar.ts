/**
 * Augmented reality: a dish's 3D model (product_ar_models) in the owned
 * database, reached through the product detail operations
 * (POST /api/admin/products/[id]/catalog, entity 'ar').
 *
 *   list    the model, or null
 *   patch   create or update: glb_* (required to create), usdz_*, poster_url,
 *           real_scale, scale (real-size correction, 0.05–20) and
 *           model_width_cm (the file's own size). usdz_* null clears the iOS file.
 *   delete  remove the model (storage objects are kept)
 *
 * The caller (mutateProductDetail) has already checked the role, taken the
 * tenant lock and found the product in this tenant. Until the schema step
 * creates the table, list answers null and writes are refused with a 409; the
 * columns a later step adds (scale, model_width_cm) are read and written only
 * once they exist.
 */
import type { ProductArModel } from '@/types/database'
import { MAX_AR_MODEL_BYTES } from '@/lib/ar/model-file'
import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'

export const AR_MODEL_COLUMNS = 'id product_id tenant_id glb_url glb_storage_path glb_bytes usdz_url usdz_storage_path usdz_bytes poster_url real_scale scale model_width_cm created_at updated_at'
/** Columns added by docs/owned-schema/20261111090000_ar_real_size_and_cart_source.sql. */
const LATER_COLUMNS = ['scale', 'model_width_cm']

const PATCH_FIELDS = ['glb_url', 'glb_storage_path', 'glb_bytes', 'usdz_url', 'usdz_storage_path', 'usdz_bytes', 'poster_url', 'real_scale', 'scale', 'model_width_cm'] as const
export const MIN_MODEL_SCALE = 0.05
export const MAX_MODEL_SCALE = 20
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
  if ('scale' in body) {
    if (typeof body.scale !== 'number' || !Number.isFinite(body.scale) || body.scale < MIN_MODEL_SCALE || body.scale > MAX_MODEL_SCALE) throw bad('Invalid real size')
    patch.scale = body.scale
  }
  if ('model_width_cm' in body) {
    if (body.model_width_cm !== null && (typeof body.model_width_cm !== 'number' || !Number.isFinite(body.model_width_cm)
      || body.model_width_cm <= 0 || body.model_width_cm >= 10000)) throw bad('Invalid model size')
    patch.model_width_cm = body.model_width_cm as number | null
  }
  return patch
}

/** The table's columns, empty when the table does not exist yet. */
async function tableColumns(query: AdminMenuQuery): Promise<Set<string>> {
  const result = await query(`SELECT coalesce(json_agg(column_name), '[]'::json) AS columns FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_ar_models'`)
  const columns = result.rows[0]?.columns
  return new Set(Array.isArray(columns) ? columns.filter((name): name is string => typeof name === 'string') : [])
}

async function readModel(query: AdminMenuQuery, context: AdminMenuContext, productId: string, available: Set<string>, lock = false): Promise<ProductArModel | null> {
  const columns = AR_MODEL_COLUMNS.split(' ').filter(column => available.has(column)).map(column => `a.${column}`).join(',')
  const result = await query(`SELECT to_jsonb((SELECT projected FROM (SELECT ${columns}) projected)) AS row FROM public.product_ar_models a
    WHERE a.tenant_id=$1 AND a.product_id=$2 LIMIT 2${lock ? ' FOR UPDATE' : ''}`, [context.tenantId, productId])
  if (result.rows.length > 1) throw new AdminMenuError(409, 'Ambiguous 3D model')
  return (result.rows[0]?.row as ProductArModel | undefined) ?? null
}

export async function mutateArModel(query: AdminMenuQuery, context: AdminMenuContext, productId: string, action: string, values: unknown): Promise<ProductArModel | null> {
  const available = await tableColumns(query)
  const ready = available.size > 0
  if (action === 'list') return ready ? readModel(query, context, productId, available) : null
  if (!ready) throw new AdminMenuError(409, '3D models are not enabled on this database yet')

  if (action === 'delete') {
    await query('DELETE FROM public.product_ar_models WHERE tenant_id=$1 AND product_id=$2', [context.tenantId, productId])
    return null
  }
  if (action !== 'patch') throw bad()

  const patch = arModelPatch(values, context)
  if (LATER_COLUMNS.some(column => column in patch && !available.has(column))) {
    throw new AdminMenuError(409, 'Real size is not enabled on this database yet')
  }
  const current = await readModel(query, context, productId, available, true)
  const entries = Object.entries(patch)
  if (!current) {
    if (typeof patch.glb_url !== 'string') throw bad('Upload the 3D model (.glb) first')
    await query(`INSERT INTO public.product_ar_models(tenant_id,product_id,${entries.map(([key]) => key).join(',')})
      VALUES($1,$2,${entries.map((_, index) => `$${index + 3}`).join(',')})`, [context.tenantId, productId, ...entries.map(([, value]) => value)])
  } else {
    await query(`UPDATE public.product_ar_models SET ${entries.map(([key], index) => `${key}=$${index + 3}`).join(',')},updated_at=now()
      WHERE tenant_id=$1 AND product_id=$2`, [context.tenantId, productId, ...entries.map(([, value]) => value)])
  }
  return readModel(query, context, productId, available)
}
