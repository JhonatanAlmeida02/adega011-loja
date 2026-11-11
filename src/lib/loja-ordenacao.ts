import type { Produto } from "./tipos";

/** Grupos de adicionais e opções na ordem definida no painel. */
export function ordenarGrupos(p: Produto): Produto {
  return {
    ...p,
    grupos: [...(p.grupos ?? [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((g) => ({ ...g, opcoes: [...g.opcoes].sort((a, b) => a.ordem - b.ordem) })),
  };
}
