import {AdminMenuError} from '../../data/admin-menus'
import {nativeBlogFlagsReady} from './flags'
export {legacyBlogWritesBlocked,LEGACY_BLOG_WRITES_MESSAGE} from './flags'
/** Native blog is selected only when OWNED_BLOG_ENABLED and OWNED_AUTH_ENABLED
 * are both on. Auth alone no longer redirects the blog: that made every blog
 * page and the whole sitemap answer 503 when only the auth flag was enabled. */
export const nativeBlogSelected=(env:Record<string,string|undefined>=process.env)=>nativeBlogFlagsReady(env)
export function requireNativeBlogConfiguration(){if(!nativeBlogFlagsReady())throw new AdminMenuError(503,'Native blog configuration unavailable')}
