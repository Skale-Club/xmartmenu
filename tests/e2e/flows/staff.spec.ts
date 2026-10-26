/**
 * Staff and owners: the waiter app, and the admin showing what each plan
 * allows (locks, table links, sidebar).
 */
import { expect, test } from '@playwright/test'
import { db } from '../fixtures/db'
import { TABLES, TENANTS, storageStatePath } from '../fixtures/seed'

test.describe('waiter app (Menu + Orders plan)', () => {
  test.use({ storageState: storageStatePath('waiterStaff') })

  test('a waiter takes an order for a table', async ({ page }) => {
    const startedAt = new Date().toISOString()
    await page.goto(`/${TENANTS.waiter.slug}/waiter`)
    await page.getByRole('button', { name: 'Mesa 1' }).click()
    await expect(page.getByRole('heading', { name: 'Mesa 1' })).toBeVisible()

    await page.getByRole('button', { name: 'Add Classic Burger' }).click()
    await page.getByRole('button', { name: /Send order — Mesa 1/ }).click()

    await expect.poll(async () => {
      const { data } = await db()
        .from('orders')
        .select('table_id, table_name, status')
        .eq('tenant_id', TENANTS.waiter.id)
        .eq('table_id', TABLES.waiterMesa1.id)
        .gte('created_at', startedAt)
        .limit(1)
      return data?.[0] ?? null
    }).toMatchObject({ table_name: 'Mesa 1', status: 'pending' })
  })

  test('the sidebar links to the waiter app', async ({ page }) => {
    await page.goto('/orders')
    await expect(page.getByRole('link', { name: 'Waiter app' })).toHaveAttribute('href', `/${TENANTS.waiter.slug}/waiter`)
  })
})

test.describe('menu-only plan admin', () => {
  test.use({ storageState: storageStatePath('menuOwner') })

  test('guest ordering is locked with the plan that unlocks it', async ({ page }) => {
    // The ordering switches live in Store settings; a plan that lacks guest
    // ordering shows no switch, only the one hint card naming the plan.
    await page.goto('/settings/store')
    await expect(page.getByText(/Available on Menu \+ Payments: .*Guest ordering/)).toBeVisible()
    await expect(page.getByText('Guests order from the menu')).toHaveCount(0)
  })

  test('no waiter app, even with the switch on', async ({ page }) => {
    await page.goto('/orders')
    await expect(page.getByRole('link', { name: 'Waiter app' })).toHaveCount(0)
    await page.goto(`/${TENANTS.menu.slug}/waiter`)
    await expect(page).toHaveURL(new RegExp(`/${TENANTS.menu.slug}$`))
  })
})

test.describe('table links in the admin', () => {
  test.describe('self-service plan', () => {
    test.use({ storageState: storageStatePath('selfOwner') })

    test('each table has a link and a QR code', async ({ page }) => {
      await page.goto('/settings/store')
      await expect(page.getByRole('button', { name: 'Copy the menu link for Mesa 4' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Download the QR code for Mesa 4' })).toBeVisible()
    })
  })

  test.describe('waiter plan', () => {
    test.use({ storageState: storageStatePath('waiterOwner') })

    test('tables exist for the waiter, links need the payments plan', async ({ page }) => {
      await page.goto('/settings/store')
      await expect(page.getByText('Mesa 1')).toBeVisible()
      await expect(page.getByRole('button', { name: /Copy the menu link/ })).toHaveCount(0)
      await expect(page.getByText(/Table links for guests to order/)).toBeVisible()
    })
  })
})

test.describe('superadmin audit trail', () => {
  test.use({ storageState: storageStatePath('superadmin') })

  test('lists changes with restaurant, who and what changed, filterable', async ({ page }) => {
    await page.goto('/audit?days=1')
    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible()
    await expect(page.getByRole('table')).toContainText(TENANTS.self.name)

    await page.getByLabel('What').selectOption('restaurant_tables')
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page).toHaveURL(/table=restaurant_tables/)
    await expect(page.getByRole('table')).toContainText('Mesa 4')
  })
})
