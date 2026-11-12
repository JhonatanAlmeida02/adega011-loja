"use client";

import { ChevronDown } from "lucide-react";
import type { GrupoOpcoes } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { FotoProduto } from "./foto-produto";

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

/** Grupos expansíveis com rádio ou múltipla escolha, mantendo as regras do cadastro. */
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
          <fieldset key={g.id} data-grupo={g.id} tabIndex={-1} className="min-w-0 scroll-mt-4 outline-none focus-visible:ring-2 focus-visible:ring-foco">
            <legend className="sr-only">{g.nome}</legend>
            <details className="group rounded-lg border border-borda bg-superficie">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg bg-superficie-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div><h3 className="text-sm font-semibold">{g.nome}</h3><p className="mt-0.5 text-xs text-suave">{g.minimo === g.maximo && g.minimo > 0 ? `Escolha ${g.minimo} ${g.minimo === 1 ? "opção" : "opções"}` : g.minimo > 0 ? `Escolha de ${g.minimo} a ${g.maximo} opções` : `Escolha até ${g.maximo} ${g.maximo === 1 ? "opção" : "opções"}`}</p>{escolhidas.length > 0 && <p className="mt-1 text-xs text-rosa-texto">{g.opcoes.filter((o) => escolhidas.includes(o.id)).map((o) => o.nome).join(", ")}</p>}</div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="text-suave" aria-label={`${escolhidas.length} de ${g.maximo} escolhas`}>{escolhidas.length}/{g.maximo}</span>
                <span className={cn("rounded px-2 py-1 text-[.65rem] font-semibold", g.minimo > 0 && escolhidas.length < g.minimo ? "bg-texto text-fundo" : "bg-superficie-3 text-suave")}>
                  {g.minimo > 0 ? "Obrigatório" : "Opcional"}
                </span>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-suave transition-transform group-open:rotate-180" />
              </div>
            </summary>
            <div className="divide-y divide-borda px-4">
              {g.opcoes.map((o) => {
                const marcada = escolhidas.includes(o.id);
                const bloqueada = !o.disponivel || (!marcada && !unica && escolhidas.length >= g.maximo);
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "relative flex min-h-16 cursor-pointer items-center gap-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco",
                      marcada && "text-rosa-texto",
                      bloqueada && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type={unica ? "radio" : "checkbox"}
                      name={`${idBase}-${g.id}`}
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
                    {g.opcoes.some((x) => x.foto_url) && (
                      <FotoProduto src={o.foto_url ?? null} alt="" sizes="44px" className="size-11 shrink-0 rounded-md" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{o.nome}</span>
                      <span className={cn("mt-1 block text-xs", !o.disponivel ? "text-suave" : o.preco ? "text-rosa-texto" : "text-suave")}>
                        {!o.disponivel ? "Indisponível no momento" : o.preco ? `+ ${formatarPreco(o.preco)}` : "Incluso"}
                      </span>
                    </span>
                    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center border-2", unica ? "rounded-full" : "rounded", marcada ? "border-rosa bg-rosa" : "border-suave")}>
                      {marcada && (unica ? <span className="size-2 rounded-full bg-preto" /> : <span className="text-xs font-bold text-preto">✓</span>)}
                    </span>
                  </label>
                );
              })}
              </div>
            </details>
          </fieldset>
        );
      })}
    </div>
  );
}
