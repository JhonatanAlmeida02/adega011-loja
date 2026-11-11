"use client";

import type { GrupoOpcoes } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";

export type Selecao = Record<string, string[]>; // grupoId -> opções escolhidas

export function opcoesEscolhidas(sel: Selecao): string[] {
  return Object.values(sel).flat();
}

export function acrescimo(grupos: GrupoOpcoes[], sel: Selecao): number {
  const precos = new Map(grupos.flatMap((g) => g.opcoes).map((o) => [o.id, o.preco]));
  return opcoesEscolhidas(sel).reduce((s, id) => s + (precos.get(id) ?? 0), 0);
}

/** Primeira regra não atendida (ex.: grupo obrigatório sem escolha), ou null. */
export function pendencia(grupos: GrupoOpcoes[], sel: Selecao): string | null {
  for (const g of grupos) {
    const n = sel[g.id]?.length ?? 0;
    if (n < g.minimo) return g.minimo === 1 ? `Escolha uma opção em “${g.nome}”` : `Escolha ${g.minimo} em “${g.nome}”`;
  }
  return null;
}

function regra(g: GrupoOpcoes): string {
  if (g.minimo > 0 && g.minimo === g.maximo) return g.minimo === 1 ? "Obrigatório · escolha 1" : `Obrigatório · escolha ${g.minimo}`;
  if (g.minimo > 0) return `Obrigatório · ${g.minimo} a ${g.maximo}`;
  return g.maximo === 1 ? "Opcional" : `Opcional · até ${g.maximo}`;
}

/** Lista de grupos de adicionais com rádio (máx. 1) ou caixas de seleção. */
export function EscolhaOpcoes({
  grupos,
  selecao,
  onChange,
  idBase,
}: {
  grupos: GrupoOpcoes[];
  selecao: Selecao;
  onChange: (s: Selecao) => void;
  idBase: string;
}) {
  const alternar = (g: GrupoOpcoes, opcaoId: string) => {
    const atual = selecao[g.id] ?? [];
    let novo: string[];
    if (atual.includes(opcaoId)) novo = atual.filter((x) => x !== opcaoId);
    else if (g.maximo === 1) novo = [opcaoId];
    else if (atual.length >= g.maximo) return;
    else novo = [...atual, opcaoId];
    onChange({ ...selecao, [g.id]: novo });
  };

  return (
    <div className="space-y-5">
      {grupos.map((g) => {
        const escolhidas = selecao[g.id] ?? [];
        const unica = g.maximo === 1;
        return (
          <fieldset key={g.id} className="rounded-2xl border border-borda bg-superficie-2 p-3">
            <legend className="sr-only">{g.nome}</legend>
            <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <span className="font-bold" aria-hidden>
                {g.nome}
              </span>
              <span
                className={cn(
                  "rotulo rounded-full px-2 py-0.5 text-[0.65rem]",
                  g.minimo > 0 && escolhidas.length < g.minimo ? "bg-rosa text-preto" : "text-suave",
                )}
              >
                {regra(g)}
              </span>
            </div>
            <div className="space-y-1.5">
              {g.opcoes.map((o) => {
                const marcada = escolhidas.includes(o.id);
                const bloqueada = !o.disponivel || (!marcada && !unica && escolhidas.length >= g.maximo);
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-foco",
                      marcada ? "border-rosa bg-rosa/10" : "border-transparent bg-superficie hover:border-rosa/40",
                      bloqueada && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type={unica ? "radio" : "checkbox"}
                      name={`${idBase}-${g.id}`}
                      className="sr-only"
                      checked={marcada}
                      disabled={bloqueada}
                      onChange={() => alternar(g, o.id)}
                      onClick={(e) => {
                        // rádio opcional: clicar de novo desmarca
                        if (unica && marcada && g.minimo === 0) {
                          e.preventDefault();
                          onChange({ ...selecao, [g.id]: [] });
                        }
                      }}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-5 shrink-0 place-items-center border-2",
                        unica ? "rounded-full" : "rounded-md",
                        marcada ? "border-rosa bg-rosa" : "border-suave",
                      )}
                    >
                      {marcada && (unica ? <span className="size-2 rounded-full bg-preto" /> : <span className="text-xs font-bold text-preto">✓</span>)}
                    </span>
                    <span className="flex-1">
                      {o.nome}
                      {!o.disponivel && <span className="ml-2 text-xs text-suave">esgotado</span>}
                    </span>
                    <span className="font-mono text-sm text-amarelo-texto">{o.preco ? `+ ${formatarPreco(o.preco)}` : "grátis"}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
