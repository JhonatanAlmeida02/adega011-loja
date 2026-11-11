"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { combina } from "@/lib/busca";
import type { DadosLoja, Produto } from "@/lib/tipos";
import { textoBuscaProduto } from "@/lib/variacoes";
import { montarSecoes } from "@/lib/catalogo-secoes";
import { cn } from "@/lib/utils";
import { DivisorRua } from "@/components/marca/grafismos";
import { CardProduto } from "./card-produto";
import { ProdutoDetalhe } from "./produto-detalhe";

export function Catalogo({ loja }: { loja: DadosLoja }) {
  const secoes = useMemo(() => montarSecoes(loja.categorias, loja.produtos), [loja.categorias, loja.produtos]);
  const nomeCategoria = useMemo(
    () => new Map(loja.categorias.map((c) => [c.id, c.nome])),
    [loja.categorias],
  );
  const [busca, setBusca] = useState("");
  const [ativa, setAtiva] = useState(secoes[0]?.id ?? "");
  const [aberto, setAberto] = useState<Produto | null>(null);
  const barraChips = useRef<HTMLDivElement>(null);
  const rolandoPorClique = useRef(false);

  const todos = useMemo(() => secoes.flatMap((s) => s.produtos), [secoes]);
  const resultados = useMemo(
    () => (busca.trim() ? todos.filter((p) => combina(textoBuscaProduto(p), busca)) : []),
    [busca, todos],
  );
  const buscando = busca.trim().length > 0;

  // Destaca a categoria visível conforme a rolagem (scroll spy).
  useEffect(() => {
    if (buscando) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (rolandoPorClique.current) return;
        const visivel = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visivel) setAtiva(visivel.target.id.replace("cat-", ""));
      },
      { rootMargin: "-140px 0px -60% 0px" },
    );
    secoes.forEach((s) => {
      const el = document.getElementById(`cat-${s.id}`);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [secoes, buscando]);

  // Mantém o chip ativo visível na barra horizontal.
  useEffect(() => {
    const chip = barraChips.current?.querySelector<HTMLElement>(`[data-cat="${ativa}"]`);
    chip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [ativa]);

  const irPara = (id: string) => {
    setBusca("");
    setAtiva(id);
    rolandoPorClique.current = true;
    requestAnimationFrame(() => {
      document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => (rolandoPorClique.current = false), 700);
    });
  };

  if (loja.erro) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="titulo text-3xl">Cardápio fora do ar</p>
        <p className="mt-2 text-suave">{loja.erro} Tente de novo em instantes ou chame a gente no WhatsApp.</p>
      </div>
    );
  }

  return (
    <div id="cardapio">
      {/* Barra fixa: busca + categorias */}
      <div className="sticky top-0 z-30 border-b border-borda/70 bg-preto/90 backdrop-blur-md supports-[backdrop-filter]:bg-preto/75">
        <div className="mx-auto max-w-6xl px-4 pt-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
            <label htmlFor="busca" className="sr-only">
              Buscar produto
            </label>
            <input
              id="busca"
              type="search"
              inputMode="search"
              autoComplete="off"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar gin, vinho, cerveja…"
              className="h-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-base w-full rounded-full border border-borda bg-superficie-2 pl-10 pr-10 text-sm text-branco placeholder:text-[#8f8f8f] focus-visible:border-rosa focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rosa/40 [&::-webkit-search-cancel-button]:hidden"
            />
            {buscando && (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-suave hover:text-branco"
                aria-label="Limpar busca"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <nav aria-label="Categorias" className="mx-auto max-w-6xl">
          <div ref={barraChips} className="sem-barra flex gap-2 overflow-x-auto px-4 py-2">
            {secoes.map((s) => {
              const sel = !buscando && ativa === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-cat={s.id}
                  onClick={() => irPara(s.id)}
                  aria-current={sel ? "true" : undefined}
                  className={cn(
                    "rotulo h-8 [@media(pointer:coarse)]:min-h-11 shrink-0 cursor-pointer rounded-full border px-3 text-xs font-bold transition-colors",
                    sel
                      ? "border-rosa bg-rosa text-preto"
                      : "border-borda bg-superficie text-branco hover:border-rosa/70",
                  )}
                >
                  {s.nome}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-36">
        {buscando ? (
          <section aria-live="polite" className="pt-6">
            <p className="rotulo text-suave">
              {resultados.length === 0
                ? `Nada encontrado para “${busca}”`
                : `${resultados.length} ${resultados.length === 1 ? "resultado" : "resultados"} para “${busca}”`}
            </p>
            {resultados.length === 0 ? (
              <p className="mt-3 text-suave">Tente outro nome ou navegue pelas categorias.</p>
            ) : (
              <Grade produtos={resultados} onAbrir={setAberto} />
            )}
          </section>
        ) : secoes.length === 0 ? (
          <p className="py-16 text-center text-suave">O cardápio está sendo montado. Volte logo!</p>
        ) : (
          secoes.map((s, i) => (
            <section key={s.id} id={`cat-${s.id}`} aria-labelledby={`titulo-${s.id}`} className="scroll-mt-36 pt-6">
              {/* Âncora sem prefixo, para links do banner como "#combos" */}
              <span id={s.id} className="relative -top-36 block" aria-hidden />
              <div className="flex items-end justify-between gap-4">
                <h2 id={`titulo-${s.id}`} className="titulo text-3xl sm:text-4xl">
                  {s.nome}
                </h2>
                <span className="rotulo pb-1 text-suave">
                  {s.produtos.length} {s.produtos.length === 1 ? "item" : "itens"}
                </span>
              </div>
              <DivisorRua className="mt-2 h-6 opacity-80" />
              <Grade produtos={s.produtos} onAbrir={setAberto} carregarJa={i === 0} />
            </section>
          ))
        )}
      </div>

      <ProdutoDetalhe
        produto={aberto}
        categoria={aberto?.categoria_id ? nomeCategoria.get(aberto.categoria_id) : undefined}
        onFechar={() => setAberto(null)}
      />
    </div>
  );
}

function Grade({
  produtos,
  onAbrir,
  carregarJa,
}: {
  produtos: Produto[];
  onAbrir: (p: Produto) => void;
  carregarJa?: boolean;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {produtos.map((p, i) => (
        <CardProduto key={p.id} produto={p} onAbrir={onAbrir} carregarJa={carregarJa && i < 2} />
      ))}
    </div>
  );
}
