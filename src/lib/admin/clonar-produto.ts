"use client";

import { BUCKET_FOTOS } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";

/** Guardado durante as tentativas para não duplicar o cadastro após falha de rede. */
export type PedidoClonagem = { id: string; fotos: Record<string, string> };

export async function clonarProduto(origem: string, incluirVariacoes: boolean, pedido: PedidoClonagem): Promise<string> {
  const sb = supabaseNavegador();
  const { data: produto, error } = await sb.from("produtos").select("id,familia_id,foto_url").eq("id", origem).single();
  if (error || !produto) throw new Error("Não foi possível carregar o produto original.");
  let membros = [produto];
  if (incluirVariacoes && produto.familia_id) {
    const { data, error } = await sb.from("produtos").select("id,familia_id,foto_url").eq("familia_id", produto.familia_id);
    if (error || !data?.length) throw new Error("Não foi possível carregar as variações.");
    membros = data;
  }
  const bucket = sb.storage.from(BUCKET_FOTOS);
  const prefixo = bucket.getPublicUrl("").data.publicUrl;
  for (const membro of membros) {
    const foto = membro.foto_url as string | null;
    if (!foto || !foto.startsWith(prefixo) || pedido.fotos[membro.id]) continue;
    const caminho = decodeURIComponent(foto.slice(prefixo.length).split("?")[0]);
    const extensao = caminho.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "webp";
    const destino = `produtos/clones/${pedido.id}/${crypto.randomUUID()}.${extensao}`;
    const { error } = await bucket.copy(caminho, destino);
    if (error) throw new Error("Não foi possível copiar a foto. Tente novamente.");
    // Arquivo independente: trocar/excluir a foto da cópia não afeta o original.
    pedido.fotos[membro.id] = bucket.getPublicUrl(destino).data.publicUrl;
  }
  const { data, error: falha } = await sb.rpc("clonar_produto", {
    p_origem: origem, p_novo: pedido.id, p_incluir_variacoes: incluirVariacoes, p_fotos: pedido.fotos,
  });
  // Não apaga fotos em falhas de rede: a transação pode ter sido concluída.
  if (falha) throw new Error(falha.message);
  if (typeof data !== "string") throw new Error("Não foi possível confirmar a clonagem. Tente novamente.");
  return data;
}
