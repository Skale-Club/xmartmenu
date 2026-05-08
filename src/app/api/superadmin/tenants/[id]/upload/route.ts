import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { validateAndConvertToWebP } from '@/lib/upload'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Arquivo ou tipo inválido' }, { status: 400 })

  const conversion = await validateAndConvertToWebP(file)
  if (conversion.error) return NextResponse.json({ error: conversion.error }, { status: 400 })

  const bucket = 'tenant-assets'
  const filename = `${id}/${type}.webp`
  const blob = new Blob([conversion.buffer], { type: 'image/webp' })

  const service = await createServiceClient()
  const { data, error } = await service.storage
    .from(bucket)
    .upload(filename, blob, { upsert: true, contentType: 'image/webp' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(data.path)
  return NextResponse.json({ url: publicUrl })
}
