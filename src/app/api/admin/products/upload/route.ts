import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { validateAndConvertToWebP } from '@/lib/upload'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) return NextResponse.json({ error: 'Arquivo inválido' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file)
  if (conversion.error) return NextResponse.json({ error: conversion.error }, { status: 400 })

  const filename = `${effective.tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
  const blob = new Blob([conversion.buffer], { type: 'image/webp' })

  const service = await createServiceClient()
  const { data, error } = await service.storage
    .from('product-images')
    .upload(filename, blob, { upsert: true, contentType: 'image/webp' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = service.storage.from('product-images').getPublicUrl(data.path)
  return NextResponse.json({ url: publicUrl })
}
