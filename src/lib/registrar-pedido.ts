"use client";

import { supabaseConfigurado } from "./supabase/config";
import { supabaseNavegador } from "./supabase/navegador";
import type { DadosCheckout, LinhaCarrinho } from "./pedido";
import { paraCentavos } from "./utils";

export type ResultadoRegistro =
  | { ok: true; numero: number | null; subtotal?: number; taxa?: number; total?: number }
  | { ok: false; mensagem: string };

/**
 * Registra o pedido no Supabase (função criar_pedido) antes de abrir o WhatsApp.
 * - Erro de regra de negócio (esgotado, mínimo, região...) => bloqueia e mostra a mensagem.
 * - Falha de rede/servidor => segue sem número, para não perder a venda.
 * - Modo demonstração => não registra.
 */
export async function registrarPedido(dados: DadosCheckout, linhas: LinhaCarrinho[]): Promise<ResultadoRegistro> {
  if (!supabaseConfigurado) return { ok: true, numero: null };

  try {
    const { data, error } = await supabaseNavegador().rpc("criar_pedido", {
      p_cliente_nome: dados.nome.trim(),
      p_cliente_telefone: dados.telefone,
      p_tipo: dados.tipo,
      p_regiao_id: dados.tipo === "entrega" ? dados.regiaoId || null : null,
      p_endereco:
        dados.tipo === "entrega"
          ? [dados.endereco.trim(), dados.complemento.trim()].filter(Boolean).join(" — ")
          : null,
      p_pagamento: dados.pagamento,
      p_troco_para: dados.pagamento === "dinheiro" && dados.troco.trim() ? paraCentavos(dados.troco) : null,
      p_observacoes: dados.observacoes.trim() || null,
      p_itens: linhas
        .filter((l) => !l.indisponivel)
        .map((l) => ({ produto_id: l.produto.id, quantidade: l.quantidade })),
    });

    if (error) {
      // P0001 = "raise exception" da função: mensagem pensada para o cliente.
      if (error.code === "P0001") return { ok: false, mensagem: error.message };
      console.warn("[pedido] não registrado, seguindo pelo WhatsApp:", error.message);
      return { ok: true, numero: null };
    }

    const r = data as { numero: number; subtotal: number; taxa: number; total: number };
    return { ok: true, numero: r.numero, subtotal: r.subtotal, taxa: r.taxa, total: r.total };
  } catch (e) {
    console.warn("[pedido] falha de rede, seguindo pelo WhatsApp:", e);
    return { ok: true, numero: null };
  }
}

/** Abre o WhatsApp: na aba pré-aberta (computador) ou na própria aba (celular abre o app). */
export function abrirWhatsApp(url: string, janela: Window | null) {
  if (janela && !janela.closed) janela.location.href = url;
  else window.location.assign(url);
}
