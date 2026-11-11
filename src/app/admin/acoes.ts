"use server";

import { updateTag } from "next/cache";
import { ErroImportacao, baixarImagemOtimizada } from "@/lib/admin/importar-imagem";
import { TAG_LOJA } from "@/lib/loja";
import { BUCKET_FOTOS, supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseServidor } from "@/lib/supabase/servidor";

/** Cliente com a sessão do usuário, se ele for admin. Senão, null. */
async function clienteDoAdmin() {
  if (!supabaseConfigurado) return null;
  const sb = await supabaseServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return data ? sb : null;
}

/**
 * Atualiza a vitrine na hora depois que o admin salva algo.
 * Confere a sessão e a permissão de admin aqui dentro (não confia no cliente).
 */
export async function revalidarLoja(): Promise<{ ok: boolean }> {
  if (!(await clienteDoAdmin())) return { ok: false };
  updateTag(TAG_LOJA);
  return { ok: true };
}

/**
 * "Colar link da imagem": o servidor baixa a foto do link, reduz para WebP
 * e guarda no Storage do Supabase (com a sessão do admin, respeitando o RLS).
 */
export async function importarImagemPorLink(
  link: string,
  pasta: "produtos" | "banner",
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const sb = await clienteDoAdmin();
  if (!sb) return { ok: false, erro: "Sem permissão. Entre novamente como administrador." };
  if (pasta !== "produtos" && pasta !== "banner") return { ok: false, erro: "Destino inválido." };
  if (typeof link !== "string" || link.length > 2048) return { ok: false, erro: "Link inválido." };

  try {
    const imagem = await baixarImagemOtimizada(link, pasta === "banner" ? 2000 : 1400);
    const caminho = `${pasta}/${crypto.randomUUID()}.webp`;
    const { error } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, imagem, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) return { ok: false, erro: `Falha ao guardar a imagem: ${error.message}` };
    return { ok: true, url: sb.storage.from(BUCKET_FOTOS).getPublicUrl(caminho).data.publicUrl };
  } catch (e) {
    if (e instanceof ErroImportacao) return { ok: false, erro: e.message };
    console.error("[importar-imagem]", e);
    return { ok: false, erro: "Não foi possível importar essa imagem." };
  }
}

let ultimaAtualizacaoPublica = 0;

/**
 * Chamada pela loja depois de um pedido com produto de estoque controlado,
 * para a vitrine mostrar "esgotado"/"últimas unidades" na hora.
 * Pública (o cliente não está logado), então limitada a 1 vez a cada 3 s.
 */
export async function atualizarVitrineAposPedido(): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaAtualizacaoPublica < 3000) return;
  ultimaAtualizacaoPublica = agora;
  updateTag(TAG_LOJA);
}
