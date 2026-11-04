import { ownedAdminTransaction } from './admin-menus-runtime'
import { applySaasWebhook, ignoreConnectedSaasEvent, type SaasWebhookEvent, type SaasWebhookResult } from './saas-webhooks'
import { nativeInvoiceTarget } from './ai-billing'
import { billOwnedAiUsage } from '../ai/native-billing'

export async function processOwnedSaasWebhook(event: SaasWebhookEvent): Promise<SaasWebhookResult> {
  if (ignoreConnectedSaasEvent(event)) return { received: true }
  const prepared = await ownedAdminTransaction(true, async query => {
    const target = await nativeInvoiceTarget(query, event)
    return target ? { target } : { outcome: await applySaasWebhook(query, event) }
  })
  if (prepared.outcome) return prepared.outcome
  if (!prepared.target) throw new Error('Invoice target is unavailable')
  const outcome = await billOwnedAiUsage(prepared.target)
  return outcome.skipped ? { received: true as const, skipped: true as const } : { received: true as const }
}
