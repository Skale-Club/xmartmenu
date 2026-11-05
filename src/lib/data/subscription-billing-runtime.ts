import { ownedAdminTransaction } from './admin-menus-runtime'
import { readSubscriptionApi, readSubscriptionPage, readSuperSubscription, type SubscriptionActor } from './subscription-billing'
export const subscriptionTransactions = { run: ownedAdminTransaction }
export const readOwnedSubscriptionPage = (context: SubscriptionActor) => ownedAdminTransaction(false, query => readSubscriptionPage(query, context))
export const readOwnedSubscriptionApi = (context: SubscriptionActor) => ownedAdminTransaction(false, query => readSubscriptionApi(query, context))
export const readOwnedSuperSubscription = (context: SubscriptionActor) => ownedAdminTransaction(false, query => readSuperSubscription(query, context))
