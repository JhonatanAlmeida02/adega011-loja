"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Undo2 } from "lucide-react";
import { hojeFinanceiro } from "@/lib/financeiro";
import {
  NOMES_MESES, TEXTOS_TITULO, dataBr, nomeDoMes, semanasDoMes, situacaoTitulo, somarMeses,
  type Situacao, type TipoTitulo, type Titulo,
} from "@/lib/titulos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando } from "../ui";
import { CORES_SITUACAO, FormularioTitulo, sugestoesTitulos, useContasFinanceiras, type AcaoTitulo } from "./contas";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PONTO: Record<Situacao["tipo"], string> = {
  vencida: "bg-perigo", hoje: "bg-amarelo", proxima: "bg-amarelo", "em-dia": "bg-suave", paga: "bg-sucesso", cancelada: "bg-borda",
};
const nomeDia = (data: string) =>
  new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Calendário das contas a pagar (e, se quiser, a receber): o ano inteiro organizado por dia. */
export function PaginaCalendario() {
  const { titulos, contas, erro, atualizar } = useContasFinanceiras();
  const hoje = hojeFinanceiro();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [comReceber, setComReceber] = useState(false);
  const [dia, setDia] = useState<string | null>(null);
  const [acao, setAcao] = useState<AcaoTitulo | null>(null);
  const [operando, setOperando] = useState(false);

  const visiveis = useMemo(
    () => (titulos ?? []).filter((t) => t.status !== "cancelado" && (comReceber || t.tipo === "pagar")),
    [titulos, comReceber],
  );
  const porDia = useMemo(() => {
    const m = new Map<string, Titulo[]>();
    for (const t of visiveis) m.set(t.vencimento, [...(m.get(t.vencimento) ?? []), t]);
    return m;
  }, [visiveis]);
  const semanas = useMemo(() => semanasDoMes(mes), [mes]);

  const doMes = visiveis.filter((t) => t.vencimento.startsWith(mes));
  const soma = (l: Titulo[]) => l.reduce((s, t) => s + t.valor, 0);
  const totais = {
    aPagar: soma(doMes.filter((t) => t.tipo === "pagar" && t.status === "aberto")),
    pago: soma(doMes.filter((t) => t.tipo === "pagar" && t.status === "pago")),
    aReceber: soma(doMes.filter((t) => t.tipo === "receber" && t.status === "aberto")),
    vencidas: (titulos ?? []).filter((t) => t.tipo === "pagar" && t.status === "aberto" && t.vencimento < hoje),
  };
  const ano = mes.slice(0, 4);
  const meses = NOMES_MESES.map((nome, i) => {
    const chave = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const lista = (titulos ?? []).filter((t) => t.tipo === "pagar" && t.status !== "cancelado" && t.vencimento.startsWith(chave));
    return { chave, nome: nome.slice(0, 3), total: soma(lista), vencida: lista.some((t) => t.status === "aberto" && t.vencimento < hoje) };
  });

  const abrirDia = (data: string) => {
    if (porDia.get(data)?.length) setDia(data);
    else setAcao({ tipo: "editar", tipoTitulo: "pagar", vencimento: data });
  };
  const fechar = () => { if (!operando) { setAcao(null); setDia(null); } };
  const tipoDaAcao: TipoTitulo | null = acao ? (acao.tipo === "editar" ? acao.titulo?.tipo ?? acao.tipoTitulo ?? "pagar" : acao.titulo.tipo) : null;
  const sugestoes = useMemo(() => (tipoDaAcao ? sugestoesTitulos(titulos, tipoDaAcao) : { pessoas: [], categorias: [] }), [titulos, tipoDaAcao]);

  if (!titulos && !erro) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Calendário de contas"
        descricao="Organize o ano: clique num dia para cadastrar uma conta com esse vencimento. É o mesmo cadastro de Contas a pagar."
        acoes={<Button onClick={() => setAcao({ tipo: "editar", tipoTitulo: "pagar", vencimento: mes === hoje.slice(0, 7) ? hoje : `${mes}-01` })}><Plus /> Nova conta a pagar</Button>}
      />
      {erro && <p role="alert" className="mb-4 rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}

      {/* O ano todo: total a pagar por mês */}
      <nav aria-label={`Meses de ${ano}`} className="mb-4 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
        {meses.map((m) => (
          <button key={m.chave} type="button" onClick={() => setMes(m.chave)} aria-current={m.chave === mes ? "true" : undefined}
            className={cn("cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors",
              m.chave === mes ? "border-rosa bg-rosa/10" : "border-borda bg-superficie hover:border-rosa/60")}>
            <span className={cn("block text-xs font-bold", m.vencida && "text-perigo")}>{m.nome}</span>
            <span className="block font-mono text-[0.7rem] text-suave tabular-nums">{m.total ? formatarPreco(m.total) : "—"}</span>
          </button>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="suave" size="icone" aria-label="Mês anterior" onClick={() => setMes((m) => somarMeses(m, -1))}><ChevronLeft /></Button>
        <h2 className="min-w-48 text-center text-lg font-semibold" aria-live="polite">{nomeDoMes(mes)}</h2>
        <Button variant="suave" size="icone" aria-label="Próximo mês" onClick={() => setMes((m) => somarMeses(m, 1))}><ChevronRight /></Button>
        {mes !== hoje.slice(0, 7) && <Button variant="fantasma" size="sm" onClick={() => setMes(hoje.slice(0, 7))}>Hoje</Button>}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-rosa" checked={comReceber} onChange={(e) => setComReceber(e.target.checked)} />
          Mostrar contas a receber
        </label>
      </div>

      <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-suave">A pagar no mês: </dt><dd className="inline font-mono font-semibold">{formatarPreco(totais.aPagar)}</dd></div>
        <div><dt className="inline text-suave">Já pago: </dt><dd className="inline font-mono text-sucesso">{formatarPreco(totais.pago)}</dd></div>
        {comReceber && <div><dt className="inline text-suave">A receber: </dt><dd className="inline font-mono">{formatarPreco(totais.aReceber)}</dd></div>}
        {totais.vencidas.length > 0 && (
          <div><dt className="inline text-perigo">Vencidas (todos os meses): </dt><dd className="inline font-mono font-semibold text-perigo">{totais.vencidas.length} · {formatarPreco(soma(totais.vencidas))}</dd></div>
        )}
      </dl>

      <div role="grid" aria-label={`Calendário de ${nomeDoMes(mes)}`} className="overflow-hidden rounded-lg border border-borda">
        <div role="row" className="grid grid-cols-7 border-b border-borda bg-superficie-2 text-center text-xs text-suave">
          {DIAS_SEMANA.map((d) => <div key={d} role="columnheader" className="py-2">{d}</div>)}
        </div>
        {semanas.map((semana) => (
          <div key={semana[0].data} role="row" className="grid grid-cols-7 border-b border-borda last:border-b-0">
            {semana.map(({ data, doMes: dentro }) => {
              const lista = porDia.get(data) ?? [];
              const totalDia = soma(lista.filter((t) => t.tipo === "pagar"));
              const ehHoje = data === hoje;
              const rotulo = `${dataBr(data)}${lista.length ? `: ${lista.length} ${lista.length === 1 ? "conta" : "contas"}, ${formatarPreco(soma(lista))}` : ": sem contas, toque para cadastrar"}`;
              return (
                <button key={data} type="button" role="gridcell" aria-label={rotulo} onClick={() => abrirDia(data)}
                  className={cn(
                    "group relative flex min-h-16 cursor-pointer flex-col gap-1 border-r border-borda p-1 text-left transition-colors last:border-r-0 hover:bg-superficie-2 md:min-h-28 md:p-1.5",
                    dentro ? "bg-superficie" : "bg-fundo/60 text-suave/60",
                  )}>
                  <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold", ehHoje && "bg-rosa text-preto")}>
                    {Number(data.slice(8))}
                  </span>
                  {/* Celular: pontinhos coloridos */}
                  <span className="flex flex-wrap gap-0.5 md:hidden" aria-hidden>
                    {lista.slice(0, 4).map((t) => <span key={t.id} className={cn("size-1.5 rounded-full", PONTO[situacaoTitulo(t, hoje).tipo])} />)}
                  </span>
                  {/* Computador: nome e valor de cada conta */}
                  <span className="hidden min-w-0 flex-col gap-0.5 md:flex" aria-hidden>
                    {lista.slice(0, 3).map((t) => (
                      <span key={t.id} className={cn("truncate rounded border px-1 text-[0.68rem] leading-4", CORES_SITUACAO[situacaoTitulo(t, hoje).tipo])}>
                        {t.tipo === "receber" ? "+ " : ""}{t.descricao} · {formatarPreco(t.valor)}
                      </span>
                    ))}
                    {lista.length > 3 && <span className="text-[0.68rem] text-suave">+{lista.length - 3} contas</span>}
                  </span>
                  {totalDia > 0 && <span className="mt-auto hidden self-end font-mono text-[0.68rem] text-suave tabular-nums md:block" aria-hidden>{formatarPreco(totalDia)}</span>}
                  {!lista.length && dentro && <Plus aria-hidden className="absolute right-1.5 bottom-1.5 hidden size-4 text-suave opacity-0 group-hover:opacity-100 md:block" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-suave">Toque num dia vazio para cadastrar uma conta com esse vencimento. Para o ano todo (ex.: aluguel), use “Repetir todo mês”.</p>

      <Sheet open={!!acao || !!dia} onOpenChange={(v) => { if (!v) fechar(); }}>
        <SheetContent lado="centro" className="max-w-lg">
          <SheetTitle className="sr-only">{acao ? "Conta" : dia ? `Contas de ${dataBr(dia)}` : "Contas"}</SheetTitle>
          <SheetDescription className="sr-only">Contas com vencimento neste dia.</SheetDescription>
          {acao && tipoDaAcao ? (
            <FormularioTitulo
              key={acao.tipo + (acao.titulo?.id ?? "nova") + (acao.tipo === "editar" ? acao.vencimento ?? "" : "")}
              tipo={tipoDaAcao} acao={acao} contas={contas} pessoas={sugestoes.pessoas} categorias={sugestoes.categorias}
              onOperando={setOperando}
              onCancelar={() => setAcao(null)}
              onSalvo={() => { setAcao(null); atualizar(); }}
            />
          ) : dia ? (
            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-3 overflow-y-auto px-5 pt-5 pb-6">
                <h2 className="pr-9 text-lg font-semibold first-letter:uppercase">{nomeDia(dia)}</h2>
                <ul className="divide-y divide-borda rounded-lg border border-borda">
                  {(porDia.get(dia) ?? []).map((t) => {
                    const sit = situacaoTitulo(t, hoje);
                    const textos = TEXTOS_TITULO[t.tipo];
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{t.tipo === "receber" && <span className="text-sucesso">A receber · </span>}{t.descricao}{t.parcelas && t.parcelas > 1 ? ` (${t.parcela}/${t.parcelas})` : ""}</p>
                          <p className="text-xs text-suave">{[t.pessoa, t.categoria].filter(Boolean).join(" · ") || "—"}</p>
                        </div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[0.7rem] font-bold", CORES_SITUACAO[sit.tipo])}>{sit.texto}</span>
                        <strong className="font-mono tabular-nums">{formatarPreco(t.valor)}</strong>
                        <div className="flex w-full justify-end gap-1">
                          {t.status === "aberto" ? (
                            <>
                              <Button size="sm" onClick={() => setAcao({ tipo: "baixar", titulo: t })}>{textos.acao}</Button>
                              <Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "editar", titulo: t })}><Pencil /> Editar</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="suave" onClick={() => setAcao({ tipo: "desfazer", titulo: t })}><Undo2 /> Desfazer</Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-borda px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {comReceber && <Button variant="suave" onClick={() => setAcao({ tipo: "editar", tipoTitulo: "receber", vencimento: dia })}><Plus /> Conta a receber</Button>}
                <Button onClick={() => setAcao({ tipo: "editar", tipoTitulo: "pagar", vencimento: dia })}><Plus /> Nova conta neste dia</Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
