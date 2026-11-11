"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Minus, Plus, Printer, Search, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { combina } from "@/lib/busca";
import { revalidarLoja } from "@/app/admin/acoes";
import { useConfiguracoes } from "@/lib/admin/config";
import { ordenarGrupos } from "@/lib/loja-ordenacao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_ORIGEM, produtoDisponivel, type Categoria, type FormaPagamento, type Opcao, type Produto } from "@/lib/tipos";
import { centavosParaCampo, cn, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { acrescimo, EscolhaOpcoes, opcoesEscolhidas, pendencia, type Selecao } from "@/components/loja/escolha-opcoes";
import { Cupom, type DadosCupom } from "../cupom";
import { CabecalhoPagina, Carregando, Cartao } from "../ui";

interface ResumoCaixa {
  id: string;
  aberto_em: string;
  fechado_em: string | null;
  valor_inicial: number;
  vendas: { pagamento: FormaPagamento; origem: "site" | "balcao"; quantidade: number; total: number }[];
  total_vendas: number;
  quantidade_vendas: number;
  suprimentos: number;
  sangrias: number;
  dinheiro_esperado: number;
  valor_contado: number | null;
  diferenca?: number;
  movimentos: { tipo: "sangria" | "suprimento"; valor: number; descricao: string | null; criado_em: string }[];
}

interface ItemVenda {
  chave: string;
  produto: Produto;
  opcoes: Opcao[];
  quantidade: number;
}

const PAGAMENTOS: { id: FormaPagamento; rotulo: string }[] = [
  { id: "dinheiro", rotulo: "Dinheiro" },
  { id: "pix", rotulo: "Pix" },
  { id: "cartao", rotulo: "Cartão" },
];

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const unitario = (i: ItemVenda) => i.produto.preco + i.opcoes.reduce((s, o) => s + o.preco, 0);

export function PaginaPdv() {
  const { config } = useConfiguracoes();
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined);
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    Promise.all([
      sb.rpc("resumo_caixa"),
      sb
        .from("produtos")
        .select(
          "id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,estoque," +
            "grupos:grupos_opcoes(id,produto_id,nome,minimo,maximo,ordem,opcoes(id,grupo_id,nome,preco,disponivel,ordem))",
        )
        .eq("ativo", true)
        .order("ordem"),
      sb.from("categorias").select("id,nome,slug,ordem,ativa").order("ordem"),
    ]).then(([r, p, c]) => {
      if (!ativo) return;
      if (r.error) toast.error(r.error.message);
      setCaixa((r.data as ResumoCaixa | null) ?? null);
      setProdutos(((p.data ?? []) as unknown as Produto[]).map(ordenarGrupos));
      setCategorias((c.data ?? []) as Categoria[]);
    });
    return () => {
      ativo = false;
    };
  }, [versao]);

  if (caixa === undefined || !produtos || !config) return <Carregando />;

  if (!caixa) return <AbrirCaixa onAberto={recarregar} />;

  return (
    <Venda
      caixa={caixa}
      produtos={produtos}
      categorias={categorias}
      loja={{ nome: config.nome, endereco: config.endereco, whatsapp: config.whatsapp }}
      onMudou={recarregar}
    />
  );
}

/* ------------------------------------------------------------------ */

