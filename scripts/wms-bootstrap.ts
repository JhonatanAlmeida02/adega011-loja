/**
 * Bootstrap controlado do primeiro administrador do WMS (sem senha em seed).
 * 1) Convide/crie o usuário no Supabase Auth (painel ou convite por e-mail) — ele define a própria senha.
 * 2) Rode, com DATABASE_URL do banco (papel dono das migrations):
 *      npm run wms:bootstrap -- admin@empresa.com.br EMPRESA "Nome da Empresa" "Nome do Admin"
 * Recusa se a empresa já tiver administrador ativo (a partir daí, use convites pela interface).
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });
config();

async function main() {
  const [email, codigo, nome, nomeAdmin = ""] = process.argv.slice(2);
  if (!email || !codigo || !nome) {
    console.error('Uso: npm run wms:bootstrap -- email CODIGO "Nome da empresa" ["Nome do admin"]');
    process.exit(1);
  }
  const url = process.env.WMS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina DATABASE_URL.");
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const u = await c.query("select id from auth.users where lower(email) = lower($1)", [email]);
    if (!u.rows[0]) throw new Error("Usuário não encontrado no Supabase Auth. Convide-o primeiro.");
    const r = await c.query("select wms.bootstrap_organization($1, $2, $3, $4) as org", [u.rows[0].id, codigo, nome, nomeAdmin]);
    console.log(`Administrador vinculado à empresa ${codigo.toUpperCase()} (${r.rows[0].org}). Ative o MFA em /wms/conta no primeiro acesso.`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
