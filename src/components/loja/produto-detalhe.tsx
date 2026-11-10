"use client";

import { Plus } from "lucide-react";
import { useCarrinho } from "@/lib/carrinho";
import type { Produto } from "@/lib/tipos";
import { formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FotoProduto } from "./foto-produto";
import { SeletorQuantidade } from "./seletor-quantidade";
import { SeloProduto } from "./card-produto";

export function ProdutoDetalhe({
  produto,
  categoria,
  onFechar,
}: {
  produto: Produto | null;
  categoria?: string;
  onFechar: () => void;
}) {
  const quantidade = useCarrinho((s) => (produto ? (s.itens[produto.id] ?? 0) : 0));
  const adicionar = useCarrinho((s) => s.adicionar);
  const remover = useCarrinho((s) => s.remover);

  return (
    <Sheet open={!!produto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="overflow-y-auto">
        {produto && (
          <>
            <FotoProduto
              src={produto.foto_url}
              alt={produto.nome}
              esgotado={!produto.disponivel}
              carregarJa
              sizes="(min-width: 768px) 440px, 100vw"
              className="mx-4 mt-3 aspect-square shrink-0 rounded-card md:mx-6 md:mt-16"
            />
            <div className="flex flex-col gap-3 p-5 md:p-6">
              <div className="flex flex-wrap gap-2">
                {categoria && (
                  <span className="rotulo rounded-full border border-borda px-2.5 py-1 text-[0.68rem] text-suave">
                    {categoria}
                  </span>
                )}
                {produto.destaque && <SeloProduto tipo="destaque" />}
                {!produto.disponivel && <SeloProduto tipo="esgotado" />}
              </div>
              <SheetTitle className="titulo text-4xl">{produto.nome}</SheetTitle>
              <SheetDescription className="text-base leading-relaxed text-suave">
                {produto.descricao || "Sem descrição."}
              </SheetDescription>
              <p className="preco text-3xl">{formatarPreco(produto.preco)}</p>
            </div>
            <div className="pb-seguro sticky bottom-0 mt-auto border-t border-borda bg-superficie px-5 pt-4 md:px-6">
              {!produto.disponivel ? (
                <Button variant="suave" size="lg" disabled className="w-full">
                  Esgotado no momento
                </Button>
              ) : quantidade > 0 ? (
                <div className="flex items-center gap-3">
                  <SeletorQuantidade
                    tamanho="lg"
                    nome={produto.nome}
                    quantidade={quantidade}
                    onMais={() => adicionar(produto.id)}
                    onMenos={() => remover(produto.id)}
                    className="w-40"
                  />
                  <p className="ml-auto text-right">
                    <span className="rotulo block text-suave">No carrinho</span>
                    <span className="preco text-xl">{formatarPreco(produto.preco * quantidade)}</span>
                  </p>
                </div>
              ) : (
                <Button size="lg" className="w-full" onClick={() => adicionar(produto.id)}>
                  <Plus /> Adicionar · {formatarPreco(produto.preco)}
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
