/**
 * Signs in each seeded user through the real login screen once and saves the
 * session, so specs start already logged in (storageState).
 */
import { expect, test as setup } from '@playwright/test'
import { assertLocalSupabase } from './fixtures/db'
import { PASSWORD, USERS, storageStatePath, type UserKey } from './fixtures/seed'

setup.beforeAll(() => {
  assertLocalSupabase()
})

for (const key of Object.keys(USERS) as UserKey[]) {
  setup(`sign in ${key}`, async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByPlaceholder('you@example.com').fill(USERS[key].email)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByPlaceholder('••••••••').fill(PASSWORD)
    await page.getByRole('button', { name: /^Sign in/ }).click()
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 20_000 })
    await page.context().storageState({ path: storageStatePath(key) })
  })
}
