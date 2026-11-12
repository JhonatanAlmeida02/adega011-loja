"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, PackagePlus, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { normalizar } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { revalidarLoja } from "@/app/admin/acoes";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { saldoVendavel, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor, Select } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando, Vazio } from "../ui";

type Filtro = "controlados" | "baixo" | "todos";
type TipoEstoque = "todos" | "simples" | "kits" | "insumos";
interface MetaEstoque { produto_id: string; codigo: string; custo: number | null; origem: { tipo?: string } | null }
const ITENS_POR_PAGINA = 50;

interface Movimento {
  id: string;
  quantidade: number;
  saldo: number;
  unidade?: string;
  motivo: string;
  observacao: string | null;
  criado_em: string;
}

const MOTIVOS: Record<string, string> = {
  pedido: "Pedido do site",
  cancelamento: "Pedido cancelado",
  reativacao: "Pedido reativado",
  venda_balcao: "Venda no balcão",
  entrada: "Entrada",
  ajuste: "Ajuste de contagem",
};

const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function PaginaEstoque() {
  const produtos = useTabela<Produto>("produtos");
  const categorias = useTabela<Categoria>("categorias");
  const metadados = useTabela<MetaEstoque>("produto_importacao", "produto_id,codigo,custo,origem", "codigo");
  const metadata = useMemo(() => new Map(metadados.dados.map((m) => [m.produto_id, m])), [metadados.dados]);
  const categoriasInsumos = useMemo(() => new Set(categorias.dados.filter((c) => c.slug === "insumos").map((c) => c.id)), [categorias.dados]);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState<Filtro>("controlados");
  const [tipo, setTipo] = useState<TipoEstoque>("todos");
  const [situacao, setSituacao] = useState("todos");
  const [categoria, setCategoria] = useState("todas");
  const [saldos, setSaldos] = useState<Map<string, number> | null>(null);
  const [acao, setAcao] = useState<{ produto: Produto; modo: "entrada" | "ajuste" | "historico" } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBuscaAplicada(busca);
      setPagina(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [busca]);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador().rpc("saldos_venda").then(({ data, error }) => {
      if (!ativo) return;
      if (error) { setSaldos(null); toast.error("Não foi possível consultar o saldo dos kits."); }
      else setSaldos(new Map((data as { produto_id: string; saldo: number }[] ?? []).map((s) => [s.produto_id, s.saldo])));
    });
    return () => { ativo = false; };
  }, [produtos.dados]);

  const tipoProduto = (p: Produto): TipoEstoque => p.eh_kit ? "kits" : metadata.get(p.id)?.origem?.tipo === "insumo" || categoriasInsumos.has(p.categoria_id ?? "") ? "insumos" : "simples";
  const indice = useMemo(() => [...produtos.dados]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((p) => ({
      produto: p,
      texto: normalizar(p.nome + " " + (metadata.get(p.id)?.codigo ?? "")),
      tipo: p.eh_kit ? "kits" : metadata.get(p.id)?.origem?.tipo === "insumo" || categoriasInsumos.has(p.categoria_id ?? "") ? "insumos" : "simples",
    })), [produtos.dados, metadata, categoriasInsumos]);
  const contagens = useMemo(() => {
    const totais = { todos: indice.length, simples: 0, kits: 0, insumos: 0 };
    for (const item of indice) totais[item.tipo as Exclude<TipoEstoque, "todos">]++;
    return totais;
  }, [indice]);

  const lista = useMemo(() => {
    const palavras = normalizar(buscaAplicada).split(/\s+/).filter(Boolean);
    return indice.filter(({ produto: p, texto, tipo: tipoItem }) => {
      if (filtro === "controlados" && !p.controla_estoque && !p.eh_kit) return false;
      if (filtro === "baixo" && (p.eh_kit || !p.controla_estoque || p.estoque > (p.volume_unidade ?? 1) * 5)) return false;
      if (tipo !== "todos" && tipoItem !== tipo) return false;
      if (situacao !== "todos" && (situacao === "ativos" ? !p.ativo : p.ativo)) return false;
      if (categoria !== "todas" && p.categoria_id !== categoria) return false;
      return palavras.every((palavra) => texto.includes(palavra));
    }).map((item) => item.produto);
  }, [indice, filtro, buscaAplicada, tipo, situacao, categoria]);
  const totalPaginas = Math.max(1, Math.ceil(lista.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const itensPagina = lista.slice(inicio, inicio + ITENS_POR_PAGINA);
  const filtrando = busca !== buscaAplicada;

  const atualizar = (id: string, campos: Partial<Produto>) =>
    produtos.setDados((l) => l.map((p) => (p.id === id ? { ...p, ...campos } : p)));

  const alternarControle = async (p: Produto) => {
    atualizar(p.id, { controla_estoque: !p.controla_estoque });
    const ok = await salvar(
      supabaseNavegador().from("produtos").update({ controla_estoque: !p.controla_estoque }).eq("id", p.id),
      !p.controla_estoque ? `Controlando estoque de ${p.nome}` : null,
    );
    if (!ok) atualizar(p.id, { controla_estoque: p.controla_estoque });
  };

  const alternarAtivo = async (p: Produto) => {
    atualizar(p.id, { ativo: !p.ativo });
    const ok = await salvar(supabaseNavegador().from("produtos").update({ ativo: !p.ativo }).eq("id", p.id), null);
    if (!ok) atualizar(p.id, { ativo: p.ativo });
  };

  const baixos = produtos.dados.filter((p) => !p.eh_kit && p.controla_estoque && p.estoque <= (p.volume_unidade ?? 1) * 5).length;

  if (produtos.carregando || categorias.carregando || metadados.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Estoque"
        descricao="Vendas do site e do balcão baixam sozinhas; cancelamentos devolvem."
      />

      <section aria-label="Controle de estoque" className="produtos-erp">
        <div className="produtos-ferramentas">
          <div className="produtos-busca relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
            <Input type="search" aria-label="Buscar produto no estoque" placeholder="Pesquisar por nome ou código (SKU)" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9 pl-9" />
          </div>
          <Select className="h-9" aria-label="Filtrar por categoria" value={categoria} onChange={(e) => { setCategoria(e.target.value); setPagina(1); }}>
            <option value="todas">Todas as categorias</option>
            {categorias.dados.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select className="h-9" aria-label="Filtrar por situação" value={situacao} onChange={(e) => { setSituacao(e.target.value); setPagina(1); }}>
            <option value="todos">Ativos e inativos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option>
          </Select>
          <Select className="h-9" aria-label="Filtrar por estoque" value={filtro} onChange={(e) => { setFiltro(e.target.value as Filtro); setPagina(1); }}>
            <option value="controlados">Com controle</option><option value="baixo">Estoque baixo ({baixos})</option><option value="todos">Todos os produtos</option>
          </Select>
        </div>
        <div className="produtos-tipos" role="group" aria-label="Filtrar por tipo de produto">
          {([["todos", "Todos"], ["simples", "Simples"], ["kits", "Kits"], ["insumos", "Insumos"]] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={tipo === valor} onClick={() => { setTipo(valor); setPagina(1); }} className={cn("produto-tipo", tipo === valor && "produto-tipo-ativo")}>
              <span>{rotulo}</span><span className="tabular-nums">{contagens[valor]}</span>
            </button>
          ))}
        </div>
        <p role="status" className="mb-2 text-xs text-suave">{filtrando ? "Filtrando…" : lista.length ? `${inicio + 1}–${Math.min(inicio + ITENS_POR_PAGINA, lista.length)} de ${lista.length} itens encontrados` : "Nenhum item encontrado"}</p>
        {lista.length === 0 ? (
          <Vazio titulo="Nenhum item encontrado" texto="Ajuste a pesquisa ou os filtros para encontrar um produto." acao={
            <Button variant="suave" size="sm" onClick={() => { setBusca(""); setBuscaAplicada(""); setTipo("todos"); setFiltro("todos"); setSituacao("todos"); setCategoria("todas"); setPagina(1); }}>Limpar filtros</Button>
          } />
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-borda" tabIndex={0} role="region" aria-label="Tabela de estoque" aria-busy={filtrando}>
            <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
              <caption className="sr-only">Estoque por produto, com situação e ações de movimentação</caption>
              <thead className="bg-superficie-2 text-xs text-suave">
                <tr>{["Produto", "Código (SKU)", "Unidade", "Preço", "Custo", "Estoque físico", "Disponível", "Controle", "Ativo", "Ações"].map((c, i) => (
                  <th key={c} scope="col" className={cn("whitespace-nowrap px-3 py-2.5 font-normal", i >= 3 && i <= 6 && "text-right", i >= 7 && "text-center")}>{c}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {itensPagina.map((p) => {
                  const meta = metadata.get(p.id);
                  const saldo = p.eh_kit ? saldos?.get(p.id) ?? null : p.controla_estoque ? saldoVendavel(p) : null;
                  const baixo = p.controla_estoque && p.estoque <= (p.volume_unidade ?? 1) * 5;
                  return <tr key={p.id} className="bg-superficie transition-colors hover:bg-superficie-2">
                    <td className="min-w-60 px-3 py-2">
                      <span className={cn("leading-snug", !p.ativo && "text-suave")}>{p.nome}</span>
                      <span className="ml-2 text-[.7rem] text-suave">{p.eh_kit ? "Kit" : tipoProduto(p) === "insumos" ? "Insumo" : ""}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-suave">{meta?.codigo || "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.eh_kit ? "KIT" : (p.unidade_estoque ?? "un").toUpperCase()}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.preco_pendente ? "Pendente" : tipoProduto(p) === "insumos" && !p.preco ? "—" : formatarPreco(p.preco)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-suave tabular-nums">{meta?.custo != null ? formatarPreco(meta.custo) : "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", !p.eh_kit && baixo && (p.estoque <= 0 ? "text-perigo" : "text-amarelo-texto"))}>
                      {p.eh_kit || !p.controla_estoque ? "—" : p.estoque.toLocaleString("pt-BR") + " " + (p.unidade_estoque ?? "un")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" title={p.eh_kit ? "Kits possíveis pelo saldo dos componentes e escolhas obrigatórias." : "Quantidade de vendas completas possível pelo estoque físico."}>{saldo === null ? "—" : saldo.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2"><div className="flex justify-center"><Interruptor disabled={!!p.eh_kit} checked={p.controla_estoque || !!p.eh_kit} onCheckedChange={() => void alternarControle(p)} label={"Controlar estoque de " + p.nome} /></div></td>
                    <td className="px-3 py-2"><div className="flex justify-center"><Interruptor checked={p.ativo} onCheckedChange={() => void alternarAtivo(p)} label={p.nome + " ativo na loja"} /></div></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {!p.eh_kit && p.controla_estoque ? <>
                          <Button size="icone-sm" onClick={() => setAcao({ produto: p, modo: "entrada" })} aria-label={"Entrada de " + p.nome} title="Registrar entrada"><PackagePlus /></Button>
                          <Button variant="fantasma" size="icone-sm" onClick={() => setAcao({ produto: p, modo: "ajuste" })} aria-label={"Ajustar contagem de " + p.nome} title="Ajustar contagem"><SlidersHorizontal /></Button>
                          <Button variant="fantasma" size="icone-sm" onClick={() => setAcao({ produto: p, modo: "historico" })} aria-label={"Histórico de " + p.nome} title="Histórico"><History /></Button>
                        </> : <span className="px-2 text-xs text-suave">{p.eh_kit ? "Via componentes" : "Sem controle"}</span>}
                      </div>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
        {lista.length > ITENS_POR_PAGINA && <nav aria-label="Paginação do estoque" className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-2 text-xs text-suave">Página {paginaAtual} de {totalPaginas} · 50 por página</span>
          <Button variant="suave" size="sm" disabled={paginaAtual === 1 || filtrando} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
          <Button variant="suave" size="sm" disabled={paginaAtual === totalPaginas || filtrando} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
        </nav>}
      </section>

      <Sheet open={!!acao} onOpenChange={(v) => !v && setAcao(null)}>
        <SheetContent className="overflow-y-auto" rotuloFechar="Fechar">
          {acao && acao.modo !== "historico" && (
            <FormMovimento
              key={`${acao.produto.id}-${acao.modo}`}
              produto={acao.produto}
              modo={acao.modo}
              onFeito={(saldo) => {
                atualizar(acao.produto.id, { estoque: saldo, controla_estoque: true });
                setAcao(null);
              }}
            />
          )}
          {acao?.modo === "historico" && <Historico produto={acao.produto} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function FormMovimento({
  produto,
  modo,
  onFeito,
}: {
  produto: Produto;
  modo: "entrada" | "ajuste";
  onFeito: (saldo: number) => void;
}) {
  const [qtd, setQtd] = useState(modo === "ajuste" ? String(produto.estoque) : "");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ml = produto.unidade_estoque === "ml";
  const fatorEmbalagem = ml ? produto.volume_unidade ?? 1 : produto.unidades_pacote ?? 1;
  const temEmbalagem = ml || fatorEmbalagem > 1;
  const [emEmbalagem, setEmEmbalagem] = useState(modo === "entrada" && temEmbalagem);
  const formato = emEmbalagem ? ml ? "garrafa" : "pacote" : "base";
  const fator = emEmbalagem ? fatorEmbalagem : 1;
  const n = Number(qtd) * fator;
  const emSalvar = useRef(false);
  const valido = qtd.trim() !== "" && Number.isInteger(Number(qtd)) && Number.isInteger(n) && n <= 1000000000 && n >= 0 && (modo === "ajuste" || n > 0);
  const saldoFinal = modo === "entrada" ? produto.estoque + (valido ? n : 0) : valido ? n : produto.estoque;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || emSalvar.current) return;
    emSalvar.current = true; setSalvando(true);
    try {
      const sb = supabaseNavegador();
      const { data, error } = modo === "entrada"
        ? await sb.rpc("registrar_entrada_estoque", { p_produto: produto.id, p_quantidade: Number(qtd), p_formato: formato, p_fator_esperado: fator, p_observacao: obs.trim() || null })
        : await sb.rpc("ajustar_estoque", { p_produto: produto.id, p_modo: modo, p_quantidade: n, p_observacao: obs.trim() || null });
      if (error) return toast.error(error.message);
      await revalidarLoja().catch(() => null);
      toast.success(`${produto.nome}: ${data} ${produto.unidade_estoque ?? "un"} em estoque`);
      onFeito(data as number);
    } catch {
      toast.error("Falha de conexão ao registrar o estoque. Confira o histórico antes de repetir a entrada.");
    } finally { emSalvar.current = false; setSalvando(false); }
  };

  return (
    <form onSubmit={enviar} className="flex flex-1 flex-col">
      <div className="space-y-5 px-5 pt-4 pr-16 md:px-6 md:pt-6">
        <div>
          <SheetTitle className="titulo text-4xl">{modo === "entrada" ? "Entrada" : "Ajustar contagem"}</SheetTitle>
          <SheetDescription className="mt-1 text-suave">
            {produto.nome} · hoje: <strong className="font-mono text-texto">{produto.estoque} {produto.unidade_estoque ?? "un"}</strong>
          </SheetDescription>
        </div>
        {temEmbalagem && modo === "entrada" && <Campo label="Forma de entrada" htmlFor="mov-formato">
          <Select id="mov-formato" disabled={salvando} value={emEmbalagem ? "embalagem" : "base"} onChange={(e) => setEmEmbalagem(e.target.value === "embalagem")}>
            <option value="embalagem">{ml ? `Garrafas de ${fatorEmbalagem} ml` : `Pacotes de ${fatorEmbalagem} UN`}</option>
            <option value="base">{ml ? "Mililitros (ml)" : "Unidades avulsas (UN)"}</option>
          </Select>
        </Campo>}
        <Campo
          label={emEmbalagem ? ml ? "Quantas garrafas chegaram?" : "Quantos pacotes chegaram?" : ml ? "Quantidade em ml" : modo === "entrada" ? "Quantas unidades chegaram?" : "Quantas unidades você contou?"}
          htmlFor="mov-qtd"
          ajuda={`${emEmbalagem && valido ? `${qtd} ${ml ? "garrafas" : "pacotes"} × ${fator} = ${n} ${produto.unidade_estoque ?? "un"}. ` : ""}Vai ficar com ${saldoFinal} ${produto.unidade_estoque ?? "un"} em estoque.`}
        >
          <Input
            id="mov-qtd"
            disabled={salvando}
            type="number"
            inputMode="numeric"
            min={0}
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            autoFocus
            className="font-mono text-lg"
          />
        </Campo>
        <Campo label="Observação (opcional)" htmlFor="mov-obs">
          <Input id="mov-obs" disabled={salvando} placeholder={modo === "entrada" ? "Ex.: nota 1234, fornecedor" : "Ex.: quebra, contagem mensal"} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} />
        </Campo>
      </div>
      <div className="pb-seguro mt-auto border-t border-borda px-5 pt-4 md:px-6">
        <Button type="submit" size="lg" className="w-full" disabled={!valido || salvando}>
          {salvando ? "Salvando…" : modo === "entrada" ? "Registrar entrada" : "Salvar contagem"}
        </Button>
      </div>
    </form>
  );
}

function Historico({ produto }: { produto: Produto }) {
  const [movs, setMovs] = useState<Movimento[] | null>(null);
  useEffect(() => {
    let ativo = true;
    supabaseNavegador()
      .from("estoque_movimentos")
      .select("id,quantidade,saldo,unidade,motivo,observacao,criado_em")
      .eq("produto_id", produto.id)
      .order("criado_em", { ascending: false })
      .limit(50)
      .then(({ data }) => ativo && setMovs((data ?? []) as Movimento[]));
    return () => {
      ativo = false;
    };
  }, [produto.id]);

  return (
    <div className="px-5 pt-4 pb-8 pr-16 md:px-6 md:pt-6">
      <SheetTitle className="titulo text-4xl">Histórico</SheetTitle>
      <SheetDescription className="mt-1 text-suave">{produto.nome} · últimos 50 movimentos</SheetDescription>
      {!movs ? (
        <Carregando />
      ) : movs.length === 0 ? (
        <p className="mt-6 text-suave">Nenhum movimento ainda.</p>
      ) : (
        <ul className="mt-5 divide-y divide-borda">
          {movs.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  "w-14 shrink-0 text-right font-mono text-lg font-bold",
                  m.quantidade > 0 ? "text-sucesso" : "text-rosa-texto",
                )}
              >
                {m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade} {m.unidade ?? "un"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{MOTIVOS[m.motivo] ?? m.motivo}</p>
                <p className="truncate text-sm text-suave">
                  {fmtData.format(new Date(m.criado_em))}
                  {m.observacao && ` · ${m.observacao}`}
                </p>
              </div>
              <span className="font-mono text-sm text-suave">= {m.saldo} {m.unidade ?? "un"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
