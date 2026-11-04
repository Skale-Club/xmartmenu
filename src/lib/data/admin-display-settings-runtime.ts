import { ownedAdminTransaction } from './admin-menus-runtime'
import { mutateAdminDisplaySettings, readAdminDisplaySettings, readAdminMenuDisplayPage, readAdminSeoSettingsPage, type DisplaySettingsView } from './admin-display-settings'
import type { AdminMenuContext } from './admin-menus'

export const readOwnedDisplaySettings = (context: AdminMenuContext, view: DisplaySettingsView) =>
  ownedAdminTransaction(false, query => readAdminDisplaySettings(query, context, view))

export const readOwnedSeoSettingsPage = (context: AdminMenuContext) =>
  ownedAdminTransaction(false, query => readAdminSeoSettingsPage(query, context))

export const readOwnedMenuDisplayPage = (context: AdminMenuContext) =>
  ownedAdminTransaction(false, query => readAdminMenuDisplayPage(query, context))

export const mutateOwnedDisplaySettings = (context: AdminMenuContext, view: DisplaySettingsView, values: Record<string, unknown>) =>
  ownedAdminTransaction(true, query => mutateAdminDisplaySettings(query, context, view, values))
