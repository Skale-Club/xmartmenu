import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function updateAppName() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: currentData, error: fetchError } = await supabase
    .from('platform_settings')
    .select('*')

  if (fetchError) {
    console.error('Error fetching platform_settings:', fetchError)
    return
  }

  console.log('Current platform_settings:', currentData)

  if (!currentData || currentData.length === 0) {
    console.log('Table is empty. Inserting new row...')
    const { data: insertedData, error: insertError } = await supabase
      .from('platform_settings')
      .insert({ app_name: 'XmartMenu' })
      .select()
    
    if (insertError) {
      console.error('Error inserting app_name:', insertError)
    } else {
      console.log('Successfully inserted app_name:', insertedData)
    }
    return
  }

  const { data: updatedData, error: updateError } = await supabase
    .from('platform_settings')
    .update({ 
      app_name: 'XmartMenu',
      brand_name: 'XmartMenu',
      menu_footer_brand: 'XmartMenu'
    })
    .or('app_name.neq.XmartMenu,brand_name.neq.XmartMenu,menu_footer_brand.neq.XmartMenu')
    .select()

  if (updateError) {
    console.error('Error updating app_name:', updateError)
  } else {
    console.log('Successfully updated app_name:', updatedData)
  }
}

updateAppName()
