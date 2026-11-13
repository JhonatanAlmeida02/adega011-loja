"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileUp, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { revalidarLoja } from "@/app/admin/acoes";
import { normalizar } from "@/lib/busca";
import { cn } from "@/lib/utils";
import type { Produto } from "@/lib/tipos";
import { COLUNAS_ORDEM, decodificarXml, LIMITE_XML, pendenciaEntrada, quantidadeEntrada, sugerirFator, type ItemEntrada, type OrdemEntrada, type StatusEntrada } from "@/lib/ordens-entrada";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/campos";
import { CabecalhoPagina, Carregando, Confirmar } from "./ui";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
const data = (s: string | null) => s ? new Date(s).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
const SITUACOES: Record<StatusEntrada, string> = { pendente: "Pendente de conferência", lancada: "Estoque lançado", cancelada: "Cancelada" };
const TAMANHO_PAGINA = 30;

export function ListaOrdensEntrada() {
  const router = useRouter();
  const [ordens, setOrdens] = useState<OrdemEntrada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [status, setStatus] = useState("todos");
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(0);
  const [importando, setImportando] = useState(false);
  const trava = useRef(false);
  const arquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ativo = true;
    let consulta = supabaseNavegador().from("ordens_entrada").select(COLUNAS_ORDEM, { count: "exact" }).order("criado_em", { ascending: false }).range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (status !== "todos") consulta = consulta.eq("status", status);
    consulta.then(({ data, error, count }) => {
      if (!ativo) return;
      if (error) setErro(`Não foi possível carregar as ordens: ${error.message}`);
      else { setErro(""); setOrdens((data ?? []) as unknown as OrdemEntrada[]); setTotal(count ?? 0); }
      setCarregando(false);
    });
    return () => { ativo = false; };
  }, [status, pagina]);

  const importar = async (f?: File) => {
    if (!f || trava.current) return;
    trava.current = true; setImportando(true); setErro("");
    try {
      if (!/\.xml$/i.test(f.name) || f.size > LIMITE_XML) throw new Error("Escolha um arquivo .xml de NF-e com até 3 MB.");
      const xml = decodificarXml(new Uint8Array(await f.arrayBuffer()));
      const { data: resultado, error } = await supabaseNavegador().rpc("importar_nfe_xml", { p_xml: xml, p_arquivo: f.name });
      if (error) throw new Error(error.message);
      toast.success(resultado.existente ? "Esta nota já tem uma ordem. Abrindo para consulta." : "Ordem criada. Confira os itens antes de lançar.");
      router.push(`/admin/ordens-entrada/${resultado.id}`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão. Tente importar novamente; a chave da nota evita duplicidade."); }
    finally { trava.current = false; setImportando(false); if (arquivo.current) arquivo.current.value = ""; }
  };

  return <>
    <CabecalhoPagina titulo="Ordens de entrada" descricao="Importe o XML da NF-e e confira a mercadoria antes de movimentar o estoque." acoes={
      <Button size="sm" disabled={importando} onClick={() => arquivo.current?.click()}><FileUp />{importando ? "Lendo XML…" : "Importar XML da NF-e"}</Button>
    } />
    <input ref={arquivo} type="file" accept=".xml,application/xml,text/xml" className="sr-only" aria-label="Arquivo XML da NF-e" disabled={importando} onChange={(e) => void importar(e.target.files?.[0])} />
    <div className="mb-4 rounded-lg border border-borda bg-superficie p-3 text-xs text-suave">Importar cria uma ordem pendente. Somente a confirmação na tela de conferência dá entrada no estoque. Não há cobrança de IA.</div>
    {erro && <p role="alert" className="mb-3 text-sm text-perigo">{erro}</p>}
    <div className="mb-3 max-w-64"><Select aria-label="Situação das ordens" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(0); }} className="h-9">
      <option value="todos">Todas as situações</option>{Object.entries(SITUACOES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </Select></div>
    {carregando ? <Carregando /> : <>
      <div className="overflow-x-auto rounded-lg border border-borda">
        <table className="w-full min-w-[650px] text-left text-sm"><caption className="sr-only">Ordens de entrada importadas de notas fiscais</caption>
          <thead className="bg-superficie-2 text-xs text-suave"><tr>{["Ordem / NF", "Fornecedor", "Importação", "Total da nota", "Situação", ""].map((t, i) => <th key={i} scope="col" className="px-3 py-2 font-normal">{t}</th>)}</tr></thead>
          <tbody className="divide-y divide-borda">{ordens.map((o) => <tr key={o.id} className="bg-superficie">
            <td className="px-3 py-2"><span className="font-medium">OE {o.numero}</span><span className="block text-xs text-suave">NF {o.nota_numero}/{o.serie}</span></td>
            <td className="max-w-64 px-3 py-2">{o.fornecedor_nome}</td><td className="px-3 py-2 text-xs text-suave">{data(o.criado_em)}</td>
            <td className="px-3 py-2 tabular-nums">{dinheiro(o.total_nota)}</td><td className="px-3 py-2 text-xs">{SITUACOES[o.status]}</td>
            <td className="px-3 py-2"><Button asChild size="sm" variant="suave"><Link href={`/admin/ordens-entrada/${o.id}`}>{o.status === "pendente" ? "Conferir" : "Consultar"}</Link></Button></td>
          </tr>)}</tbody>
        </table>
        {!ordens.length && <p className="p-8 text-center text-sm text-suave">Nenhuma ordem encontrada. Importe o XML para começar.</p>}
      </div>
      {total > TAMANHO_PAGINA && <nav aria-label="Paginação das ordens" className="mt-3 flex items-center justify-end gap-2 text-xs text-suave">
        Página {pagina + 1} de {Math.ceil(total / TAMANHO_PAGINA)}
        <Button size="sm" variant="suave" disabled={!pagina} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
        <Button size="sm" variant="suave" disabled={(pagina + 1) * TAMANHO_PAGINA >= total} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
      </nav>}
    </>}
  </>;
}

export function ConferenciaEntrada({ id }: { id: string }) {
  const [ordem, setOrdem] = useState<OrdemEntrada | null>(null);
  const [itens, setItens] = useState<ItemEntrada[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [codigos, setCodigos] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const trava = useRef(false);
  const carregar = useCallback(async () => {
    const sb = supabaseNavegador();
    const [o, i, p, c] = await Promise.all([
      sb.from("ordens_entrada").select(COLUNAS_ORDEM).eq("id", id).maybeSingle(),
      sb.from("ordens_entrada_itens").select("*").eq("ordem_id", id).order("numero_item"),
      sb.from("produtos").select("*").eq("eh_kit", false).eq("controla_estoque", true).order("nome"),
      sb.from("produto_importacao").select("produto_id,codigo"),
    ]);
    const falha = o.error ?? i.error ?? p.error ?? c.error;
    if (falha) throw new Error(falha.message);
    if (!o.data) throw new Error("Ordem não encontrada ou sem permissão de acesso.");
    return { ordem: o.data as unknown as OrdemEntrada, itens: (i.data ?? []) as ItemEntrada[], produtos: (p.data ?? []) as Produto[], codigos: new Map((c.data ?? []).map((m) => [m.produto_id, m.codigo])) as Map<string, string> };
  }, [id]);
  useEffect(() => {
    let ativo = true;
    carregar().then((r) => { if (ativo) { setOrdem(r.ordem); setItens(r.itens); setProdutos(r.produtos); setCodigos(r.codigos); } }).catch((e) => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [carregar]);
  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  const mapa = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const pendencias = itens.filter((i) => pendenciaEntrada(i, mapa.get(i.produto_id ?? "")));
  const editar = (iid: string, campos: Partial<ItemEntrada>) => {
    setItens((lista) => lista.map((i) => i.id === iid ? { ...i, ...campos, conferido: campos.conferido ?? false } : i)); setSujo(true);
  };

  const salvar = async (confirmar: boolean) => {
    if (!ordem || trava.current) return;
    trava.current = true; setSalvando(true); setErro("");
    try {
      const sb = supabaseNavegador();
      const { data: versao, error } = await sb.rpc("salvar_ordem_entrada", { p_id: id, p_versao: ordem.versao, p_itens: itens.map((i) => ({
        id: i.id, produto_id: i.produto_id, quantidade_recebida: i.quantidade_recebida, fator: i.fator,
        unidade_estoque: i.unidade_estoque, custo_conferido: i.custo_conferido, conferido: i.conferido, ignorar: i.ignorar,
      })), p_observacoes: ordem.observacoes });
      if (error) throw new Error(error.message);
      setOrdem({ ...ordem, versao }); setSujo(false);
      if (confirmar) {
        const lancamento = await sb.rpc("confirmar_ordem_entrada", { p_id: id, p_versao: versao });
        if (lancamento.error) throw new Error(lancamento.error.message);
        await revalidarLoja().catch(() => null);
        const r = await carregar(); setOrdem(r.ordem); setItens(r.itens); setProdutos(r.produtos);
        toast.success("Entrada confirmada. Estoque atualizado.");
      } else toast.success("Conferência salva. O estoque não foi alterado.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão. Reabra a ordem para conferir a situação antes de tentar novamente."); }
    finally { trava.current = false; setSalvando(false); }
  };
  const baixar = async () => {
    const { data, error } = await supabaseNavegador().from("ordens_entrada").select("xml_original").eq("id", id).single();
    if (error) return toast.error(error.message);
    const xmlUtf8 = data.xml_original.replace(/(<\?xml[^>]*encoding=)["'][^"']+["']/i, '$1"UTF-8"');
    const url = URL.createObjectURL(new Blob([xmlUtf8], { type: "application/xml;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `NFe-${ordem?.chave}.xml`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!ordem) return erro ? <p role="alert" className="text-perigo">{erro} <Link href="/admin/ordens-entrada" className="underline">Voltar às ordens</Link></p> : <Carregando />;
  const bloqueada = ordem.status !== "pendente";
  const incluidos = itens.filter((i) => !i.ignorar);
  return <>
    <Link href="/admin/ordens-entrada" onClick={(e) => { if (sujo && !window.confirm("Há alterações não salvas. Sair da conferência?")) e.preventDefault(); }} className="mb-3 inline-flex items-center gap-2 text-xs text-suave"><ArrowLeft className="size-4" />Ordens de entrada</Link>
    <CabecalhoPagina titulo={`Ordem de entrada ${ordem.numero}`} descricao={SITUACOES[ordem.status]} acoes={<Button size="sm" variant="suave" onClick={() => void baixar()}><Download />Baixar XML</Button>} />
    <section aria-label="Dados da nota" className="mb-4 rounded-lg border border-borda bg-superficie p-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3"><div><span className="block text-xs text-suave">Fornecedor</span>{ordem.fornecedor_nome}<span className="block text-xs text-suave">{ordem.fornecedor_documento}</span></div>
        <div><span className="block text-xs text-suave">NF / série · emissão</span>{ordem.nota_numero}/{ordem.serie} · {data(ordem.emitida_em)}<span className="block text-xs text-suave">Destinatário: {ordem.destinatario_documento ?? "Não informado"}</span></div>
        <div><span className="block text-xs text-suave">Total da nota</span>{dinheiro(ordem.total_nota)}<span className="block text-xs text-suave">{itens.length} itens · {incluidos.length} para entrada</span></div>
      </div><p className="mt-3 break-all text-xs text-suave">Chave: {ordem.chave}</p>
      <p className="mt-2 text-xs text-suave">Confira o destinatário e a mercadoria recebida. A importação não consulta a SEFAZ nem valida a assinatura digital. O custo informado é por unidade da nota; frete, tributos e descontos não são rateados. Preços de venda e custos do cadastro não são alterados.</p>
    </section>
    {erro && <p role="alert" className="mb-3 rounded-lg border border-perigo p-3 text-sm text-perigo">{erro}</p>}
    <div className="space-y-2">{itens.map((item) => <LinhaEntrada key={item.id} item={item} produto={mapa.get(item.produto_id ?? "")} produtos={produtos} codigos={codigos} bloqueada={bloqueada || salvando} onChange={(campos) => editar(item.id, campos)} />)}</div>
    <label className="mt-4 block text-xs text-suave" htmlFor="entrada-observacoes">Observações da conferência</label>
    <Textarea id="entrada-observacoes" maxLength={1000} disabled={bloqueada || salvando} value={ordem.observacoes} onChange={(e) => { setOrdem({ ...ordem, observacoes: e.target.value }); setSujo(true); }} className="mt-1 min-h-16" />
    {bloqueada ? <p className="mt-4 text-sm text-suave">{ordem.status === "lancada" ? `Lançada em ${data(ordem.lancado_em)}. Consulte as movimentações no Estoque.` : "Ordem cancelada, sem movimentação de estoque."}</p> : <div className="sticky bottom-20 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borda bg-superficie p-3 md:bottom-3">
      <p role="status" className="text-xs text-suave">{sujo ? "Alterações não salvas · " : ""}{pendencias.length ? `${pendencias.length} itens precisam de conferência.` : "Todos os itens conferidos."}</p>
      <div className="flex flex-wrap gap-2">
        <Confirmar titulo="Cancelar esta ordem?" descricao="A ordem será mantida para consulta, sem lançar estoque." rotuloConfirmar="Cancelar ordem" onConfirmar={async () => {
          if (trava.current) return; trava.current = true; setSalvando(true);
          try { const { error } = await supabaseNavegador().rpc("cancelar_ordem_entrada", { p_id: id, p_versao: ordem.versao }); if (error) throw new Error(error.message); const r = await carregar(); setOrdem(r.ordem); setItens(r.itens); setSujo(false); }
          catch (e) { setErro(e instanceof Error ? e.message : "Falha ao cancelar. Reabra a ordem para consultar."); }
          finally { trava.current = false; setSalvando(false); }
        }}><Button size="sm" variant="fantasma" disabled={salvando}>Cancelar ordem</Button></Confirmar>
        <Button size="sm" variant="suave" disabled={salvando} onClick={() => void salvar(false)}><Save />Salvar conferência</Button>
        <Confirmar titulo="Confirmar entrada no estoque?" descricao={`Serão lançados ${incluidos.length} itens conforme os produtos e conversões conferidos. Esta ação movimenta o estoque.`} rotuloConfirmar="Confirmar entrada" onConfirmar={() => salvar(true)}>
          <Button size="sm" disabled={salvando || !!pendencias.length || !incluidos.length}>{salvando ? "Processando…" : "Confirmar entrada no estoque"}</Button>
        </Confirmar>
      </div>
    </div>}
  </>;
}

function LinhaEntrada({ item, produto, produtos, codigos, bloqueada, onChange }: {
  item: ItemEntrada; produto?: Produto; produtos: Produto[]; codigos: Map<string, string>; bloqueada: boolean; onChange: (campos: Partial<ItemEntrada>) => void;
}) {
  const [busca, setBusca] = useState("");
  const palavras = normalizar(busca).split(/\s+/).filter(Boolean);
  const encontrados = produtos.filter((p) => palavras.every((t) => normalizar(`${p.nome} ${codigos.get(p.id) ?? ""}`).includes(t)));
  const sugestoes = encontrados.slice(0, 40);
  const opcoes = produto && !sugestoes.some((p) => p.id === produto.id) ? [produto, ...sugestoes] : sugestoes;
  const total = quantidadeEntrada(item);
  const mudarNumero = (valor: string) => valor.trim() ? Number(valor.replace(",", ".")) : null;
  return <section aria-label={`Item ${item.numero_item}: ${item.descricao}`} className={cn("rounded-lg border border-borda bg-superficie p-3", item.ignorar && "opacity-70")}>
    <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><h2 className="text-sm font-semibold">{item.numero_item}. {item.descricao}</h2><p className="mt-1 text-xs text-suave">Código fornecedor: {item.codigo_fornecedor} · EAN: {item.ean || "—"}</p></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-rosa" disabled={bloqueada} checked={item.ignorar} onChange={(e) => onChange({ ignorar: e.target.checked })} />Não lançar este item</label>
    </div>
    <p className="my-2 text-xs text-suave">Na nota: {numero(item.quantidade_nota)} {item.unidade_nota} × {dinheiro(item.custo_nota)} · total {dinheiro(item.total_item)}</p>
    {!item.ignorar && <div className="grid gap-3 lg:grid-cols-[minmax(240px,2fr)_1fr_1fr_1fr]">
      <div className="min-w-0"><label className="mb-1 block text-xs text-suave" htmlFor={`produto-${item.id}`}>Produto do estoque</label>
        {!bloqueada && <div className="relative mb-1"><Search className="absolute top-2 left-2 size-4 text-suave" /><Input aria-label={`Pesquisar produto do item ${item.numero_item}`} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, sabor, tamanho ou SKU" className="h-8 pl-8 text-xs" /></div>}
        <Select id={`produto-${item.id}`} disabled={bloqueada} value={item.produto_id ?? ""} className="h-9 text-xs" onChange={(e) => {
          const p = produtos.find((p) => p.id === e.target.value);
          onChange({ produto_id: p?.id ?? null, unidade_estoque: p?.unidade_estoque ?? null, fator: p ? sugerirFator(item.unidade_nota, p) : null });
        }}><option value="">Selecione o produto ou a variação</option>{opcoes.map((p) => <option key={p.id} value={p.id}>{p.nome}{codigos.get(p.id) ? ` · ${codigos.get(p.id)}` : ""}{!p.ativo ? " · inativo" : ""}</option>)}</Select>
        {!bloqueada && encontrados.length > 40 && <p className="mt-1 text-xs text-suave">Refine a busca para ver mais produtos.</p>}
        {bloqueada && item.produto_nome_snapshot && <p className="mt-1 text-xs text-suave">Lançado em: {item.produto_nome_snapshot}</p>}
      </div>
      <div><label className="mb-1 block text-xs text-suave" htmlFor={`qtd-${item.id}`}>Quantidade recebida ({item.unidade_nota})</label><Input id={`qtd-${item.id}`} type="number" min="0.0001" max="1000000000" step="0.0001" disabled={bloqueada} value={item.quantidade_recebida ?? ""} onChange={(e) => onChange({ quantidade_recebida: mudarNumero(e.target.value) })} className="h-9" /></div>
      <div><label className="mb-1 block text-xs text-suave" htmlFor={`fator-${item.id}`}>Quantos {item.unidade_estoque ?? "un / ml"} por {item.unidade_nota}?</label><Input id={`fator-${item.id}`} type="number" min="0.000001" max="1000000000" step="0.000001" placeholder="Ex.: 50 ou 2000" disabled={bloqueada} value={item.fator ?? ""} onChange={(e) => onChange({ fator: mudarNumero(e.target.value), unidade_estoque: produto?.unidade_estoque ?? null })} className="h-9" />
        {!bloqueada && produto && <div className="mt-1 flex flex-wrap gap-1"><button type="button" className="cursor-pointer text-xs text-rosa-texto underline" onClick={() => onChange({ fator: produto.unidade_estoque === "ml" ? produto.volume_unidade ?? 1 : produto.unidades_pacote ?? 1, unidade_estoque: produto.unidade_estoque ?? "un" })}>{produto.unidade_estoque === "ml" ? `Garrafa: ${produto.volume_unidade} ml` : `Pacote: ${produto.unidades_pacote ?? 1} un`}</button></div>}
      </div>
      <div><label className="mb-1 block text-xs text-suave" htmlFor={`custo-${item.id}`}>Custo por {item.unidade_nota} (R$)</label><Input id={`custo-${item.id}`} type="number" min="0" max="1000000000" step="any" disabled={bloqueada} value={item.custo_conferido ?? ""} onChange={(e) => onChange({ custo_conferido: mudarNumero(e.target.value) })} className="h-9" /></div>
    </div>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borda pt-2 text-xs">
      <p className={cn(!item.ignorar && total === null && "text-amarelo-texto")}>{item.ignorar ? "Este item não movimentará o estoque." : total !== null ? `${numero(item.quantidade_recebida!)} × ${numero(item.fator!)} = ${numero(total)} ${item.unidade_estoque ?? ""} de entrada` : "Vincule o produto e confira o fator de conversão."}</p>
      <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="accent-rosa" disabled={bloqueada} checked={item.conferido} onChange={(e) => onChange({ conferido: e.target.checked })} />Conferido</label>
    </div>
  </section>;
}
