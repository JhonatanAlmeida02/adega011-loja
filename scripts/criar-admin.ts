/**
 * Cria (ou promove) o usuário administrador do painel /admin.
 *
 *   npm run criar-admin -- dono@adega011.com.br "UmaSenhaForte123"
 *
 * Se o e-mail já existir no Supabase Auth, apenas garante que ele é admin
 * (a senha informada é ignorada nesse caso).
 * Requer em .env.local: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

const [email, senha] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error("✖ Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}
if (!email) {
  console.error('✖ Uso: npm run criar-admin -- email@exemplo.com "senha"');
  process.exit(1);
}

const supabase = createClient(url, chave, { auth: { persistSession: false } });

async function buscarUsuario(alvo: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => u.email?.toLowerCase() === alvo.toLowerCase());
    if (achado) return achado;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  let usuario = await buscarUsuario(email);

  if (!usuario) {
    if (!senha || senha.length < 8) {
      throw new Error("Informe uma senha com pelo menos 8 caracteres.");
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });
    if (error) throw error;
    usuario = data.user;
    console.log(`✔ Usuário criado: ${email}`);
  } else {
    console.log(`• Usuário já existia: ${email}`);
  }

  const { error } = await supabase.from("admins").upsert({ user_id: usuario.id });
  if (error) throw error;
  console.log("✔ Permissão de administrador concedida. Acesse /admin/login.");
}

main().catch((e) => {
  console.error("✖", e.message ?? e);
  process.exit(1);
});
