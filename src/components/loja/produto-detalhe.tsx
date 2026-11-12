"use client";

import { useRef, useState } from "react";
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
import { ComposicaoKit } from "./composicao-kit";
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
      <SheetContent lado="centro" className="inset-x-0 top-0 bottom-0 h-dvh max-h-dvh max-w-none translate-y-0 overflow-hidden rounded-none sm:inset-x-6 sm:top-1/2 sm:bottom-auto sm:h-[min(88dvh,850px)] sm:max-w-3xl sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex h-16 shrink-0 items-center border-b border-borda px-5 pr-16 sm:px-6"><p className="text-sm font-semibold">{produto?.grupos?.length ? "Monte seu pedido" : "Detalhes do produto"}</p></div>
        {produto && <DetalheVariacoes key={produto.id} produto={produto} categoria={categoria} onFechar={onFechar} />}
      </SheetContent>
    </Sheet>
  );
}

function DetalheVariacoes({ produto, categoria, onFechar }: { produto: Produto; categoria?: string; onFechar: () => void }) {
  const variacoes = produto.variacoes ?? [];
  const [id, setId] = useState(variacoes.find(produtoDisponivel)?.id ?? variacoes[0]?.id);
  const sku = variacoes.find((v) => v.id === id) ?? produto;
  return <div className="flex min-h-0 flex-1 flex-col">
    {variacoes.length > 0 && <div className="mx-5 mt-3 shrink-0 rounded-lg border border-borda p-3 md:mx-6">
      <label htmlFor="det-variacao" className="mb-2 block text-sm font-medium">{produto.familia_nome} · {produto.variacao_atributo}</label>
      <select id="det-variacao" value={id} onChange={(e) => setId(e.target.value)} className="h-10 w-full rounded-lg border border-borda bg-superficie-2 px-3 text-sm">
        {variacoes.map((v) => <option key={v.id} value={v.id}>{v.variacao_nome} · {formatarPreco(v.preco)}{!produtoDisponivel(v) ? " · Esgotado" : ""}</option>)}
      </select>
    </div>}
    <Conteudo key={sku.id} produto={sku} categoria={categoria} onFechar={onFechar} />
  </div>;
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
  const conteudoRef = useRef<HTMLDivElement>(null);

  const disponivel = produtoDisponivel(produto);
  const ultimas = avisoEstoque(produto);
  const limite = controlaSaldo(produto) ? saldoVendavel(produto) : 99;
  const unitario = produto.preco + acrescimo(grupos, selecao);
  const falta = pendencia(grupos, selecao);

  const adicionarComOpcoes = () => {
    setTentou(true);
    if (falta) {
      const grupo = grupos.find((g) => (selecao[g.id]?.length ?? 0) < g.minimo);
      const alvo = Array.from(conteudoRef.current?.querySelectorAll<HTMLElement>("[data-grupo]") ?? []).find((el) => el.dataset.grupo === grupo?.id);
      const expansivel = alvo?.querySelector("details");
      if (expansivel) expansivel.open = true;
      alvo?.scrollIntoView({ behavior: "smooth", block: "start" });
      alvo?.focus({ preventScroll: true });
      return;
    }
    adicionar(produto.id, opcoesEscolhidas(selecao), qtd);
    toast.success(`${qtd}x ${produto.nome} no carrinho`);
    onFechar();
  };

  return (
    <>
      <div ref={conteudoRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {produto.foto_url && <FotoProduto
        src={produto.foto_url}
        alt={produto.nome}
        esgotado={!disponivel}
        carregarJa
        sizes="(min-width: 768px) 720px, 100vw"
        className="mx-5 mt-4 h-40 rounded-xl sm:mx-6 sm:h-48"
      />}
      <div className="flex flex-col gap-3 px-5 pt-5 pb-6 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {categoria && (
            <span className="rotulo rounded-full border border-borda px-2.5 py-1 text-[0.68rem] text-suave">{categoria}</span>
          )}
          {produto.destaque && <SeloProduto tipo="destaque" />}
          {!disponivel && <SeloProduto tipo="esgotado" />}
          {disponivel && ultimas && <SeloProduto tipo="ultimas" texto={ultimas} />}
        </div>
        <SheetTitle className="pr-6 text-xl leading-snug font-bold sm:text-2xl">{produto.nome}</SheetTitle>
        <SheetDescription className="text-sm leading-relaxed text-suave">
          {produto.descricao || "Sem descrição."}
        </SheetDescription>
        <p className="preco text-xl">{formatarPreco(produto.preco)}</p>
        {produto.composicao && <ComposicaoKit itens={produto.composicao} idBase={`det-${produto.id}`} />}
        {temOpcoes && disponivel && (
          <div className="pt-2">
            <EscolhaOpcoes grupos={grupos} selecao={selecao} onChange={setSelecao} idBase={`det-${produto.id}`} />
          </div>
        )}
      </div>
      </div>
      <div className="shrink-0 border-t border-borda bg-superficie px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {temOpcoes && disponivel && <p className="mb-2 text-xs text-suave" aria-live="polite">{falta ? falta : "Tudo pronto! Confira a quantidade e adicione ao pedido."}</p>}
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
                className="w-28 shrink-0 rounded-lg border border-borda bg-transparent sm:w-32"
              />
              <Button size="lg" className="h-11 min-w-0 flex-1 justify-between rounded-lg px-4 text-sm shadow-none" onClick={adicionarComOpcoes}>
                <span>Adicionar</span><span className="tabular-nums">{formatarPreco(unitario * qtd)}</span>
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
