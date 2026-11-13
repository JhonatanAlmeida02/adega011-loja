import type { Categoria, Produto } from "./tipos";

/** Subcategoria dentro da seção (nome null = produtos da própria categoria principal). */
export interface GrupoSecao {
  id: string;
  nome: string | null;
  produtos: Produto[];
}

/** A vitrine exibe cada SKU de variação em seu próprio cartão. */
export interface Secao {
  id: string;
  nome: string;
  /** Todos os produtos da seção, na ordem em que aparecem (principal e depois cada subcategoria). */
  produtos: Produto[];
  grupos: GrupoSecao[];
}

export function montarSecoes(categorias: Categoria[], produtos: Produto[]): Secao[] {
  const visiveis = produtos.filter((p) => p.ativo).sort((a, b) => a.ordem - b.ordem);
  const ids = new Set(categorias.map((c) => c.id));
  const ehSub = (c: Categoria) => !!c.pai_id && c.pai_id !== c.id && ids.has(c.pai_id);
  const ativas = categorias.filter((c) => c.ativa).sort((a, b) => a.ordem - b.ordem);
  const daCategoria = (id: string) => visiveis.filter((p) => p.categoria_id === id);

  const secoes: Secao[] = ativas
    .filter((c) => !ehSub(c))
    .map((c) => {
      const grupos: GrupoSecao[] = [
        { id: c.slug, nome: null, produtos: daCategoria(c.id) },
        // Subcategoria oculta esconde os seus produtos, como uma categoria oculta
        ...ativas.filter((s) => ehSub(s) && s.pai_id === c.id).map((s) => ({ id: s.slug, nome: s.nome, produtos: daCategoria(s.id) })),
      ].filter((g) => g.produtos.length > 0);
      return { id: c.slug, nome: c.nome, grupos, produtos: grupos.flatMap((g) => g.produtos) };
    })
    .filter((s) => s.produtos.length > 0);
  // Produtos de categorias inativas somem; os sem categoria vão para "Outros".
  const orfaos = visiveis.filter((p) => !p.categoria_id);
  if (orfaos.length) secoes.push({ id: "outros", nome: "Outros", produtos: orfaos, grupos: [{ id: "outros", nome: null, produtos: orfaos }] });
  return secoes;
}
