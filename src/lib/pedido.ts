import type { LinhaSalva } from "./carrinho";
import {
  NOMES_PAGAMENTO,
  produtoDisponivel,
  type Configuracoes,
  type FormaPagamento,
  type Opcao,
  type Produto,
  type RegiaoEntrega,
} from "./tipos";
import { apenasDigitos, formatarPreco, mascararTelefone, paraCentavos } from "./utils";

export interface LinhaCarrinho {
  chave: string;
  produto: Produto;
  opcoes: Opcao[];
  quantidade: number;
  unitario: number; // preço do produto + adicionais
  total: number;
  indisponivel: boolean;
  motivo?: string;
}

/** Junta o carrinho salvo com o cardápio atual. Ignora produtos que sumiram. */
export function montarLinhas(itens: Record<string, LinhaSalva>, produtos: Produto[]): LinhaCarrinho[] {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const linhas: LinhaCarrinho[] = [];
  for (const [chave, salva] of Object.entries(itens)) {
    const produto = porId.get(salva.produtoId);
    if (!produto || salva.quantidade <= 0) continue;
    const todas = new Map((produto.grupos ?? []).flatMap((g) => g.opcoes).map((o) => [o.id, o]));
    const opcoes = salva.opcoes.map((id) => todas.get(id)).filter((o): o is Opcao => !!o);
    let motivo: string | undefined;
    if (!produtoDisponivel(produto)) motivo = "Esgotado";
    else if (opcoes.length !== salva.opcoes.length || opcoes.some((o) => !o.disponivel)) motivo = "Adicional indisponível";
    const unitario = produto.preco + opcoes.reduce((s, o) => s + o.preco, 0);
    linhas.push({
      chave,
      produto,
      opcoes,
      quantidade: salva.quantidade,
      unitario,
      total: unitario * salva.quantidade,
      indisponivel: !!motivo,
      motivo,
    });
  }
  return linhas;
}

export function calcularSubtotal(linhas: LinhaCarrinho[]): number {
  return linhas.filter((l) => !l.indisponivel).reduce((s, l) => s + l.total, 0);
}

export function contarItens(linhas: LinhaCarrinho[]): number {
  return linhas.filter((l) => !l.indisponivel).reduce((s, l) => s + l.quantidade, 0);
}

/** "Copão de Askov (+ Baly)" */
export function nomeComOpcoes(nome: string, opcoes: { nome: string }[] = []): string {
  return opcoes.length ? `${nome} (+ ${opcoes.map((o) => o.nome).join(", ")})` : nome;
}

export type TipoPedido = "entrega" | "retirada";

/** Cotação de frete calculada no servidor (Edge Function cotar-frete). */
export interface CotacaoFrete {
  id: string;
  km: number;
  taxa: number;
  endereco: string; // "Rua X, 10, Bairro, Cidade" (o pedido precisa começar com isso)
  endereco_formatado: string;
  expira_em: string;
}

export interface DadosCheckout {
  nome: string;
  telefone: string;
  tipo: TipoPedido;
  regiaoId: string;
  endereco: string; // rua e número
  bairro: string;
  cidade: string;
  complemento: string;
  cep?: string; // "13250-000" (opcional; preenche o endereço pela busca de CEP)
  pagamento: FormaPagamento | "";
  troco: string; // "100,00" ou vazio = sem troco
  observacoes: string;
}

/** Endereço que vai para o cálculo do frete por distância. */
export function enderecoParaCotacao(d: Pick<DadosCheckout, "endereco" | "bairro" | "cidade">): string {
  return [d.endereco, d.bairro, d.cidade].map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean).join(", ");
}

/** A cotação ainda vale para o endereço digitado agora? */
export function cotacaoValida(cotacao: CotacaoFrete | null, d: Pick<DadosCheckout, "endereco" | "bairro" | "cidade">): boolean {
  if (!cotacao) return false;
  // A validade (45 min) é conferida no servidor; aqui não usamos o relógio do
  // aparelho, que pode estar errado.
  return cotacao.endereco.toLowerCase() === enderecoParaCotacao(d).toLowerCase();
}

export interface Totais {
  subtotal: number;
  taxa: number;
  total: number;
  regiao: RegiaoEntrega | null;
  km: number | null;
  /** true quando a taxa já é conhecida (região escolhida ou frete calculado) */
  taxaDefinida: boolean;
}

