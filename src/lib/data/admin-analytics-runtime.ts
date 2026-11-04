import { ownedAdminTransaction } from './admin-menus-runtime'
import type { AdminMenuContext } from './admin-menus'
import { readAdminAnalytics, type AnalyticsWindow } from './admin-analytics'

export const readOwnedAdminAnalytics = (context: AdminMenuContext,window: AnalyticsWindow) =>
  ownedAdminTransaction(false,query=>readAdminAnalytics(query,context,window))
