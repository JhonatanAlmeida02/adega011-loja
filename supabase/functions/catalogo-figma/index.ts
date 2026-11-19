// Edge Function "catalogo-figma" (Supabase / Deno): reimporta o design do catálogo do Figma.
//
// Rotas (verify_jwt = false; quem pode é conferido no banco com o login de quem chamou):
//   GET  /catalogo-figma   → { configurado } (o painel mostra se o token do Figma está salvo)
//   POST /catalogo-figma   { link } → lê a folha no Figma e devolve o tema (cores, fontes,
//                           tamanhos) + logo/fundo trocados (salvos no Storage)
//
// Segredo (Supabase > Edge Functions > Secrets):
//   FIGMA_TOKEN   token pessoal do Figma com permissão de leitura de arquivos
//   FIGMA_FAKE=1  (só testes automáticos) usa o "documento" enviado no corpo, sem chamar o Figma

import { extrairTema, lerLinkFigma, type NoFigma } from "./extrair.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const FIGMA = "https://api.figma.com/v1";
const FAKE = Deno.env.get("FIGMA_FAKE") === "1";
const URL_BANCO = () => Deno.env.get("SUPABASE_URL")!;
const MAX_IMAGEM = 8 * 1024 * 1024;

function chaveDeServico(): string {
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof chaves.default === "string" && chaves.default) return chaves.default;
  } catch {
    /* segue para as outras */
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

async function figma(caminho: string, token: string) {
  const r = await fetch(`${FIGMA}${caminho}`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(20000) });
  if (r.status === 403) throw new Error("O token do Figma não tem acesso a este arquivo. Use um token da mesma conta dona do arquivo.");
  if (r.status === 404) throw new Error("Arquivo ou folha não encontrados no Figma. Confira o link.");
  if (r.status === 429) throw new Error("O Figma pediu para esperar um pouco. Tente de novo em 1 minuto.");
  if (!r.ok) throw new Error(`O Figma respondeu com erro (${r.status}).`);
  return await r.json();
}

/** Baixa a imagem do Figma e guarda no Storage (pasta catalogo/). Devolve o caminho. */
async function guardarImagem(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Não foi possível baixar uma imagem do Figma.");
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = tipo === "image/png" ? "png" : tipo === "image/jpeg" ? "jpg" : tipo === "image/webp" ? "webp" : null;
  if (!ext) throw new Error("Imagem do Figma em formato não suportado (use PNG ou JPG).");
  const dados = new Uint8Array(await r.arrayBuffer());
  if (dados.byteLength > MAX_IMAGEM) throw new Error("Imagem do Figma muito grande (máximo 8 MB).");
  const caminho = `catalogo/${crypto.randomUUID()}.${ext}`;
  const chave = chaveDeServico();
  const envio = await fetch(`${URL_BANCO()}/storage/v1/object/produtos/${caminho}`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": tipo, "Cache-Control": "31536000", "x-upsert": "false" },
    body: dados,
  });
  if (!envio.ok) {
    console.error("[catalogo-figma] storage", envio.status, (await envio.text()).slice(0, 300));
    throw new Error("Não foi possível guardar a imagem do Figma.");
  }
  return caminho;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const token = Deno.env.get("FIGMA_TOKEN") ?? "";
  if (req.method === "GET") return resposta(200, { configurado: FAKE || !!token });
  if (req.method !== "POST") return resposta(405, { erro: "Método não permitido." });

  // Só admin (o banco confere o token de quem chamou)
  const apikey = req.headers.get("apikey") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  if (!apikey || !auth.startsWith("Bearer ")) return resposta(401, { erro: "Entre no painel novamente." });
  const admin = await fetch(`${URL_BANCO()}/rest/v1/rpc/is_admin`, {
    method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: "{}",
  });
  if (!admin.ok || (await admin.json().catch(() => false)) !== true) return resposta(403, { erro: "Só o administrador importa o design." });

  const corpo = await req.json().catch(() => null) as { link?: unknown; documento?: unknown } | null;
  const link = typeof corpo?.link === "string" ? lerLinkFigma(corpo.link) : null;
  if (!link) return resposta(422, { erro: "Cole o link do arquivo do Figma (figma.com/design/…)." });

  try {
    let raiz: NoFigma;
    let urlsImagens: Record<string, string> = {};
    if (FAKE) {
      raiz = (corpo?.documento ?? {}) as NoFigma;
    } else {
      if (!token) return resposta(503, { erro: "Falta salvar o token do Figma (FIGMA_TOKEN) nos segredos do Supabase." });
      if (link.no) {
        const dados = await figma(`/files/${link.arquivo}/nodes?ids=${encodeURIComponent(link.no)}`, token);
        raiz = dados?.nodes?.[link.no]?.document;
        if (!raiz) return resposta(404, { erro: "Folha não encontrada nesse link." });
      } else {
        raiz = (await figma(`/files/${link.arquivo}`, token))?.document;
      }
    }

    const extraido = extrairTema(raiz);
    if (extraido.encontradas.length === 0) {
      return resposta(422, { erro: "Não achei as camadas do modelo (ex.: “Título”, “Fundo do cartão”). Use a folha exportada pelo painel e não renomeie as camadas." });
    }

    // Logo e fundo trocados no Figma: baixa e guarda no Storage
    const imagens: Record<string, string> = {};
    const refs = Object.entries(extraido.imagens).filter(([, ref]) => ref) as [string, string][];
    if (refs.length && !FAKE) {
      urlsImagens = (await figma(`/files/${link.arquivo}/images`, token))?.meta?.images ?? {};
      for (const [chave, ref] of refs) {
        if (urlsImagens[ref]) imagens[chave] = await guardarImagem(urlsImagens[ref]);
      }
    }

    return resposta(200, { tema: extraido.tema, imagens, encontradas: extraido.encontradas, faltando: extraido.faltando });
  } catch (e) {
    console.error("[catalogo-figma]", e);
    return resposta(502, { erro: e instanceof Error ? e.message : "Não foi possível ler o Figma agora." });
  }
});
