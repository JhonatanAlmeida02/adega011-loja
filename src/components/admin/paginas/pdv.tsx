"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Minus, Plus, Printer, Search, ShoppingCart, SlidersHorizontal, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { textoBuscaProduto } from "@/lib/variacoes";
import { combina } from "@/lib/busca";
import { revalidarLoja } from "@/app/admin/acoes";
import { useConfiguracoes } from "@/lib/admin/config";
import { ordenarGrupos } from "@/lib/loja-ordenacao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_ORIGEM, produtoDisponivel, controlaSaldo, saldoVendavel, aplicarSaldos, type Categoria, type FormaPagamento, type Opcao, type Produto } from "@/lib/tipos";
import { centavosParaCampo, cn, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/campos";
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
          "id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote,preco_pendente,familia_id,familia_nome,variacao_atributo,variacao_nome," +
            "grupos:grupos_opcoes(id,produto_id,nome,minimo,maximo,ordem,opcoes(id,grupo_id,nome,preco,disponivel,ordem))",
        )
        .eq("ativo", true)
        .order("ordem"),
      sb.from("categorias").select("id,nome,slug,ordem,ativa").order("ordem"),
      sb.rpc("saldos_venda"),
      sb.rpc("saldos_opcoes"),
    ]).then(([r, p, c, saldos, saldosOpcoes]) => {
      if (!ativo) return;
      if (r.error) toast.error(r.error.message);
      setCaixa((r.data as ResumoCaixa | null) ?? null);
      if (p.error || saldos.error || saldosOpcoes.error) toast.error(p.error?.message ?? saldos.error?.message ?? saldosOpcoes.error!.message);
      setProdutos(aplicarSaldos(((p.data ?? []) as unknown as Produto[]).map(ordenarGrupos), saldos.data ?? [], saldosOpcoes.data ?? []));
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
        <Wallet className="mx-auto size-12 text-rosa-texto" aria-hidden />
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
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [escolhendo, setEscolhendo] = useState<Produto | null>(null);
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [cupom, setCupom] = useState<DadosCupom | null>(null);
  const [painelCaixa, setPainelCaixa] = useState<"movimento" | "fechar" | null>(null);

  const lista = useMemo(() => {
    let l = produtos;
    if (cat !== "todas") l = l.filter((p) => p.categoria_id === cat);
    if (busca.trim()) l = l.filter((p) => combina(`${textoBuscaProduto(p)} ${p.familia_nome ?? ""} ${p.variacao_nome ?? ""}`, busca));
    return l;
  }, [produtos, cat, busca]);

  const qtdNoCarrinho = (id: string) => itens.filter((i) => i.produto.id === id).reduce((s, i) => s + i.quantidade, 0);

  const adicionar = (produto: Produto, opcoes: Opcao[] = [], quantidade = 1) => {
    if (controlaSaldo(produto) && qtdNoCarrinho(produto.id) + quantidade > saldoVendavel(produto)) {
      return toast.error(`${produto.nome}: só tem ${saldoVendavel(produto)} disponíveis.`);
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
            if (delta > 0 && controlaSaldo(i.produto) && qtdNoCarrinho(i.produto.id) + delta > saldoVendavel(i.produto)) {
              toast.error(`${i.produto.nome}: só tem ${saldoVendavel(i.produto)} disponíveis.`);
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
      <div className="pdv-shell print:hidden">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-borda pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-rosa/10 text-rosa-texto"><ShoppingCart className="size-5" aria-hidden /></div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Frente de caixa</h1>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-suave"><span className="size-1.5 rounded-full bg-sucesso" aria-hidden />Caixa aberto · {hora.format(new Date(caixa.aberto_em))}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-2 hidden text-xs text-suave xl:block">{caixa.quantidade_vendas} vendas · {formatarPreco(caixa.total_vendas)}</span>
            <Button variant="suave" size="sm" className="rounded-lg" onClick={() => setPainelCaixa("movimento")}><Wallet /> Movimentar</Button>
            <Button variant="fantasma" size="sm" className="rounded-lg text-suave" onClick={() => setPainelCaixa("fechar")}><Lock /> Fechar caixa</Button>
          </div>
        </header>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:h-[calc(100dvh-8rem)] lg:min-h-[520px] lg:grid-cols-[minmax(240px,0.6fr)_minmax(420px,1.4fr)]">
          <section aria-label="Produtos para venda" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-borda bg-superficie">
            <div className="shrink-0 space-y-3 border-b border-borda p-3">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Produtos</h2><span className="text-xs text-suave">{lista.length} encontrados</span></div>
              <div className="flex items-center gap-2"><div className="relative min-w-0 flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
                <Input type="search" aria-label="Buscar produto no PDV" placeholder="Buscar produto…"
                  value={busca} onChange={(e) => setBusca(e.target.value)} className="h-10 rounded-lg pl-10 text-sm" />
              </div><Button type="button" variant="fantasma" size="icone-sm" aria-label="Filtrar categorias" aria-expanded={filtroAberto} aria-controls="pdv-categorias" className={cn("shrink-0 rounded-lg", (filtroAberto || cat !== "todas") && "bg-rosa/10 text-rosa-texto")} onClick={() => setFiltroAberto((v) => !v)}><SlidersHorizontal /></Button></div>
              {filtroAberto && <Select id="pdv-categorias" aria-label="Filtrar produtos por categoria" value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 rounded-lg text-xs">
                <option value="todas">Todas as categorias</option>
                {categorias.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>}
            </div>
            <div className="flex shrink-0 justify-between border-b border-borda px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-suave"><span>Produto</span><span className="pr-12">Preço</span></div>
            <ul className="min-h-0 flex-1 divide-y divide-borda overflow-y-auto pb-24 lg:pb-0">
              {lista.map((p) => {
                const ok = produtoDisponivel(p);
                const q = qtdNoCarrinho(p.id);
                const detalhe = !ok ? "Esgotado" : q > 0 ? `${q} na venda` : (p.grupos?.length ?? 0) > 0 ? "Escolher adicionais" : controlaSaldo(p) && saldoVendavel(p) <= 5 ? `${saldoVendavel(p)} disponíveis` : null;
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => tocar(p)} disabled={!ok} aria-label={`Vender ${p.nome}`}
                      className={cn("group flex min-h-12 w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-superficie-2 disabled:cursor-not-allowed disabled:opacity-40", q > 0 && "bg-rosa/5")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">{p.nome}</span>
                        {detalhe && <span className="mt-0.5 block text-[11px] text-suave">{detalhe}</span>}
                      </span>
                      <span className="shrink-0 text-right font-mono text-sm tabular-nums">{formatarPreco(p.preco)}</span>
                      <span className="grid size-7 shrink-0 place-items-center rounded-md text-suave group-hover:bg-rosa/10 group-hover:text-rosa-texto"><Plus className="size-4" aria-hidden /></span>
                    </button>
                  </li>
                );
              })}
              {lista.length === 0 && <li className="px-4 py-12 text-center text-sm text-suave">Nenhum produto encontrado.</li>}
            </ul>
          </section>

          <aside aria-label="Venda atual" className="hidden min-h-0 min-w-0 overflow-hidden rounded-xl border border-borda bg-superficie lg:block">
            {painelVenda}
          </aside>
        </div>

        {/* Venda: barra + gaveta no celular */}
        {totalItens > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 px-4 md:left-[var(--sidebar-width)] md:bottom-4 lg:hidden">
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
          <SheetContent rotuloFechar="Fechar venda"><SheetTitle className="sr-only">Venda atual</SheetTitle><SheetDescription className="sr-only">Itens e pagamento da venda no balcão.</SheetDescription>{painelVenda}</SheetContent>
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
              <SheetTitle className="titulo text-3xl">Venda #{cupom.numero}</SheetTitle>
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
  const [recebimento, setRecebimento] = useState(false);
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

  const recebidoInvalido = pagamento === "dinheiro" && recebido.trim() !== "" && valorRecebido === null;

  const finalizar = async () => {
    if (!itens.length || recebidoInsuficiente || (pagamento === "dinheiro" && recebidoInvalido) || finalizando) return;
    setFinalizando(true);
    try {
    const { data, error } = await supabaseNavegador().rpc("registrar_venda_balcao", {
      p_itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade, opcoes: i.opcoes.map((o) => o.id) })),
      p_pagamento: pagamento,
      p_desconto: valorDesconto,
      p_valor_recebido: pagamento === "dinheiro" ? valorRecebido : null,
      p_cliente_nome: cliente.trim() || null,
    });
    if (error) return toast.error(error.message);
    const r = data as Omit<DadosCupom, "pagamento">;
    toast.success(`Venda #${r.numero} registrada`);
    setRecebimento(false);
    setDesconto("");
    setRecebido("");
    setCliente("");
    onFinalizado({ ...r, pagamento, valor_recebido: pagamento === "dinheiro" ? valorRecebido : null, cliente: cliente.trim() });
    } catch {
      toast.error("Falha de conexão. Confira a venda antes de tentar novamente.");
    } finally { setFinalizando(false); }
  };

  // Notas rápidas para o valor recebido
  const sugestoes = [...new Set([total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, 10000, 20000])]
    .filter((v) => v >= total && v > 0)
    .slice(0, 4);

  return (
    <div className="flex h-[78dvh] max-h-[85dvh] min-h-0 flex-col lg:h-full lg:max-h-none" data-testid="pdv-venda">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-borda px-4 pr-14 lg:pr-4">
        <div className="flex items-baseline gap-2"><SheetTitleSeguro>{recebimento ? "Pagamento" : "Venda atual"}</SheetTitleSeguro><span className="text-xs text-suave">{itens.reduce((q, i) => q + i.quantidade, 0)} {itens.reduce((q, i) => q + i.quantidade, 0) === 1 ? "item" : "itens"}</span></div>
        {recebimento ? <button type="button" disabled={finalizando} onClick={() => setRecebimento(false)} className="cursor-pointer text-xs text-suave hover:text-rosa-texto">Voltar aos itens</button> : itens.length > 0 && <button type="button" onClick={() => { setDesconto(""); setRecebido(""); setCliente(""); onLimpar(); }} className="cursor-pointer text-xs text-suave hover:text-texto">Limpar venda</button>}
      </div>

      {recebimento ? <fieldset disabled={finalizando} className="min-h-0 flex-1 overflow-y-auto p-5">
        <legend className="sr-only">Recebimento da venda</legend>
        <div className="mx-auto max-w-lg space-y-5">
          <p className="text-sm text-suave">Escolha a forma de pagamento para concluir.</p>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {PAGAMENTOS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pagamento === p.id}
                onClick={() => setPagamento(p.id)}
                className={cn(
                  "h-10 cursor-pointer rounded-lg border text-sm font-medium",
                  pagamento === p.id ? "border-rosa bg-rosa/10 text-rosa-texto" : "border-borda",
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
                  aria-invalid={recebidoInsuficiente || recebidoInvalido}
                  className="h-10 font-mono"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 pl-[5.5rem]">
                {sugestoes.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRecebido(centavosParaCampo(v))}
                    className="h-7 cursor-pointer rounded-md border border-borda px-2 font-mono text-[11px] text-suave hover:border-rosa"
                  >
                    {formatarPreco(v)}
                  </button>
                ))}
              </div>
              {troco != null && (
                <p className={cn("mt-2 text-right font-mono", recebidoInsuficiente ? "text-perigo" : "text-preco")} aria-live="polite">
                  {recebidoInsuficiente ? `Faltam ${formatarPreco(-troco)}` : `Troco: ${formatarPreco(troco)}`}
                </p>
              )}
            </div>
          )}
        </div>

        <details className="rounded-lg border border-borda px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-suave">Desconto e identificação do cliente{valorDesconto > 0 ? ` · − ${formatarPreco(valorDesconto)}` : ""}</summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <label htmlFor={ids.desconto} className="rotulo w-20 shrink-0 text-suave">
                Desconto
              </label>
              <div className="flex rounded-lg border border-borda p-0.5" role="group" aria-label="Tipo de desconto">
                {(["valor", "percentual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={modoDesconto === m}
                    onClick={() => setModoDesconto(m)}
                    className={cn(
                      "h-8 w-9 cursor-pointer rounded-md font-mono text-xs font-bold",
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

            <div className="flex items-center gap-2">
              <label htmlFor={ids.cliente} className="rotulo w-20 shrink-0 text-suave">
                Cliente
              </label>
              <Input id={ids.cliente} placeholder="Opcional" value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-10" maxLength={80} />
            </div>

          </div>
        </details>


        </div>
      </fieldset> : itens.length === 0 ? <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-suave">
        <div className="grid size-12 place-items-center rounded-full bg-superficie-2"><ShoppingCart className="size-5" aria-hidden /></div>
        <div><p className="text-sm font-medium text-texto">Sua venda começa aqui</p><p className="mt-1 text-xs">Busque um produto e adicione à venda.</p></div>
      </div> : <div className="flex min-h-0 flex-1 flex-col">
        <div aria-hidden className="flex shrink-0 items-center gap-3 border-b border-borda px-4 py-2 text-[11px] text-suave"><span className="flex-1">Produto</span><span className="w-[100px] text-center">Quantidade</span><span className="w-20 text-right">Total</span></div>
        <ul className="min-h-0 flex-1 divide-y divide-borda overflow-y-auto px-4">
          {itens.map((i) => <li key={i.chave} className="flex min-h-14 items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-snug">{i.produto.nome}</p>{i.opcoes.length > 0 && <p className="mt-0.5 text-xs text-suave">+ {i.opcoes.map((o) => o.nome).join(", ")}</p>}<p className="mt-0.5 font-mono text-[11px] text-suave">{formatarPreco(unitario(i))} / {i.produto.vende_pacote ? "pct" : "un"}</p></div>
            <div className="flex w-[100px] shrink-0 items-center justify-center">
              <Button variant="fantasma" size="icone-sm" className="size-8 rounded-md text-suave" onClick={() => onAlterar(i.chave, -1)} aria-label={`Menos ${i.produto.nome}`}>{i.quantidade === 1 ? <Trash2 /> : <Minus />}</Button>
              <span className="w-8 text-center font-mono text-sm">{i.quantidade}</span>
              <Button variant="fantasma" size="icone-sm" className="size-8 rounded-md text-suave" onClick={() => onAlterar(i.chave, 1)} aria-label={`Mais ${i.produto.nome}`}><Plus /></Button>
            </div>
            <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums">{formatarPreco(unitario(i) * i.quantidade)}</span>
          </li>)}
        </ul>
      </div>}

      <footer className="shrink-0 space-y-3 border-t border-borda bg-superficie px-4 py-4">
        {valorDesconto > 0 && <dl className="space-y-1 text-xs text-suave"><div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{formatarPreco(subtotal)}</dd></div><div className="flex justify-between"><dt>Desconto</dt><dd className="font-mono">− {formatarPreco(valorDesconto)}</dd></div></dl>}
        <div className="flex items-baseline justify-between"><span className="text-sm text-suave">Total da venda</span><strong className="font-mono text-2xl font-semibold tabular-nums" data-testid="pdv-total">{formatarPreco(total)}</strong></div>
        <Button size="sm" className="h-10 w-full rounded-lg text-sm font-semibold shadow-none" disabled={!itens.length || finalizando || (recebimento && (recebidoInsuficiente || recebidoInvalido))} onClick={(e) => { if (e.detail > 1) return; if (recebimento) void finalizar(); else setRecebimento(true); }}>
          {finalizando ? "Registrando…" : recebimento ? `Finalizar · ${formatarPreco(total)}` : "Ir para pagamento"}
        </Button>
      </footer>
    </div>
  );
}

/** Título que funciona dentro e fora da gaveta (Radix exige Title só dentro de Dialog). */
function SheetTitleSeguro({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
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
      <SheetTitle className="titulo text-3xl">Movimentar caixa</SheetTitle>
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
              tipo === id ? "border-rosa bg-rosa/10 text-rosa-texto" : "border-borda",
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
      <SheetTitle className="titulo text-3xl">{resultado ? "Caixa fechado" : "Fechar caixa"}</SheetTitle>
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
          <dd className="whitespace-nowrap pl-3 font-mono text-preco">{formatarPreco(r.dinheiro_esperado)}</dd>
        </div>
      </dl>

      {resultado ? (
        <>
          <p
            className={cn(
              "rounded-2xl p-4 text-center font-bold",
              (resultado.diferenca ?? 0) === 0 ? "bg-sucesso/15 text-sucesso" : "bg-rosa/15 text-rosa-texto",
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
            <p className={cn("text-sm font-bold", diferenca === 0 ? "text-sucesso" : "text-rosa-texto")} aria-live="polite">
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
