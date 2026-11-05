import { ownedAdminTransaction } from './admin-menus-runtime'
import { authorizeAdminActor } from './admin-actor'
import {
  parsePlatformSettingsPatch, readPlatformSettingsRow, writePlatformSettingsRow,
  type PlatformSettingColumn, type PlatformSettingsRow,
} from './platform-settings'

/** Public, unauthenticated projection (marketing pages, legal text, pending screen). */
export const readOwnedPlatformSettings = (columns: readonly PlatformSettingColumn[] | '*'): Promise<PlatformSettingsRow | null> =>
  ownedAdminTransaction(false, query => readPlatformSettingsRow(query, columns))

/** Whole row for an already-authenticated superadmin; the stored role is re-checked in SQL. */
export const readOwnedPlatformSettingsAsSuperadmin = (actorId: string): Promise<PlatformSettingsRow | null> =>
  ownedAdminTransaction(false, async query => {
    await authorizeAdminActor(query, { actorId, role: 'superadmin' })
    return readPlatformSettingsRow(query, '*')
  })

/** Validates, re-authorizes the superadmin and writes in a single transaction. */
export const writeOwnedPlatformSettings = (actorId: string, body: unknown): Promise<PlatformSettingsRow> =>
  ownedAdminTransaction(true, async query => {
    await authorizeAdminActor(query, { actorId, role: 'superadmin' }, true)
    return writePlatformSettingsRow(query, parsePlatformSettingsPatch(body))
  })
