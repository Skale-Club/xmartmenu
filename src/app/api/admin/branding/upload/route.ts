import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { validateAndConvertToWebP } from '@/lib/upload'
import { getStorageClient } from '@/lib/storage'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Uploads overwrite the live logo/banner file, so they are owner-only like the branding PATCH.
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })
  if (!['logo', 'banner', 'seo'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file)
  if (conversion.error) return NextResponse.json({ error: conversion.error }, { status: 400 })

  const webpBuffer = conversion.buffer as Buffer
  const filename = `${effective.tenantId}/${type}.webp`

  try {
    const publicUrl = await getStorageClient().upload('tenant-assets', filename, webpBuffer, {
      contentType: 'image/webp',
      upsert: true,
    })
    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    log.error('POST /api/admin/branding/upload', { err: err })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const POST = withApi('POST /api/admin/branding/upload', handlePOST)
