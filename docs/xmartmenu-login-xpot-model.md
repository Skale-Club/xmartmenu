# Login nativo no modelo do Xpot (telefone primeiro, Google em segundo)

Referência: `Xpot/server/auth/googleLogin.ts`. Nada aqui liga flag nem muda o banco em produção; a migração é aditiva.

## Regra de entrada (`resolveLogin`, `src/lib/auth/identity-policy.ts`)

1. Vínculo já existente (`app_identity_bindings`) entra.
2. Token Google cujo `firebase.identities['google.com'][0]` está em `identity_google_subject_claims` entra e grava vínculo `binding_proof='google-subject'`.
3. Telefone verificado entra e vincula (`phone-match`) somente se o `profiles.phone` guardado tem `+` explícito e é igual ao E.164 verificado (um número nacional nunca casa com um internacional de outro país), a conta é `customer`, sem vínculo ativo e sem `must_change_password`. Admin, staff e superadmin nunca entram por telefone (o telefone do onboarding é público do negócio): usam Google importado ou a rota por senha. Número em mais de uma conta: recusa (`PHONE_AMBIGUOUS`, 409); número de uma única conta inelegível não vira dono.
4. Google sem vínculo devolve 409 `phone_required` e nada é guardado. Depois de entrar pelo telefone, a tela leva a `/identity?action=link`, que exige sessão recente e novo login Google, mostrando o e-mail do Google antes de confirmar.
5. E-mail nunca reivindica conta, em nenhum passo.
6. Telefone desconhecido segue o cadastro de cliente que já existia (`ACCOUNT_LINK_REQUIRED` e `register-customer`), sem acesso de admin.
7. Conta desabilitada continua bloqueada (403 `ACCOUNT_BLOCKED`), por subject Google ou por telefone.

As consultas de primeiro login (`googleClaim`, `phoneOwners`) só existem com `OWNED_AUTH_ENABLED=true` (`first-login-gate.ts`); `GOOGLE_AUTH_ENABLED` sozinho não vincula nada.

A rota por senha (`existing-account-link`) continua para quem tem conta de e-mail: a tela convida a digitar a senha uma vez para adicionar o telefone.

## Importar os subjects Google

`scripts/ops/import-google-subject-claims.ts` lê a Admin API do Supabase Auth só com GET e grava `sub -> account_id` somente quando o UID do usuário é exatamente um `app_accounts.id`. Não olha e-mail. Idempotente. Não imprime sub, e-mail nem UID, só contagens.

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... IDENTITY_CLAIMS_DATABASE_URL=... \
  npx tsx scripts/ops/import-google-subject-claims.ts          # ensaio, não grava
  npx tsx scripts/ops/import-google-subject-claims.ts --apply  # grava (ON CONFLICT DO NOTHING)
```

Se um sub já estiver reivindicado por outra conta, a execução inteira é desfeita.

## Domínio personalizado

Não implementado. O login nativo é preso ao host canônico (cookie `__Host-`, toda rota de identidade confere o host, e `getOwnedPrincipal` só lê a sessão nele). Um handoff por origem, como no Xkedule, exige: tabela de handoffs (código de uso único, hash do navegador, origem verificada, 2 minutos), emissão no host canônico, consumo no domínio personalizado e uma sessão independente por origem. Isso muda a leitura de sessão de todas as rotas e guardas do painel, e não cabe como mudança mínima. A tela de garçom e o painel continuam no host canônico.

## Garçom

Em modo próprio, `(public)/[slug]/waiter/page.tsx` autentica pela sessão nativa e lê tenant, mesas, cardápio, opções, ingredientes e pedidos ativos do banco próprio (`src/lib/data/owned-waiter.ts`), sem cliente Supabase.

## Migração e fundação

`20261104090000_identity_google_claims.sql` é segura nos dois bancos (REVOKE de `anon` e GRANT a `xmartmenu_runtime` condicionais) e entra em `MIGRATIONS`/`IDENTITY_TABLES` de `prepare-xmartmenu-identity-foundation.mjs`. O executor de host `apply-xmartmenu-identity-foundation.py` continua fixado nas três migrações originais; aplicar esta como passo revisado à parte ou regenerar os hashes fixados do executor.
