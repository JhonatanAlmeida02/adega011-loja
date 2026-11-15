/** Contas a pagar / a receber (tabela financeiro_titulos). */
export type TipoTitulo = "pagar" | "receber";

export interface Titulo {
  id: string;
  tipo: TipoTitulo;
  descricao: string;
  pessoa: string;
  categoria: string;
  documento: string;
  observacoes: string;
  valor: number;
  vencimento: string; // AAAA-MM-DD
  status: "aberto" | "pago" | "cancelado";
  pago_em: string | null;
  conta_id: string | null;
  lancamento_id: string | null;
  parcela: number | null;
  parcelas: number | null;
}

export const TEXTOS_TITULO = {
  pagar: { titulo: "Contas a pagar", novo: "Nova conta a pagar", pessoa: "Fornecedor / para quem", acao: "Pagar", feito: "Paga", conta: "Pagar com a conta", verbo: "pagamento" },
  receber: { titulo: "Contas a receber", novo: "Nova conta a receber", pessoa: "Cliente / de quem", acao: "Receber", feito: "Recebida", conta: "Receber na conta", verbo: "recebimento" },
} as const;

export const CATEGORIAS_TITULO: Record<TipoTitulo, string[]> = {
  pagar: ["Fornecedores", "Aluguel", "Energia", "Água", "Internet / telefone", "Funcionários", "Impostos", "Manutenção", "Embalagens", "Marketing", "Outros"],
  receber: ["Clientes", "Fiado", "Eventos", "Reembolso", "Outros"],
};

/** Dias entre duas datas AAAA-MM-DD (positivo se `ate` é depois de `de`). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export type Situacao =
  | { tipo: "vencida"; texto: string }
  | { tipo: "hoje"; texto: string }
  | { tipo: "proxima"; texto: string }
  | { tipo: "em-dia"; texto: string }
  | { tipo: "paga"; texto: string }
  | { tipo: "cancelada"; texto: string };

/** Situação para mostrar na lista (vencida, vence hoje, vence em N dias, paga…). */
export function situacaoTitulo(t: Pick<Titulo, "status" | "vencimento" | "pago_em" | "tipo">, hoje: string): Situacao {
  if (t.status === "cancelado") return { tipo: "cancelada", texto: "Cancelada" };
  if (t.status === "pago") return { tipo: "paga", texto: `${TEXTOS_TITULO[t.tipo].feito} em ${dataBr(t.pago_em ?? "")}` };
  const d = diasEntre(hoje, t.vencimento);
  if (d < 0) return { tipo: "vencida", texto: d === -1 ? "Venceu ontem" : `Vencida há ${-d} dias` };
  if (d === 0) return { tipo: "hoje", texto: "Vence hoje" };
  if (d <= 7) return { tipo: "proxima", texto: d === 1 ? "Vence amanhã" : `Vence em ${d} dias` };
  return { tipo: "em-dia", texto: `Vence em ${dataBr(t.vencimento)}` };
}

/** Totais do topo: vencidas, que vencem em 7 dias e total em aberto. */
export function resumoTitulos(titulos: Pick<Titulo, "status" | "vencimento" | "valor">[], hoje: string) {
  const abertos = titulos.filter((t) => t.status === "aberto");
  const soma = (l: typeof abertos) => ({ quantidade: l.length, valor: l.reduce((s, t) => s + t.valor, 0) });
  return {
    vencidas: soma(abertos.filter((t) => diasEntre(hoje, t.vencimento) < 0)),
    proximas: soma(abertos.filter((t) => { const d = diasEntre(hoje, t.vencimento); return d >= 0 && d <= 7; })),
    abertas: soma(abertos),
  };
}

export function dataBr(iso: string): string {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}
