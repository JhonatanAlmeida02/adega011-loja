import type { Categoria, Produto } from "./tipos";

/** A vitrine exibe cada SKU de variação em seu próprio cartão. */
interface Secao {
  id: string;
  nome: string;
  produtos: Produto[];
}

export function montarSecoes(categorias: Categoria[], produtos: Produto[]): Secao[] {
  const visiveis = produtos.filter((p) => p.ativo).sort((a, b) => a.ordem - b.ordem);
  const ativas = categorias.filter((c) => c.ativa).sort((a, b) => a.ordem - b.ordem);
  const secoes: Secao[] = ativas
    .map((c) => ({ id: c.slug, nome: c.nome, produtos: visiveis.filter((p) => p.categoria_id === c.id) }))
    .filter((s) => s.produtos.length > 0);
  // Produtos de categorias inativas somem; os sem categoria vão para "Outros".
  const orfaos = visiveis.filter((p) => !p.categoria_id);
  if (orfaos.length) secoes.push({ id: "outros", nome: "Outros", produtos: orfaos });
  return secoes;
}

