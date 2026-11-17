#!/usr/bin/env bash
# Recria um banco PostgreSQL LOCAL de teste com o shim do Supabase + migrations do WMS.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres WMS_TEST_DB=wms_test bash scripts/wms-db-local.sh
# Nunca aponte para um banco real: o script apaga e recria o banco informado.
set -euo pipefail
DB="${WMS_TEST_DB:-wms_test}"
case "$DB" in *test*|*dev*) ;; *) echo "Recusado: o nome do banco precisa conter 'test' ou 'dev'." >&2; exit 1;; esac
cd "$(dirname "$0")/.."
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f tests/wms/sql/00_supabase_shim.sql
for f in supabase/migrations/*_wms_*.sql; do
  if ! out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1); then
    echo "$out" | grep -v NOTICE >&2; echo "Falhou em $f" >&2; exit 1
  fi
done
echo "Banco $DB pronto."
