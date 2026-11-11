"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { chaveDe, useCarrinho } from "@/lib/carrinho";
import { produtoDisponivel, controlaSaldo, saldoVendavel, type Produto } from "@/lib/tipos";
import { formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FotoProduto } from "./foto-produto";
import { SeletorQuantidade } from "./seletor-quantidade";
import { avisoEstoque, SeloProduto } from "./card-produto";
import { acrescimo, EscolhaOpcoes, opcoesEscolhidas, pendencia, type Selecao } from "./escolha-opcoes";

export function ProdutoDetalhe({
  produto,
  categoria,
  onFechar,
}: {
  produto: Produto | null;
  categoria?: string;
  onFechar: () => void;
}) {
  return (
    <Sheet open={!!produto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="overflow-y-auto">
        {produto && <DetalheVariacoes key={produto.id} produto={produto} categoria={categoria} onFechar={onFechar} />}
      </SheetContent>
    </Sheet>
  );
}

function DetalheVariacoes({ produto, categoria, onFechar }: { produto: Produto; categoria?: string; onFechar: () => void }) {
  const variacoes = produto.variacoes ?? [];
  const [id, setId] = useState(variacoes.find(produtoDisponivel)?.id ?? variacoes[0]?.id);
  const sku = variacoes.find((v) => v.id === id) ?? produto;
  return <>
    {variacoes.length > 0 && <div className="mx-5 mt-16 rounded-xl border border-borda p-4 md:mx-6">
      <label htmlFor="det-variacao" className="mb-2 block text-sm font-medium">{produto.familia_nome} · {produto.variacao_atributo}</label>
      <select id="det-variacao" value={id} onChange={(e) => setId(e.target.value)} className="h-10 w-full rounded-lg border border-borda bg-superficie-2 px-3 text-sm">
        {variacoes.map((v) => <option key={v.id} value={v.id}>{v.variacao_nome} · {formatarPreco(v.preco)}{!produtoDisponivel(v) ? " · Esgotado" : ""}</option>)}
      </select>
    </div>}
    <Conteudo key={sku.id} produto={sku} categoria={categoria} onFechar={onFechar} />
  </>;
}

function Conteudo({ produto, categoria, onFechar }: { produto: Produto; categoria?: string; onFechar: () => void }) {
  const grupos = produto.grupos ?? [];
  const temOpcoes = grupos.length > 0;
  const chave = chaveDe(produto.id);
  const quantidadeSimples = useCarrinho((s) => s.itens[chave]?.quantidade ?? 0);
  const adicionar = useCarrinho((s) => s.adicionar);
  const remover = useCarrinho((s) => s.remover);
  const [selecao, setSelecao] = useState<Selecao>({});
  const [qtd, setQtd] = useState(1);
  const [tentou, setTentou] = useState(false);

  const disponivel = produtoDisponivel(produto);
  const ultimas = avisoEstoque(produto);
  const limite = controlaSaldo(produto) ? saldoVendavel(produto) : 99;
  const unitario = produto.preco + acrescimo(grupos, selecao);
  const falta = pendencia(grupos, selecao);

  const adicionarComOpcoes = () => {
    setTentou(true);
    if (falta) return;
    adicionar(produto.id, opcoesEscolhidas(selecao), qtd);
    toast.success(`${qtd}x ${produto.nome} no carrinho`);
    onFechar();
  };

  return (
    <>
      <FotoProduto
        src={produto.foto_url}
        alt={produto.nome}
        esgotado={!disponivel}
        carregarJa
        sizes="(min-width: 768px) 440px, 100vw"
        className="mx-4 mt-3 aspect-square shrink-0 rounded-card md:mx-6 md:mt-16"
      />
      <div className="flex flex-col gap-3 p-5 md:p-6">
        <div className="flex flex-wrap gap-2">
          {categoria && (
            <span className="rotulo rounded-full border border-borda px-2.5 py-1 text-[0.68rem] text-suave">{categoria}</span>
          )}
          {produto.destaque && <SeloProduto tipo="destaque" />}
          {!disponivel && <SeloProduto tipo="esgotado" />}
          {disponivel && ultimas && <SeloProduto tipo="ultimas" texto={ultimas} />}
        </div>
        <SheetTitle className="titulo text-3xl">{produto.nome}</SheetTitle>
        <SheetDescription className="text-base leading-relaxed text-suave">
          {produto.descricao || "Sem descrição."}
        </SheetDescription>
        <p className="preco text-3xl">{formatarPreco(produto.preco)}</p>
        {temOpcoes && disponivel && (
          <div className="pt-2">
            <EscolhaOpcoes grupos={grupos} selecao={selecao} onChange={setSelecao} idBase={`det-${produto.id}`} />
          </div>
        )}
      </div>
      <div className="pb-seguro sticky bottom-0 mt-auto border-t border-borda bg-superficie px-5 pt-4 md:px-6">
        {!disponivel ? (
          <Button variant="suave" size="lg" disabled className="w-full">
            Esgotado no momento
          </Button>
        ) : temOpcoes ? (
          <>
            {tentou && falta && (
              <p role="alert" className="mb-2 text-sm text-perigo">
                {falta}
              </p>
            )}
            <div className="flex items-center gap-3">
              <SeletorQuantidade
                tamanho="lg"
                nome={produto.nome}
                quantidade={qtd}
                minimo={1}
                maximo={limite}
                onMais={() => setQtd((q) => Math.min(q + 1, limite))}
                onMenos={() => setQtd((q) => Math.max(1, q - 1))}
                className="w-36 shrink-0"
              />
              <Button size="lg" className="flex-1 px-3" onClick={adicionarComOpcoes}>
                Adicionar · {formatarPreco(unitario * qtd)}
              </Button>
            </div>
          </>
        ) : quantidadeSimples > 0 ? (
          <div className="flex items-center gap-3">
            <SeletorQuantidade
              tamanho="lg"
              nome={produto.nome}
              quantidade={quantidadeSimples}
              maximo={limite}
              onMais={() => adicionar(produto.id)}
              onMenos={() => remover(chave)}
              className="w-40"
            />
            <p className="ml-auto text-right">
              <span className="rotulo block text-suave">No carrinho</span>
              <span className="preco text-xl">{formatarPreco(produto.preco * quantidadeSimples)}</span>
            </p>
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={() => adicionar(produto.id)}>
            <Plus /> Adicionar · {formatarPreco(produto.preco)}
          </Button>
        )}
      </div>
    </>
  );
}
