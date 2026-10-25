import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { validateAndConvertToWebP } from '@/lib/upload'
import { getStorageClient } from '@/lib/storage'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file)
  if (conversion.error) return NextResponse.json({ error: conversion.error }, { status: 400 })

  // After error check, buffer is guaranteed present by the discriminated union
  const webpBuffer = conversion.buffer as Buffer
  const filename = `${effective.tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`

  try {
    const publicUrl = await getStorageClient().upload('product-images', filename, webpBuffer, {
      contentType: 'image/webp',
      upsert: true,
    })
    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    log.error('POST /api/admin/products/upload', { err: err })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const POST = withApi('POST /api/admin/products/upload', handlePOST)
