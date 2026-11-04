import { ownedAdminTransaction } from './admin-menus-runtime'
import { createPublicChatSession } from './public-chat-session'

export const createOwnedPublicChatSession = (slug: string, phone: unknown) =>
  ownedAdminTransaction(true, query => createPublicChatSession(query, slug, phone))
