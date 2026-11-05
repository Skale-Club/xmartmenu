/** Dependency-free flag logic, safe to import from instrumentation. Native blog
 * needs both flags; any other combination keeps the legacy blog serving, so a
 * half-configured rollout can never turn public pages or the sitemap into 503s. */
type Env=Record<string,string|undefined>
const isTrue=(value:string|undefined)=>value==='true'
export const nativeBlogFlagsReady=(env:Env=process.env)=>isTrue(env.OWNED_BLOG_ENABLED)&&isTrue(env.OWNED_AUTH_ENABLED)
/** Human-readable description of an invalid combination, or null when valid. */
export function nativeBlogFlagProblem(env:Env=process.env):string|null{
 for(const name of ['OWNED_BLOG_ENABLED','OWNED_AUTH_ENABLED'] as const){
  const value=env[name]
  if(value!==undefined&&value!==''&&value!=='true'&&value!=='false')return `${name} must be "true" or "false"; native blog stays OFF and the legacy blog keeps serving.`
 }
 if(isTrue(env.OWNED_BLOG_ENABLED)&&!isTrue(env.OWNED_AUTH_ENABLED))return 'OWNED_BLOG_ENABLED=true requires OWNED_AUTH_ENABLED=true; native blog stays OFF and the legacy blog keeps serving until both are set.'
 return null
}
/** One clear boot-time line; never throws, so public pages are unaffected. */
export function reportNativeBlogFlags(env:Env=process.env,log:(message:string)=>void=message=>console.error(message)){
 const problem=nativeBlogFlagProblem(env)
 if(problem)log('[native-blog] Invalid configuration: '+problem)
 return problem
}
