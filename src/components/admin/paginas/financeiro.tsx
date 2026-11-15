"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { centavosParaCampo, cn, formatarPreco, paraCentavos } from "@/lib/utils";
import { NOMES_ORIGEM, NOMES_PAGAMENTO, NOMES_STATUS } from "@/lib/tipos";
import { hojeFinanceiro, TIPOS_CONTA, TIPOS_LANCAMENTO, type ContaFinanceira, type HistoricoFinanceiro, type LancamentoFinanceiro, type PainelFinanceiro, type VendaFinanceira } from "@/lib/financeiro";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando, Vazio } from "../ui";

type Aba = "contas" | "movimentos" | "vendas";
type Acao = { tipo: "conta"; conta?: ContaFinanceira } | { tipo: "lancamento"; transferencia?: boolean } | { tipo: "saldo"; conta: ContaFinanceira } | { tipo: "estorno"; lancamento: LancamentoFinanceiro };
const dataCurta = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const podeEstornar = (l: LancamentoFinanceiro) => ["entrada", "saida", "transferencia", "ajuste"].includes(l.tipo) && !l.estornado;

export function PaginaFinanceiro() {
  const [aba, setAba] = useState<Aba>("contas");
  const [inicio, setInicio] = useState(() => `${hojeFinanceiro().slice(0, 8)}01`);
  const [fim, setFim] = useState(hojeFinanceiro);
  const [conta, setConta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [paginaVendas, setPaginaVendas] = useState(1);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [origem, setOrigem] = useState("");
  const [status, setStatus] = useState("");
  const [pagamento, setPagamento] = useState("");
  const [dados, setDados] = useState<PainelFinanceiro | null>(null);
  const [vendas, setVendas] = useState<HistoricoFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoVendas, setCarregandoVendas] = useState(false);
  const [erro, setErro] = useState("");
  const [erroVendas, setErroVendas] = useState("");
  const [atualizacao, setAtualizacao] = useState(0);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [operando, setOperando] = useState(false);
  const [detalhe, setDetalhe] = useState<VendaFinanceira | null>(null);
  const periodoValido = !!inicio && !!fim && inicio <= fim;
  const atualizar = () => setAtualizacao((n) => n + 1);

  useEffect(() => {
    const timer = setTimeout(() => { setTermo(busca.trim()); setPaginaVendas(1); }, 300);
    return () => clearTimeout(timer);
  }, [busca]);

  useEffect(() => {
    if (!periodoValido) return;
    let ativo = true;
    const sb = supabaseNavegador();
    sb.rpc("financeiro_painel", { p_inicio: inicio, p_fim: fim, p_conta: conta || null, p_pagina: pagina }).then(({ data, error }) => {
      if (!ativo) return;
      setErro(error?.message ?? "");
      if (!error) setDados(data as PainelFinanceiro);
      setCarregando(false);
    });
    return () => { ativo = false; };
  }, [inicio, fim, conta, pagina, atualizacao, periodoValido]);

  useEffect(() => {
    if (aba !== "vendas" || !periodoValido) return;
    let ativo = true;
    supabaseNavegador().rpc("financeiro_historico_vendas", { p_inicio: inicio, p_fim: fim, p_pagina: paginaVendas, p_busca: termo, p_origem: origem, p_status: status, p_pagamento: pagamento }).then(({ data, error }) => {
      if (!ativo) return;
      setErroVendas(error?.message ?? "");
      if (!error) setVendas(data as HistoricoFinanceiro);
      setCarregandoVendas(false);
    });
    return () => { ativo = false; };
  }, [aba, inicio, fim, paginaVendas, termo, origem, status, pagamento, atualizacao, periodoValido]);

  // Refresh on returning to the screen; no permanent polling while the tab is hidden.
  useEffect(() => {
    const voltar = () => { if (document.visibilityState === "visible") atualizar(); };
    window.addEventListener("focus", voltar);
    document.addEventListener("visibilitychange", voltar);
    const timer = setInterval(voltar, 30000);
    return () => { clearInterval(timer); window.removeEventListener("focus", voltar); document.removeEventListener("visibilitychange", voltar); };
  }, []);

  const filtroData = (qual: "inicio" | "fim", valor: string) => {
    if (qual === "inicio") setInicio(valor); else setFim(valor);
    setPagina(1); setPaginaVendas(1); setCarregando(true); setCarregandoVendas(true);
  };
  const saldoTotal = dados?.contas.reduce((n, c) => n + c.saldo, 0) ?? 0;
  const padrao = dados?.contas.find((c) => c.padrao);

  return <>
    <CabecalhoPagina titulo="Financeiro" descricao="Dinheiro por conta, movimentações e histórico de vendas." acoes={<>
      <Button size="sm" variant="suave" onClick={atualizar} aria-label="Atualizar financeiro"><RefreshCw className="size-4" /></Button>
      <Button size="sm" variant="suave" disabled={!dados?.contas.some((c) => c.ativa)} onClick={() => setAcao({ tipo: "lancamento", transferencia: true })}><ArrowLeftRight /> Transferir</Button>
      <Button size="sm" disabled={!dados} onClick={() => setAcao({ tipo: "lancamento" })}><Plus /> Novo lançamento</Button>
    </>} />
    <div className="produtos-erp space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="mb-1 block text-xs text-suave" htmlFor="fin-inicio">De</label><Input id="fin-inicio" type="date" value={inicio} max={fim} onChange={(e) => filtroData("inicio", e.target.value)} className="w-40" /></div>
        <div><label className="mb-1 block text-xs text-suave" htmlFor="fin-fim">Até</label><Input id="fin-fim" type="date" value={fim} min={inicio} onChange={(e) => filtroData("fim", e.target.value)} className="w-40" /></div>
        <p className="pb-2 text-xs text-suave">As datas filtram movimentos e vendas. Os saldos das contas são os atuais.</p>
      </div>
      {!periodoValido && <p role="alert" className="text-sm text-perigo">Informe um período válido.</p>}
      {erro && <p role="alert" className="rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro} <button type="button" className="underline" onClick={atualizar}>Tentar novamente</button></p>}
      {!dados && carregando ? <Carregando texto="Carregando financeiro…" /> : dados && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Resumo rotulo="Dinheiro total nas contas" valor={saldoTotal} className="col-span-2 sm:col-span-1" />
          <Resumo rotulo="Entradas no período" valor={dados.resumo.entradas} />
          <Resumo rotulo="Saídas no período" valor={dados.resumo.saidas} />
        </div>
        <p className="text-xs text-suave">Vendas concluídas entram em <strong>{padrao?.nome ?? "conta padrão"}</strong>. Transferências, saldos iniciais e conferências não contam como entradas ou saídas do período.</p>
        <div role="group" aria-label="Seções do financeiro" className="flex gap-4 border-b border-borda">
          {([["contas", "Contas e saldos"], ["movimentos", "Movimentações"], ["vendas", "Histórico de vendas"]] as const).map(([id, nome]) => <button key={id} type="button" aria-pressed={aba === id} onClick={() => { if (id !== aba) { setAba(id); if (id === "vendas") setCarregandoVendas(true); if (id !== "movimentos" && conta) { setConta(""); setPagina(1); setCarregando(true); } } }} className={cn("cursor-pointer border-b-2 px-1 py-2.5 text-sm", aba === id ? "border-rosa font-semibold text-texto" : "border-transparent text-suave")}>{nome}</button>)}
        </div>
        {aba === "contas" && <>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-suave">Controle iniciado em {dataHora(dados.iniciado_em)}. Informe o dinheiro que já existia com “Conferir saldo”.</p><Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "conta" })}><Plus /> Nova conta</Button></div>
          <div className="overflow-x-auto rounded-lg border border-borda"><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-superficie-2 text-xs text-suave"><tr><th className="px-3 py-2.5 font-normal">Conta / local</th><th className="px-3 py-2.5 font-normal">Tipo</th><th className="px-3 py-2.5 text-right font-normal">Saldo atual</th><th className="px-3 py-2.5 text-right font-normal">Ações</th></tr></thead><tbody className="divide-y divide-borda">
            {dados.contas.map((c) => <tr key={c.id} className={cn(!c.ativa && "text-suave")}><td className="px-3 py-3"><span className="font-medium">{c.nome}</span>{c.padrao && <span className="ml-2 rounded bg-rosa/10 px-2 py-1 text-[11px] text-rosa-texto">Padrão para vendas</span>}{!c.ativa && <span className="ml-2 text-xs">Inativa</span>}</td><td className="px-3 py-3 text-suave">{TIPOS_CONTA[c.tipo]}</td><td className={cn("px-3 py-3 text-right font-mono tabular-nums", c.saldo < 0 && "text-perigo")}>{formatarPreco(c.saldo)}</td><td className="px-3 py-2"><div className="flex justify-end gap-2"><Button size="sm" variant="fantasma" onClick={() => setAcao({ tipo: "conta", conta: c })}>Editar</Button><Button size="sm" variant="suave" disabled={!c.ativa} onClick={() => setAcao({ tipo: "saldo", conta: c })}>Conferir saldo</Button></div></td></tr>)}
          </tbody></table></div>
          <p className="text-xs text-suave">Abrir ou fechar o PDV não cria dinheiro novo. Para mudar dinheiro de lugar, use Transferir. Cancelar uma venda registrada devolve o valor da conta em que ela entrou, mantendo o histórico.</p>
        </>}
        {aba === "movimentos" && <>
          <div className="max-w-xs"><Select aria-label="Conta dos movimentos" value={conta} onChange={(e) => { setConta(e.target.value); setPagina(1); setCarregando(true); }}><option value="">Todas as contas</option>{dados.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></div>
          {carregando && <p role="status" className="text-xs text-suave">Atualizando…</p>}
          {!dados.lancamentos.length ? <Vazio titulo="Nenhuma movimentação no período" texto="As novas vendas concluídas aparecem aqui automaticamente. Você também pode registrar entradas, despesas e transferências." /> : <div className="overflow-x-auto rounded-lg border border-borda"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-superficie-2 text-xs text-suave"><tr>{["Data", "Descrição", "Tipo", "Origem → destino", "Valor", ""].map((t) => <th key={t} className="px-3 py-2.5 font-normal">{t}</th>)}</tr></thead><tbody className="divide-y divide-borda">{dados.lancamentos.map((l) => <tr key={l.id}><td className="whitespace-nowrap px-3 py-2.5 text-xs text-suave">{dataCurta(l.data)}</td><td className="px-3 py-2.5"><span className="block font-medium">{l.descricao}</span><span className="text-xs text-suave">{l.categoria}{l.estornado ? " · Estornado" : ""}</span></td><td className="px-3 py-2.5 text-xs">{TIPOS_LANCAMENTO[l.tipo]}</td><td className="px-3 py-2.5 text-xs text-suave">{l.origem_nome ?? "Externo"} → {l.destino_nome ?? "Externo"}</td><td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{formatarPreco(l.valor)}</td><td className="px-3 py-2">{podeEstornar(l) && <Button size="sm" variant="fantasma" onClick={() => setAcao({ tipo: "estorno", lancamento: l })}>Estornar</Button>}</td></tr>)}</tbody></table></div>}
          <Paginacao pagina={pagina} total={dados.total} carregando={carregando} onChange={(n) => { setPagina(n); setCarregando(true); }} />
        </>}
        {aba === "vendas" && <>
          <div className="flex flex-wrap gap-2"><Input type="search" maxLength={100} aria-label="Pesquisar vendas" placeholder="Número da venda ou cliente…" value={busca} onChange={(e) => { setBusca(e.target.value); if (e.target.value.trim() !== termo) setCarregandoVendas(true); }} className="max-w-sm" />
            <Select aria-label="Origem das vendas" value={origem} onChange={(e) => { setOrigem(e.target.value); setPaginaVendas(1); setCarregandoVendas(true); }}><option value="">Site e PDV</option><option value="site">Site</option><option value="balcao">PDV</option></Select>
            <Select aria-label="Situação das vendas" value={status} onChange={(e) => { setStatus(e.target.value); setPaginaVendas(1); setCarregandoVendas(true); }}><option value="">Todas as situações</option>{Object.entries(NOMES_STATUS).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</Select>
            <Select aria-label="Pagamento das vendas" value={pagamento} onChange={(e) => { setPagamento(e.target.value); setPaginaVendas(1); setCarregandoVendas(true); }}><option value="">Todos os pagamentos</option>{Object.entries(NOMES_PAGAMENTO).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</Select>
          </div>
          {erroVendas && <p role="alert" className="text-sm text-perigo">{erroVendas}</p>}
          {carregandoVendas && <p role="status" className="text-xs text-suave">Carregando vendas…</p>}
          {vendas && <><p className="text-xs text-suave">{vendas.concluidos} vendas concluídas · {formatarPreco(vendas.faturamento)} no período filtrado. Vendas anteriores ao início do financeiro não foram somadas às contas.</p>
            {!vendas.vendas.length ? <Vazio titulo="Nenhuma venda encontrada" texto="Ajuste o período ou os filtros." /> : <div className="overflow-x-auto rounded-lg border border-borda"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-superficie-2 text-xs text-suave"><tr>{["Venda", "Data", "Cliente", "Origem", "Pagamento", "Situação / conta", "Total"].map((t) => <th key={t} className="px-3 py-2.5 font-normal">{t}</th>)}</tr></thead><tbody className="divide-y divide-borda">{vendas.vendas.map((v) => <tr key={v.id}><td className="px-3 py-3"><button type="button" className="cursor-pointer font-semibold text-rosa-texto underline-offset-2 hover:underline" onClick={() => setDetalhe(v)}>#{v.numero}</button></td><td className="whitespace-nowrap px-3 py-3 text-xs text-suave">{dataHora(v.criado_em)}</td><td className="px-3 py-3">{v.cliente_nome}</td><td className="px-3 py-3 text-xs">{NOMES_ORIGEM[v.origem]}</td><td className="px-3 py-3 text-xs">{NOMES_PAGAMENTO[v.pagamento]}</td><td className="px-3 py-3"><span className="block text-xs">{NOMES_STATUS[v.status]}</span><span className="text-[11px] text-suave">{v.conta_nome ?? (v.possui_lancamentos ? "Recebimento estornado" : v.status === "concluido" ? v.total === 0 ? "Sem valor a receber" : "Anterior ao financeiro" : "Sem recebimento")}</span></td><td className="whitespace-nowrap px-3 py-3 text-right font-mono">{formatarPreco(v.total)}</td></tr>)}</tbody></table></div>}
            <Paginacao pagina={paginaVendas} total={vendas.total} carregando={carregandoVendas} onChange={(n) => { setPaginaVendas(n); setCarregandoVendas(true); }} />
          </>}
        </>}
      </>}
    </div>
    <Sheet open={!!acao} onOpenChange={(v) => { if (!v && !operando) setAcao(null); }}><SheetContent lado="centro" className="max-w-lg"><SheetTitle className="sr-only">{acao?.tipo === "conta" ? "Conta financeira" : acao?.tipo === "saldo" ? "Conferir saldo" : acao?.tipo === "estorno" ? "Estornar lançamento" : "Novo lançamento"}</SheetTitle><SheetDescription className="sr-only">Confira os dados antes de salvar a movimentação financeira.</SheetDescription>{acao && dados && <FormularioFinanceiro key={acao.tipo + ("conta" in acao ? acao.conta?.id ?? "nova" : "")} acao={acao} contas={dados.contas} onOperando={setOperando} onCancelar={() => setAcao(null)} onSalvo={() => { setAcao(null); atualizar(); }} />}</SheetContent></Sheet>
    <Sheet open={!!detalhe} onOpenChange={(v) => { if (!v) setDetalhe(null); }}><SheetContent lado="centro" className="max-w-lg"><div className="min-h-0 overflow-y-auto p-5"><SheetTitle className="pr-10 text-lg font-semibold">Venda #{detalhe?.numero}</SheetTitle><SheetDescription className="mt-1 text-xs text-suave">{detalhe && `${dataHora(detalhe.criado_em)} · ${detalhe.cliente_nome}`}</SheetDescription>{detalhe && <><div className="my-4 space-y-2">{detalhe.itens.map((i, n) => <div key={n} className="flex justify-between gap-3 border-b border-borda py-2 text-sm"><span>{i.quantidade} × {i.nome}{i.opcoes?.length ? <small className="block text-suave">{i.opcoes.map((o) => o.nome).join(", ")}</small> : null}</span><span className="shrink-0 font-mono">{formatarPreco(i.preco * i.quantidade)}</span></div>)}</div><dl className="space-y-2 text-sm">{[["Subtotal", detalhe.subtotal], ["Desconto", -detalhe.desconto], ["Entrega", detalhe.taxa], ["Total", detalhe.total]].map(([n, v]) => <div key={n} className="flex justify-between"><dt>{n}</dt><dd className="font-mono">{formatarPreco(v as number)}</dd></div>)}</dl><p className="mt-4 text-xs text-suave">{NOMES_PAGAMENTO[detalhe.pagamento]} · {NOMES_STATUS[detalhe.status]}{detalhe.conta_nome ? ` · ${detalhe.conta_nome}` : ""}</p></>}</div><div className="border-t border-borda p-4"><Button variant="suave" className="w-full" onClick={() => setDetalhe(null)}>OK, fechar</Button></div></SheetContent></Sheet>
  </>;
}

function Resumo({ rotulo, valor, className }: { rotulo: string; valor: number; className?: string }) {
  return <div className={cn("min-w-0 rounded-lg border border-borda bg-superficie px-4 py-3", className)}><p className="text-xs text-suave">{rotulo}</p><p className={cn("mt-1 break-words font-mono text-lg font-semibold sm:text-xl", valor < 0 && "text-perigo")}>{formatarPreco(valor)}</p></div>;
}
function Paginacao({ pagina, total, carregando, onChange }: { pagina: number; total: number; carregando: boolean; onChange: (n: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / 50));
  return <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-suave"><span>{total} registros · Página {pagina} de {paginas}</span><div className="flex gap-2"><Button size="sm" variant="suave" disabled={carregando || pagina <= 1} onClick={() => onChange(pagina - 1)}>Anterior</Button><Button size="sm" variant="suave" disabled={carregando || pagina >= paginas} onClick={() => onChange(pagina + 1)}>Próxima</Button></div></div>;
}

function FormularioFinanceiro({ acao, contas, onCancelar, onSalvo, onOperando }: { acao: Acao; contas: ContaFinanceira[]; onCancelar: () => void; onSalvo: () => void; onOperando: (valor: boolean) => void }) {
  const contaInicial = "conta" in acao ? acao.conta : undefined;
  const [nome, setNome] = useState(contaInicial?.nome ?? "");
  const [tipoConta, setTipoConta] = useState<ContaFinanceira["tipo"]>(contaInicial?.tipo ?? "banco");
  const [padrao, setPadrao] = useState(contaInicial?.padrao ?? false);
  const [ativa, setAtiva] = useState(contaInicial?.ativa ?? true);
  const [tipo, setTipo] = useState(acao.tipo === "lancamento" && acao.transferencia ? "transferencia" : "saida");
  const [origem, setOrigem] = useState(contas.find((c) => c.padrao)?.id ?? "");
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState(acao.tipo === "saldo" ? centavosParaCampo(acao.conta.saldo) : "");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [data, setData] = useState(hojeFinanceiro);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [id] = useState(() => acao.tipo === "conta" ? acao.conta?.id ?? crypto.randomUUID() : crypto.randomUUID());
  const emSalvar = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titulo = acao.tipo === "conta" ? contaInicial ? "Editar conta" : "Nova conta" : acao.tipo === "saldo" ? `Conferir saldo · ${acao.conta.nome}` : acao.tipo === "estorno" ? "Estornar lançamento" : "Nova movimentação";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); if (emSalvar.current) return;
    setErro("");
    const negativo = acao.tipo === "saldo" && valor.trim().startsWith("-");
    const centavos = paraCentavos(negativo ? valor.trim().slice(1) : valor);
    const saldo = centavos == null ? null : negativo ? -centavos : centavos;
    if (acao.tipo !== "estorno" && (saldo === null && !(acao.tipo === "conta" && (!valor.trim() || !!contaInicial)) || saldo != null && Math.abs(saldo) > 1000000000000)) return setErro("Informe um valor válido em reais.");
    if (acao.tipo === "lancamento" && (!saldo || saldo < 0 || !descricao.trim() || !data)) return setErro("Informe um valor maior que zero, descrição e data.");
    if ((acao.tipo === "saldo" || acao.tipo === "estorno") && !descricao.trim()) return setErro("Informe o motivo para manter o histórico da alteração.");
    const sb = supabaseNavegador();
    emSalvar.current = true; setSalvando(true); onOperando(true);
    try {
      let resposta;
      if (acao.tipo === "conta") resposta = await sb.rpc("financeiro_salvar_conta", { p_id: id, p_nome: nome.trim(), p_tipo: tipoConta, p_padrao: padrao, p_ativa: ativa, p_saldo_inicial: contaInicial ? 0 : saldo ?? 0 });
      else if (acao.tipo === "saldo") resposta = await sb.rpc("financeiro_conferir_saldo", { p_id: id, p_conta: acao.conta.id, p_saldo: saldo, p_esperado: acao.conta.saldo, p_motivo: descricao.trim() });
      else if (acao.tipo === "estorno") resposta = await sb.rpc("financeiro_estornar", { p_id: acao.lancamento.id, p_motivo: descricao.trim() });
      else resposta = await sb.rpc("financeiro_lancar", { p_id: id, p_tipo: tipo, p_origem: tipo === "entrada" ? null : origem || null, p_destino: tipo === "saida" ? null : destino || null, p_valor: saldo, p_descricao: descricao.trim(), p_categoria: categoria.trim(), p_data: data });
      if (resposta.error) { setErro(resposta.error.message); return; }
      toast.success("Financeiro atualizado"); onSalvo();
    } catch { setErro("Falha de conexão. Os dados continuam aqui; tente salvar novamente."); }
    finally { emSalvar.current = false; setSalvando(false); onOperando(false); }
  };
  const seletorConta = (label: string, valor: string, alterar: (s: string) => void) => <Campo label={label} htmlFor={`fin-${label}`}><Select id={`fin-${label}`} required value={valor} onChange={(e) => alterar(e.target.value)}><option value="">Selecione…</option>{contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome} · {formatarPreco(c.saldo)}</option>)}</Select></Campo>;

  return <form ref={formRef} onSubmit={enviar} className="flex min-h-0 flex-col">
    <div className="min-h-0 space-y-4 overflow-y-auto px-5 pt-5 pb-6"><h2 className="pr-9 text-lg font-semibold">{titulo}</h2>
      {erro && <p role="alert" className="rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}
      <fieldset disabled={salvando} className="space-y-4">
        {acao.tipo === "conta" ? <>
          <Campo label="Nome da conta / local" htmlFor="fin-nome"><Input id="fin-nome" value={nome} required maxLength={80} placeholder="Ex.: Banco, Caixa da loja, Caixa 2" onChange={(e) => setNome(e.target.value)} /></Campo>
          <Campo label="Tipo" htmlFor="fin-tipo-conta"><Select id="fin-tipo-conta" value={tipoConta} onChange={(e) => setTipoConta(e.target.value as ContaFinanceira["tipo"])}>{Object.entries(TIPOS_CONTA).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</Select></Campo>
          {!contaInicial && <Campo label="Saldo que já existe nesta conta (R$)" htmlFor="fin-valor" ajuda="Esse valor é um saldo inicial, não uma nova venda."><Input id="fin-valor" inputMode="decimal" value={valor} placeholder="0,00" onChange={(e) => setValor(e.target.value)} /></Campo>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={padrao} disabled={!!contaInicial?.padrao} onChange={(e) => { setPadrao(e.target.checked); if (e.target.checked) setAtiva(true); }} className="size-4 accent-rosa" />Conta padrão para novas vendas</label>
          {contaInicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativa} disabled={padrao} onChange={(e) => setAtiva(e.target.checked)} className="size-4 accent-rosa" />Conta ativa</label>}
          <p className="text-xs text-suave">Trocar a conta padrão só muda o destino das próximas vendas. Para mover o saldo atual, faça uma transferência.</p>
        </> : acao.tipo === "estorno" ? <><p className="text-sm">{acao.lancamento.descricao} · <strong>{formatarPreco(acao.lancamento.valor)}</strong></p><p className="text-xs text-suave">O lançamento original será preservado. Um movimento contrário devolverá o valor às contas de origem.</p></> : acao.tipo === "saldo" ? <>
          <p className="text-sm text-suave">Saldo registrado: <strong>{formatarPreco(acao.conta.saldo)}</strong></p>
          <Campo label="Quanto existe de verdade nesta conta? (R$)" htmlFor="fin-valor" ajuda="A diferença será registrada como conferência, sem apagar vendas ou movimentações."><Input id="fin-valor" required inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
        </> : <>
          <Campo label="Tipo de movimentação" htmlFor="fin-tipo"><Select id="fin-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="entrada">Entrada</option><option value="saida">Saída / despesa</option><option value="transferencia">Transferência entre contas</option></Select></Campo>
          {tipo !== "entrada" && seletorConta("Origem", origem, setOrigem)}
          {tipo !== "saida" && seletorConta("Destino", destino, setDestino)}
          <div className="grid grid-cols-2 gap-3"><Campo label="Valor (R$)" htmlFor="fin-valor"><Input id="fin-valor" inputMode="decimal" required value={valor} placeholder="0,00" onChange={(e) => setValor(e.target.value)} /></Campo><Campo label="Data" htmlFor="fin-data"><Input id="fin-data" type="date" required max={hojeFinanceiro()} value={data} onChange={(e) => setData(e.target.value)} /></Campo></div>
          <Campo label="Categoria" htmlFor="fin-categoria"><Input id="fin-categoria" maxLength={80} value={categoria} placeholder="Ex.: Fornecedor, aluguel, retirada" onChange={(e) => setCategoria(e.target.value)} /></Campo>
          {tipo === "transferencia" && <p className="text-xs text-suave">O valor sai da origem e entra no destino ao mesmo tempo. O total de dinheiro nas contas permanece igual.</p>}
        </>}
        {acao.tipo !== "conta" && <Campo label={acao.tipo === "saldo" || acao.tipo === "estorno" ? "Motivo" : "Descrição"} htmlFor="fin-descricao"><Input id="fin-descricao" required maxLength={acao.tipo === "lancamento" ? 300 : 250} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>}
      </fieldset>
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-borda px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button type="button" variant="suave" disabled={salvando} onClick={onCancelar}>Cancelar</Button><Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : acao.tipo === "estorno" ? "Confirmar estorno" : "Salvar"}</Button></div>
  </form>;
}
