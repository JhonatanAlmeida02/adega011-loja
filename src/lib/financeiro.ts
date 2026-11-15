import type { ItemPedido, StatusPedido, FormaPagamento } from "./tipos";

export interface ContaFinanceira {
  id: string; nome: string; tipo: "caixa" | "banco" | "carteira" | "outro";
  padrao: boolean; ativa: boolean; saldo: number; criado_em: string;
}
export interface LancamentoFinanceiro {
  id: string; tipo: string; origem_id: string | null; destino_id: string | null;
  origem_nome: string | null; destino_nome: string | null; valor: number;
  descricao: string; categoria: string; data: string; criado_em: string;
  pedido_id: string | null; pedido_numero: number | null; estornado: boolean;
}
export interface PainelFinanceiro {
  contas: ContaFinanceira[]; lancamentos: LancamentoFinanceiro[];
  resumo: { entradas: number; saidas: number }; total: number; iniciado_em: string;
}
export interface VendaFinanceira {
  id: string; numero: number; criado_em: string; status: StatusPedido;
  cliente_nome: string; origem: "site" | "balcao"; pagamento: FormaPagamento;
  subtotal: number; desconto: number; taxa: number; total: number; itens: ItemPedido[];
  conta_nome: string | null; recebimento_id: string | null; possui_lancamentos: boolean;
}
export interface HistoricoFinanceiro { vendas: VendaFinanceira[]; total: number; faturamento: number; concluidos: number }

export const TIPOS_CONTA = { caixa: "Caixa / dinheiro", banco: "Conta bancária", carteira: "Carteira / reserva", outro: "Outro local" };
export const TIPOS_LANCAMENTO: Record<string, string> = {
  abertura: "Saldo inicial", entrada: "Entrada", saida: "Saída", transferencia: "Transferência",
  venda: "Venda", estorno_venda: "Estorno de venda", ajuste: "Conferência", estorno: "Estorno",
};
export function hojeFinanceiro(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