function AbrirCaixa({ onAberto }: { onAberto: () => void }) {
  const [valor, setValor] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const abrir = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = paraCentavos(valor || "0");
    if (c === null) return toast.error("Valor inválido.");
    setAbrindo(true);
    const { error } = await supabaseNavegador().rpc("abrir_caixa", { p_valor_inicial: c });
    setAbrindo(false);
    if (error) return toast.error(error.message);
    toast.success("Caixa aberto. Boas vendas!");
    onAberto();
  };
  return (
    <>
      <CabecalhoPagina titulo="PDV" descricao="Venda no balcão com baixa de estoque e cupom." />
      <Cartao className="mx-auto max-w-md text-center">
        <Wallet className="mx-auto size-12 text-rosa" aria-hidden />
        <h2 className="titulo mt-3 text-3xl">Abrir caixa</h2>
        <p className="mt-1 text-suave">Informe quanto tem de troco na gaveta para começar.</p>
        <form onSubmit={abrir} className="mt-5 space-y-4 text-left">
          <Campo label="Troco inicial (R$)" htmlFor="cx-inicial">
            <Input
              id="cx-inicial"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))}
              className="font-mono text-lg"
              autoFocus
            />
          </Campo>
          <Button type="submit" size="lg" className="w-full" disabled={abrindo}>
            {abrindo ? "Abrindo…" : "Abrir caixa"}
          </Button>
        </form>
      </Cartao>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Venda({
  caixa,
  produtos,
  categorias,
  loja,
  onMudou,
}: {
  caixa: ResumoCaixa;
  produtos: Produto[];
  categorias: Categoria[];
  loja: { nome: string; endereco: string; whatsapp: string };
  onMudou: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("todas");
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [escolhendo, setEscolhendo] = useState<Produto | null>(null);
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [cupom, setCupom] = useState<DadosCupom | null>(null);
  const [painelCaixa, setPainelCaixa] = useState<"movimento" | "fechar" | null>(null);

  const lista = useMemo(() => {
    let l = produtos;
    if (cat !== "todas") l = l.filter((p) => p.categoria_id === cat);
    if (busca.trim()) l = l.filter((p) => combina(p.nome, busca));
    return l;
  }, [produtos, cat, busca]);

  const qtdNoCarrinho = (id: string) => itens.filter((i) => i.produto.id === id).reduce((s, i) => s + i.quantidade, 0);

  const adicionar = (produto: Produto, opcoes: Opcao[] = [], quantidade = 1) => {
    if (produto.controla_estoque && qtdNoCarrinho(produto.id) + quantidade > produto.estoque) {
      return toast.error(`${produto.nome}: só tem ${produto.estoque} em estoque.`);
    }
    const chave = `${produto.id}|${opcoes.map((o) => o.id).sort().join(",")}`;
    setItens((l) => {
      const existe = l.find((i) => i.chave === chave);
      if (existe) return l.map((i) => (i.chave === chave ? { ...i, quantidade: i.quantidade + quantidade } : i));
      return [...l, { chave, produto, opcoes, quantidade }];
    });
  };

  const tocar = (p: Produto) => {
    if (!produtoDisponivel(p)) return;
    if ((p.grupos?.length ?? 0) > 0) setEscolhendo(p);
    else adicionar(p);
  };

  const totalItens = itens.reduce((s, i) => s + i.quantidade, 0);
  const subtotal = itens.reduce((s, i) => s + unitario(i) * i.quantidade, 0);

  const finalizado = (c: DadosCupom) => {
    setItens([]);
    setCarrinhoAberto(false);
    setCupom(c);
    void revalidarLoja().catch(() => null);
    onMudou();
  };

  const painelVenda = (
    <PainelVenda
      itens={itens}
      subtotal={subtotal}
      onAlterar={(chave, delta) =>
        setItens((l) =>
          l.flatMap((i) => {
            if (i.chave !== chave) return [i];
            const q = i.quantidade + delta;
            if (delta > 0 && i.produto.controla_estoque && qtdNoCarrinho(i.produto.id) + delta > i.produto.estoque) {
              toast.error(`${i.produto.nome}: só tem ${i.produto.estoque} em estoque.`);
              return [i];
            }
            return q > 0 ? [{ ...i, quantidade: q }] : [];
          }),
        )
      }
      onLimpar={() => setItens([])}
      onFinalizado={finalizado}
    />
  );

  return (
    <>
      <div className="print:hidden">
        <CabecalhoPagina
          titulo="PDV"
          descricao={`Caixa aberto ${hora.format(new Date(caixa.aberto_em))} · ${caixa.quantidade_vendas} vendas · ${formatarPreco(caixa.total_vendas)}`}
          acoes={
            <>
              <Button variant="suave" size="sm" onClick={() => setPainelCaixa("movimento")}>
                <ArrowDownToLine /> Sangria / suprimento
              </Button>
              <Button variant="contorno" size="sm" onClick={() => setPainelCaixa("fechar")}>
                <Lock /> Fechar caixa
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="relative mb-3">
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-suave" />
              <Input
                type="search"
                aria-label="Buscar produto no PDV"
                placeholder="Buscar produto…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="rounded-full pl-12"
              />
            </div>
            <div className="sem-barra -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
              {[{ id: "todas", nome: "Todas" }, ...categorias.filter((c) => c.ativa)].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={cat === c.id}
                  onClick={() => setCat(c.id)}
                  className={cn(
                    "rotulo h-10 shrink-0 cursor-pointer rounded-full border px-4 font-bold",
                    cat === c.id ? "border-rosa bg-rosa text-preto" : "border-borda hover:border-rosa/60",
                  )}
                >
                  {c.nome}
                </button>
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-2.5 pb-28 sm:grid-cols-3 xl:grid-cols-4 lg:pb-0">
              {lista.map((p) => {
                const ok = produtoDisponivel(p);
                const q = qtdNoCarrinho(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => tocar(p)}
                      disabled={!ok}
                      aria-label={`Vender ${p.nome}`}
                      className={cn(
                        "relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-superficie text-left transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
                        q > 0 ? "border-rosa" : "border-borda hover:border-rosa/60",
                      )}
                    >
                      <div className="relative aspect-[4/3] w-full bg-superficie-2">
                        {p.foto_url && <Image src={p.foto_url} alt="" fill sizes="200px" className="object-cover" />}
                        {q > 0 && (
                          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-rosa font-mono text-sm font-bold text-preto">
                            {q}
                          </span>
                        )}
                      </div>
                      <span className="flex flex-1 flex-col gap-1 p-2.5">
                        <span className="text-sm font-bold leading-tight">{p.nome}</span>
                        <span className="mt-auto flex items-baseline justify-between gap-1">
                          <span className="preco text-sm">{formatarPreco(p.preco)}</span>
                          {p.controla_estoque && (
                            <span className={cn("font-mono text-[0.7rem]", p.estoque <= 5 ? "text-amarelo" : "text-suave")}>
                              {p.estoque <= 0 ? "esgotado" : `${p.estoque} un`}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Venda: coluna fixa no computador */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 rounded-card border border-borda bg-superficie">{painelVenda}</div>
          </aside>
        </div>

        {/* Venda: barra + gaveta no celular */}
        {totalItens > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 px-4 lg:hidden">
            <button
              type="button"
              onClick={() => setCarrinhoAberto(true)}
              className="pointer-events-auto flex h-14 w-full cursor-pointer items-center gap-3 rounded-full bg-rosa pl-2 pr-5 text-preto shadow-xl"
            >
              <span className="grid size-10 place-items-center rounded-full bg-preto font-mono font-bold text-rosa">{totalItens}</span>
              <span className="flex-1 text-left font-bold">Ver venda</span>
              <span className="font-mono font-bold">{formatarPreco(subtotal)}</span>
            </button>
          </div>
        )}
        <Sheet open={carrinhoAberto} onOpenChange={setCarrinhoAberto}>
          <SheetContent rotuloFechar="Fechar venda">{painelVenda}</SheetContent>
        </Sheet>
      </div>

      <EscolherOpcoes
        produto={escolhendo}
        onFechar={() => setEscolhendo(null)}
        onAdicionar={(p, opcoes, qtd) => {
          adicionar(p, opcoes, qtd);
          setEscolhendo(null);
        }}
      />

      <Sheet open={painelCaixa === "movimento"} onOpenChange={(v) => !v && setPainelCaixa(null)}>
        <SheetContent rotuloFechar="Fechar">
          <MovimentoCaixa
            onFeito={() => {
              setPainelCaixa(null);
              onMudou();
            }}
          />
        </SheetContent>
      </Sheet>
      <Sheet open={painelCaixa === "fechar"} onOpenChange={(v) => !v && setPainelCaixa(null)}>
        <SheetContent rotuloFechar="Fechar" className="overflow-y-auto">
          <FecharCaixa caixa={caixa} onFechado={onMudou} />
        </SheetContent>
      </Sheet>

      {/* Cupom da última venda */}
      <Sheet open={!!cupom} onOpenChange={(v) => !v && setCupom(null)}>
        <SheetContent rotuloFechar="Fechar cupom" className="overflow-y-auto">
          {cupom && (
            <div className="px-5 pt-4 pb-6 pr-16 md:px-6">
              <SheetTitle className="titulo text-4xl">Venda #{cupom.numero}</SheetTitle>
              <SheetDescription className="mt-1 text-suave">
                Total {formatarPreco(cupom.total)}
                {cupom.pagamento === "dinheiro" && cupom.troco ? ` · Troco ${formatarPreco(cupom.troco)}` : ""}
              </SheetDescription>
              {cupom.pagamento === "dinheiro" && (cupom.troco ?? 0) > 0 && (
                <p className="mt-4 rounded-2xl bg-amarelo p-4 text-center text-preto">
                  <span className="rotulo block">Troco</span>
                  <span className="font-mono text-4xl font-bold">{formatarPreco(cupom.troco!)}</span>
                </p>
              )}
              <div className="mt-4 rounded-xl bg-white p-3">
                <Cupom dados={cupom} loja={loja} />
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={() => window.print()}>
                  <Printer /> Imprimir cupom
                </Button>
                <Button variant="suave" onClick={() => setCupom(null)}>
                  Nova venda
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {cupom && (
        <div className="area-cupom" aria-hidden>
          <Cupom dados={cupom} loja={loja} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function PainelVenda({
  itens,
  subtotal,
  onAlterar,
  onLimpar,
  onFinalizado,
}: {
  itens: ItemVenda[];
  subtotal: number;
  onAlterar: (chave: string, delta: number) => void;
  onLimpar: () => void;
  onFinalizado: (c: DadosCupom) => void;
}) {
  const [modoDesconto, setModoDesconto] = useState<"valor" | "percentual">("valor");
  const [desconto, setDesconto] = useState("");
  const [pagamento, setPagamento] = useState<FormaPagamento>("dinheiro");
  const [recebido, setRecebido] = useState("");
  const [cliente, setCliente] = useState("");
  const [finalizando, setFinalizando] = useState(false);
  // O painel existe na coluna (computador) e na gaveta (celular): ids únicos por instância
  const uid = useId();
  const ids = { desconto: `${uid}-desconto`, recebido: `${uid}-recebido`, cliente: `${uid}-cliente` };

  const valorDesconto = (() => {
    if (!desconto.trim()) return 0;
    if (modoDesconto === "percentual") {
      const pct = Number(desconto.replace(",", "."));
      return Number.isFinite(pct) ? Math.round((subtotal * Math.min(Math.max(pct, 0), 100)) / 100) : 0;
    }
    return Math.min(paraCentavos(desconto) ?? 0, subtotal);
  })();
  const total = subtotal - valorDesconto;
  const valorRecebido = recebido.trim() ? paraCentavos(recebido) : null;
  const troco = valorRecebido != null ? valorRecebido - total : null;
  const recebidoInsuficiente = pagamento === "dinheiro" && valorRecebido != null && valorRecebido < total;

  const finalizar = async () => {
    if (!itens.length || recebidoInsuficiente) return;
    setFinalizando(true);
    const { data, error } = await supabaseNavegador().rpc("registrar_venda_balcao", {
      p_itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade, opcoes: i.opcoes.map((o) => o.id) })),
      p_pagamento: pagamento,
      p_desconto: valorDesconto,
      p_valor_recebido: pagamento === "dinheiro" ? valorRecebido : null,
      p_cliente_nome: cliente.trim() || null,
    });
    setFinalizando(false);
    if (error) return toast.error(error.message);
    const r = data as Omit<DadosCupom, "pagamento">;
    toast.success(`Venda #${r.numero} registrada`);
    setDesconto("");
    setRecebido("");
    setCliente("");
    onFinalizado({ ...r, pagamento, valor_recebido: pagamento === "dinheiro" ? valorRecebido : null, cliente: cliente.trim() });
  };

  // Notas rápidas para o valor recebido
  const sugestoes = [...new Set([total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, 10000, 20000])]
    .filter((v) => v >= total && v > 0)
    .slice(0, 4);

  return (
    <div className="flex max-h-[85dvh] flex-col lg:max-h-[calc(100dvh-6rem)]">
      <div className="flex items-center justify-between px-4 pt-4 pr-14 lg:pr-4">
        <SheetTitleSeguro>Venda atual</SheetTitleSeguro>
        {itens.length > 0 && (
          <button type="button" onClick={onLimpar} className="cursor-pointer text-sm text-suave hover:text-branco">
            Limpar
          </button>
        )}
      </div>

      {itens.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-8 text-suave">
          <ShoppingCart className="size-5" aria-hidden /> Toque nos produtos para vender.
        </p>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 divide-y divide-borda overflow-y-auto px-4">
          {itens.map((i) => (
            <li key={i.chave} className="flex items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight">{i.produto.nome}</p>
                {i.opcoes.length > 0 && <p className="text-xs text-suave">+ {i.opcoes.map((o) => o.nome).join(", ")}</p>}
                <p className="font-mono text-xs text-suave">{formatarPreco(unitario(i))} un</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="suave" size="icone-sm" onClick={() => onAlterar(i.chave, -1)} aria-label={`Menos ${i.produto.nome}`}>
                  {i.quantidade === 1 ? <Trash2 /> : <Minus />}
                </Button>
                <span className="w-6 text-center font-mono font-bold">{i.quantidade}</span>
                <Button variant="suave" size="icone-sm" onClick={() => onAlterar(i.chave, 1)} aria-label={`Mais ${i.produto.nome}`}>
                  <Plus />
                </Button>
              </div>
              <span className="w-20 text-right font-mono text-sm">{formatarPreco(unitario(i) * i.quantidade)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-borda p-4">
        <div className="flex items-center gap-2">
          <label htmlFor={ids.desconto} className="rotulo w-20 shrink-0 text-suave">
            Desconto
          </label>
          <div className="flex rounded-full border border-borda p-0.5" role="group" aria-label="Tipo de desconto">
            {(["valor", "percentual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={modoDesconto === m}
                onClick={() => setModoDesconto(m)}
                className={cn(
                  "h-9 w-10 cursor-pointer rounded-full font-mono text-sm font-bold",
                  modoDesconto === m ? "bg-rosa text-preto" : "text-suave",
                )}
              >
                {m === "valor" ? "R$" : "%"}
              </button>
            ))}
          </div>
          <Input
            id={ids.desconto}
            inputMode="decimal"
            placeholder="0"
            value={desconto}
            onChange={(e) => setDesconto(e.target.value.replace(/[^\d,.]/g, ""))}
            className="h-10 font-mono"
          />
        </div>

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pagamento">
          {PAGAMENTOS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pagamento === p.id}
              onClick={() => setPagamento(p.id)}
              className={cn(
                "h-11 cursor-pointer rounded-xl border-2 text-sm font-bold",
                pagamento === p.id ? "border-rosa bg-rosa/10 text-rosa" : "border-borda",
              )}
            >
              {p.rotulo}
            </button>
          ))}
        </div>

        {pagamento === "dinheiro" && (
          <div>
            <div className="flex items-center gap-2">
              <label htmlFor={ids.recebido} className="rotulo w-20 shrink-0 text-suave">
                Recebido
              </label>
              <Input
                id={ids.recebido}
                inputMode="decimal"
                placeholder={centavosParaCampo(total)}
                value={recebido}
                onChange={(e) => setRecebido(e.target.value.replace(/[^\d,.]/g, ""))}
                aria-invalid={recebidoInsuficiente}
                className="h-10 font-mono"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 pl-[5.5rem]">
              {sugestoes.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRecebido(centavosParaCampo(v))}
                  className="h-8 cursor-pointer rounded-full border border-borda px-2.5 font-mono text-xs hover:border-rosa"
                >
                  {formatarPreco(v)}
                </button>
              ))}
            </div>
            {troco != null && (
              <p className={cn("mt-2 text-right font-mono", recebidoInsuficiente ? "text-perigo" : "text-amarelo")} aria-live="polite">
                {recebidoInsuficiente ? `Faltam ${formatarPreco(-troco)}` : `Troco: ${formatarPreco(troco)}`}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={ids.cliente} className="rotulo w-20 shrink-0 text-suave">
            Cliente
          </label>
          <Input id={ids.cliente} placeholder="Opcional" value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-10" maxLength={80} />
        </div>

        <dl className="space-y-0.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-suave">Subtotal</dt>
            <dd className="font-mono">{formatarPreco(subtotal)}</dd>
          </div>
          {valorDesconto > 0 && (
            <div className="flex justify-between">
              <dt className="text-suave">Desconto</dt>
              <dd className="font-mono text-sucesso">− {formatarPreco(valorDesconto)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <dt className="font-bold">Total</dt>
            <dd className="preco text-2xl" data-testid="pdv-total">
              {formatarPreco(total)}
            </dd>
          </div>
        </dl>
        <Button size="lg" className="w-full" disabled={!itens.length || recebidoInsuficiente || finalizando} onClick={finalizar}>
          {finalizando ? "Registrando…" : `Finalizar · ${formatarPreco(total)}`}
        </Button>
      </div>
    </div>
  );
}

/** Título que funciona dentro e fora da gaveta (Radix exige Title só dentro de Dialog). */
function SheetTitleSeguro({ children }: { children: React.ReactNode }) {
  return <h2 className="titulo text-3xl">{children}</h2>;
}

/* ------------------------------------------------------------------ */

function EscolherOpcoes({
  produto,
  onFechar,
  onAdicionar,
}: {
  produto: Produto | null;
  onFechar: () => void;
  onAdicionar: (p: Produto, opcoes: Opcao[], qtd: number) => void;
}) {
  return (
    <Sheet open={!!produto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent rotuloFechar="Fechar" className="overflow-y-auto">
        {produto && <ConteudoOpcoes key={produto.id} produto={produto} onAdicionar={onAdicionar} />}
      </SheetContent>
    </Sheet>
  );
}

function ConteudoOpcoes({
  produto,
  onAdicionar,
}: {
  produto: Produto;
  onAdicionar: (p: Produto, opcoes: Opcao[], qtd: number) => void;
}) {
  const grupos = produto.grupos ?? [];
  const [selecao, setSelecao] = useState<Selecao>({});
  const [qtd, setQtd] = useState(1);
  const falta = pendencia(grupos, selecao);
  const todas = new Map(grupos.flatMap((g) => g.opcoes).map((o) => [o.id, o]));
  const preco = produto.preco + acrescimo(grupos, selecao);

  return (
    <div className="flex flex-col">
      <div className="space-y-4 px-5 pt-4 pr-16 md:px-6 md:pt-6">
        <SheetTitle className="titulo text-3xl">{produto.nome}</SheetTitle>
        <SheetDescription className="text-suave">{formatarPreco(produto.preco)} + adicionais</SheetDescription>
        <EscolhaOpcoes grupos={grupos} selecao={selecao} onChange={setSelecao} idBase={`pdv-${produto.id}`} />
      </div>
      <div className="pb-seguro sticky bottom-0 mt-4 flex items-center gap-3 border-t border-borda bg-superficie px-5 pt-4 md:px-6">
        <div className="flex items-center gap-1">
          <Button variant="suave" size="icone" onClick={() => setQtd((q) => Math.max(1, q - 1))} aria-label="Menos">
            <Minus />
          </Button>
          <span className="w-8 text-center font-mono text-lg font-bold">{qtd}</span>
          <Button variant="suave" size="icone" onClick={() => setQtd((q) => q + 1)} aria-label="Mais">
            <Plus />
          </Button>
        </div>
        <Button
          size="lg"
          className="flex-1 px-3"
          disabled={!!falta}
          title={falta ?? undefined}
          onClick={() => onAdicionar(produto, opcoesEscolhidas(selecao).map((id) => todas.get(id)!), qtd)}
        >
          {falta ? falta : `Adicionar · ${formatarPreco(preco * qtd)}`}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MovimentoCaixa({ onFeito }: { onFeito: () => void }) {
  const [tipo, setTipo] = useState<"sangria" | "suprimento">("sangria");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = paraCentavos(valor);
    if (!c) return toast.error("Informe o valor.");
    const { error } = await supabaseNavegador().rpc("movimentar_caixa", { p_tipo: tipo, p_valor: c, p_descricao: descricao || null });
    if (error) return toast.error(error.message);
    toast.success(`${tipo === "sangria" ? "Sangria" : "Suprimento"} de ${formatarPreco(c)} registrada`);
    onFeito();
  };
  return (
    <form onSubmit={enviar} className="space-y-5 px-5 pt-4 pb-6 pr-16 md:px-6 md:pt-6">
      <SheetTitle className="titulo text-4xl">Movimentar caixa</SheetTitle>
      <SheetDescription className="text-suave">Sangria tira dinheiro da gaveta; suprimento coloca.</SheetDescription>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimento">
        {(
          [
            ["sangria", "Sangria", ArrowUpFromLine],
            ["suprimento", "Suprimento", ArrowDownToLine],
          ] as const
        ).map(([id, rotulo, Icone]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tipo === id}
            onClick={() => setTipo(id)}
            className={cn(
              "flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 font-bold",
              tipo === id ? "border-rosa bg-rosa/10 text-rosa" : "border-borda",
            )}
          >
            <Icone className="size-5" aria-hidden /> {rotulo}
          </button>
        ))}
      </div>
      <Campo label="Valor (R$)" htmlFor="mv-valor">
        <Input id="mv-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))} className="font-mono" autoFocus />
      </Campo>
      <Campo label="Motivo (opcional)" htmlFor="mv-desc">
        <Input id="mv-desc" placeholder="Ex.: pagamento do gelo" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} />
      </Campo>
      <Button type="submit" size="lg" className="w-full">
        Registrar
      </Button>
    </form>
  );
}

function FecharCaixa({ caixa, onFechado }: { caixa: ResumoCaixa; onFechado: () => void }) {
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [resultado, setResultado] = useState<ResumoCaixa | null>(null);
  const c = contado.trim() ? paraCentavos(contado) : null;
  const diferenca = c != null ? c - caixa.dinheiro_esperado : null;

  const fechar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (c == null) return toast.error("Conte o dinheiro da gaveta e informe o valor.");
    const { data, error } = await supabaseNavegador().rpc("fechar_caixa", { p_valor_contado: c, p_observacoes: obs || null });
    if (error) return toast.error(error.message);
    toast.success("Caixa fechado");
    setResultado(data as ResumoCaixa);
  };

  const r = resultado ?? caixa;
  const porPagamento = PAGAMENTOS.map((p) => ({
    ...p,
    total: r.vendas.filter((v) => v.pagamento === p.id).reduce((s, v) => s + v.total, 0),
  }));

  return (
    <div className="space-y-5 px-5 pt-4 pb-6 pr-16 md:px-6 md:pt-6">
      <SheetTitle className="titulo text-4xl">{resultado ? "Caixa fechado" : "Fechar caixa"}</SheetTitle>
      <SheetDescription className="text-suave">Aberto em {hora.format(new Date(caixa.aberto_em))}</SheetDescription>

      <dl className="divide-y divide-borda rounded-2xl border border-borda px-4 text-sm">
        {porPagamento.map((p) => (
          <div key={p.id} className="flex justify-between py-2">
            <dt>{p.rotulo}</dt>
            <dd className="font-mono">{formatarPreco(p.total)}</dd>
          </div>
        ))}
        <div className="flex justify-between py-2 font-bold">
          <dt>Total vendido ({r.quantidade_vendas})</dt>
          <dd className="font-mono">{formatarPreco(r.total_vendas)}</dd>
        </div>
        {r.vendas.length > 0 && (
          <div className="py-2 text-suave">
            {(["balcao", "site"] as const).map((o) => {
              const t = r.vendas.filter((v) => v.origem === o).reduce((s, v) => s + v.total, 0);
              return t ? (
                <p key={o} className="flex justify-between">
                  <span>{NOMES_ORIGEM[o]}</span>
                  <span className="font-mono">{formatarPreco(t)}</span>
                </p>
              ) : null;
            })}
          </div>
        )}
      </dl>

      <dl className="divide-y divide-borda rounded-2xl border border-borda px-4 text-sm">
        <div className="flex justify-between py-2">
          <dt>Troco inicial</dt>
          <dd className="font-mono">{formatarPreco(r.valor_inicial)}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>Vendas em dinheiro</dt>
          <dd className="font-mono">{formatarPreco(porPagamento.find((p) => p.id === "dinheiro")!.total)}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>Suprimentos</dt>
          <dd className="font-mono">+ {formatarPreco(r.suprimentos)}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>Sangrias</dt>
          <dd className="font-mono">− {formatarPreco(r.sangrias)}</dd>
        </div>
        <div className="flex justify-between py-2 font-bold">
          <dt>Dinheiro esperado na gaveta</dt>
          <dd className="whitespace-nowrap pl-3 font-mono text-amarelo">{formatarPreco(r.dinheiro_esperado)}</dd>
        </div>
      </dl>

      {resultado ? (
        <>
          <p
            className={cn(
              "rounded-2xl p-4 text-center font-bold",
              (resultado.diferenca ?? 0) === 0 ? "bg-sucesso/15 text-sucesso" : "bg-rosa/15 text-rosa",
            )}
          >
            Contado {formatarPreco(resultado.valor_contado ?? 0)} ·{" "}
            {(resultado.diferenca ?? 0) === 0
              ? "bateu certinho!"
              : `${(resultado.diferenca ?? 0) > 0 ? "sobrou" : "faltou"} ${formatarPreco(Math.abs(resultado.diferenca ?? 0))}`}
          </p>
          <Button size="lg" className="w-full" onClick={onFechado}>
            Concluir
          </Button>
        </>
      ) : (
        <form onSubmit={fechar} className="space-y-4">
          <Campo label="Dinheiro contado na gaveta (R$)" htmlFor="fc-contado">
            <Input
              id="fc-contado"
              inputMode="decimal"
              value={contado}
              onChange={(e) => setContado(e.target.value.replace(/[^\d,.]/g, ""))}
              className="font-mono text-lg"
            />
          </Campo>
          {diferenca != null && (
            <p className={cn("text-sm font-bold", diferenca === 0 ? "text-sucesso" : "text-rosa")} aria-live="polite">
              {diferenca === 0 ? "Bate com o esperado." : `${diferenca > 0 ? "Sobra" : "Falta"} ${formatarPreco(Math.abs(diferenca))}`}
            </p>
          )}
          <Campo label="Observação (opcional)" htmlFor="fc-obs">
            <Input id="fc-obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} />
          </Campo>
          <Button type="submit" size="lg" className="w-full">
            <Lock /> Fechar caixa
          </Button>
        </form>
      )}
    </div>
  );
}
