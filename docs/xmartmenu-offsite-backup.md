# Backup fora do host do banco Xmartmenu

Perfil Xmartmenu do mecanismo do Xmail (`xmail-owned-backup` / `xmail-offsite-backup`). Sem serviço novo e sem custo:
usa os dois hosts que já existem (49 = PostgreSQL, 188 = destino) e o certificado de destinatário que o Xmail já usa.
Grava o recibo `/opt/xmartmenu/offsite-backups/latest.json` que o `plan` e o `preflight` da troca final exigem
(`docs/xmartmenu-final-cutover.md`). **Nada aqui foi executado em produção.**

## O que acontece por dia

1. No 49 (`xmartmenu-offsite-backup.py --backup`, chamado pelo timer): trava própria, trava do backup do Xmail (se estiver rodando, recusa), teste da trava de deploy do Xmail (se um deploy está em curso, recusa), capacidade (MemAvailable >= 1024 MiB, swap usado <= 512 MiB, disco >= 2 GiB; os mesmos limites do operador da troca).
2. Snapshot repeatable-read exportado do banco `xmartmenu` do contêiner compartilhado; `pg_dump -Fc` e o manifesto saem do mesmo snapshot.
3. Manifesto: por tabela de `public` (contagem + soma de md5 por linha, sem ordenação, memória constante), assinatura de colunas, constraints, índices, políticas, gatilhos e RLS, funções, enums, sequences, ledger de migrações e papéis das políticas.
4. `tar` (dump + manifesto) cifrado com CMS AuthEnvelopedData, AES-256-GCM, RSA-OAEP-SHA256, para o certificado fixado pelo SHA-256 (`2efbf3fc...`, o do Xmail; a chave privada fica só no 188).
5. Envio pelo SSH dedicado (`restrict`, `from=49.13.197.250`, comando forçado `xmartmenu-offsite-backup`) para o 188.
6. No 188 (`--receive`): confere pares do SSH, trava própria e a do receptor do Xmail, recusa se houver `xmail-dr-*` rodando, confere capacidade somando o contêiner de restauração, confere hash, algoritmos e decifra (a tag GCM falha antes de qualquer byte ser aceito).
7. Restauração num contêiner descartável: `--network none`, root somente leitura, sem volumes, `--cpus 0.5`, `--pids-limit 96`, memória = swap (sem swap), `--oom-score-adj 1000` (se faltar memória o kernel mata este contêiner primeiro, não o Xmail nem o app), dados em tmpfs. Tamanho derivado do dump: 16x, piso 256 MiB, teto 512 MiB; dump acima de 32 MiB é recusado antes, com rótulo claro, até alguém rever o perfil. Compara o manifesto inteiro; qualquer diferença recusa.
8. Publicação atômica (`renameat2 NOREPLACE`) em `/opt/xmartmenu/offsite-backups/v1/xmartmenu-<UTC>-<nonce>/` (só `snapshot.tar.cms` e `receipt.json`); retenção das 7 últimas, só do layout exato, nunca apaga conteúdo desconhecido.
9. De volta ao 49: confere a prova, guarda a cópia cifrada local (7), e **por último** grava `latest.json` com `{at, sha256, restored:true, database:"xmartmenu", ...}` de forma atômica. Falha em qualquer passo não toca o recibo anterior (ele envelhece e bloqueia a troca, o que é o certo).

Horário: timer às 03:50 UTC + até 10 min. O Xmail roda 03:15 UTC + até 15 min e termina em menos de 11 min (limite da unidade 650 s). A unidade também declara `After=xmail-owned-backup.service` para o caso de os dois dispararem juntos após um boot (`Persistent=true`).

Falhas saem em stderr/journal como JSON com rótulo fixo (`step`), SQLSTATE e coordenadas de função e linha; nunca linhas, SQL, chaves ou mensagens do driver. Uma diferença de restauração traz só nomes técnicos de tabela e booleanos.

## Instalação (manual, uma vez; o operador roda, nada disto foi feito)

Pré-requisito: a troca ainda não rodou; o 188 já tem o destinatário do Xmail em `/opt/xmail/offsite-backups/v1/recipient` e a imagem `postgres:17-alpine` (id `266d3c257594...`) em cache. O instalador recusa se algo divergir.

