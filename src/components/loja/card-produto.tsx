"use client";

import { Plus, SlidersHorizontal } from "lucide-react";
import { chaveDe, quantidadeDoProduto, useCarrinho } from "@/lib/carrinho";
import { produtoDisponivel, controlaSaldo, saldoVendavel, type Produto } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FotoProduto } from "./foto-produto";
import { SeletorQuantidade } from "./seletor-quantidade";

export function SeloProduto({ tipo, texto }: { tipo: "destaque" | "esgotado" | "ultimas"; texto?: string }) {
  const estilos = {
    destaque: "bg-amarelo text-preto",
    esgotado: "bg-branco text-preto",
    ultimas: "bg-rosa text-preto",
  } as const;
  const rotulos = { destaque: "★ Destaque", esgotado: "Esgotado", ultimas: texto ?? "Últimas unidades" } as const;
  return (
    <span className={cn("rotulo inline-flex items-center rounded-full px-2.5 py-1 text-[0.68rem] font-bold", estilos[tipo])}>
      {rotulos[tipo]}
    </span>
  );
}

/** Selo de "Últimas X" quando o estoque está baixo. */
export function avisoEstoque(p: Produto): string | null {
  if (!controlaSaldo(p) || saldoVendavel(p) <= 0 || saldoVendavel(p) > 5) return null;
  return saldoVendavel(p) === 1 ? "Última unidade" : `Últimas ${saldoVendavel(p)}`;
}

export function CardProduto({
  produto,
  onAbrir,
  carregarJa,
}: {
  produto: Produto;
  onAbrir: (p: Produto) => void;
  carregarJa?: boolean;
}) {
  const temVariacoes = !!produto.variacoes?.length;
  const temOpcoes = temVariacoes || (produto.grupos?.length ?? 0) > 0;
  const chave = chaveDe(produto.id);
  const noCarrinho = useCarrinho((s) => (produto.variacoes ?? [produto]).reduce((q, v) => q + quantidadeDoProduto(s.itens, v.id), 0));
  const quantidadeSimples = useCarrinho((s) => s.itens[chave]?.quantidade ?? 0);
  const adicionar = useCarrinho((s) => s.adicionar);
  const remover = useCarrinho((s) => s.remover);
  const esgotado = !produtoDisponivel(produto);
  const ultimas = avisoEstoque(produto);
  const limite = controlaSaldo(produto) ? saldoVendavel(produto) : undefined;

  return (
    <article
      className={cn(
        "group relative flex animate-entrar flex-col overflow-hidden rounded-card border border-borda bg-superficie transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-rosa/60",
        noCarrinho > 0 && "border-rosa/70",
      )}
      aria-label={produto.nome}
    >
      <button
        type="button"
        onClick={() => onAbrir(produto)}
        className="relative block w-full cursor-pointer text-left"
        aria-label={`Ver detalhes de ${produto.nome}`}
      >
        <FotoProduto
          src={produto.foto_url}
          alt={produto.nome}
          esgotado={esgotado}
          carregarJa={carregarJa}
          sizes="(min-width: 1280px) 280px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="aspect-square w-full"
        />
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {produto.destaque && <SeloProduto tipo="destaque" />}
          {esgotado && <SeloProduto tipo="esgotado" />}
          {!esgotado && ultimas && <SeloProduto tipo="ultimas" texto={ultimas} />}
        </div>
        {noCarrinho > 0 && (
          <span className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-rosa font-mono text-sm font-bold text-preto shadow-lg">
            {noCarrinho}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        <h3 className="text-[0.95rem] font-bold leading-snug sm:text-base">{produto.nome}</h3>
        {temVariacoes && <p className="text-xs text-rosa">{produto.variacoes!.length} opções · {produto.variacao_atributo}</p>}
        {produto.descricao && (
          <p className="line-clamp-2 text-[0.82rem] leading-snug text-suave sm:text-sm">{produto.descricao}</p>
        )}
        <div className="mt-auto pt-2">
          <p className="preco mb-2.5 text-lg">
            {temOpcoes && <span className="mr-1 text-xs font-normal text-suave">a partir de</span>}
            {formatarPreco(produto.preco)}
          </p>
          {esgotado ? (
            <Button variant="suave" size="sm" disabled className="h-11 w-full">
              Esgotado
            </Button>
          ) : temOpcoes ? (
            <Button size="sm" className="h-11 w-full" onClick={() => onAbrir(produto)} aria-label={`Escolher ${produto.nome}`}>
              <SlidersHorizontal /> Escolher
            </Button>
          ) : quantidadeSimples > 0 ? (
            <SeletorQuantidade
              nome={produto.nome}
              quantidade={quantidadeSimples}
              maximo={limite}
              onMais={() => adicionar(produto.id)}
              onMenos={() => remover(chave)}
            />
          ) : (
            <Button size="sm" className="h-11 w-full" onClick={() => adicionar(produto.id)} aria-label={`Adicionar ${produto.nome}`}>
              <Plus /> Adicionar
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
