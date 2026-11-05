import { createHash } from 'node:crypto'
import { identityRuntimeConfig } from '../../src/lib/auth/identity-runtime-config'
import { legacyPasswordProofConfig } from '../../src/lib/auth/legacy-password-proof'
import {PILOT_PREFIX,PILOT_ORIGIN} from './xmartmenu-identity-pilot-public'

export {PILOT_PREFIX,PILOT_ORIGIN}
export const PILOT_DATABASE = 'xmartmenu_identity_pilot'
export const PILOT_HOST = 'xmartmenu-identity-pilot-db'
export const PILOT_ROLE = 'xmartmenu_pilot_runtime'
export const PILOT_OWNER = 'xmartmenu_pilot_owner'
export const PILOT_PORT = 8099
export const PILOT_OPERATIONS = new Set(['config','session','challenge','login','link','existing-account-link','logout','revoke-all'])
const fields = ['IDENTITY_ORIGIN','IDENTITY_DATABASE_URL','GOOGLE_AUTH_PROJECT_ID','GOOGLE_AUTH_PROJECT_NUMBER','GOOGLE_AUTH_WEB_API_KEY',
  'GOOGLE_AUTH_ADC_FILE','GOOGLE_AUTH_ADC_AUDIENCE','GOOGLE_AUTH_ADC_SERVICE_ACCOUNT','GOOGLE_AUTH_ADC_SUBJECT','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY']
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value)
export function pilotConfiguration(input:unknown) {
  if (!object(input) || Object.keys(input).some(key=>!['environment','profileAuthorityHash','accountControlHash'].includes(key))
    || !object(input.environment) || Object.keys(input.environment).some(key=>!fields.includes(key))
    || !/^[a-f0-9]{64}$/.test(String(input.profileAuthorityHash)) || !/^[a-f0-9]{64}$/.test(String(input.accountControlHash))) throw new Error('Pilot configuration refused')
  const environment=input.environment
  if (fields.some(key=>typeof environment[key]!=='string')) throw new Error('Pilot configuration refused')
  const env:Record<string,string>={ ...environment as Record<string,string>,NODE_ENV:'production',GOOGLE_AUTH_ENABLED:'true',
    PROD_DATABASE_HOST:PILOT_HOST,PROD_DATABASE_NAME:PILOT_DATABASE,IDENTITY_DATABASE_SSL:'disable' }
  const target=new URL(env.IDENTITY_DATABASE_URL)
  if (target.hostname!==PILOT_HOST || decodeURIComponent(target.username)!==PILOT_ROLE || target.port!=='5432'
    || target.pathname!==`/${PILOT_DATABASE}` || !target.password || target.search || target.hash) throw new Error('Isolated pilot database required')
  const config=identityRuntimeConfig(env)
  if (config.origin!==PILOT_ORIGIN || config.web.projectId!=='skaleclub' || config.projectNumber!=='937861185231') throw new Error('Pilot identity project refused')
  legacyPasswordProofConfig(env) // Fixed source project and public key only, before constructing a reader.
  return {env,config,profileAuthorityHash:String(input.profileAuthorityHash),accountControlHash:String(input.accountControlHash)}
}
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export const PILOT_ADMISSION_SQL = `SELECT current_database() AS database,current_user AS role,
  (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')) AS tables,
  (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,
  (SELECT count(*)::int FROM public.app_accounts) AS accounts,
  (SELECT count(*)::int FROM public.app_accounts WHERE disabled_at IS NOT NULL) AS disabled,
  (SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p.id),''),'UTF8')),'hex') FROM public.profiles p) AS profiles_hash,
  (SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY a.id),''),'UTF8')),'hex') FROM public.app_accounts a) AS accounts_hash,
  (SELECT count(*)::int FROM public.app_identity_bindings b LEFT JOIN public.app_accounts a ON a.id=b.user_id WHERE a.id IS NULL OR b.project_id<>'skaleclub') AS invalid_bindings,
  (SELECT count(*)::int FROM public.app_sessions s LEFT JOIN public.app_accounts a ON a.id=s.user_id WHERE a.id IS NULL OR s.project_id<>'skaleclub') AS invalid_sessions,
  (SELECT rolconnlimit=2 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS restricted_role`
export function assertPilotAdmission(row:Record<string,unknown>,expected:{profileAuthorityHash:string;accountControlHash:string}) {
  if (row.database!==PILOT_DATABASE || row.role!==PILOT_ROLE || row.owner!==PILOT_OWNER || row.tables!==51 || row.ledger!==95
    || row.accounts!==7 || row.disabled!==1 || row.profiles_hash!==expected.profileAuthorityHash || row.accounts_hash!==expected.accountControlHash
    || row.invalid_bindings!==0 || row.invalid_sessions!==0 || row.restricted_role!==true) throw new Error('Isolated pilot admission refused')
}
