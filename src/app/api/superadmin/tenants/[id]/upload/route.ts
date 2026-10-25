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
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Invalid file or type' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file)
  if (conversion.error) return NextResponse.json({ error: conversion.error }, { status: 400 })

  // After error check, buffer is guaranteed present by the discriminated union
  const webpBuffer = conversion.buffer as Buffer
  const filename = `${id}/${type}.webp`

  try {
    const publicUrl = await getStorageClient().upload('tenant-assets', filename, webpBuffer, {
      contentType: 'image/webp',
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
