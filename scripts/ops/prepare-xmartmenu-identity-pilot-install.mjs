// Pure renderer for the root coordinator. No shell, Docker, network or filesystem calls.
import {sha256} from './xmartmenu-source-protocol.mjs'
export const APP_IMAGE='sha256:8a3a78e14940bb671ecb5031cd0410e563eb03ea2c4ff4dc3732f7b97a905dd3'
export const PG_IMAGE='sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
export const PILOT_DB='xmartmenu_identity_pilot',PG_CONTAINER='xmartmenu-identity-pilot-db',APP_CONTAINER='xmartmenu-identity-pilot-app'
export function pilotCleanupTimer({nonce,operatorSha256,receiptSha256}){
  if(!/^[a-f0-9]{16}$/.test(nonce)||![operatorSha256,receiptSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))throw Error('Pilot cleanup timer refused')
  return['/usr/bin/systemd-run',`--unit=xmartmenu-identity-pilot-cleanup-${nonce}`,'--on-active=120m','--timer-property=AccuracySec=1s',
    '--property=Type=oneshot','--property=TimeoutStartSec=40s','--property=MemoryMax=48M','--property=TasksMax=16','--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes','--property=ProtectSystem=strict','--property=ProtectHome=yes',
    '/usr/bin/python3','-I',`/opt/xmartmenu/identity-pilot/${nonce}/cleanup.py`,'--cleanup-reviewed','--nonce',nonce,
    '--expected-operator-sha256',operatorSha256,'--expected-receipt-sha256',receiptSha256]
}
export function pilotInstallPlan(input){
  if(!input||Object.keys(input).sort().join('|')!=='appImage|manifestSha256|nonce'||input.appImage!==APP_IMAGE
    ||!/^[a-f0-9]{64}$/.test(input.manifestSha256)||!/^[a-f0-9]{16}$/.test(input.nonce))throw Error('Pilot install plan refused')
  const {nonce}=input,root=`/opt/xmartmenu/identity-pilot/${nonce}`,network=`xmartmenu-identity-pilot-${nonce}`,volume=`xmartmenu-identity-pilot-pg-${nonce}`
  const router=`xmartmenu-identity-pilot-${nonce}`,label=['--label',`io.xmartmenu.isolated-pilot=${nonce}`]
  const pgCreate=['create','--name',PG_CONTAINER,...label,'--network','none','--memory','512m','--memory-swap','512m','--cpus','0.5','--pids-limit','64',
    '--mount',`type=volume,src=${volume},dst=/var/lib/postgresql/data`,
    '--mount',`type=bind,src=${root}/cluster-password,dst=/run/secrets/pilot-cluster-password,readonly`,
    '--tmpfs','/tmp:rw,nosuid,nodev,size=536870912,mode=1777','--env','POSTGRES_PASSWORD_FILE=/run/secrets/pilot-cluster-password',
    '--env','POSTGRES_DB=postgres','--health-cmd','pg_isready -U postgres -d postgres','--health-interval','2s','--health-timeout','2s','--health-retries','15','--health-start-period','10s',
    PG_IMAGE,'postgres','-c','max_connections=10','-c','shared_buffers=32MB','-c','work_mem=2MB','-c','password_encryption=scram-sha-256']
  const appCreate=['create','--name',APP_CONTAINER,...label,'--network',network,'--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--memory','128m','--memory-swap','128m','--cpus','0.25','--pids-limit','64','--tmpfs','/tmp:rw,nosuid,nodev,size=16777216,mode=1777',
    '--mount',`type=bind,src=${root}/bundle,dst=/app/pilot,readonly`,
    '--mount',`type=bind,src=${root}/config.json,dst=/run/secrets/xmartmenu-identity-pilot-config,readonly`,
    '--mount','type=bind,src=/opt/xmartmenu/google-identity-runtime,dst=/run/secrets/xmartmenu-google-identity,readonly',
    '--label','traefik.enable=true','--label','traefik.docker.network=coolify',
    '--label',`traefik.http.routers.${router}.rule=Host(\`xmartmenu.skale.club\`) && PathPrefix(\`/__xmartmenu_identity_pilot/\`)`,
    '--label',`traefik.http.routers.${router}.entrypoints=https`,'--label',`traefik.http.routers.${router}.tls=true`,
    '--label',`traefik.http.routers.${router}.priority=1000000`,'--label',`traefik.http.routers.${router}.service=${router}`,
    '--label',`traefik.http.services.${router}.loadbalancer.server.port=8099`,
    '--health-cmd',"node -e \"fetch('http://127.0.0.1:8099/__xmartmenu_identity_pilot/health',{headers:{host:'xmartmenu.skale.club'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
    '--health-interval','10s','--health-timeout','5s','--health-retries','3','--health-start-period','15s',
    '--entrypoint','/bin/sh','--workdir','/app',input.appImage,'/app/pilot/launcher.sh',input.manifestSha256]
  const commands={volume:['volume','create',...label,volume],network:['network','create','--internal',...label,network],pgCreate,
    pgStart:['start',PG_CONTAINER],pgAttach:['network','connect','--alias',PG_CONTAINER,network,PG_CONTAINER],
    restore:['exec','-i','--user','postgres',PG_CONTAINER,'pg_restore','-w','--exit-on-error','--single-transaction','--no-owner','--no-acl','--role=xmartmenu_pilot_owner','-U','postgres','-d',PILOT_DB],
    appCreate,appProxyNetwork:['network','connect','coolify',APP_CONTAINER],appStart:['start',APP_CONTAINER]}
  // Commands remain arrays. A caller must never join them into shell text.
  return{host:'188.245.112.3',hostname:'skaleclub-server',root,network,volume,pg:PG_CONTAINER,app:APP_CONTAINER,commands,
    capacity:{minimumAvailableMiB:2048,pgMemoryMiB:512,appMemoryMiB:128,pgCpu:.5,appCpu:.25,pgMaxConnections:10},
    preconditions:['fresh current capacity/PSI/CPU/no counter increases','exact cached image IDs; never pull','no existing container/volume/network names or router',
      'root700 stage; regular single-link root400 archive/key; config uid1000/gid1000 mode0400; Google mount exact admitted existing source',
      'authenticate archive before any restore byte; compare51/95/7/47 after restore before network attach',
      'private Docker network exact membership PG+miniapp only; no host-published ports','root confirms existing proxy https entrypoint and Google source mount',
      'source49 independent unchanged OID/roles/manifest proof','fixed public launcher redirects RO config to stdin with EOF; no private shell/env/URL/argv value',
      'independent same-host cleanup timer installed before either new container starts'],
    rollback:'Stop/remove only exact newly receipted container IDs, then network; retain volume and encrypted recovery until reviewed. Never delete by prefix or force a database.'}
}
/** Private SQL result only. Never print this return value: it contains a verifier. */
export function pilotBootstrapSql(verifier){
  if(typeof verifier!=='string'||!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(verifier))throw Error('Pilot verifier refused')
  const cluster=`BEGIN;
DO $pilot$ BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres'
 OR EXISTS(SELECT FROM pg_database WHERE datname NOT IN('postgres','template0','template1'))
 OR EXISTS(SELECT FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ESCAPE '\\' AND rolname<>'postgres') THEN RAISE EXCEPTION 'Fresh isolated cluster required'; END IF;
END $pilot$;
CREATE ROLE xmartmenu_pilot_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE xmartmenu_pilot_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '${verifier}';
CREATE ROLE authenticated NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN NOBYPASSRLS;
CREATE ROLE xmartmenu_runtime NOLOGIN NOBYPASSRLS; CREATE ROLE xmartmenu_staging_reader NOLOGIN NOBYPASSRLS;
COMMIT;`
  const create=`CREATE DATABASE ${PILOT_DB} OWNER xmartmenu_pilot_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';`
  const prepare=`DO $pilot$ BEGIN IF current_database()<>'${PILOT_DB}' OR EXISTS(SELECT FROM pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'Empty isolated pilot required'; END IF; END $pilot$; DROP SCHEMA public;`
  const grant=`BEGIN;
DO $pilot$ BEGIN IF current_database()<>'${PILOT_DB}' OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_pilot_owner' THEN RAISE EXCEPTION 'Isolated pilot required'; END IF; END $pilot$;
REVOKE CONNECT ON DATABASE ${PILOT_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${PILOT_DB} TO xmartmenu_pilot_runtime;
REVOKE ALL ON SCHEMA public,auth,supabase_migrations FROM PUBLIC;
GRANT USAGE ON SCHEMA public,supabase_migrations TO xmartmenu_pilot_runtime;
GRANT SELECT ON public.profiles,public.tenants,supabase_migrations.schema_migrations TO xmartmenu_pilot_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_accounts,public.app_identity_bindings,public.app_sessions,public.app_identity_challenges TO xmartmenu_pilot_runtime;
${['profiles','tenants','app_accounts','app_identity_bindings','app_sessions','app_identity_challenges'].map(name=>`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY; CREATE POLICY xmartmenu_isolated_pilot ON public.${name} TO xmartmenu_pilot_runtime USING(true) WITH CHECK(true);`).join('\n')}
COMMIT;`
  return{cluster,create,prepare,grant,executionHash:sha256([cluster,create,prepare,grant].join('\n'))}
}
