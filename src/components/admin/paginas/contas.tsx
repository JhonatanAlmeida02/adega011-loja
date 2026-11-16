"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Pencil, Plus, RefreshCw, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { hojeFinanceiro, type ContaFinanceira } from "@/lib/financeiro";
import {
  CATEGORIAS_TITULO, TEXTOS_TITULO, dataBr, intervaloPeriodo, noPeriodo, resumoTitulos, situacaoTitulo,
  type Periodo, type Situacao, type TipoTitulo, type Titulo,
} from "@/lib/titulos";
import { centavosParaCampo, cn, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando, Confirmar, Vazio } from "../ui";

type Filtro = "abertas" | "pagas" | "canceladas" | "todas";
export type AcaoTitulo =
  | { tipo: "editar"; titulo?: Titulo; tipoTitulo?: TipoTitulo; vencimento?: string }
  | { tipo: "baixar"; titulo: Titulo }
  | { tipo: "desfazer"; titulo: Titulo };
type Acao = AcaoTitulo;

export const CORES_SITUACAO: Record<Situacao["tipo"], string> = {
  vencida: "border-perigo/50 bg-perigo/10 text-perigo",
  hoje: "border-amarelo/60 bg-amarelo/10 text-amarelo-texto",
  proxima: "border-amarelo/40 bg-amarelo/5 text-amarelo-texto",
  "em-dia": "border-borda bg-superficie-2 text-suave",
  paga: "border-sucesso/50 bg-sucesso/10 text-sucesso",
  cancelada: "border-borda bg-superficie-2 text-suave line-through",
};

/** Contas a pagar/receber (de um tipo ou dos dois) e as contas do Financeiro. */
export function useContasFinanceiras(tipo?: TipoTitulo) {
  const [titulos, setTitulos] = useState<Titulo[] | null>(null);
  const [contas, setContas] = useState<ContaFinanceira[]>([]);
  const [erro, setErro] = useState("");
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    let consulta = sb.from("financeiro_titulos").select("*");
    if (tipo) consulta = consulta.eq("tipo", tipo);
    Promise.all([
      consulta.order("vencimento").order("criado_em").limit(5000),
      sb.from("financeiro_saldos").select("*").order("padrao", { ascending: false }).order("nome"),
    ]).then(([t, c]) => {
      if (!ativo) return;
      const falha = t.error ?? c.error;
      setErro(falha ? `Não foi possível carregar: ${falha.message}` : "");
      if (!t.error) setTitulos((t.data ?? []) as Titulo[]);
      if (!c.error) setContas((c.data ?? []) as ContaFinanceira[]);
    });
    return () => { ativo = false; };
  }, [tipo, versao]);
  return { titulos, contas, erro, atualizar: () => setVersao((v) => v + 1) };
}

/** Sugestões de fornecedor/cliente e categoria a partir do que já foi cadastrado. */
export function sugestoesTitulos(titulos: Titulo[] | null, tipo: TipoTitulo) {
  const doTipo = (titulos ?? []).filter((t) => t.tipo === tipo);
  return {
    pessoas: [...new Set(doTipo.map((t) => t.pessoa).filter(Boolean))].sort(),
    categorias: [...new Set([...CATEGORIAS_TITULO[tipo], ...doTipo.map((t) => t.categoria).filter(Boolean)])],
  };
}

