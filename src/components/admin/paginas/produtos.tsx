"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { agruparVariacoes, textoBuscaProduto } from "@/lib/variacoes";
import { modoVisibilidade, OPCOES_VISIBILIDADE, produtoVisivel, type Visibilidade } from "@/lib/visibilidade";
import { combina } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { removerImagem } from "@/lib/admin/imagens";
import { clonarProduto, type PedidoClonagem } from "@/lib/admin/clonar-produto";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { idsDaCategoria, ordenarArvore, rotuloCategoria } from "@/lib/categorias";
import { saldoVendavel, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Confirmar, Vazio } from "../ui";
import { MiniaturaProduto } from "../miniatura-produto";

export function PaginaProdutos() {
  const produtos = useTabela<Produto>("produtos");
  const categorias = useTabela<Categoria>("categorias");
  const [filtro, setFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [situacao, setSituacao] = useState("todas");
  const [ordem, setOrdem] = useState("cadastro");
  const [ordenando, setOrdenando] = useState(false);
  const [coluna, setColuna] = useState<{ chave: Coluna; desc: boolean } | null>(null);
  const metadados = useTabela<{ produto_id: string; codigo: string; codigo_pai: string | null; custo: number | null }>("produto_importacao", "produto_id,codigo,codigo_pai,custo", "codigo");
  const [saldos, setSaldos] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let ativo = true;
    supabaseNavegador().rpc("saldos_venda").then(({ data, error }) => {
      if (!ativo) return;
      if (error) toast.error("Não foi possível consultar o saldo dos kits.");
      else setSaldos(new Map((data as { produto_id: string; saldo: number }[] ?? []).map((s) => [s.produto_id, s.saldo])));
    });
    return () => { ativo = false; };
  }, []);
  const metadata = useMemo(() => new Map(metadados.dados.map((m) => [m.produto_id, m])), [metadados.dados]);
  const visivel = (p: Produto) => produtoVisivel({ ...p, saldo_venda: saldos?.get(p.id) });
  // Custo dos kits: automático, pela soma dos componentes (calculado no banco)
  const [custosKit, setCustosKit] = useState<Map<string, CustoKit>>(new Map());
  useEffect(() => {
    let ativo = true;
    supabaseNavegador().rpc("custos_kits").then(({ data, error }) => {
      if (!ativo || error) return;
      setCustosKit(new Map(((data ?? []) as { produto_id: string; custo_min: number | null; custo_max: number | null; faltam: string[] }[])
        .map((k) => [k.produto_id, { min: k.custo_min, max: k.custo_max, faltam: k.faltam ?? [] }])));
    });
    return () => { ativo = false; };
  }, []);
  const router = useRouter();
  const [clonando, setClonando] = useState(false);
  const travaClonagem = useRef(false);
  const pedidosClonagem = useRef(new Map<string, PedidoClonagem>());
  const clonar = async (id: string, familia = true) => {
    if (travaClonagem.current) return;
    travaClonagem.current = true;
    setClonando(true);
    const chave = `${id}:${familia}`;
    const pedido = pedidosClonagem.current.get(chave) ?? { id: crypto.randomUUID(), fotos: {} };
    pedidosClonagem.current.set(chave, pedido);
    try {
      const novoId = await clonarProduto(id, familia, pedido);
      toast.success("Cópia criada oculta. Revise o nome e o SKU antes de ativar.");
      router.push(`/admin/produtos/${novoId}`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível clonar o produto.");
    } finally {
      travaClonagem.current = false;
      setClonando(false);
    }
  };

  const agrupados = useMemo(() => agruparVariacoes([...produtos.dados].sort((a, b) => a.ordem - b.ordem)), [produtos.dados]);
  const valores = useMemo(() => {
    const m = new Map<string, ValoresLinha>();
    for (const p of agrupados) m.set(p.id, valoresLinha(p, metadata, saldos, custosKit));
    return m;
  }, [agrupados, metadata, saldos, custosKit]);
  const contagens = useMemo(() => ({
    todos: agrupados.length,
    simples: agrupados.filter((p) => !p.eh_kit && !p.variacoes).length,
    kits: agrupados.filter((p) => p.eh_kit).length,
    variacoes: agrupados.filter((p) => p.variacoes).length,
  }), [agrupados]);
  // Filtrar uma categoria principal mostra também as suas subcategorias
  const doFiltro = useMemo(() => idsDaCategoria(filtro, categorias.dados), [filtro, categorias.dados]);
  const visiveis = useMemo(() => {
    const lista = agrupados.filter((p) => {
      const membros = p.variacoes ?? [p];
      if (filtro === "sem" ? !!p.categoria_id : filtro !== "todas" && !doFiltro.has(p.categoria_id ?? "")) return false;
      if (tipo === "kits" && !p.eh_kit || tipo === "variacoes" && !p.variacoes || tipo === "simples" && (p.eh_kit || p.variacoes)) return false;
      if (situacao !== "todas" && !membros.some((v) => situacao === "pendente" ? v.preco_pendente : situacao === "ativos" ? produtoVisivel({ ...v, saldo_venda: saldos?.get(v.id) }) : !produtoVisivel({ ...v, saldo_venda: saldos?.get(v.id) }))) return false;
      return combina(`${textoBuscaProduto(p)} ${membros.map((v) => `${metadata.get(v.id)?.codigo ?? ""} ${metadata.get(v.id)?.codigo_pai ?? ""}`).join(" ")}`, busca);
    });
    if (ordem === "nome") lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (ordem === "preco") lista.sort((a, b) => a.preco - b.preco);
    if (coluna) lista.sort((a, b) => compararColuna(valores.get(a.id)!, valores.get(b.id)!, a.nome, b.nome, coluna.chave, coluna.desc));
    return lista;
  }, [agrupados, filtro, busca, tipo, situacao, ordem, metadata, coluna, valores, doFiltro, saldos]);
  const podeOrdenar = filtro !== "todas" && !busca.trim() && tipo === "todos" && situacao === "todas" && ordem === "cadastro" && !coluna;
  // Clique no título: A→Z (menor primeiro), de novo Z→A, de novo volta à ordem anterior
  const ordenarPor = (chave: Coluna) => {
    setOrdenando(false);
    setColuna((c) => (c?.chave !== chave ? { chave, desc: false } : !c.desc ? { chave, desc: true } : null));
  };

  const atualizarLocal = (id: string, campos: Partial<Produto>) =>
    produtos.setDados((lista) => lista.map((p) => (p.id === id ? { ...p, ...campos } : p)));

  const definirVisibilidade = async (p: Produto, visibilidade: Visibilidade) => {
    const campos = { visibilidade, ativo: visibilidade !== "oculto" };
    const ok = await salvar(supabaseNavegador().from("produtos").update(campos).eq("id", p.id), "Visibilidade atualizada");
    if (ok) atualizarLocal(p.id, campos);
  };

  const alternar = async (p: Produto, campo: "disponivel" | "destaque" | "ativo") => {
    const valor = !p[campo];
    atualizarLocal(p.id, { [campo]: valor });
    const ok = await salvar(supabaseNavegador().from("produtos").update({ [campo]: valor }).eq("id", p.id), null);
    if (!ok) atualizarLocal(p.id, { [campo]: !valor });
  };

  const reordenar = async (novos: Produto[]) => {
    const comOrdem = novos.flatMap((p, i) => (p.variacoes ?? [p]).map((v) => ({ ...v, ordem: i })));
    produtos.setDados((lista) => lista.map((p) => comOrdem.find((n) => n.id === p.id) ?? p));
    const sb = supabaseNavegador();
    await salvar(
      Promise.all(comOrdem.map((p) => sb.from("produtos").update({ ordem: p.ordem }).eq("id", p.id))).then((rs) => ({
        error: rs.find((r) => r.error)?.error ?? null,
      })),
      "Ordem salva",
    );
  };

  const excluir = async (p: Produto) => {
    const sb = supabaseNavegador();
    // Um único DELETE mantém a exclusão da família atômica, inclusive quando
    // uma das variações está vinculada a kits/adicionais ou ordens de entrada.
    const resultado = await sb.from("produtos").delete()
      .eq(p.variacoes ? "familia_id" : "id", p.variacoes ? p.familia_id : p.id)
      .select("id,foto_url");
    if (resultado.error?.code === "23503") {
      toast.error("Este produto ou uma de suas variações está vinculado a kits, adicionais ou ordens de entrada. Remova os vínculos ou oculte o produto antes de excluir.");
      return;
    }
    const ok = await salvar(Promise.resolve(resultado), p.variacoes ? "Produto e variações excluídos" : "Produto excluído");
    if (ok) {
      const removidos = resultado.data ?? [];
      const ids = new Set(removidos.map((x) => x.id));
      produtos.setDados((lista) => lista.filter((x) => !ids.has(x.id)));
      const fotos = [...new Set(removidos.map((x) => x.foto_url).filter((url): url is string => !!url))];
      if (fotos.length) {
        // Variações podem compartilhar a foto com produtos que continuam ativos.
        const restantes = await sb.from("produtos").select("foto_url").in("foto_url", fotos);
        if (!restantes.error) {
          const usadas = new Set(restantes.data?.map((x) => x.foto_url));
          for (const foto of fotos) if (!usadas.has(foto)) void removerImagem(foto);
        }
      }
    }
  };

  const novo = () => {
    const cat = filtro !== "todas" && filtro !== "sem" ? filtro : (categorias.dados[0]?.id ?? null);
    router.push(`/admin/produtos/novo${cat ? `?categoria=${encodeURIComponent(cat)}` : ""}`);
  };

  if (produtos.carregando || categorias.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos"
        acoes={
          <Button onClick={novo}>
            <Plus /> Novo produto
          </Button>
        }
      />

      <section aria-label="Catálogo de produtos" className="produtos-erp">
        <div className="produtos-ferramentas">
          <div className="produtos-busca relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
            <Input type="search" aria-label="Buscar produto" placeholder="Pesquisar por nome ou código (SKU)" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filtrar por categoria" value={filtro} onChange={(e) => { setFiltro(e.target.value); setOrdenando(false); }}>
            <option value="todas">Todas as categorias</option>
            {ordenarArvore(categorias.dados).map((c) => <option key={c.id} value={c.id}>{rotuloCategoria(c, categorias.dados)}</option>)}
            <option value="sem">Sem categoria</option>
          </Select>
          <Select aria-label="Filtrar por situação" value={situacao} onChange={(e) => { setSituacao(e.target.value); setOrdenando(false); }}>
            <option value="todas">Situação: todas</option><option value="ativos">Visíveis</option><option value="inativos">Ocultos</option><option value="pendente">Preço pendente</option>
          </Select>
          <Select aria-label="Ordenação" value={ordem} onChange={(e) => { setOrdem(e.target.value); setColuna(null); setOrdenando(false); }}>
            <option value="cadastro">Ordem do catálogo</option><option value="nome">Nome: A a Z</option><option value="preco">Menor preço</option>
          </Select>
        </div>
        <div className="produtos-tipos" role="group" aria-label="Filtrar por tipo de produto">
          {([['todos', 'Todos'], ['simples', 'Simples'], ['kits', 'Kits'], ['variacoes', 'Variações']] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={tipo === valor} onClick={() => { setTipo(valor); setOrdenando(false); }} className={cn("produto-tipo", tipo === valor && "produto-tipo-ativo")}>
              <span>{rotulo}</span><span className="tabular-nums">{contagens[valor]}</span>
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-suave">
          <p role="status">{visiveis.length} registros · {produtos.dados.length} itens incluindo variações</p>
          {podeOrdenar && <Button variant="fantasma" size="sm" onClick={() => setOrdenando(!ordenando)}>{ordenando ? "Voltar à tabela" : "Reordenar catálogo"}</Button>}
        </div>
        {visiveis.length === 0 ? <Vazio titulo="Nenhum produto encontrado" texto="Ajuste a pesquisa ou os filtros para encontrar um produto." /> : ordenando && podeOrdenar ? (
          <ListaOrdenavel itens={visiveis} rotulo={(p) => p.nome} onReordenar={reordenar} renderizar={(p) => <span className="text-sm">{p.nome}</span>} />
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-borda" tabIndex={0} role="region" aria-label="Tabela de produtos">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <caption className="sr-only">Produtos cadastrados e seus estoques</caption>
              <thead className="bg-superficie-2 text-xs text-suave">
                <tr>{COLUNAS.map(([chave, c], i) => {
                  const ativa = chave !== null && coluna?.chave === chave;
                  return <th key={i} scope="col" aria-sort={ativa ? (coluna.desc ? "descending" : "ascending") : undefined} className={cn("px-3 py-3 font-normal whitespace-nowrap", i >= 3 && i <= 6 && "text-right")}>
                    {chave === null ? <span className="sr-only">Ações</span> : (
                      <button type="button" onClick={() => ordenarPor(chave)} title={`Ordenar por ${c.toLowerCase()}`} className="cursor-pointer whitespace-nowrap hover:text-texto">
                        {c}{ativa && <span aria-hidden className="ml-1">{coluna.desc ? "↓" : "↑"}</span>}
                      </button>
                    )}
                  </th>;
                })}</tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {visiveis.map((p) => {
                  const membros = p.variacoes ?? [p];
                  const { codigo, unidade, unidadeFisico, fisico, disponivel, custos, precos, kit } = valores.get(p.id) ?? valoresLinha(p, metadata, saldos, custosKit);
                  const custo = kit ? textoCustoKit(kit) : custos ? faixa(custos) : "—";
                  return <tr key={p.id} className="bg-superficie transition-colors hover:bg-superficie-2">
                    <td className="min-w-64 px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <MiniaturaProduto foto={p.foto_url || membros.find((v) => v.foto_url)?.foto_url} />
                        <div className="min-w-0">
                      <button onClick={() => router.push(`/admin/produtos/${membros[0].id}`)} className={cn("cursor-pointer text-left leading-snug hover:text-rosa-texto", !p.ativo && "text-suave")}>
                        {p.nome}{p.variacoes && <span className="ml-1 text-xs text-rosa-texto">({p.variacoes.length} variações)</span>}
                      </button>
                      <span className="ml-2 inline-flex flex-wrap gap-x-2 text-[.7rem] text-suave">
                        {p.eh_kit && <span className="text-rosa-texto">Kit</span>}
                        {p.preco_pendente && <span className="text-amarelo-texto">Preço pendente</span>}
                        {!membros.some(visivel) && <span>Oculto</span>}
                        {!p.variacoes && modoVisibilidade(p) === "automatico" && <span>Automático pelo estoque</span>}
                        {!p.disponivel && !p.preco_pendente && !p.variacoes && <span>Venda pausada</span>}
                      </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-suave">{codigo || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{unidade}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{precos.length ? faixa(precos) : <span className="text-xs text-amarelo-texto">Pendente</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-suave tabular-nums" title={kit ? (kit.faltam.length ? `Automático. Sem custo: ${kit.faltam.join(", ")}` : "Automático: soma dos componentes") : undefined}>
                      {custo}{kit && kit.min != null && kit.faltam.length > 0 && <span className="text-amarelo-texto" aria-label=" (incompleto: componente sem custo)">*</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fisico === null ? "—" : `${fisico.toLocaleString("pt-BR")} ${unidadeFisico}`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" title="Quantidade possível pelo estoque; a situação de venda é controlada separadamente.">{disponivel === null ? "—" : disponivel.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-2">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild><Button variant="fantasma" size="icone-sm" aria-label={`Ações de ${p.nome}`}><MoreHorizontal /></Button></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content sideOffset={4} align="end" className="z-50 min-w-48 rounded-lg border border-borda bg-superficie p-1 text-sm shadow-xl">
                          <DropdownMenu.Item onSelect={() => router.push(`/admin/produtos/${membros[0].id}`)} className="menu-produto-item"><Pencil className="size-4" />Editar produto</DropdownMenu.Item>
                          <DropdownMenu.Item disabled={clonando} onSelect={() => void clonar(membros[0].id)} className="menu-produto-item data-[disabled]:opacity-50"><Copy className="size-4" />{clonando ? "Clonando…" : "Clonar produto"}</DropdownMenu.Item>
                          {p.variacoes && <DropdownMenu.Sub>
                            <DropdownMenu.SubTrigger disabled={clonando} className="menu-produto-item data-[disabled]:opacity-50">Clonar uma variação<ChevronRight className="ml-auto size-4" /></DropdownMenu.SubTrigger>
                            <DropdownMenu.Portal><DropdownMenu.SubContent sideOffset={4} className="z-50 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-borda bg-superficie p-1 text-sm shadow-xl">
                              {membros.map((v) => <DropdownMenu.Item key={v.id} disabled={clonando} onSelect={() => void clonar(v.id, false)} className="menu-produto-item">{v.variacao_nome || v.nome}</DropdownMenu.Item>)}
                            </DropdownMenu.SubContent></DropdownMenu.Portal>
                          </DropdownMenu.Sub>}
                          {!p.variacoes && <>
                            <DropdownMenu.Separator className="my-1 h-px bg-borda" />
                            {([['disponivel', 'Disponível para venda'], ['destaque', 'Destaque na loja']] as const).map(([campo, label]) => <DropdownMenu.CheckboxItem key={campo} checked={p[campo]} disabled={campo === "disponivel" && p.preco_pendente} onCheckedChange={() => void alternar(p, campo)} className="menu-produto-item justify-between disabled:opacity-50 data-[disabled]:opacity-50">{label}<span aria-hidden className={p[campo] ? "text-rosa-texto" : "text-suave"}>{p[campo] ? "✓" : "—"}</span></DropdownMenu.CheckboxItem>)}
                            <DropdownMenu.Separator className="my-1 h-px bg-borda" />
                            <DropdownMenu.RadioGroup value={modoVisibilidade(p)} onValueChange={(v) => void definirVisibilidade(p, v as Visibilidade)}>
                              {OPCOES_VISIBILIDADE.map(([v, nome]) => <DropdownMenu.RadioItem key={v} value={v} className="menu-produto-item justify-between">{nome}<DropdownMenu.ItemIndicator aria-hidden>✓</DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
                            </DropdownMenu.RadioGroup>
                          </>}
                          <DropdownMenu.Separator className="my-1 h-px bg-borda" />
                          <Confirmar titulo={p.variacoes ? "Excluir produto e variações?" : "Excluir produto?"} descricao={p.variacoes ? `“${p.nome}” e suas ${membros.length} variações serão excluídos. Isso não pode ser desfeito.` : `“${p.nome}” será removido do cardápio. Isso não pode ser desfeito.`} onConfirmar={() => excluir(p)}>
                            <button type="button" className="menu-produto-item w-full text-perigo"><Trash2 className="size-4" />{p.variacoes ? "Excluir produto e variações" : "Excluir produto"}</button>
                          </Confirmar>
                        </DropdownMenu.Content></DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function faixa(valores: number[]) {
  const minimo = Math.min(...valores);
  return `${valores.some((v) => v !== minimo) ? "A partir de " : ""}${formatarPreco(minimo)}`;
}

type CustoKit = { min: number | null; max: number | null; faltam: string[] };

/** Custo do kit: "R$ 2,56" ou, com escolhas (ex.: vodka do copão), "R$ 1,00 – R$ 2,56". */
function textoCustoKit(k: CustoKit) {
  if (k.min == null || k.max == null) return "—";
  return k.min === k.max ? formatarPreco(k.min) : `${formatarPreco(k.min)} – ${formatarPreco(k.max)}`;
}

type Coluna = "nome" | "codigo" | "unidade" | "preco" | "custo" | "fisico" | "disponivel";

const COLUNAS: [Coluna | null, string][] = [
  ["nome", "Descrição"], ["codigo", "Código (SKU)"], ["unidade", "Unidade"], ["preco", "Preço"],
  ["custo", "Custo"], ["fisico", "Estoque físico"], ["disponivel", "Disponível p/ venda"], [null, ""],
];

type ValoresLinha = {
  codigo: string | null;
  unidade: string;
  unidadeFisico: string;
  fisico: number | null;
  disponivel: number | null;
  custos: number[] | null;
  precos: number[];
  kit: CustoKit | null;
};

type Meta = { codigo: string; codigo_pai: string | null; custo: number | null };

/** O que cada linha mostra; serve tanto para desenhar quanto para ordenar pelas colunas. */
function valoresLinha(p: Produto & { variacoes?: Produto[] }, metadata: Map<string, Meta>, saldos: Map<string, number> | null, custosKit: Map<string, CustoKit>): ValoresLinha {
  const membros = p.variacoes ?? [p];
  const meta = metadata.get(membros[0].id);
  const unidades = new Set(membros.map((v) => v.unidade_estoque ?? "un"));
  const custos = membros.map((v) => metadata.get(v.id)?.custo);
  return {
    codigo: (p.variacoes ? meta?.codigo_pai : meta?.codigo) || null,
    unidade: p.eh_kit ? "KIT" : p.variacoes ? "VAR" : p.vende_pacote ? "PCT" : p.unidade_estoque === "ml" ? "GFA" : "UN",
    unidadeFisico: [...unidades][0],
    fisico: !p.eh_kit && membros.every((v) => v.controla_estoque) && unidades.size === 1 ? membros.reduce((s, v) => s + v.estoque, 0) : null,
    disponivel: p.eh_kit ? saldos?.get(p.id) ?? null : membros.every((v) => v.controla_estoque) ? membros.reduce((s, v) => s + saldoVendavel(v), 0) : null,
    custos: custos.every((v) => v != null) ? (custos as number[]) : null,
    precos: membros.filter((v) => !v.preco_pendente).map((v) => v.preco),
    kit: p.eh_kit ? custosKit.get(p.id) ?? { min: null, max: null, faltam: [] } : null,
  };
}

/** Compara duas linhas pela coluna escolhida. Vazios ("—", pendente) ficam sempre no fim; empate desempata pelo nome. */
function compararColuna(a: ValoresLinha, b: ValoresLinha, nomeA: string, nomeB: string, chave: Coluna, desc: boolean) {
  const valor = (v: ValoresLinha, nome: string): string | number | null => {
    switch (chave) {
      case "nome": return nome;
      case "codigo": return v.codigo;
      case "unidade": return v.unidade;
      case "preco": return v.precos.length ? Math.min(...v.precos) : null;
      case "custo": return v.kit ? v.kit.min : v.custos ? Math.min(...v.custos) : null;
      case "fisico": return v.fisico;
      case "disponivel": return v.disponivel;
    }
  };
  const x = valor(a, nomeA);
  const y = valor(b, nomeB);
  if (x === null || y === null) return x === y ? nomeA.localeCompare(nomeB, "pt-BR") : x === null ? 1 : -1;
  const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true, sensitivity: "base" });
  return (desc ? -r : r) || nomeA.localeCompare(nomeB, "pt-BR");
}
