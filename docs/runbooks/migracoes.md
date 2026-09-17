# Aplicar migrações

`npm run db:migrate` — `scripts/apply-migrations.mjs`.

O registo é `supabase_migrations.schema_migrations`, **a mesma tabela que o
Supabase CLI e o dashboard escrevem**. Não é detalhe de implementação: um
registo próprio faria com que este script e o `supabase db push` se ignorassem, e
cada um reaplicasse o que o outro já tinha corrido.

**Simula por omissão.** Nada é escrito sem `--apply`. A connection string destes
repos aponta para a base de dados que serve clientes reais, e um engano aqui não
se desfaz com ctrl-Z, portanto o comando fácil é o inofensivo.

```bash
npm run db:migrate                             # o que está pendente
npm run db:migrate -- --apply                  # aplica, cada um numa transação
npm run db:migrate -- --only=058_x.sql --apply # só esse ficheiro
```

Connection string, por ordem: `MIGRATION_DATABASE_URL`, `POSTGRES_URL_NON_POOLING`,
`DATABASE_URL`. A não-pooling vem primeiro de propósito — DDL através de um pooler
em modo transação perde estado de sessão entre statements.

## Primeira vez numa base de dados que já existe

O registo está vazio e aparecem dezenas de pendentes. Aplicar isso reproduziria a
história toda contra dados reais, por isso o script **recusa** e pede um baseline:

```bash
npm run db:migrate -- --baseline=057 --apply   # marca tudo até 057 SEM CORRER
npm run db:migrate                             # agora só sobra o que falta
npm run db:migrate -- --apply
```

Numa base de dados genuinamente nova, `--first-run --apply`.

## Versões duplicadas

O registo guarda **uma linha por versão**. Dois ficheiros com o mesmo prefixo não
cabem lá os dois: o segundo cairia no `on conflict do nothing` e passaria a
constar como aplicado sem nunca ter corrido — uma falha que não deixa rasto
nenhum. O script deteta-as, lista-as, e recusa aplicar quando uma pendente
colide. A resolução é renomear uma delas para uma versão livre.

Este repo tem dois pares assim na história (`051_*` e `052_*`), de branches que
aterraram no mesmo dia. Como já estão em produção, um baseline passa por cima
deles e o assunto fecha-se.

## Falhas

Cada ficheiro corre numa transação **com** o seu registo. Uma falha a meio reverte
o ficheiro inteiro e não regista nada, portanto a repetição é segura: retoma
exatamente onde parou. Os ficheiros anteriores dessa passagem ficam aplicados.

## Testar migrações sem tocar em produção

Um Postgres local mais estes stubs chega para correr a história toda — foi assim
que se apanhou, na 058, uma política de RLS que tornava invisível ao público o
blog de todos os restaurantes:

```sql
create extension if not exists pgcrypto;
create schema if not exists auth;  create schema if not exists storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls;
create publication supabase_realtime;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select string_to_array(name, '/') $$;
-- o Supabase concede isto por omissão em tabelas novas; localmente é à mão,
-- e sem ele testa-se a falta de grant em vez da RLS, que não é a mesma coisa
grant select on all tables in schema public to anon, authenticated;
```
