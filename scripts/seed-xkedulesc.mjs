import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ktogbpqookfcqilqvici.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0b2dicHFvb2tmY3FpbHF2aWNpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUxMTk0OSwiZXhwIjoyMDkxMDg3OTQ5fQ.ScwA2ZzaVJgMgQ8wbgb_-Dl_gknQSEHEDh0TFUNSDKc'

const TENANT_ID = 'b5f74b1e-4d7f-4d17-8ea0-c3a1a42ae808'
const MENU_ID   = '91cb00b5-aa55-4683-939c-b8c2d5826b6f'
const CATS = {
  entradas:       '903dd756-8b6a-40c7-9850-7d1e4720c7f2',
  pratos:         '6750f79f-d8b5-47ea-9de6-78e3b8700bfa',
  sobremesas:     'eef0966e-fc61-4c3b-900d-eeeef71bdfb1',
  bebidas:        '15edfa0f-d100-4610-900b-b40dab1bb4e7',
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function daysAgo(d) {
  const dt = new Date()
  dt.setDate(dt.getDate() - d)
  dt.setHours(randomBetween(10, 22), randomBetween(0, 59), 0, 0)
  return dt.toISOString()
}

async function seed() {
  console.log('Inserting products...')

  const products = [
    // Entradas
    { category_id: CATS.entradas, name: 'Bruschetta Italiana', description: 'Pão italiano grelhado com tomate fresco, manjericão e azeite de oliva extra virgem', price: 28.90, original_price: 35.00, image_url: 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500', is_featured: true,  tags: ['Vegetariano', 'Destaque do chef'], position: 0 },
    { category_id: CATS.entradas, name: 'Carpaccio de Carne',  description: 'Finas fatias de carne bovina com rúcula, parmesão e molho de mostarda',            price: 45.90, original_price: null,  image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500', is_featured: false, tags: ['Destaque do chef'],           position: 1 },
    { category_id: CATS.entradas, name: 'Salada Caesar',       description: 'Alface romana, croutons, parmesão e molho caesar tradicional',                        price: 32.00, original_price: null,  image_url: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=500', is_featured: false, tags: ['Vegetariano', 'Sem Glúten'],   position: 2 },
    { category_id: CATS.entradas, name: 'Bolinho de Bacalhau', description: 'Tradicional bolinho português com bacalhau desfiado e batata (4 unidades)',            price: 38.00, original_price: null,  image_url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500', is_featured: true,  tags: ['Recomendado'],               position: 3 },
    // Pratos Principais
    { category_id: CATS.pratos, name: 'Picanha Premium',              description: 'Picanha maturada 30 dias grelhada na brasa, arroz, farofa e vinagrete',          price: 89.90, original_price: 110.00, image_url: 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=500', is_featured: true,  tags: ['Destaque do chef', 'Recomendado'], position: 0 },
    { category_id: CATS.pratos, name: 'Filé Mignon ao Molho Madeira', description: 'Filé mignon suíno com molho madeira, purê de batata e legumes salteados',        price: 72.00, original_price: null,   image_url: 'https://images.unsplash.com/photo-1558030006-450675393462?w=500', is_featured: false, tags: ['Sem Glúten'],                       position: 1 },
    { category_id: CATS.pratos, name: 'Salmão Grelhado',             description: 'Salmão norueguês grelhado com crosta de ervas, legumes assados e molho de limão', price: 78.00, original_price: null,   image_url: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500', is_featured: true,  tags: ['Sem Glúten', 'Recomendado'],        position: 2 },
    { category_id: CATS.pratos, name: 'Risoto de Funghi Secchi',     description: 'Arroz arbóreo com cogumelos secchi, parmesão e trufa negra',                     price: 58.00, original_price: null,   image_url: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500', is_featured: false, tags: ['Vegetariano'],                      position: 3 },
    { category_id: CATS.pratos, name: 'Hambúrguer Artesanal',        description: 'Pão brioche, blend de 180g, queijo cheddar, bacon crocante e molho especial',     price: 42.00, original_price: null,   image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500', is_featured: false, tags: ['Novidade'],                         position: 4 },
    { category_id: CATS.pratos, name: 'Frango à Parmegiana',         description: 'Peito de frango empanado com molho de tomate e queijo gratinado, arroz e batata',  price: 52.00, original_price: null,   image_url: 'https://images.unsplash.com/photo-1632778149955-e80f8ceca2e8?w=500', is_featured: false, tags: [],                                  position: 5 },
    // Sobremesas
    { category_id: CATS.sobremesas, name: 'Petit Gâteau',                   description: 'Bolo de chocolate com recheio cremoso, sorvete de baunilha e calda de frutas vermelhas', price: 28.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500', is_featured: true,  tags: ['Destaque do chef'],           position: 0 },
    { category_id: CATS.sobremesas, name: 'Tiramisù',                       description: 'Clássica sobremesa italiana com café, mascarpone e cacau',                                 price: 26.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=500', is_featured: false, tags: ['Vegetariano'],               position: 1 },
    { category_id: CATS.sobremesas, name: 'Cheesecake de Frutas Vermelhas', description: 'Cheesecake cremoso com calda de frutas vermelhas frescas',                                 price: 24.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500', is_featured: false, tags: ['Vegetariano', 'Sem Glúten'], position: 2 },
    { category_id: CATS.sobremesas, name: 'Pudim de Leite Condensado',      description: 'Tradicional pudim brasileiro com calda de caramelo',                                       price: 18.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=500', is_featured: false, tags: ['Vegetariano'],               position: 3 },
    // Bebidas
    { category_id: CATS.bebidas, name: 'Suco Natural de Laranja', description: 'Suco de laranja espremido na hora',                        price: 12.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500', is_featured: false, tags: ['Sem Glúten', 'Vegano'], position: 0 },
    { category_id: CATS.bebidas, name: 'Coca-Cola 350ml',          description: 'Refrigerante Coca-Cola lata 350ml',                       price:  8.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=500', is_featured: false, tags: [],                      position: 1 },
    { category_id: CATS.bebidas, name: 'Água Mineral 500ml',       description: 'Água mineral sem gás 500ml',                              price:  6.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=500', is_featured: false, tags: ['Sem Glúten', 'Vegano'], position: 2 },
    { category_id: CATS.bebidas, name: 'Caipiroska de Limão',      description: 'Vodka, limão, açúcar e gelo',                             price: 22.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500', is_featured: true,  tags: [],                      position: 3 },
    { category_id: CATS.bebidas, name: 'Mojito Clássico',          description: 'Rum branco, hortelã, limão, açúcar e água com gás',       price: 24.00, original_price: null, image_url: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=500', is_featured: false, tags: [],                      position: 4 },
  ]

  const rows = products.map(p => ({
    tenant_id:      TENANT_ID,
    menu_id:        MENU_ID,
    category_id:    p.category_id,
    name:           p.name,
    description:    p.description,
    price:          p.price,
    original_price: p.original_price,
    image_url:      p.image_url,
    is_available:   true,
    is_featured:    p.is_featured,
    tags:           p.tags,
    position:       p.position,
  }))

  const { error: prodErr } = await supabase.from('products').insert(rows)
  if (prodErr) { console.error('Products error:', prodErr.message); }
  else console.log(`✅ Inserted ${rows.length} products`)

  // QR Codes
  console.log('\nInserting QR codes...')
  const qrRows = [
    { tenant_id: TENANT_ID, label: 'QR Mesa 1',        target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=1',   scans: 127 },
    { tenant_id: TENANT_ID, label: 'QR Mesa 2',        target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=2',   scans: 89  },
    { tenant_id: TENANT_ID, label: 'QR Mesa 3',        target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=3',   scans: 54  },
    { tenant_id: TENANT_ID, label: 'QR Entrada',       target_url: 'https://xmartmenu.skale.club/r/restaurante-teste',            scans: 342 },
    { tenant_id: TENANT_ID, label: 'QR Cardápio',      target_url: 'https://xmartmenu.skale.club/r/restaurante-teste',            scans: 512 },
    { tenant_id: TENANT_ID, label: 'QR Instagram',     target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?ref=ig',    scans: 78  },
  ]
  const { data: qrInserted, error: qrErr } = await supabase.from('qr_codes').insert(qrRows).select('id, label')
  if (qrErr) { console.error('QR codes error:', qrErr.message) }
  else console.log(`✅ Inserted ${qrInserted.length} QR codes`)

  // Scan events — spread over last 30 days so the calendar has data
  if (qrInserted && qrInserted.length > 0) {
    console.log('\nInserting scan events (calendar data)...')
    const agents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    ]
    const countries = ['BR', 'BR', 'BR', 'US', 'AR', 'PT']

    const scanEvents = []
    // Generate ~200 scan events spread across 30 days
    for (let day = 0; day < 30; day++) {
      const scansThisDay = randomBetween(2, 12)
      for (let i = 0; i < scansThisDay; i++) {
        const qr = qrInserted[randomBetween(0, qrInserted.length - 1)]
        const dt = new Date()
        dt.setDate(dt.getDate() - day)
        dt.setHours(randomBetween(10, 22), randomBetween(0, 59), randomBetween(0, 59), 0)
        scanEvents.push({
          tenant_id:  TENANT_ID,
          qr_code_id: qr.id,
          scanned_at: dt.toISOString(),
          user_agent: agents[randomBetween(0, agents.length - 1)],
          country:    countries[randomBetween(0, countries.length - 1)],
        })
      }
    }

    const { error: scanErr } = await supabase.from('scan_events').insert(scanEvents)
    if (scanErr) console.error('Scan events error:', scanErr.message)
    else console.log(`✅ Inserted ${scanEvents.length} scan events across 30 days`)
  }

  console.log('\n=== Seed concluído! ===')
  console.log(`Conta: xkedulesc@gmail.com`)
  console.log(`Tenant: ${TENANT_ID}`)
  console.log(`Produtos: ${products.length} (4 categorias)`)
  console.log(`QR Codes: ${qrRows.length}`)
  console.log(`Logo: https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400`)
  console.log(`Banner: https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200`)
}

seed().catch(err => { console.error('Fatal:', err); process.exit(1) })
