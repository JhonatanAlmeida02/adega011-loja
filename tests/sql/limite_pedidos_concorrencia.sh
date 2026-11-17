#!/usr/bin/env bash
# Concorrência nos pedidos do site (precisa de várias conexões, por isso não é um .sql).
#  1) 30 pedidos SIMULTÂNEOS do mesmo telefone: só 5 passam (limite de 5 a cada 10 min).
#  2) 60 pedidos simultâneos de telefones diferentes para um produto com 10 em estoque:
#     exatamente 10 passam e o estoque termina em 0 (nunca negativo).
#
# Rode em um banco de TESTE com as migrations aplicadas (usa as variáveis PG* do psql):
#   PGHOST=... PGUSER=postgres PGDATABASE=... bash tests/sql/limite_pedidos_concorrencia.sh
# Precisa de psql e pgbench (vêm no pacote do cliente do PostgreSQL).
set -euo pipefail

PRODUTO=7e570000-0000-4000-8000-00000000c0c0
TELEFONE=11900009999
TMP=$(mktemp -d)

sql() { psql -v ON_ERROR_STOP=1 -qtAX -c "$1"; }

limpar() {
  sql "delete from public.pedidos where itens @> '[{\"produto_id\": \"$PRODUTO\"}]';
       delete from public.estoque_movimentos where produto_id = '$PRODUTO';
       delete from public.produtos where id = '$PRODUTO';"
}

# Guarda a configuração para devolver no fim
CONFIG=$(sql "select row_to_json(c)::text from public.configuracoes c where id = 1")
restaurar() {
  limpar || true
  # Variáveis do psql (:'cfg') só funcionam lendo o SQL da entrada, não com -c
  psql -v ON_ERROR_STOP=1 -qtAX -v cfg="$CONFIG" <<'EOF' || true
update public.configuracoes c set status_manual = j.status_manual, pedido_minimo = j.pedido_minimo,
  aceita_retirada = j.aceita_retirada, pagamentos = j.pagamentos
  from json_populate_record(null::public.configuracoes, :'cfg'::json) j where c.id = 1;
EOF
  rm -rf "$TMP"
}
trap restaurar EXIT

limpar
sql "update public.configuracoes set status_manual = 'aberta', pedido_minimo = 0, aceita_retirada = true,
       pagamentos = array['pix', 'cartao', 'dinheiro'] where id = 1;
     insert into public.produtos (id, nome, preco, controla_estoque, unidade_estoque)
       values ('$PRODUTO', 'QA Concorrência', 1000, true, 'un');
     update public.produtos set estoque = 1000 where id = '$PRODUTO';"

pedido() { # $1 = expressão do telefone no pgbench
  cat <<EOF
set role anon;
select public.criar_pedido('QA Concorrência', $1, 'retirada', null, null, 'dinheiro', null, null,
  '[{"produto_id": "$PRODUTO", "quantidade": 1}]'::jsonb);
EOF
}

# 1) Mesmo telefone, 30 ao mesmo tempo
pedido "'$TELEFONE'" > "$TMP/mesmo.sql"
pgbench -n -c 30 -j 30 -t 1 -f "$TMP/mesmo.sql" > /dev/null 2>&1 || true
n=$(sql "select count(*) from public.pedidos where cliente_telefone = '$TELEFONE'")
if [ "$n" != "5" ]; then echo "FAIL limite por telefone: $n pedidos simultâneos aceitos (esperado 5)"; exit 1; fi
echo "ok  limite por telefone com 30 pedidos simultâneos: 5 aceitos"

# 2) Telefones diferentes disputando 10 unidades
sql "delete from public.pedidos where itens @> '[{\"produto_id\": \"$PRODUTO\"}]';
     update public.produtos set estoque = 10 where id = '$PRODUTO';"
{ echo '\set tel random(11900000000, 11999999999)'; pedido ":tel::text"; } > "$TMP/estoque.sql"
pgbench -n -c 30 -j 10 -t 2 -f "$TMP/estoque.sql" > /dev/null 2>&1 || true
read -r vendidos saldo < <(sql "select (select count(*) from public.pedidos where itens @> '[{\"produto_id\": \"$PRODUTO\"}]'),
                                       (select estoque from public.produtos where id = '$PRODUTO')" | tr '|' ' ')
if [ "$vendidos" != "10" ] || [ "$saldo" != "0" ]; then
  echo "FAIL estoque com pedidos simultâneos: $vendidos vendidos, saldo $saldo (esperado 10 e 0)"; exit 1
fi
echo "ok  60 pedidos simultâneos para 10 unidades: 10 vendidos, saldo 0"
