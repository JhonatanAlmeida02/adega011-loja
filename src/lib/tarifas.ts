/**
 * Tarifas de pagamento (maquininha de cartão e Pix).
 * Porcentagens em pontos-base, como no banco: 1% = 100, 2,99% = 299, 100% = 10000.
 */

export type Maquininha = {
  id: string; nome: string; taxa_debito_bp: number; taxa_credito_bp: number;
  padrao_pdv: boolean; padrao_site: boolean; ativa?: boolean;
};
export type TarifasPagamento = { pix_bp: number; maquininhas: Maquininha[] };
export type TipoCartao = "debito" | "credito";

/** "2,99" ou "2.99" → 299. Vazio vira 0. Inválido ou fora de 0–100% → null. */
export function paraPontosBase(texto: string): number | null {
  const limpo = texto.trim().replace("%", "").replace(",", ".");
  if (!limpo) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpo)) return null;
  const bp = Math.round(Number(limpo) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

/** 299 → "2,99" (para o campo). */
export function pontosBaseParaCampo(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

/** 299 → "2,99%". */
export function formatarPercentual(bp: number): string {
  return `${pontosBaseParaCampo(bp)}%`;
}

/** Tarifa em centavos (mesmo arredondamento do banco). */
export function calcularTarifa(total: number, bp: number): number {
  return Math.min(Math.round((total * bp) / 10000), total);
}

/** Maquininha que já vem escolhida no PDV: a padrão do PDV, senão a do site, senão a primeira. */
export function maquininhaInicial(maquininhas: Maquininha[]): Maquininha | null {
  return maquininhas.find((m) => m.padrao_pdv) ?? maquininhas.find((m) => m.padrao_site) ?? maquininhas[0] ?? null;
}

/** Taxa da maquininha para débito ou crédito. */
export function taxaDoCartao(m: Maquininha, tipo: TipoCartao): number {
  return tipo === "debito" ? m.taxa_debito_bp : m.taxa_credito_bp;
}

/**
 * Porcentagem que vale para a venda: cartão usa a maquininha escolhida (ou a
 * inicial) com a taxa de débito ou crédito; sem débito/crédito escolhido ainda
 * não há taxa. Pix usa a taxa do Pix; dinheiro não tem.
 */
export function tarifaDaVenda(
  tarifas: TarifasPagamento | null,
  pagamento: "pix" | "cartao" | "dinheiro",
  maquininhaId: string | null,
  tipo: TipoCartao | null,
): { bp: number; maquininha: Maquininha | null } {
  if (!tarifas) return { bp: 0, maquininha: null };
  if (pagamento === "pix") return { bp: tarifas.pix_bp, maquininha: null };
  if (pagamento !== "cartao") return { bp: 0, maquininha: null };
  const m = tarifas.maquininhas.find((x) => x.id === maquininhaId) ?? maquininhaInicial(tarifas.maquininhas);
  return { bp: m && tipo ? taxaDoCartao(m, tipo) : 0, maquininha: m };
}
