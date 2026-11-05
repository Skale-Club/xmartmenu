import {ownedAuthSelected} from '../../auth/owned-principal'
import {AdminMenuError} from '../../data/admin-menus'
export const nativeBlogSelected=(env:Record<string,string|undefined>=process.env)=>ownedAuthSelected(env)||env.OWNED_BLOG_ENABLED==='true'
export function requireNativeBlogConfiguration(){if(!ownedAuthSelected()||process.env.OWNED_BLOG_ENABLED!=='true')throw new AdminMenuError(503,'Native blog configuration unavailable')}
