import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { validateAndConvertToWebP } from '@/lib/upload'
import { getStorageClient } from '@/lib/storage'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })
  if (!['logo', 'banner'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

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
    console.error('POST /api/admin/branding/upload:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
