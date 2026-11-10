import { NOMES_PAGAMENTO, type Configuracoes, type FormaPagamento, type Produto, type RegiaoEntrega } from "./tipos";
import { apenasDigitos, formatarPreco, mascararTelefone, paraCentavos } from "./utils";

export interface LinhaCarrinho {
  produto: Produto;
  quantidade: number;
  total: number;
  indisponivel: boolean;
}

/** Junta o carrinho (id -> qtd) com o cardápio atual. Ignora produtos que sumiram. */
export function montarLinhas(itens: Record<string, number>, produtos: Produto[]): LinhaCarrinho[] {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  return Object.entries(itens)
    .map(([id, quantidade]) => {
      const produto = porId.get(id);
      if (!produto || quantidade <= 0) return null;
      const indisponivel = !produto.disponivel || !produto.ativo;
      return { produto, quantidade, total: produto.preco * quantidade, indisponivel };
    })
    .filter((l): l is LinhaCarrinho => l !== null);
}

export function calcularSubtotal(linhas: LinhaCarrinho[]): number {
  return linhas.filter((l) => !l.indisponivel).reduce((s, l) => s + l.total, 0);
}

export function contarItens(linhas: LinhaCarrinho[]): number {
  return linhas.filter((l) => !l.indisponivel).reduce((s, l) => s + l.quantidade, 0);
}

export type TipoPedido = "entrega" | "retirada";

export interface DadosCheckout {
  nome: string;
  telefone: string;
  tipo: TipoPedido;
  regiaoId: string;
  endereco: string;
  complemento: string;
  pagamento: FormaPagamento | "";
  troco: string; // "100,00" ou vazio = sem troco
  observacoes: string;
}

export interface Totais {
  subtotal: number;
  taxa: number;
  total: number;
  regiao: RegiaoEntrega | null;
}

export function calcularTotais(subtotal: number, dados: Pick<DadosCheckout, "tipo" | "regiaoId">, regioes: RegiaoEntrega[]): Totais {
  const regiao = dados.tipo === "entrega" ? (regioes.find((r) => r.id === dados.regiaoId && r.ativa) ?? null) : null;
  const taxa = regiao?.taxa ?? 0;
  return { subtotal, taxa, total: subtotal + taxa, regiao };
}

export type ErrosCheckout = Partial<Record<keyof DadosCheckout | "geral", string>>;

export function validarCheckout(
  dados: DadosCheckout,
  config: Configuracoes,
  totais: Totais,
): ErrosCheckout {
  const erros: ErrosCheckout = {};
  if (dados.nome.trim().length < 2) erros.nome = "Informe seu nome.";
  const tel = apenasDigitos(dados.telefone);
  if (tel.length < 10 || tel.length > 11) erros.telefone = "Informe um telefone com DDD.";

  if (dados.tipo === "entrega") {
    if (!config.aceita_entrega) erros.tipo = "No momento não estamos fazendo entregas.";
    if (!totais.regiao) erros.regiaoId = "Escolha a região de entrega.";
    if (dados.endereco.trim().length < 5) erros.endereco = "Informe rua e número.";
  } else if (!config.aceita_retirada) {
    erros.tipo = "No momento não estamos aceitando retirada.";
  }

  if (!dados.pagamento || !config.pagamentos.includes(dados.pagamento)) {
    erros.pagamento = "Escolha a forma de pagamento.";
  } else if (dados.pagamento === "dinheiro" && dados.troco.trim()) {
    const troco = paraCentavos(dados.troco);
    if (troco === null) erros.troco = "Valor inválido.";
    else if (troco < totais.total) erros.troco = `O troco precisa ser para ${formatarPreco(totais.total)} ou mais.`;
  }

  if (apenasDigitos(config.whatsapp).length < 12) erros.geral = "A loja ainda não configurou o WhatsApp de pedidos.";
  else if (totais.subtotal <= 0) erros.geral = "Seu carrinho está vazio.";
  else if (totais.subtotal < config.pedido_minimo)
    erros.geral = `O pedido mínimo é de ${formatarPreco(config.pedido_minimo)}.`;

  return erros;
}

/** Monta o texto do pedido com a formatação do WhatsApp (*negrito*). */
export function montarMensagem({
  config,
  linhas,
  dados,
  totais,
  numero,
}: {
  config: Configuracoes;
  linhas: LinhaCarrinho[];
  dados: DadosCheckout;
  totais: Totais;
  numero?: number | null;
}): string {
  const l: string[] = [];
  l.push(`*Novo pedido · ${config.nome}*${numero ? ` — #${numero}` : ""}`);
  l.push("");
  l.push("*Itens*");
  for (const it of linhas.filter((x) => !x.indisponivel)) {
    l.push(`${it.quantidade}x ${it.produto.nome} — ${formatarPreco(it.total)}`);
  }
  l.push("");
  l.push(`Subtotal: ${formatarPreco(totais.subtotal)}`);
  if (dados.tipo === "entrega") {
    l.push(`Taxa de entrega (${totais.regiao?.nome ?? "-"}): ${totais.taxa ? formatarPreco(totais.taxa) : "Grátis"}`);
  }
  l.push(`*Total: ${formatarPreco(totais.total)}*`);
  l.push("");
  l.push("*Cliente*");
  l.push(`Nome: ${dados.nome.trim()}`);
  l.push(`Telefone: ${mascararTelefone(dados.telefone)}`);
  l.push("");
  if (dados.tipo === "entrega") {
    l.push("*Entrega*");
    l.push(`Endereço: ${dados.endereco.trim()}${dados.complemento.trim() ? ` — ${dados.complemento.trim()}` : ""}`);
    l.push(`Região: ${totais.regiao?.nome ?? "-"}`);
  } else {
    l.push("*Retirada na loja*");
    if (config.endereco) l.push(config.endereco);
  }
  l.push("");
  l.push("*Pagamento*");
  if (dados.pagamento === "dinheiro") {
    const troco = dados.troco.trim() ? paraCentavos(dados.troco) : null;
    l.push(
      troco
        ? `Dinheiro — troco para ${formatarPreco(troco)} (levar ${formatarPreco(troco - totais.total)})`
        : "Dinheiro — sem troco",
    );
  } else if (dados.pagamento) {
    l.push(NOMES_PAGAMENTO[dados.pagamento]);
  }
  if (dados.observacoes.trim()) {
    l.push("");
    l.push("*Observações*");
    l.push(dados.observacoes.trim());
  }
  return l.join("\n");
}

export function linkWhatsApp(numero: string, mensagem: string): string {
  return `https://wa.me/${apenasDigitos(numero)}?text=${encodeURIComponent(mensagem)}`;
}
