export interface LinhaRelatorio { chave: string; pedidos: number; total: number }
export interface RelatorioVendas {
  faturamento: number; pedidos: number; ticket_medio: number; descontos: number;
  taxas_entrega: number; cancelados: number; custo_produtos: number;
  vendas_sem_custo: number; despesas: number; lucro_bruto: number; lucro_liquido: number;
  despesas_por_categoria: { categoria: string; total: number }[];
  por_origem: LinhaRelatorio[]; por_pagamento: LinhaRelatorio[];
  por_dia: { dia: string; pedidos: number; total: number }[];
  top_produtos: { nome: string; quantidade: number; total: number; custo?: number | null }[];
}

const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const numero = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const lista = (v: unknown, validar: (linha: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every((l) => objeto(l) && validar(l));

/** Never invent zero costs/profit when the API still has an older schema. */
export function validarRelatorio(dados: unknown): RelatorioVendas {
  const campos = ["faturamento", "pedidos", "ticket_medio", "descontos", "taxas_entrega", "cancelados", "custo_produtos", "vendas_sem_custo", "despesas", "lucro_bruto", "lucro_liquido"];
  const grupo = (l: Record<string, unknown>) => typeof l.chave === "string" && numero(l.pedidos) && numero(l.total);
  if (!objeto(dados) || !campos.every((c) => numero(dados[c]))
    || !lista(dados.por_origem, grupo) || !lista(dados.por_pagamento, grupo)
    || !lista(dados.por_dia, (l) => typeof l.dia === "string" && numero(l.pedidos) && numero(l.total))
    || !lista(dados.top_produtos, (l) => typeof l.nome === "string" && numero(l.quantidade) && numero(l.total) && (l.custo == null || numero(l.custo)))
    || !lista(dados.despesas_por_categoria, (l) => typeof l.categoria === "string" && numero(l.total))) {
    throw new Error("O banco retornou um relatório incompleto ou incompatível.");
  }
  return dados as unknown as RelatorioVendas;
}
