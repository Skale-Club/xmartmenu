-- =============================================================================
-- 059_telegram_webhook_scope.sql — autoblog-parity XM-16
--
-- O blog de cada restaurante passa a operar pelo Telegram como o da plataforma:
-- o rascunho chega ao chat com Aprovar/Rejeitar, e a decisão publica no site
-- dele. Um endpoint só serve todos, porque O SEGREDO É O ESCOPO — o webhook
-- procura a linha de telegram_settings pelo segredo recebido e é essa linha que
-- diz de quem é a torneira.
--
-- Isso obriga o segredo a ser único na tabela. Sem esta restrição, dois escopos
-- com o mesmo segredo davam uma confusão de escopo silenciosa: o `.maybeSingle()`
-- do webhook devolveria erro ("multiple rows") e as aprovações de ambos parariam
-- sem explicação — ou, pior, uma implementação que pegasse na primeira linha
-- publicaria o rascunho de um restaurante a partir do bot de outro.
--
-- Parcial, WHERE webhook_secret IS NOT NULL: num índice único do Postgres os
-- NULLs são distintos entre si, portanto um índice total não recusaria nada aos
-- escopos sem aprovações ligadas — mas seria uma restrição a dizer algo que não
-- queremos dizer. A parcial diz exatamente o que se pretende: os segredos que
-- existem são únicos.
-- =============================================================================

-- Defensivo: a 058 pode não ter corrido ainda num ambiente qualquer, e uma
-- migração que rebenta por falta da tabela não acrescenta nada a ninguém.
DO $$
BEGIN
  IF to_regclass('public.telegram_settings') IS NULL THEN
    RAISE NOTICE 'telegram_settings ainda não existe — 058 primeiro. Nada a fazer.';
    RETURN;
  END IF;

  -- Antes de criar o índice, garantir que ele pode ser criado. Dois escopos com
  -- o mesmo segredo só podem ter vindo de uma cópia manual de linha; o segredo
  -- é sempre gerado por randomBytes(32). Limpar o duplicado (pondo-o a NULL)
  -- desliga as aprovações desse escopo, que é o modo de falha seguro: o dono
  -- volta a gravar e recebe um segredo novo.
  UPDATE public.telegram_settings t
     SET webhook_secret = NULL,
         approvals_enabled = FALSE
   WHERE t.webhook_secret IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.telegram_settings o
        WHERE o.webhook_secret = t.webhook_secret
          AND o.id <> t.id
          AND o.created_at < t.created_at
     );

  CREATE UNIQUE INDEX IF NOT EXISTS telegram_settings_webhook_secret_unique
    ON public.telegram_settings (webhook_secret)
    WHERE webhook_secret IS NOT NULL;
END $$;
