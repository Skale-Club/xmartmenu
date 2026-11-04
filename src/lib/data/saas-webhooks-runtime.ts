import { ownedAdminTransaction } from './admin-menus-runtime'
import { applySaasWebhook, type SaasWebhookEvent } from './saas-webhooks'

export const processOwnedSaasWebhook = (event: SaasWebhookEvent) => ownedAdminTransaction(true, query => applySaasWebhook(query, event))