export function calcularTotais(
  subtotal: number,
  dados: Pick<DadosCheckout, "tipo" | "regiaoId" | "endereco" | "bairro" | "cidade">,
  regioes: RegiaoEntrega[],
  config?: Pick<Configuracoes, "modo_frete">,
  cotacao: CotacaoFrete | null = null,
): Totais {
  if (dados.tipo !== "entrega") return { subtotal, taxa: 0, total: subtotal, regiao: null, km: null, taxaDefinida: true };
  if (config?.modo_frete === "distancia") {
    const ok = cotacaoValida(cotacao, dados);
    const taxa = ok ? cotacao!.taxa : 0;
    return { subtotal, taxa, total: subtotal + taxa, regiao: null, km: ok ? cotacao!.km : null, taxaDefinida: ok };
  }
  const regiao = regioes.find((r) => r.id === dados.regiaoId && r.ativa) ?? null;
  const taxa = regiao?.taxa ?? 0;
  return { subtotal, taxa, total: subtotal + taxa, regiao, km: null, taxaDefinida: !!regiao };
}

export type ErrosCheckout = Partial<Record<keyof DadosCheckout | "geral" | "frete", string>>;

export function validarCheckout(dados: DadosCheckout, config: Configuracoes, totais: Totais): ErrosCheckout {
  const erros: ErrosCheckout = {};
  if (dados.nome.trim().length < 2) erros.nome = "Informe seu nome.";
  const tel = apenasDigitos(dados.telefone);
  if (tel.length < 10 || tel.length > 11) erros.telefone = "Informe um telefone com DDD.";

  if (dados.tipo === "entrega") {
    if (!config.aceita_entrega) erros.tipo = "No momento não estamos fazendo entregas.";
    if (dados.endereco.trim().length < 5) erros.endereco = "Informe rua e número.";
    if (config.modo_frete === "distancia") {
      if (dados.bairro.trim().length < 2) erros.bairro = "Informe o bairro.";
      if (!totais.taxaDefinida && !erros.endereco && !erros.bairro) erros.frete = "Calcule a taxa de entrega.";
    } else if (!totais.regiao) {
      erros.regiaoId = "Escolha a região de entrega.";
    }
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

/** Endereço completo gravado no pedido. */
export function enderecoCompleto(dados: DadosCheckout, config: Pick<Configuracoes, "modo_frete">): string {
  const base = config.modo_frete === "distancia" ? enderecoParaCotacao(dados) : dados.endereco.trim();
  // O CEP vem depois do endereço: o servidor confere se o endereço do pedido começa
  // com o endereço do frete calculado.
  const cep = dados.cep?.replace(/\D/g, "").length === 8 ? ` · CEP ${dados.cep}` : "";
  return [base + cep, dados.complemento.trim()].filter(Boolean).join(" — ");
}

const km = (n: number) => `${n.toFixed(1).replace(".", ",")} km`;

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
    l.push(`${it.quantidade}x ${nomeComOpcoes(it.produto.nome, it.opcoes)} — ${formatarPreco(it.total)}`);
  }
  l.push("");
  l.push(`Subtotal: ${formatarPreco(totais.subtotal)}`);
  if (dados.tipo === "entrega") {
    const detalhe = totais.km != null ? km(totais.km) : (totais.regiao?.nome ?? "-");
    l.push(`Taxa de entrega (${detalhe}): ${totais.taxa ? formatarPreco(totais.taxa) : "Grátis"}`);
  }
  l.push(`*Total: ${formatarPreco(totais.total)}*`);
  l.push("");
  l.push("*Cliente*");
  l.push(`Nome: ${dados.nome.trim()}`);
  l.push(`Telefone: ${mascararTelefone(dados.telefone)}`);
  l.push("");
  if (dados.tipo === "entrega") {
    l.push("*Entrega*");
    l.push(`Endereço: ${enderecoCompleto(dados, config)}`);
    if (config.modo_frete === "distancia") {
      if (totais.km != null) l.push(`Distância: ${km(totais.km)}`);
    } else {
      l.push(`Região: ${totais.regiao?.nome ?? "-"}`);
    }
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
