import { ownedAdminTransaction } from './admin-menus-runtime'
import { readPublicChatAudio, readPublicChatTurn, savePublicChatTurn } from './public-chat-turns'

export const readOwnedPublicChatTurn = (slug: string, conversationId: string, menuId?: string | null) =>
  ownedAdminTransaction(false, query => readPublicChatTurn(query, slug, conversationId, menuId))
export const readOwnedPublicChatAudio = (slug: string, conversationId: string) =>
  ownedAdminTransaction(false, query => readPublicChatAudio(query, slug, conversationId))
export const saveOwnedPublicChatTurn = (input: Parameters<typeof savePublicChatTurn>[1]) =>
  ownedAdminTransaction(true, query => savePublicChatTurn(query, input))
