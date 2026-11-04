import { ownedAdminTransaction } from './admin-menus-runtime'
import type { AdminActorContext } from './admin-actor'
import { claimNativeStripeOAuth, completeNativeStripeOAuth, refuseNativeStripeOAuth, disconnectNativeStripe, readNativeStripeAvailability, readNativeStripeConnection, readNativeStripeCurrency, readNativeStripeFeature, readNativeStripeOwnerState, type NativeStripeOAuthAttempt } from './stripe-connect'

export const readOwnedStripeOwnerState = (context: AdminActorContext) => ownedAdminTransaction(false, query => readNativeStripeOwnerState(query, context))
export const claimOwnedStripeOAuth = (context: AdminActorContext, proof: NativeStripeOAuthAttempt) => ownedAdminTransaction(true, query => claimNativeStripeOAuth(query, context, proof))
export const connectOwnedStripe = (context: AdminActorContext, accountId: string, proof: NativeStripeOAuthAttempt) => ownedAdminTransaction(true, query => completeNativeStripeOAuth(query, context, proof, accountId))
export const refuseOwnedStripeOAuth = (context: AdminActorContext, proof: NativeStripeOAuthAttempt, accountId?: string) => ownedAdminTransaction(true, query => refuseNativeStripeOAuth(query, context, proof, accountId))
export const disconnectOwnedStripe = (context: AdminActorContext) => ownedAdminTransaction(true, query => disconnectNativeStripe(query, context))
export const readOwnedStripeConnection = (tenantId: string) => ownedAdminTransaction(false, query => readNativeStripeConnection(query, tenantId))
export const readOwnedStripeAvailability = (tenantId: string) => ownedAdminTransaction(false, query => readNativeStripeAvailability(query, tenantId))
export const readOwnedStripeCurrency = (tenantId: string) => ownedAdminTransaction(false, query => readNativeStripeCurrency(query, tenantId))
export const readOwnedStripeFeature = (tenantId: string) => ownedAdminTransaction(false, query => readNativeStripeFeature(query, tenantId))