```bash
# 0. Mesmo commit de main nos dois hosts. Calcule o hash (o script normaliza CRLF):
SHA=$(tr -d '\r' < scripts/ops/xmartmenu-offsite-backup.py | sha256sum | cut -d' ' -f1)
python3 -B scripts/ops/install-xmartmenu-offsite-backup.py --plan        # nada é alterado; confira o hash impresso

# 1. Envie os dois arquivos (0600, root) para cada host
for H in 49.13.197.250 188.245.112.3; do
  ssh root@$H 'umask 077; mkdir -p /root/xmartmenu-offsite-install'
  scp scripts/ops/xmartmenu-offsite-backup.py scripts/ops/install-xmartmenu-offsite-backup.py root@$H:/root/xmartmenu-offsite-install/
  ssh root@$H 'chmod 600 /root/xmartmenu-offsite-install/*'
done
I='cd /root/xmartmenu-offsite-install && python3 -B install-xmartmenu-offsite-backup.py'

# 2. No 49: cria a chave dedicada (fica no 49) e imprime a metade pública
KEY=$(ssh root@49.13.197.250 "$I --prepare-transport --role source --backup-script-sha256 $SHA" | python3 -c 'import sys,json;print(json.load(sys.stdin)["transportPublicKey"])')

# 3. No 188: autoriza essa chave só para o comando forçado; devolve o certificado público do destinatário
printf '{"transportPublicKey":"%s"}' "$KEY" | ssh root@188.245.112.3 "$I --apply --role target --backup-script-sha256 $SHA" > /tmp/target.json

# 4. No 49: fixa o certificado e a chave de host do 188 (o instalador confere o SHA-256 da chave de host) e instala unidade e timer
HOSTKEY=$(ssh-keyscan -t ed25519 188.245.112.3 2>/dev/null | grep -v '^#' | head -1)   # confira contra o known_hosts
python3 - <<PY | ssh root@49.13.197.250 "$I --apply --role source --backup-script-sha256 $SHA"
import json
print(json.dumps({"recipientPublicPem": json.load(open('/tmp/target.json'))["recipientPublicPem"], "targetKnownHost": """$HOSTKEY"""}))
PY
```

O timer fica **habilitado e parado**. Primeira execução manual, com o Xmail fora do horário dele:

```bash
ssh root@49.13.197.250 'systemctl start xmartmenu-offsite-backup.service; journalctl -u xmartmenu-offsite-backup.service -n 5 --no-pager; cat /opt/xmartmenu/offsite-backups/latest.json'
ssh root@188.245.112.3 'ls -l /opt/xmartmenu/offsite-backups/v1; docker ps -a --filter name=xmartmenu-dr- -q'   # a segunda lista deve vir vazia
# só então:
ssh root@49.13.197.250 'systemctl start xmartmenu-offsite-backup.timer; systemctl list-timers xmartmenu-offsite-backup.timer'
```

Depois disso o `plan` da troca deixa de imprimir `offhost-backup present=false`.

## O que o recibo garante, e o que não

Garante: um dump consistente do banco `xmartmenu` do contêiner de produção foi cifrado, copiado ao 188, decifrado, restaurado num PostgreSQL 17 descartável e idêntico (linhas e esquema) ao snapshot de origem, há menos de 26 h. Não garante: restauração dos papéis e senhas (o arquivo não leva `ALTER ROLE`), nem R2, Auth do Supabase ou segredos do app. A chave privada do destinatário é única e mora no 188: perdê-la perde todas as cópias (escrow dela é uma decisão pendente, a mesma do Xmail).

Reutilizar o certificado do Xmail evita uma chave a mais para guardar; o custo é que quem tem a chave do 188 abre os dois. Se isso não servir, gere outro par no 188 e troque `RECIPIENT_SHA` e `Config.recipient_dir` (uma linha cada).

## Capacidade

O 49 já recusou deploy do Xmail por memória ou swap. Por isso o trabalho pesado (restauração) fica no 188, com limites duros e checagem prévia, e o 49 só faz `pg_dump` (dentro do contêiner de banco), `openssl` e `ssh`, sob `MemoryMax=256M`, `CPUQuota=50%`, `Nice=10`, I/O ocioso. Uma recusa por capacidade falha a unidade com `capacity-<onde>-<memory|swap|disk>` e deixa tudo como estava.

## Testes

`scripts/ops/test_xmartmenu_offsite_backup.py`. Offline: planos sem I/O, horário sem colisão, linha forçada do SSH, pares do receptor, validação do pacote, limites do contêiner, perfil de restauração, recibo aceito pela checagem real do operador da troca. Com PostgreSQL 17 descartável (job `offsite-backup-postgres` do CI): ciclo completo com restauração real em contêiner limitado, retenção, ciphertext adulterado, restauração divergente com classificação, capacidade na origem e no destino, travas do Xmail e da própria execução, banco errado, conteúdo desconhecido na retenção, manifesto estável e sensível a mudança.

Sem teste (só o primeiro `--backup` real prova): SSH e chave de host reais, `systemd`, formato das 47+ tabelas reais e extensões do banco (um `CREATE EXTENSION` fora do contrib faria o `pg_restore` falhar com `restore-failed`), privilégios de `xmail_owner` sobre `xmartmenu`, memória livre real do 188, tempo real de restauração, e a afinidade com o Xmail rodando na mesma janela.

## M10: métricas de pedido em modo próprio

`recordTrustedOrderAnalyticsEvent` (`src/lib/analytics/server.ts`) só serve ao caminho Supabase. Em modo próprio os três chamadores nunca chegam nela: criar pedido usa `owned.recordAnalytics` dentro da mesma transação; o PATCH de pedido retorna em `ordersDataOwned()` antes de criar o cliente; o webhook do Stripe desvia por `paymentsDataOwned()` para o repositório próprio de pagamentos (`src/lib/data/payments.ts`), que também chama `recordAnalytics`. Os testes `orders-source` e `payments-source` já provavam isso. O que podia perder evento em silêncio era uma combinação de flags inconsistente (o cliente de serviço lança em modo próprio e o `catch` genérico engolia). Agora a função para antes, com o erro `analytics.order_event_legacy_path_in_owned_mode` (pesquisável), e há teste cobrindo as duas flags e o caminho legado intacto. Com o conjunto completo das 14 flags da troca, o caminho é inalcançável.
