import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'

export async function GET() {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to fetch plans:', error)
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
  }

  return NextResponse.json(data || [])
}

export async function POST(request: Request) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createServiceClient()

  let body: {
    name: string
    description?: string | null
    monthly_price: number
    annual_price: number
    transaction_fee_pct: number
    features: string[]
    is_active: boolean
    sort_order: number
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, description, monthly_price, annual_price, transaction_fee_pct, features, is_active, sort_order } = body

  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  if (monthly_price < 0 || annual_price < 0) {
    return NextResponse.json({ error: 'Prices must be non-negative' }, { status: 400 })
  }

  if (annual_price < monthly_price) {
    return NextResponse.json({ error: 'Annual price must be >= monthly price' }, { status: 400 })
  }

  // Generate slug
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { data, error } = await supabase
    .from('plans')
    .insert({
      name: name.trim(),
      slug,
      description: description || null,
      monthly_price,
      annual_price,
      transaction_fee_pct,
      features: features || [],
      is_active: is_active ?? true,
      sort_order: sort_order ?? 0,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create plan:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}