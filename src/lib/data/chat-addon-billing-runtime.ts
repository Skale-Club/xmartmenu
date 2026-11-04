import { ownedAdminTransaction } from './admin-menus-runtime'
import type { AdminActorContext } from './admin-actor'
import { readChatAddonBilling, writeChatAddonOverride } from './chat-addon-billing'

export const readOwnedChatAddonBilling = (context: AdminActorContext, checkout: boolean) => ownedAdminTransaction(false, query => readChatAddonBilling(query, context, checkout))
export const writeOwnedChatAddonOverride = (context: AdminActorContext, override: unknown) => ownedAdminTransaction(true, query => writeChatAddonOverride(query, context, override))
