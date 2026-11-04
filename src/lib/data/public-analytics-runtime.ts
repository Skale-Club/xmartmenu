import {ownedAdminTransaction} from './admin-menus-runtime'
import {ingestPublicAnalytics} from './public-analytics'

export const ingestOwnedPublicAnalytics=(input:unknown)=>ownedAdminTransaction(true,query=>ingestPublicAnalytics(query,input))
