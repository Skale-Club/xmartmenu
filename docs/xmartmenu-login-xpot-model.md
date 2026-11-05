# Login nativo no modelo do Xpot (telefone primeiro, Google em segundo)

Referência: `Xpot/server/auth/googleLogin.ts`. Nada aqui liga flag nem muda o banco em produção; a migração é aditiva.

## Regra de entrada (`resolveLogin`, `src/lib/auth/identity-policy.ts`)

1. Vínculo já existente (`app_identity_bindings`) entra.
2. Token Google cujo `firebase.identities['google.com'][0]` está em `identity_google_subject_claims` entra e grava vínculo `binding_proof='google-subject'`.
3. Telefone verificado que bate (só dígitos) com o `profiles.phone` de exatamente uma conta entra e grava `binding_proof='phone-match'`. Dois ou mais: recusa (`PHONE_AMBIGUOUS`, 409). O telefone precisa ainda constar na conta do provedor.
4. Google sem vínculo: resposta 409 `phone_required` e um pendente de 10 minutos (cookie `xm_identity_pending` + linha em `app_identity_pending_google`, uso único). Ao confirmar o telefone, o Google pendente é vinculado à mesma conta.
5. E-mail nunca reivindica conta, em nenhum passo.
6. Telefone desconhecido segue o cadastro de cliente que já existia (`ACCOUNT_LINK_REQUIRED` e `register-customer`), sem acesso de admin.
7. Conta desabilitada continua bloqueada (403 `ACCOUNT_BLOCKED`), por subject Google ou por telefone.

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
