/**
 * The guest's menu on a phone: what each plan shows, "Complete your order",
 * required choices, and ordering from a table link (QR / NFC).
 */
import { expect, test, type Page } from '@playwright/test'
import { findOrderByCustomer, uniqueName } from '../fixtures/db'
import { TABLES, TENANTS } from '../fixtures/seed'

const upsell = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('#upsell-heading') })

test.describe('menu-only plan', () => {
  test('guests can browse but not order, even with ordering switched on', async ({ page }) => {
    await page.goto(`/${TENANTS.menu.slug}?view=list`)
    await expect(page.getByRole('heading', { name: TENANTS.menu.name })).toBeVisible()
    await expect(page.getByText('Classic Burger').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /View order/ })).toHaveCount(0)
  })
})

test.describe('self-service plan', () => {
  test('a main course opens "Complete your order": drink, then dessert', async ({ page }) => {
    await page.goto(`/${TENANTS.self.slug}?view=list`)
    await page.getByRole('button', { name: 'Add Classic Burger' }).click()

    const sheet = upsell(page)
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Classic Burger added')
    await expect(sheet.getByRole('heading', { name: 'Something to drink?' })).toBeVisible()
    // Featured drinks first.
    await expect(sheet.getByRole('listitem').first()).toContainText('Orange Juice')

    await sheet.getByRole('button', { name: 'Add Cola' }).click()
    await expect(sheet.getByText('In your order')).toBeVisible()
    await sheet.getByRole('button', { name: 'Continue' }).click()

    await expect(sheet.getByRole('heading', { name: 'Room for dessert?' })).toBeVisible()
    await sheet.getByRole('button', { name: 'No, thanks' }).click()
    await expect(sheet).toBeHidden()

    await expect(page.getByRole('button', { name: /View order/ })).toContainText('2')
  })

  test('drinks and desserts do not start the sequence', async ({ page }) => {
    await page.goto(`/${TENANTS.self.slug}?view=list`)
    await page.getByRole('button', { name: 'Add Brownie' }).click()
    await expect(page.getByRole('button', { name: /View order/ })).toContainText('1')
    await expect(upsell(page)).toHaveCount(0)
  })

  test('a dish with a required choice opens its details first', async ({ page }) => {
    await page.goto(`/${TENANTS.self.slug}?view=list`)
    await page.getByRole('button', { name: 'Add Ribeye Steak' }).click()

    const dish = page.getByRole('dialog', { name: 'Ribeye Steak' })
    await expect(dish).toBeVisible()
    await dish.getByText('Large', { exact: true }).click()
    await dish.getByRole('button', { name: /^Add\s*·/ }).click()

    await expect(upsell(page)).toContainText('Ribeye Steak added')
  })

  test('ordering from a table link sends the order to that table', async ({ page }) => {
    const customer = uniqueName('Mesa test')
    await page.goto(`/${TENANTS.self.slug}?view=list&lang=pt&table=${TABLES.selfMesa4.id}`)
    await expect(page.getByText('Sua mesa')).toBeVisible()

    await page.getByRole('button', { name: 'Adicionar Cola' }).click()
    const checkout = page.getByRole('button', { name: 'Finalizar pedido' })
    if (!(await checkout.isVisible())) await page.getByRole('button', { name: /Ver pedido/ }).click()
    await checkout.click()

    const dialog = page.getByRole('dialog').last()
    await expect(dialog).toContainText('Mesa 4')
    await expect(dialog).toContainText('Levamos seu pedido até esta mesa.')
    await dialog.getByLabel('Seu nome').fill(customer)
    await dialog.getByLabel('Telefone').fill('+5511900000004')
    await dialog.getByRole('button', { name: /^Fazer pedido/ }).click()
    await expect(page.getByText('Pedido feito!').first()).toBeVisible()

    await expect.poll(() => findOrderByCustomer(TENANTS.self.id, customer)).toMatchObject({
      order_type: 'dine_in',
      table_id: TABLES.selfMesa4.id,
      table_name: 'Mesa 4',
    })
  })

  test('an unknown table link is ignored', async ({ page }) => {
    await page.goto(`/${TENANTS.self.slug}?view=list&table=${TABLES.waiterMesa1.id}`)
    await expect(page.getByRole('heading', { name: TENANTS.self.name })).toBeVisible()
    await expect(page.getByText('Your table')).toHaveCount(0)
  })
})