/** Contas a pagar ou a receber, ligadas às contas do Financeiro. */
export function PaginaContas({ tipo }: { tipo: TipoTitulo }) {
  const textos = TEXTOS_TITULO[tipo];
  const { titulos, contas, erro, atualizar } = useContasFinanceiras(tipo);
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [periodo, setPeriodo] = useState<Periodo>("tudo");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [operando, setOperando] = useState(false);
  const hoje = hojeFinanceiro();

  const resumo = useMemo(() => resumoTitulos(titulos ?? [], hoje), [titulos, hoje]);
  const pagasNoMes = useMemo(() => (titulos ?? []).filter((t) => t.status === "pago" && (t.pago_em ?? "").slice(0, 7) === hoje.slice(0, 7)), [titulos, hoje]);
  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.id, c.nome])), [contas]);
  const { pessoas, categorias } = useMemo(() => sugestoesTitulos(titulos, tipo), [titulos, tipo]);
  const intervalo = useMemo(() => intervaloPeriodo(periodo, hoje, de, ate), [periodo, hoje, de, ate]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return (titulos ?? [])
      .filter((t) => filtro === "todas" || (filtro === "abertas" ? t.status === "aberto" : filtro === "pagas" ? t.status === "pago" : t.status === "cancelado"))
      .filter((t) => noPeriodo(t, intervalo, hoje))
      .filter((t) => !termo || `${t.descricao} ${t.pessoa} ${t.categoria} ${t.documento}`.toLocaleLowerCase("pt-BR").includes(termo))
      // Pagas: mais recentes primeiro; o resto por vencimento
      .sort((a, b) => (filtro === "pagas" ? (b.pago_em ?? "").localeCompare(a.pago_em ?? "") : a.vencimento.localeCompare(b.vencimento)));
  }, [titulos, filtro, busca, intervalo, hoje]);

  const cancelar = async (t: Titulo) => {
    const { error } = await supabaseNavegador().rpc("financeiro_cancelar_titulo", { p_id: t.id });
    if (error) toast.error(error.message);
    else { toast.success("Conta cancelada"); atualizar(); }
  };

  if (!titulos && !erro) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo={textos.titulo}
        descricao={tipo === "pagar"
          ? "Cadastre o que a loja precisa pagar e, ao pagar, escolha de qual conta sai o dinheiro. O extrato do Financeiro é atualizado sozinho."
          : "Cadastre o que a loja tem para receber e, ao receber, escolha em qual conta entra o dinheiro. O extrato do Financeiro é atualizado sozinho."}
        acoes={<Button onClick={() => setAcao({ tipo: "editar" })}><Plus /> {textos.novo}</Button>}
      />
      {erro && <p role="alert" className="mb-4 rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}

      <section aria-label="Resumo" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumo titulo="Vencidas" valor={resumo.vencidas.valor} quantidade={resumo.vencidas.quantidade} destaque={resumo.vencidas.quantidade > 0 ? "perigo" : undefined} onClick={() => setFiltro("abertas")} />
        <Resumo titulo="Vencem em 7 dias" valor={resumo.proximas.valor} quantidade={resumo.proximas.quantidade} destaque={resumo.proximas.quantidade > 0 ? "aviso" : undefined} onClick={() => setFiltro("abertas")} />
        <Resumo titulo="Total em aberto" valor={resumo.abertas.valor} quantidade={resumo.abertas.quantidade} onClick={() => setFiltro("abertas")} />
        <Resumo titulo={`${tipo === "pagar" ? "Pagas" : "Recebidas"} neste mês`} valor={pagasNoMes.reduce((s, t) => s + t.valor, 0)} quantidade={pagasNoMes.length} onClick={() => setFiltro("pagas")} />
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <Input type="search" aria-label="Buscar conta" placeholder={`Buscar por descrição, ${tipo === "pagar" ? "fornecedor" : "cliente"}, categoria ou documento`} value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" />
        </div>
        <div role="group" aria-label="Situação" className="flex flex-wrap gap-1">
          {([["abertas", "Em aberto"], ["pagas", tipo === "pagar" ? "Pagas" : "Recebidas"], ["canceladas", "Canceladas"], ["todas", "Todas"]] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}
              className={cn("h-10 cursor-pointer rounded-full border px-3 text-sm font-medium", filtro === valor ? "border-rosa bg-rosa/10 text-rosa-texto" : "border-borda text-suave hover:text-texto")}>
              {rotulo}
            </button>
          ))}
        </div>
        <Button variant="suave" size="icone" onClick={atualizar} aria-label="Atualizar lista"><RefreshCw /></Button>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-48">
          <Campo label={filtro === "pagas" ? "Período (data do pagamento)" : "Período (vencimento)"} htmlFor="periodo">
            <Select id="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
              <option value="tudo">Todas as datas</option>
              <option value="mes">Este mês</option>
              <option value="proximo">Próximo mês</option>
              <option value="ano">Este ano</option>
              <option value="personalizado">Escolher período…</option>
            </Select>
          </Campo>
        </div>
        {periodo === "personalizado" && (
          <>
            <div className="w-40"><Campo label="De" htmlFor="periodo-de"><Input id="periodo-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo></div>
            <div className="w-40"><Campo label="Até" htmlFor="periodo-ate"><Input id="periodo-ate" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} /></Campo></div>
          </>
        )}
        {periodo !== "tudo" && filtro === "abertas" && (
          <p className="pb-2 text-xs text-suave">Contas vencidas de antes do período continuam aparecendo.</p>
        )}
        {periodo !== "tudo" && lista.length > 0 && (
          <p className="ml-auto pb-2 text-sm">Total no filtro: <strong className="font-mono">{formatarPreco(lista.reduce((s, t) => s + t.valor, 0))}</strong></p>
        )}
      </div>

      {lista.length === 0 ? (
        <Vazio titulo={filtro === "abertas" ? "Nada em aberto" : "Nenhuma conta aqui"} texto={filtro === "abertas" ? `Use "${textos.novo}" para cadastrar.` : "Ajuste a busca ou a situação."} />
      ) : (
        <ul aria-label={textos.titulo} className="divide-y divide-borda overflow-hidden rounded-lg border border-borda">
          {lista.map((t) => {
            const sit = situacaoTitulo(t, hoje);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-superficie px-4 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="font-semibold">
                    {t.descricao}
                    {t.parcelas && t.parcelas > 1 && <span className="ml-1.5 text-xs font-normal text-suave">({t.parcela}/{t.parcelas})</span>}
                  </p>
                  <p className="text-xs text-suave">
                    {[t.pessoa, t.categoria, t.documento && `Doc. ${t.documento}`, t.status === "pago" && t.conta_id && nomeConta.get(t.conta_id)].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[0.7rem] font-bold whitespace-nowrap", CORES_SITUACAO[sit.tipo])}>{sit.texto}</span>
                  <span className="text-xs text-suave tabular-nums" title="Vencimento">{dataBr(t.vencimento)}</span>
                </div>
                <strong className="ml-auto font-mono tabular-nums">{formatarPreco(t.valor)}</strong>
                <div className="flex items-center gap-1">
                  {t.status === "aberto" && (
                    <>
                      <Button size="sm" onClick={() => setAcao({ tipo: "baixar", titulo: t })}>{textos.acao}</Button>
                      <Button size="icone-sm" variant="fantasma" aria-label={`Editar ${t.descricao}`} onClick={() => setAcao({ tipo: "editar", titulo: t })}><Pencil /></Button>
                      <Confirmar titulo="Cancelar esta conta?" descricao={`"${t.descricao}" sai da lista de contas em aberto. Nenhum dinheiro é movimentado.`} rotuloConfirmar="Cancelar conta" onConfirmar={() => cancelar(t)}>
                        <Button size="icone-sm" variant="fantasma" aria-label={`Cancelar ${t.descricao}`}><Ban /></Button>
                      </Confirmar>
                    </>
                  )}
                  {t.status === "pago" && (
                    <Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "desfazer", titulo: t })}><Undo2 /> Desfazer</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!acao} onOpenChange={(v) => { if (!v && !operando) setAcao(null); }}>
        <SheetContent lado="centro" className="max-w-lg">
          <SheetTitle className="sr-only">{acao?.tipo === "baixar" ? textos.acao : acao?.tipo === "desfazer" ? "Desfazer" : textos.novo}</SheetTitle>
          <SheetDescription className="sr-only">Confira os dados antes de salvar.</SheetDescription>
          {acao && (
            <FormularioTitulo
              key={acao.tipo + (acao.titulo?.id ?? "nova")}
              tipo={tipo} acao={acao} contas={contas} pessoas={pessoas} categorias={categorias}
              onOperando={setOperando} onCancelar={() => setAcao(null)} onSalvo={() => { setAcao(null); atualizar(); }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Resumo({ titulo, valor, quantidade, destaque, onClick }: { titulo: string; valor: number; quantidade: number; destaque?: "perigo" | "aviso"; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("cursor-pointer rounded-lg border bg-superficie p-3 text-left transition-colors hover:border-rosa/60",
        destaque === "perigo" ? "border-perigo/50" : destaque === "aviso" ? "border-amarelo/50" : "border-borda")}>
      <span className="block text-xs text-suave">{titulo}</span>
      <strong className={cn("mt-1 block font-mono text-lg tabular-nums", destaque === "perigo" && "text-perigo")}>{formatarPreco(valor)}</strong>
      <span className="text-xs text-suave">{quantidade} {quantidade === 1 ? "conta" : "contas"}</span>
    </button>
  );
}

export function FormularioTitulo({ tipo, acao, contas, pessoas, categorias, onCancelar, onSalvo, onOperando }: {
  tipo: TipoTitulo; acao: Acao; contas: ContaFinanceira[]; pessoas: string[]; categorias: string[];
  onCancelar: () => void; onSalvo: () => void; onOperando: (v: boolean) => void;
}) {
  const textos = TEXTOS_TITULO[tipo];
  const t = acao.titulo;
  const [id] = useState(() => t?.id ?? crypto.randomUUID());
  const [descricao, setDescricao] = useState(t?.descricao ?? "");
  const [pessoa, setPessoa] = useState(t?.pessoa ?? "");
  const [categoria, setCategoria] = useState(t?.categoria ?? "");
  const [documento, setDocumento] = useState(t?.documento ?? "");
  const [observacoes, setObservacoes] = useState(t?.observacoes ?? "");
  const [valor, setValor] = useState(t ? centavosParaCampo(t.valor) : "");
  const [vencimento, setVencimento] = useState(t?.vencimento ?? (acao.tipo === "editar" ? acao.vencimento : undefined) ?? hojeFinanceiro());
  const [repetir, setRepetir] = useState(1);
  const ativas = contas.filter((c) => c.ativa);
  const [conta, setConta] = useState(() => ativas.find((c) => c.padrao)?.id ?? ativas[0]?.id ?? "");
  const [data, setData] = useState(hojeFinanceiro);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const emSalvar = useRef(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emSalvar.current) return;
    setErro("");
    const centavos = paraCentavos(valor);
    if (acao.tipo === "editar" && (!descricao.trim() || !centavos || centavos <= 0 || !vencimento)) return setErro("Informe descrição, valor e vencimento.");
    if (acao.tipo === "baixar" && (!conta || !data)) return setErro("Escolha a conta e a data.");
    if (acao.tipo === "desfazer" && !motivo.trim()) return setErro("Informe o motivo, para ficar no histórico.");
    const sb = supabaseNavegador();
    emSalvar.current = true; setSalvando(true); onOperando(true);
    try {
      const r = acao.tipo === "editar"
        ? await sb.rpc("financeiro_salvar_titulo", { p_id: id, p_tipo: tipo, p_descricao: descricao.trim(), p_pessoa: pessoa.trim(), p_categoria: categoria.trim(), p_documento: documento.trim(), p_observacoes: observacoes.trim(), p_valor: centavos, p_vencimento: vencimento, p_repetir: t ? 1 : repetir })
        : acao.tipo === "baixar"
          ? await sb.rpc("financeiro_baixar_titulo", { p_id: acao.titulo.id, p_conta: conta, p_data: data })
          : await sb.rpc("financeiro_desfazer_baixa", { p_id: acao.titulo.id, p_motivo: motivo.trim() });
      if (r.error) { setErro(r.error.message); return; }
      toast.success(acao.tipo === "editar" ? (t ? "Conta atualizada" : repetir > 1 ? `${repetir} contas criadas` : "Conta criada")
        : acao.tipo === "baixar" ? `${textos.feito} e lançada no extrato` : "Pagamento desfeito; a conta voltou a ficar em aberto");
      onSalvo();
    } catch {
      setErro("Falha de conexão. Os dados continuam aqui; tente de novo.");
    } finally {
      emSalvar.current = false; setSalvando(false); onOperando(false);
    }
  };

  const titulo = acao.tipo === "baixar" ? `${textos.acao} conta` : acao.tipo === "desfazer" ? `Desfazer ${textos.verbo}` : t ? "Editar conta" : textos.novo;
  const contaEscolhida = ativas.find((c) => c.id === conta);

  return (
    <form onSubmit={enviar} noValidate className="flex min-h-0 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pt-5 pb-6">
        <h2 className="pr-9 text-lg font-semibold">{titulo}</h2>
        {erro && <p role="alert" className="rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}
        <fieldset disabled={salvando} className="space-y-4">
          {acao.tipo === "editar" ? (
            <>
              <Campo label="Descrição" htmlFor="tit-descricao"><Input id="tit-descricao" required maxLength={200} value={descricao} placeholder={tipo === "pagar" ? "Ex.: NF 1234 Ambev, Aluguel de dezembro" : "Ex.: Evento do sábado, fiado"} onChange={(e) => setDescricao(e.target.value)} /></Campo>
              <Campo label={textos.pessoa} htmlFor="tit-pessoa"><Input id="tit-pessoa" list="tit-pessoas" maxLength={120} value={pessoa} onChange={(e) => setPessoa(e.target.value)} /></Campo>
              <datalist id="tit-pessoas">{pessoas.map((p) => <option key={p} value={p} />)}</datalist>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Valor (R$)" htmlFor="tit-valor"><Input id="tit-valor" inputMode="decimal" required value={valor} placeholder="0,00" onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))} className="font-mono" /></Campo>
                <Campo label="Vencimento" htmlFor="tit-vencimento"><Input id="tit-vencimento" type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Categoria" htmlFor="tit-categoria"><Input id="tit-categoria" list="tit-categorias" maxLength={80} value={categoria} onChange={(e) => setCategoria(e.target.value)} /></Campo>
                <Campo label="Nº do documento" htmlFor="tit-documento"><Input id="tit-documento" maxLength={60} value={documento} placeholder="Nota, boleto…" onChange={(e) => setDocumento(e.target.value)} /></Campo>
              </div>
              <datalist id="tit-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
              {!t && (
                <Campo label="Repetir" htmlFor="tit-repetir" ajuda={repetir > 1 ? `Cria ${repetir} contas, uma por mês, a partir do vencimento.` : "Para contas fixas, como aluguel e internet."}>
                  <Select id="tit-repetir" value={repetir} onChange={(e) => setRepetir(Number(e.target.value))}>
                    <option value={1}>Não repetir</option>
                    {[2, 3, 4, 6, 12, 24].map((n) => <option key={n} value={n}>Todo mês, {n} vezes</option>)}
                  </Select>
                </Campo>
              )}
              <Campo label="Observações" htmlFor="tit-obs"><Textarea id="tit-obs" maxLength={500} rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} /></Campo>
            </>
          ) : acao.tipo === "baixar" ? (
            <>
              <p className="rounded-lg border border-borda bg-superficie-2 p-3 text-sm">
                <strong>{acao.titulo.descricao}</strong>{acao.titulo.pessoa && ` · ${acao.titulo.pessoa}`}
                <span className="mt-1 block font-mono text-lg">{formatarPreco(acao.titulo.valor)}</span>
                <span className="text-xs text-suave">Vencimento {dataBr(acao.titulo.vencimento)}</span>
              </p>
              {ativas.length === 0 ? (
                <p role="alert" className="text-sm text-perigo">Cadastre uma conta (banco, caixa…) em Financeiro antes.</p>
              ) : (
                <Campo label={textos.conta} htmlFor="tit-conta" ajuda={tipo === "pagar" ? "O valor sai dessa conta (aparece como saída no extrato)." : "O valor entra nessa conta (aparece como entrada no extrato)."}>
                  <Select id="tit-conta" required value={conta} onChange={(e) => setConta(e.target.value)}>
                    {ativas.map((c) => <option key={c.id} value={c.id}>{c.nome} · saldo {formatarPreco(c.saldo)}</option>)}
                  </Select>
                </Campo>
              )}
              {tipo === "pagar" && contaEscolhida && contaEscolhida.saldo < acao.titulo.valor && (
                <p className="text-xs text-amarelo-texto">Atenção: o saldo registrado de {contaEscolhida.nome} é menor que o valor; a conta ficará negativa.</p>
              )}
              <Campo label={`Data do ${textos.verbo}`} htmlFor="tit-data"><Input id="tit-data" type="date" required max={hojeFinanceiro()} value={data} onChange={(e) => setData(e.target.value)} /></Campo>
            </>
          ) : (
            <>
              <p className="text-sm">{acao.titulo.descricao} · <strong>{formatarPreco(acao.titulo.valor)}</strong></p>
              <p className="text-xs text-suave">O lançamento continua no histórico e um estorno devolve o valor à conta. A conta volta a ficar em aberto.</p>
              <Campo label="Motivo" htmlFor="tit-motivo"><Input id="tit-motivo" required maxLength={250} value={motivo} placeholder="Ex.: paguei pela conta errada" onChange={(e) => setMotivo(e.target.value)} /></Campo>
            </>
          )}
        </fieldset>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-borda px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="suave" disabled={salvando} onClick={onCancelar}>Voltar</Button>
        <Button type="submit" disabled={salvando || (acao.tipo === "baixar" && ativas.length === 0)}>
          {salvando ? "Salvando…" : acao.tipo === "baixar" ? `${textos.acao} ${formatarPreco(acao.titulo.valor)}` : acao.tipo === "desfazer" ? "Desfazer" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
