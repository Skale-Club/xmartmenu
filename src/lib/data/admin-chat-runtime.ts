import { ownedAdminTransaction } from './admin-menus-runtime'
import { readPublicChatAddon } from './public-chat-session'
import { blockAdminChatPhone, readAdminChatBlocked, readAdminChatConversations, readAdminChatSettings, readAdminChatThread, unblockAdminChatPhone, writeAdminChatNote, writeAdminChatSettings, type AdminChatContext } from './admin-chat'

export const readOwnedChatAddonStatus = (tenantId: string) => ownedAdminTransaction(false, async query => (await readPublicChatAddon(query, tenantId)).status)
export const readOwnedAdminChatSettings = (context: AdminChatContext) => ownedAdminTransaction(false, query => readAdminChatSettings(query, context))
export const writeOwnedAdminChatSettings = (context: AdminChatContext, input: unknown) => ownedAdminTransaction(true, query => writeAdminChatSettings(query, context, input))
export const readOwnedAdminChatConversations = (context: AdminChatContext, search: URLSearchParams) => ownedAdminTransaction(false, query => readAdminChatConversations(query, context, search))
export const readOwnedAdminChatThread = (context: AdminChatContext, conversationId: string) => ownedAdminTransaction(false, query => readAdminChatThread(query, context, conversationId))
export const writeOwnedAdminChatNote = (context: AdminChatContext, conversationId: string, input: unknown) => ownedAdminTransaction(true, query => writeAdminChatNote(query, context, conversationId, input))
export const readOwnedAdminChatBlocked = (context: AdminChatContext) => ownedAdminTransaction(false, query => readAdminChatBlocked(query, context))
export const blockOwnedAdminChatPhone = (context: AdminChatContext, conversationId: string, input: unknown) => ownedAdminTransaction(true, query => blockAdminChatPhone(query, context, conversationId, input))
export const unblockOwnedAdminChatPhone = (context: AdminChatContext, blockedId: string) => ownedAdminTransaction(true, query => unblockAdminChatPhone(query, context, blockedId))
