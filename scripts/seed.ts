/**
 * Popula o Supabase com os dados de exemplo (upsert, pode rodar várias vezes).
 *
 *   npm run seed
 *
 * Requer em .env.local: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  CATEGORIAS_EXEMPLO,
  CONFIG_EXEMPLO,
  PRODUTOS_EXEMPLO,
  REGIOES_EXEMPLO,
} from "../src/lib/dados-exemplo";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error("✖ Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const supabase = createClient(url, chave, { auth: { persistSession: false } });

async function upsert(tabela: string, linhas: object | object[]) {
  const { error } = await supabase.from(tabela).upsert(linhas);
  if (error) throw new Error(`${tabela}: ${error.message}`);
  console.log(`✔ ${tabela}`);
}

async function main() {
  await upsert("configuracoes", { id: 1, ...CONFIG_EXEMPLO });
  await upsert("categorias", CATEGORIAS_EXEMPLO);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  await upsert("produtos", PRODUTOS_EXEMPLO.map(({ grupos, estoque, composicao, ...p }) => p));
  const grupos = PRODUTOS_EXEMPLO.flatMap((p) => p.grupos ?? []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  await upsert("grupos_opcoes", grupos.map(({ opcoes, ...g }) => g));
  // foto_url das opções é só da vitrine (vem do produto ligado), não é coluna da tabela
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  await upsert("opcoes", grupos.flatMap((g) => g.opcoes.map(({ foto_url, ...o }) => o)));
  await upsert("regioes_entrega", REGIOES_EXEMPLO);
  console.log(`\nPronto! Loja populada com ${CATEGORIAS_EXEMPLO.length} categorias, ${PRODUTOS_EXEMPLO.length} produtos e 3 regiões.`);
}

main().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
