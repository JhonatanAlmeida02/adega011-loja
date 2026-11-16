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

/* ------------------------------------------------------------------ */
/* Datas para o calendário e o filtro por período (AAAA-MM-DD, sem fuso) */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Soma meses a um "AAAA-MM". */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Último dia (AAAA-MM-DD) do mês "AAAA-MM". */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return iso(new Date(Date.UTC(a, m, 0)));
}

/** Semanas do calendário (domingo a sábado) cobrindo o mês, com os dias de fora marcados. */
export function semanasDoMes(mes: string): { data: string; doMes: boolean }[][] {
  const [a, m] = mes.split("-").map(Number);
  const primeiro = new Date(Date.UTC(a, m - 1, 1));
  const inicio = new Date(primeiro);
  inicio.setUTCDate(1 - primeiro.getUTCDay());
  const ultimo = Date.parse(`${fimDoMes(mes)}T00:00:00Z`);
  const semanas: { data: string; doMes: boolean }[][] = [];
  const d = new Date(inicio);
  while (d.getTime() <= ultimo || d.getUTCDay() !== 0) {
    if (d.getUTCDay() === 0) semanas.push([]);
    semanas[semanas.length - 1].push({ data: iso(d), doMes: d.getUTCMonth() === m - 1 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return semanas;
}

export const NOMES_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "Novembro de 2026" */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${NOMES_MESES[m - 1]} de ${a}`;
}

export type Periodo = "tudo" | "mes" | "proximo" | "ano" | "personalizado";

/** Intervalo [de, ate] do período (null = sem limite). */
export function intervaloPeriodo(periodo: Periodo, hoje: string, de = "", ate = ""): { de: string | null; ate: string | null } {
  const mes = hoje.slice(0, 7);
  if (periodo === "mes") return { de: `${mes}-01`, ate: fimDoMes(mes) };
  if (periodo === "proximo") { const p = somarMeses(mes, 1); return { de: `${p}-01`, ate: fimDoMes(p) }; }
  if (periodo === "ano") return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` };
  if (periodo === "personalizado") return { de: de || null, ate: ate || null };
  return { de: null, ate: null };
}

/**
 * Filtro por período: contas pagas pela data do pagamento, as outras pelo
 * vencimento. Contas em aberto vencidas ANTES do período continuam aparecendo
 * (para ninguém se perder com uma conta atrasada fora do filtro).
 */
export function noPeriodo(t: Pick<Titulo, "status" | "vencimento" | "pago_em">, intervalo: { de: string | null; ate: string | null }, hoje: string): boolean {
  const data = t.status === "pago" ? (t.pago_em ?? t.vencimento) : t.vencimento;
  if (t.status === "aberto" && t.vencimento < hoje && (!intervalo.de || t.vencimento < intervalo.de)) return true;
  return (!intervalo.de || data >= intervalo.de) && (!intervalo.ate || data <= intervalo.ate);
}
