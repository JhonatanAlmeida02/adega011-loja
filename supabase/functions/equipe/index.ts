// Edge Function "equipe" (Supabase / Deno): cadastro de logins do painel.
//
// Rotas (verify_jwt = false; a permissão é conferida no banco com o login de quem chamou):
//   POST /equipe        { email, senha, nome, papel } → cria o login (se ainda não existir)
//                        e coloca a pessoa na equipe como "admin" ou "operador"
//   POST /equipe/senha  { user_id, senha } → define uma nova senha para alguém da equipe
//
// Ordem de segurança: primeiro o banco confirma que quem chamou é ADMIN (com o
// token dessa pessoa); só depois a função usa a chave de serviço para mexer no
// login. Quem entra na equipe é sempre decidido por public.equipe_vincular,
// também com o token do admin.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const URL_BANCO = () => Deno.env.get("SUPABASE_URL")!;

/** Chave secreta do projeto: a nova (SUPABASE_SECRET_KEYS) ou, se não houver, a antiga. */
function chaveDeServico(): string {
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof chaves.default === "string" && chaves.default) return chaves.default;
  } catch {
    /* segue para as outras */
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

function cabecalhosServico(): Record<string, string> {
  const chave = chaveDeServico();
  return { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
}

type Login = { apikey: string; auth: string };

/** Chama uma função do banco com o login de quem pediu. */
async function rpcComoQuemPediu<T>(login: Login, nome: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_BANCO()}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: login.apikey, Authorization: login.auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!r.ok) return { ok: false as const, status: r.status, mensagem: String(dados?.message ?? "Erro no banco.") };
  return { ok: true as const, dados: dados as T };
}

/** Senha: 8 a 72 caracteres (limite do bcrypt), com letra e número. */
export function senhaValida(senha: unknown): senha is string {
  return typeof senha === "string" && senha.length >= 8 && senha.length <= 72 && /[a-zA-Z]/.test(senha) && /\d/.test(senha);
}

async function cadastrar(login: Login, corpo: Record<string, unknown>) {
  const email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
  const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
  const papel = corpo.papel;
  if (!EMAIL.test(email)) return resposta(422, { erro: "E-mail inválido." });
  if (!nome || nome.length > 80) return resposta(422, { erro: "Informe o nome (até 80 letras)." });
  if (papel !== "admin" && papel !== "operador") return resposta(422, { erro: "Escolha o papel." });
  if (!senhaValida(corpo.senha)) return resposta(422, { erro: "A senha precisa ter de 8 a 72 caracteres, com letras e números." });

  // Cria o login (e-mail já confirmado: quem cadastra é o admin)
  const r = await fetch(`${URL_BANCO()}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabecalhosServico(),
    body: JSON.stringify({ email, password: corpo.senha, email_confirm: true, user_metadata: { nome } }),
  });
  let jaExistia = false;
  if (!r.ok) {
    const erro = await r.json().catch(() => null);
    const codigo = String(erro?.error_code ?? erro?.code ?? "");
    if (r.status === 422 && (codigo === "email_exists" || /already/i.test(String(erro?.msg ?? erro?.message ?? "")))) {
      jaExistia = true; // login já existe: só entra na equipe, a senha dele não muda
    } else if (codigo === "weak_password") {
      return resposta(422, { erro: "Senha fraca. Use uma senha maior, com letras e números." });
    } else {
      console.error("[equipe] criar login", r.status, JSON.stringify(erro).slice(0, 300));
      return resposta(502, { erro: "Não foi possível criar o login agora." });
    }
  }

  const vinculo = await rpcComoQuemPediu<string>(login, "equipe_vincular", { p_email: email, p_nome: nome, p_papel: papel });
  if (!vinculo.ok) return resposta(422, { erro: vinculo.mensagem });
  return resposta(200, { ok: true, user_id: vinculo.dados, ja_existia: jaExistia });
}

async function trocarSenha(login: Login, corpo: Record<string, unknown>) {
  const usuario = typeof corpo.user_id === "string" ? corpo.user_id : "";
  if (!UUID.test(usuario)) return resposta(422, { erro: "Pessoa inválida." });
  if (!senhaValida(corpo.senha)) return resposta(422, { erro: "A senha precisa ter de 8 a 72 caracteres, com letras e números." });
  // Só para quem é da equipe (não serve para mexer em outros logins)
  const membro = await rpcComoQuemPediu<boolean>(login, "equipe_membro", { p_user: usuario });
  if (!membro.ok || membro.dados !== true) return resposta(422, { erro: "Essa pessoa não faz parte da equipe." });
  const r = await fetch(`${URL_BANCO()}/auth/v1/admin/users/${usuario}`, {
    method: "PUT",
    headers: cabecalhosServico(),
    body: JSON.stringify({ password: corpo.senha }),
  });
  if (!r.ok) {
    const erro = await r.json().catch(() => null);
    if (String(erro?.error_code ?? "") === "weak_password") return resposta(422, { erro: "Senha fraca. Use uma senha maior, com letras e números." });
    console.error("[equipe] trocar senha", r.status, JSON.stringify(erro).slice(0, 300));
    return resposta(502, { erro: "Não foi possível trocar a senha agora." });
  }
  return resposta(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "Método não permitido." });

  const login: Login = { apikey: req.headers.get("apikey") ?? "", auth: req.headers.get("Authorization") ?? "" };
  if (!login.apikey || !login.auth.startsWith("Bearer ")) return resposta(401, { erro: "Entre no painel novamente." });

  // 1º: quem chamou é admin? (o banco confere o token)
  const admin = await rpcComoQuemPediu<boolean>(login, "is_admin", {});
  if (!admin.ok || admin.dados !== true) return resposta(403, { erro: "Só o administrador cadastra usuários." });

  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return resposta(400, { erro: "Pedido inválido." });

  const rota = new URL(req.url).pathname.replace(/^.*\/equipe/, "") || "/";
  if (rota === "/") return cadastrar(login, corpo);
  if (rota === "/senha") return trocarSenha(login, corpo);
  return resposta(404, { erro: "Rota não encontrada." });
});
