"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { agruparVariacoes, textoBuscaProduto } from "@/lib/variacoes";
import { combina } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { removerImagem } from "@/lib/admin/imagens";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { saldoVendavel, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Confirmar, Vazio } from "../ui";

export function PaginaProdutos() {
  const produtos = useTabela<Produto>("produtos");
  const categorias = useTabela<Categoria>("categorias");
  const [filtro, setFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [situacao, setSituacao] = useState("todas");
  const [ordem, setOrdem] = useState("cadastro");
  const [ordenando, setOrdenando] = useState(false);
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
  const router = useRouter();


  const agrupados = useMemo(() => agruparVariacoes([...produtos.dados].sort((a, b) => a.ordem - b.ordem)), [produtos.dados]);
  const contagens = useMemo(() => ({
    todos: agrupados.length,
    simples: agrupados.filter((p) => !p.eh_kit && !p.variacoes).length,
    kits: agrupados.filter((p) => p.eh_kit).length,
    variacoes: agrupados.filter((p) => p.variacoes).length,
  }), [agrupados]);
  const visiveis = useMemo(() => {
    const lista = agrupados.filter((p) => {
      const membros = p.variacoes ?? [p];
      if (filtro === "sem" ? !!p.categoria_id : filtro !== "todas" && p.categoria_id !== filtro) return false;
      if (tipo === "kits" && !p.eh_kit || tipo === "variacoes" && !p.variacoes || tipo === "simples" && (p.eh_kit || p.variacoes)) return false;
      if (situacao !== "todas" && !membros.some((v) => situacao === "pendente" ? v.preco_pendente : situacao === "ativos" ? v.ativo : !v.ativo)) return false;
      return combina(`${textoBuscaProduto(p)} ${membros.map((v) => `${metadata.get(v.id)?.codigo ?? ""} ${metadata.get(v.id)?.codigo_pai ?? ""}`).join(" ")}`, busca);
    });
    if (ordem === "nome") lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (ordem === "preco") lista.sort((a, b) => a.preco - b.preco);
    return lista;
  }, [agrupados, filtro, busca, tipo, situacao, ordem, metadata]);
  const podeOrdenar = filtro !== "todas" && !busca.trim() && tipo === "todos" && situacao === "todas" && ordem === "cadastro";

  const atualizarLocal = (id: string, campos: Partial<Produto>) =>
    produtos.setDados((lista) => lista.map((p) => (p.id === id ? { ...p, ...campos } : p)));

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
    const ok = await salvar(supabaseNavegador().from("produtos").delete().eq("id", p.id), "Produto excluído");
    if (ok) {
      produtos.setDados((lista) => lista.filter((x) => x.id !== p.id));
      void removerImagem(p.foto_url);
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
            {categorias.dados.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            <option value="sem">Sem categoria</option>
          </Select>
          <Select aria-label="Filtrar por situação" value={situacao} onChange={(e) => { setSituacao(e.target.value); setOrdenando(false); }}>
            <option value="todas">Situação: todas</option><option value="ativos">Visíveis</option><option value="inativos">Ocultos</option><option value="pendente">Preço pendente</option>
          </Select>
          <Select aria-label="Ordenação" value={ordem} onChange={(e) => { setOrdem(e.target.value); setOrdenando(false); }}>
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
                <tr>{["Descrição", "Código (SKU)", "Unidade", "Preço", "Custo", "Estoque físico", "Disponível p/ venda", ""].map((c, i) => <th key={i} scope="col" className={cn("px-3 py-3 font-normal whitespace-nowrap", i >= 3 && i <= 6 && "text-right")}>{c || <span className="sr-only">Ações</span>}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {visiveis.map((p) => {
                  const membros = p.variacoes ?? [p];
                  const meta = metadata.get(membros[0].id);
                  const codigo = p.variacoes ? meta?.codigo_pai : meta?.codigo;
                  const unidades = new Set(membros.map((v) => v.unidade_estoque ?? "un"));
                  const fisico = !p.eh_kit && membros.every((v) => v.controla_estoque) && unidades.size === 1 ? membros.reduce((s, v) => s + v.estoque, 0) : null;
                  const disponivel = p.eh_kit ? saldos?.get(p.id) ?? null : membros.every((v) => v.controla_estoque) ? membros.reduce((s, v) => s + saldoVendavel(v), 0) : null;
                  const custos = membros.map((v) => metadata.get(v.id)?.custo);
                  const custo = custos.every((v) => v != null) ? faixa(custos as number[]) : "—";
                  const precos = membros.filter((v) => !v.preco_pendente).map((v) => v.preco);
                  return <tr key={p.id} className="bg-superficie transition-colors hover:bg-superficie-2">
                    <td className="min-w-64 px-3 py-2.5">
                      <button onClick={() => router.push(`/admin/produtos/${membros[0].id}`)} className={cn("cursor-pointer text-left leading-snug hover:text-rosa-texto", !p.ativo && "text-suave")}>
                        {p.nome}{p.variacoes && <span className="ml-1 text-xs text-rosa-texto">({p.variacoes.length} variações)</span>}
                      </button>
                      <span className="ml-2 inline-flex flex-wrap gap-x-2 text-[.7rem] text-suave">
                        {p.eh_kit && <span className="text-rosa-texto">Kit</span>}
                        {p.preco_pendente && <span className="text-amarelo-texto">Preço pendente</span>}
                        {!p.ativo && <span>Oculto</span>}
                        {!p.disponivel && !p.preco_pendente && !p.variacoes && <span>Venda pausada</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-suave">{codigo || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{p.eh_kit ? "KIT" : p.variacoes ? "VAR" : p.vende_pacote ? "PCT" : p.unidade_estoque === "ml" ? "GFA" : "UN"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{precos.length ? faixa(precos) : <span className="text-xs text-amarelo-texto">Pendente</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-suave tabular-nums">{custo}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fisico === null ? "—" : `${fisico.toLocaleString("pt-BR")} ${[...unidades][0]}`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" title="Quantidade possível pelo estoque; a situação de venda é controlada separadamente.">{disponivel === null ? "—" : disponivel.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-2">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild><Button variant="fantasma" size="icone-sm" aria-label={`Ações de ${p.nome}`}><MoreHorizontal /></Button></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content sideOffset={4} align="end" className="z-50 min-w-48 rounded-lg border border-borda bg-superficie p-1 text-sm shadow-xl">
                          <DropdownMenu.Item onSelect={() => router.push(`/admin/produtos/${membros[0].id}`)} className="menu-produto-item"><Pencil className="size-4" />Editar produto</DropdownMenu.Item>
                          {!p.variacoes && <>
                            <DropdownMenu.Separator className="my-1 h-px bg-borda" />
                            {([['disponivel', 'Disponível para venda'], ['destaque', 'Destaque na loja'], ['ativo', 'Visível na loja']] as const).map(([campo, label]) => <DropdownMenu.CheckboxItem key={campo} checked={p[campo]} disabled={campo === "disponivel" && p.preco_pendente} onCheckedChange={() => void alternar(p, campo)} className="menu-produto-item justify-between disabled:opacity-50 data-[disabled]:opacity-50">{label}<span aria-hidden className={p[campo] ? "text-rosa-texto" : "text-suave"}>{p[campo] ? "✓" : "—"}</span></DropdownMenu.CheckboxItem>)}
                            <DropdownMenu.Separator className="my-1 h-px bg-borda" />
                            <Confirmar titulo="Excluir produto?" descricao={`“${p.nome}” será removido do cardápio. Isso não pode ser desfeito.`} onConfirmar={() => excluir(p)}>
                              <button type="button" className="menu-produto-item w-full text-perigo"><Trash2 className="size-4" />Excluir produto</button>
                            </Confirmar>
                          </>}
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
