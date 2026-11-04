import { ownedAdminTransaction } from './admin-menus-runtime'
import { claimNativeBilling, finalizeNativeBilling, prepareNativeBilling, refuseNativeBilling } from './ai-billing'
import type { NativeBillingRepository } from '../ai/native-billing'

export const ownedAiBillingRepository: NativeBillingRepository = {
  prepare: (options, context) => ownedAdminTransaction(true, query => prepareNativeBilling(query, options, context)),
  claim: (request, context, now) => ownedAdminTransaction(true, query => claimNativeBilling(query, request, context, now)),
  refuse: (request, token) => ownedAdminTransaction(true, query => refuseNativeBilling(query, request, token)),
  finalize: (request, token, item, options, now) => ownedAdminTransaction(true, query => finalizeNativeBilling(query, request, token, item, options, now)),
}
