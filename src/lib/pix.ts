"use client";

import { supabaseNavegador } from "./supabase/navegador";

export interface StatusPix {
  status: "pendente" | "pago" | "expirado" | "estornado" | "divergente";
  valor: number;
  expira_em: string;
  qr_code: string | null;
  qr_code_base64: string | null;
  numero: number;
  /** Hora do servidor na consulta */
  agora: string;
}

/** Pede ao servidor a cobrança Pix do pedido (o valor vem do banco, nunca daqui). */
export async function gerarPix(pedidoId: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  try {
    const { error } = await supabaseNavegador().functions.invoke("pix", { body: { pedido_id: pedidoId } });
    if (!error) return { ok: true };
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, mensagem: corpo?.erro ?? "Não foi possível gerar o Pix agora." };
  } catch {
    return { ok: false, mensagem: "Sem conexão para gerar o Pix. Tente de novo." };
  }
}

/** Situação do Pix do pedido (QR Code enquanto aguarda; "pago" quando o Mercado Pago confirmar). */
export async function lerStatusPix(pedidoId: string): Promise<(StatusPix & { diferencaRelogio: number }) | null> {
  const antes = Date.now();
  const { data, error } = await supabaseNavegador().rpc("status_pix", { p_pedido: pedidoId });
  if (error || !data) return null;
  const st = data as StatusPix;
  // Quanto o relógio do aparelho está adiantado/atrasado em relação ao servidor
  const meio = (antes + Date.now()) / 2;
  return { ...st, diferencaRelogio: st.agora ? new Date(st.agora).getTime() - meio : 0 };
}

/** Pede ao servidor para conferir agora no Mercado Pago (se o aviso automático atrasar). */
export async function conferirPix(pedidoId: string): Promise<void> {
  await supabaseNavegador().functions.invoke("pix/verificar", { body: { pedido_id: pedidoId } }).catch(() => null);
}

/** "mm:ss" que faltam até o vencimento. */
export function tempoRestante(expiraEm: string, agora = Date.now()): string {
  const s = Math.max(0, Math.floor((new Date(expiraEm).getTime() - agora) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
