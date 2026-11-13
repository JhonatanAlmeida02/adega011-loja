import type { Categoria } from "./tipos";

/**
 * Categorias em árvore de um nível: cada principal seguida das suas
 * subcategorias (ex.: Destilados, Vodka, Gin, Whisky). Uma subcategoria cuja
 * principal não existe mais é tratada como principal.
 */
export function ordenarArvore<T extends Categoria>(categorias: T[]): (T & { nivel: 0 | 1 })[] {
  const ids = new Set(categorias.map((c) => c.id));
  const porOrdem = [...categorias].sort((a, b) => a.ordem - b.ordem);
  const ehSub = (c: T) => !!c.pai_id && c.pai_id !== c.id && ids.has(c.pai_id);
  return porOrdem
    .filter((c) => !ehSub(c))
    .flatMap((pai) => [
      { ...pai, nivel: 0 as const },
      ...porOrdem.filter((c) => ehSub(c) && c.pai_id === pai.id).map((c) => ({ ...c, nivel: 1 as const })),
    ]);
}

/** "Destilados › Vodka" para subcategorias; o próprio nome para as principais. */
export function rotuloCategoria(c: Categoria, categorias: Categoria[]): string {
  const pai = c.pai_id ? categorias.find((x) => x.id === c.pai_id && x.id !== c.id) : undefined;
  return pai ? `${pai.nome} › ${c.nome}` : c.nome;
}

/** A categoria e as suas subcategorias (para filtrar "Destilados" e ver Vodka, Gin…). */
export function idsDaCategoria(id: string, categorias: Categoria[]): Set<string> {
  return new Set([id, ...categorias.filter((c) => c.pai_id === id).map((c) => c.id)]);
}
