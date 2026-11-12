import { nativeTenantEffectHttp } from '@/lib/tenant-effects/http'
import { tenantEffectsSelected } from '@/lib/data/tenant-effect-authority-runtime'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { tenantAdministrationSelected } from '@/lib/data/tenant-administration'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { validateAndConvertToWebP } from '@/lib/upload'
import { getStorageClient } from '@/lib/storage'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (ownedAuthSelected() || tenantAdministrationSelected() || tenantEffectsSelected()) return nativeTenantEffectHttp('upload',request,(await params).id)
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Invalid file or type' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file, { profile: type === 'logo' || type === 'favicon' ? 'logo' : 'wide' })
  if (conversion.error !== undefined) return NextResponse.json({ error: conversion.error }, { status: 400 })

  // After error check, buffer is guaranteed present by the discriminated union
  const webpBuffer = conversion.buffer as Buffer
  const filename = `${id}/${type}.${conversion.extension ?? 'webp'}`

  try {
    const publicUrl = await getStorageClient().upload('tenant-assets', filename, webpBuffer, {
      contentType: conversion.contentType ?? 'image/webp',
      upsert: true,
    })
    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    log.error('POST /api/superadmin/tenants/[id]/upload', { err: err })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const POST = withApi('POST /api/superadmin/tenants/[id]/upload', handlePOST)
