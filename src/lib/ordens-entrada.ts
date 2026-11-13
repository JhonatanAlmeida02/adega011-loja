import type { Produto } from "./tipos";

export const LIMITE_XML = 3 * 1024 * 1024;
export type StatusEntrada = "pendente" | "lancada" | "cancelada";
export interface OrdemEntrada {
  id: string; numero: number; chave: string; nota_numero: string; serie: string;
  fornecedor_nome: string; fornecedor_documento: string; destinatario_documento: string | null;
  emitida_em: string | null; total_nota: number; arquivo_nome: string; status: StatusEntrada;
  versao: number; observacoes: string; criado_em: string; lancado_em: string | null;
}
export interface ItemEntrada {
  id: string; ordem_id: string; numero_item: number; codigo_fornecedor: string; ean: string | null;
  descricao: string; unidade_nota: string; quantidade_nota: number; custo_nota: number; total_item: number;
  produto_id: string | null; quantidade_recebida: number | null; fator: number | null;
  unidade_estoque: "un" | "ml" | null; custo_conferido: number | null;
  conferido: boolean; ignorar: boolean; produto_nome_snapshot: string | null; quantidade_lancada: number | null;
}
export const COLUNAS_ORDEM = "id,numero,chave,nota_numero,serie,fornecedor_nome,fornecedor_documento,destinatario_documento,emitida_em,total_nota,arquivo_nome,status,versao,observacoes,criado_em,lancado_em";

export function decodificarXml(bytes: Uint8Array): string {
  if (!bytes.length || bytes.byteLength > LIMITE_XML) throw new Error("Envie um XML de até 3 MB.");
  const inicio = new TextDecoder("ascii").decode(bytes.slice(0, 250));
  const encoding = inicio.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "utf-8";
  if (!["utf-8", "utf8", "iso-8859-1", "windows-1252"].includes(encoding)) throw new Error("O XML precisa estar em UTF-8 ou ISO-8859-1.");
  let xml: string;
  try { xml = new TextDecoder(encoding === "utf8" ? "utf-8" : encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error("Não foi possível ler a codificação do XML."); }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml)) throw new Error("XML com DTD ou entidades externas não é permitido.");
  if (new TextEncoder().encode(xml).byteLength > LIMITE_XML) throw new Error("O conteúdo do XML excede 3 MB.");
  return xml;
}

export function quantidadeEntrada(item: Pick<ItemEntrada, "quantidade_recebida" | "fator">): number | null {
  if (item.quantidade_recebida == null || item.fator == null) return null;
  const quantidade = item.quantidade_recebida * item.fator;
  const inteiro = Math.round(quantidade);
  return Number.isFinite(quantidade) && quantidade > 0 && Math.abs(quantidade - inteiro) < 1e-7 && inteiro <= 1_000_000_000 ? inteiro : null;
}

export function pendenciaEntrada(item: ItemEntrada, produto?: Produto): string | null {
  if (!item.conferido) return "Marque o item como conferido.";
  if (item.ignorar) return null;
  if (!produto || produto.eh_kit || !produto.controla_estoque) return "Vincule um produto simples com controle de estoque.";
  if (item.unidade_estoque !== (produto.unidade_estoque ?? "un")) return "Confira a unidade do produto.";
  if (quantidadeEntrada(item) === null) return "Confira a quantidade e o fator de conversão.";
  if (item.custo_conferido == null || !Number.isFinite(item.custo_conferido) || item.custo_conferido < 0) return "Confira o custo.";
  return null;
}

/** Sugestão explícita, nunca interpretamos CX/PCT/FD como uma unidade solta. */
export function sugerirFator(unidadeNota: string, produto: Produto): number | null {
  const unidade = unidadeNota.trim().toUpperCase();
  const ml = produto.unidade_estoque === "ml";
  if (ml) {
    if (["L", "LT", "LITRO"].includes(unidade)) return 1000;
    if (unidade === "ML") return 1;
    if (["UN", "UND", "UNID", "GF", "GFA"].includes(unidade)) return produto.volume_unidade ?? null;
  } else if (["UN", "UND", "UNID"].includes(unidade)) {
    return produto.vende_pacote ? produto.unidades_pacote ?? null : 1;
  }
  return null;
}
