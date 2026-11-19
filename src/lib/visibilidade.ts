import { controlaSaldo, saldoVendavel, type Produto } from "./tipos";

export type Visibilidade = "automatico" | "visivel" | "oculto";
export const OPCOES_VISIBILIDADE: [Visibilidade, string][] = [
  ["automatico", "Automático pelo estoque"], ["visivel", "Sempre visível"], ["oculto", "Sempre oculto"],
];

export function modoVisibilidade(p: Pick<Produto, "ativo" | "visibilidade">): Visibilidade {
  return !p.ativo ? "oculto" : p.visibilidade ?? "automatico";
}

/** Exibir não autoriza vender sem saldo. A venda continua validada no banco. */
export function produtoVisivel(p: Produto): boolean {
  const modo = modoVisibilidade(p);
  if (modo === "oculto") return false;
  if (modo === "visivel") return true;
  return !p.consumo_proprio && !p.preco_pendente && (!controlaSaldo(p) || saldoVendavel(p) > 0);
}
