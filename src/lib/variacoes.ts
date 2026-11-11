import { produtoDisponivel, type Produto } from "./tipos";

/** Group visible SKUs for display. Never pass these synthetic cards to checkout. */
export function agruparVariacoes(produtos: Produto[]): Produto[] {
  const familias = new Map<string, Produto[]>();
  for (const p of produtos) {
    if (p.familia_id) {
      const lista = familias.get(p.familia_id) ?? [];
      lista.push(p); familias.set(p.familia_id, lista);
    }
  }
  const vistos = new Set<string>();
  return produtos.flatMap((p) => {
    if (!p.familia_id) return [p];
    if (vistos.has(p.familia_id)) return [];
    vistos.add(p.familia_id);
    const variacoes = familias.get(p.familia_id)!;
    const precificadas = variacoes.filter((v) => !v.preco_pendente);
    const vendaveis = precificadas.filter(produtoDisponivel);
    return [{ ...p, id: `familia-${p.familia_id}`, nome: p.familia_nome || p.nome,
      preco_pendente: precificadas.length === 0,
      preco: Math.min(...(vendaveis.length ? vendaveis : precificadas.length ? precificadas : variacoes).map((v) => v.preco)),
      ativo: variacoes.some((v) => v.ativo), disponivel: vendaveis.length > 0, controla_estoque: false, eh_kit: false,
      destaque: variacoes.some((v) => v.destaque), variacoes }];
  });
}

export function textoBuscaProduto(p: Produto): string {
  return `${p.nome} ${p.descricao} ${(p.variacoes ?? []).map((v) => v.nome).join(" ")}`;
}
