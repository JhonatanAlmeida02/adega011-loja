"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_ORIGEM, NOMES_PAGAMENTO, type FormaPagamento } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Input } from "@/components/ui/campos";
import { Button } from "@/components/ui/button";
import { validarRelatorio, type RelatorioVendas as Relatorio, type LinhaRelatorio as Linha } from "@/lib/relatorios";
import { CabecalhoPagina, Carregando, Cartao, Vazio } from "../ui";

type Periodo = "hoje" | "7" | "30" | "mes" | "custom";

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function intervalo(p: Periodo, de: string, ate: string): [string, string] {
  const hoje = hojeSP();
  if (p === "hoje") return [hoje, hoje];
  if (p === "7") return [somarDias(hoje, -6), hoje];
  if (p === "30") return [somarDias(hoje, -29), hoje];
  if (p === "mes") return [`${hoje.slice(0, 8)}01`, hoje];
  return [de || hoje, ate || hoje];
}

/** Mesma data N meses antes/depois (dia 31 vira o último dia do mês). */
function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
}

type Comparacao = "anterior" | "mes" | "ano" | "custom";
function intervaloComparacao(c: Comparacao, inicio: string, fim: string, de: string, ate: string): [string, string] {
  if (c === "anterior") {
    const n = diasEntre(inicio, fim) + 1;
    return [somarDias(inicio, -n), somarDias(inicio, -1)];
  }
  if (c === "mes") return [somarMeses(inicio, -1), somarMeses(fim, -1)];
  if (c === "ano") return [somarMeses(inicio, -12), somarMeses(fim, -12)];
  return [de, ate];
}

const diaCurto = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const dataCurta = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const faixa = (de: string, ate: string) => (de === ate ? dataCurta(de) : `${dataCurta(de)} a ${dataCurta(ate)}`);

/** Margem (%) sobre o faturamento, com 1 casa. */
const margem = (lucro: number, faturamento: number) =>
  faturamento ? `${((lucro / faturamento) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";

/** Busca o relatório de um período (null enquanto carrega). */
function useRelatorio(inicio: string, fim: string, ativo = true) {
  const [estado, setEstado] = useState<{ chave: string; dados: Relatorio | null; erro: string } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const chave = `${inicio}|${fim}|${tentativa}`;
  const valido = !!inicio && !!fim && fim >= inicio && diasEntre(inicio, fim) <= 366;
  const tentarNovamente = () => setTentativa((n) => n + 1);
  useEffect(() => {
    if (!ativo || !valido) return;
    let vivo = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const carregar = async () => {
      try {
        const { data, error } = await supabaseNavegador().rpc("relatorio_vendas", { p_inicio: inicio, p_fim: fim }).abortSignal(controller.signal);
        if (error) throw error;
        const dados = validarRelatorio(data);
        if (vivo) setEstado({ chave, dados, erro: "" });
      } catch (erro) {
        if (!vivo) return;
        console.error("[relatorios] Falha ao carregar:", erro);
        setEstado({ chave, dados: null, erro: controller.signal.aborted ? "O relatório demorou para responder. Tente novamente." : "Não foi possível carregar o relatório. Tente novamente." });
      } finally { clearTimeout(timer); }
    };
    void carregar();
    return () => {
      vivo = false; clearTimeout(timer); controller.abort();
    };
  }, [chave, inicio, fim, ativo, valido]);
  if (!valido) return { dados: null, carregando: false, erro: "Escolha um período válido de até 1 ano.", tentarNovamente };
  return estado?.chave === chave ? { dados: estado.dados, carregando: false, erro: estado.erro, tentarNovamente } : { dados: null, carregando: ativo, erro: "", tentarNovamente };
}

function FalhaRelatorio({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return <div role="alert" className="space-y-3 rounded-lg border border-borda bg-superficie p-4"><p className="text-sm text-suave">{mensagem}</p><Button type="button" size="sm" variant="suave" onClick={onTentar}>Tentar novamente</Button></div>;
}

const NOME_CHAVE: Record<string, string> = {
  ...NOMES_ORIGEM,
  ...Object.fromEntries(Object.entries(NOMES_PAGAMENTO).map(([k, v]) => [k, k === "cartao" ? "Cartão" : v])),
};

export function PaginaRelatorios() {
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [de, setDe] = useState(() => somarDias(hojeSP(), -6));
  const [ate, setAte] = useState(() => hojeSP());
  const [inicio, fim] = intervalo(periodo, de, ate);
  const { dados, carregando, erro, tentarNovamente } = useRelatorio(inicio, fim);

  // Dias sem venda também aparecem (zerados) no gráfico
  const dias = useMemo(() => {
    if (!dados) return [];
    const mapa = new Map(dados.por_dia.map((d) => [d.dia, d]));
    const lista: { dia: string; pedidos: number; total: number }[] = [];
    for (let d = inicio, i = 0; d <= fim && i < 400; d = somarDias(d, 1), i++) {
      lista.push(mapa.get(d) ?? { dia: d, pedidos: 0, total: 0 });
    }
    return lista;
  }, [dados, inicio, fim]);

  return (
    <>
      <CabecalhoPagina titulo="Relatórios" descricao="Vendas do site e do balcão (pedidos cancelados não entram)." />

      {/* Filtros: uma linha acima de tudo */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(
          [
            ["hoje", "Hoje"],
            ["7", "7 dias"],
            ["30", "30 dias"],
            ["mes", "Este mês"],
            ["custom", "Escolher datas"],
          ] as [Periodo, string][]
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            aria-pressed={periodo === id}
            onClick={() => setPeriodo(id)}
            className={cn(
              "rotulo h-10 cursor-pointer rounded-full border px-4 font-bold",
              periodo === id ? "border-rosa bg-rosa text-preto" : "border-borda hover:border-rosa/60",
            )}
          >
            {rotulo}
          </button>
        ))}
        {periodo === "custom" && (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="rel-de">
              De
            </label>
            <Input id="rel-de" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="h-10 w-40 font-mono" />
            <span className="text-suave">até</span>
            <label className="sr-only" htmlFor="rel-ate">
              Até
            </label>
            <Input id="rel-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className="h-10 w-40 font-mono" />
          </div>
        )}
      </div>

      {erro ? <FalhaRelatorio mensagem={erro} onTentar={tentarNovamente} /> : carregando || !dados ? (
        <Carregando />
      ) : dados.pedidos === 0 ? (
        <div className="space-y-6">
          <Vazio titulo="Sem vendas no período" texto={`Nenhuma venda entre ${diaCurto(inicio)} e ${diaCurto(fim)}.`} />
          <Comparativo atual={dados} inicio={inicio} fim={fim} />
        </div>
      ) : (
        <div className="space-y-6">
          <LucroLiquido dados={dados} />

          {/* Números principais */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Numero rotulo="Faturamento" valor={formatarPreco(dados.faturamento)} destaque />
            <Numero rotulo="Pedidos" valor={String(dados.pedidos)} />
            <Numero rotulo="Ticket médio" valor={formatarPreco(dados.ticket_medio)} />
            <Numero rotulo="Taxas de entrega" valor={formatarPreco(dados.taxas_entrega)} />
            <Numero rotulo="Descontos" valor={formatarPreco(dados.descontos)} />
            <Numero rotulo="Cancelados" valor={String(dados.cancelados)} />
          </div>

          <Comparativo atual={dados} inicio={inicio} fim={fim} />

          {dias.length > 1 && <GraficoDias dias={dias} />}

          <div className="grid gap-6 md:grid-cols-2">
            <Barras titulo="Por forma de pagamento" linhas={dados.por_pagamento} />
            <Barras titulo="Por origem" linhas={dados.por_origem} />
          </div>

          <Cartao>
            <h2 className="titulo mb-3 text-2xl">Mais vendidos</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="rotulo text-left text-suave">
                  <th className="pb-2 font-normal">Produto</th>
                  <th className="pb-2 text-right font-normal">Qtd.</th>
                  <th className="pb-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {dados.top_produtos.map((p, i) => (
                  <tr key={p.nome}>
                    <td className="py-2">
                      <span className="mr-2 font-mono text-suave">{i + 1}.</span>
                      {p.nome}
                    </td>
                    <td className="py-2 text-right font-mono">{p.quantidade}</td>
                    <td className="py-2 text-right font-mono">{formatarPreco(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cartao>
        </div>
      )}
    </>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-card border border-borda bg-superficie p-4">
      <p className="rotulo text-suave">{rotulo}</p>
      <p className={cn("mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl", destaque && "text-preco")}>
        {valor}
      </p>
    </div>
  );
}

/** Faturamento por dia: uma série, barras finas com tooltip e tabela alternativa. */
function GraficoDias({ dias }: { dias: { dia: string; pedidos: number; total: number }[] }) {
  const [tabela, setTabela] = useState(false);
  const max = Math.max(...dias.map((d) => d.total), 1);
  const passo = Math.max(1, Math.ceil(dias.length / 8)); // rótulos do eixo sem amontoar
  return (
    <Cartao>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="titulo text-2xl">Faturamento por dia</h2>
        <button
          type="button"
          onClick={() => setTabela((t) => !t)}
          aria-pressed={tabela}
          className="cursor-pointer text-sm text-suave underline-offset-4 hover:text-texto hover:underline"
        >
          {tabela ? "Ver gráfico" : "Ver tabela"}
        </button>
      </div>
      {tabela ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="rotulo text-left text-suave">
              <th className="pb-2 font-normal">Dia</th>
              <th className="pb-2 text-right font-normal">Pedidos</th>
              <th className="pb-2 text-right font-normal">Faturamento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {dias.map((d) => (
              <tr key={d.dia}>
                <td className="py-1.5 font-mono">{diaCurto(d.dia)}</td>
                <td className="py-1.5 text-right font-mono">{d.pedidos}</td>
                <td className="py-1.5 text-right font-mono">{formatarPreco(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div>
          <div className="relative flex h-44 items-end gap-[2px] border-b border-borda" role="list" aria-label="Faturamento por dia">
            {/* linha de referência no máximo (grade discreta) */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-borda/60" />
            <span aria-hidden className="pointer-events-none absolute -top-5 right-0 font-mono text-[0.68rem] text-suave">
              {formatarPreco(max)}
            </span>
            {dias.map((d) => (
              <div
                key={d.dia}
                role="listitem"
                tabIndex={0}
                aria-label={`${diaCurto(d.dia)}: ${formatarPreco(d.total)} em ${d.pedidos} pedidos`}
                className="group relative flex h-full flex-1 cursor-default items-end outline-none"
              >
                <div
                  className="w-full rounded-t-[4px] bg-rosa transition-opacity group-hover:opacity-80 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-foco"
                  style={{ height: d.total ? `${Math.max(2, (d.total / max) * 100)}%` : "0" }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-borda bg-superficie-2 px-2.5 py-1.5 text-xs shadow-xl group-hover:block group-focus-visible:block">
                  <span className="block text-suave">{diaCurto(d.dia)}</span>
                  <span className="font-mono font-bold">{formatarPreco(d.total)}</span>
                  <span className="text-suave"> · {d.pedidos} ped.</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[2px]" aria-hidden>
            {dias.map((d, i) => (
              <span key={d.dia} className="flex-1 text-center font-mono text-[0.65rem] text-suave">
                {i % passo === 0 ? diaCurto(d.dia) : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </Cartao>
  );
}

/** Barras horizontais de uma série (magnitude por categoria), com valor escrito. */
function Barras({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  const max = Math.max(...linhas.map((l) => l.total), 1);
  return (
    <Cartao>
      <h2 className="titulo mb-4 text-2xl">{titulo}</h2>
      <ul className="space-y-3">
        {linhas.map((l) => (
          <li key={l.chave}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-bold">{NOME_CHAVE[l.chave as FormaPagamento] ?? l.chave}</span>
              <span className="font-mono">
                {formatarPreco(l.total)} <span className="text-suave">· {l.pedidos}</span>
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-superficie-3">
              <div className="h-full rounded-full bg-rosa" style={{ width: `${Math.max(2, (l.total / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

/** Lucro líquido do período, com a conta que leva até ele. */
function LucroLiquido({ dados }: { dados: Relatorio }) {
  const positivo = dados.lucro_liquido >= 0;
  return (
    <Cartao className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
      <div>
        <p className="rotulo text-suave">Lucro líquido</p>
        <p className={cn("mt-1 font-mono text-3xl font-bold tabular-nums sm:text-4xl", positivo ? "text-sucesso" : "text-perigo")}>
          {formatarPreco(dados.lucro_liquido)}
        </p>
        <p className="mt-1 text-sm text-suave">
          Margem líquida <span className="font-mono font-bold text-texto">{margem(dados.lucro_liquido, dados.faturamento)}</span>
          {" · "}bruta <span className="font-mono">{margem(dados.lucro_bruto, dados.faturamento)}</span>
        </p>
      </div>
      <dl className="space-y-1.5 text-sm">
        <LinhaConta rotulo="Faturamento" valor={dados.faturamento} />
        <LinhaConta rotulo="Custo dos produtos vendidos" valor={-dados.custo_produtos} />
        <LinhaConta rotulo="Lucro bruto" valor={dados.lucro_bruto} forte />
        <LinhaConta rotulo="Despesas pagas" valor={-dados.despesas} />
        {dados.despesas_por_categoria.map((d) => (
          <LinhaConta key={d.categoria} rotulo={d.categoria} valor={-d.total} recuo />
        ))}
        <LinhaConta rotulo="Lucro líquido" valor={dados.lucro_liquido} forte />
      </dl>
      <p className="text-xs text-suave md:col-span-2">
        Custo pelo cadastro atual de cada produto. Despesas são as saídas do Financeiro no período (inclui contas pagas), sem
        a categoria Fornecedores — a compra de mercadoria já está no custo dos produtos.
        {dados.vendas_sem_custo > 0 && (
          <span className="mt-1 block font-bold text-amarelo-texto">
            {formatarPreco(dados.vendas_sem_custo)} em vendas de produtos sem custo cadastrado: o lucro real é menor.
          </span>
        )}
      </p>
    </Cartao>
  );
}

function LinhaConta({ rotulo, valor, forte, recuo }: { rotulo: string; valor: number; forte?: boolean; recuo?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        forte && "border-t border-borda pt-1.5 font-bold",
        recuo && "pl-4 text-xs text-suave",
      )}
    >
      <dt>{rotulo}</dt>
      <dd className="font-mono tabular-nums">{valor < 0 ? `− ${formatarPreco(-valor)}` : formatarPreco(valor)}</dd>
    </div>
  );
}

type TipoValor = "dinheiro" | "numero" | "pct";
const formatarValor = (v: number, tipo: TipoValor) =>
  tipo === "dinheiro"
    ? formatarPreco(v)
    : tipo === "pct"
      ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
      : String(v);

/** Mini relatório: o período escolhido lado a lado com outro, e a variação. */
function Comparativo({ atual, inicio, fim }: { atual: Relatorio; inicio: string; fim: string }) {
  const [modo, setModo] = useState<Comparacao>("anterior");
  const [de, setDe] = useState(() => intervaloComparacao("anterior", inicio, fim, "", "")[0]);
  const [ate, setAte] = useState(() => intervaloComparacao("anterior", inicio, fim, "", "")[1]);
  const [cInicio, cFim] = intervaloComparacao(modo, inicio, fim, de, ate);
  const valido = !!cInicio && !!cFim && cInicio <= cFim && diasEntre(cInicio, cFim) <= 366;
  const { dados: outro, carregando, erro, tentarNovamente } = useRelatorio(cInicio, cFim, valido);

  const pctLiquida = (r: Relatorio) => (r.faturamento ? (r.lucro_liquido / r.faturamento) * 100 : 0);
  const linhas: { rotulo: string; a: number; b: number; tipo: TipoValor; menorMelhor?: boolean; forte?: boolean }[] = outro
    ? [
        { rotulo: "Faturamento", a: atual.faturamento, b: outro.faturamento, tipo: "dinheiro", forte: true },
        { rotulo: "Pedidos", a: atual.pedidos, b: outro.pedidos, tipo: "numero" },
        { rotulo: "Ticket médio", a: atual.ticket_medio, b: outro.ticket_medio, tipo: "dinheiro" },
        { rotulo: "Custo dos produtos", a: atual.custo_produtos, b: outro.custo_produtos, tipo: "dinheiro", menorMelhor: true },
        { rotulo: "Despesas", a: atual.despesas, b: outro.despesas, tipo: "dinheiro", menorMelhor: true },
        { rotulo: "Lucro líquido", a: atual.lucro_liquido, b: outro.lucro_liquido, tipo: "dinheiro", forte: true },
        { rotulo: "Margem líquida", a: pctLiquida(atual), b: pctLiquida(outro), tipo: "pct" },
        { rotulo: "Descontos", a: atual.descontos, b: outro.descontos, tipo: "dinheiro", menorMelhor: true },
        { rotulo: "Cancelados", a: atual.cancelados, b: outro.cancelados, tipo: "numero", menorMelhor: true },
      ]
    : [];

  return (
    <Cartao>
      <h2 className="titulo mb-1 text-2xl">Comparar períodos</h2>
      <p className="mb-4 text-sm text-suave">
        {faixa(inicio, fim)} comparado com {valido ? faixa(cInicio, cFim) : "…"}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["anterior", "Período anterior"],
            ["mes", "Mês passado"],
            ["ano", "Ano passado"],
            ["custom", "Escolher datas"],
          ] as [Comparacao, string][]
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            aria-pressed={modo === id}
            onClick={() => setModo(id)}
            className={cn(
              "rotulo h-9 cursor-pointer rounded-full border px-3.5 font-bold",
              modo === id ? "border-rosa bg-rosa text-preto" : "border-borda hover:border-rosa/60",
            )}
          >
            {rotulo}
          </button>
        ))}
        {modo === "custom" && (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="cmp-de">
              Comparar de
            </label>
            <Input id="cmp-de" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="h-9 w-40 font-mono" />
            <span className="text-suave">até</span>
            <label className="sr-only" htmlFor="cmp-ate">
              Comparar até
            </label>
            <Input id="cmp-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className="h-9 w-40 font-mono" />
          </div>
        )}
      </div>

      {!valido ? (
        <p className="text-sm text-suave">Escolha um período de até 1 ano.</p>
      ) : erro ? <FalhaRelatorio mensagem={erro} onTentar={tentarNovamente} /> : carregando || !outro ? (
        <Carregando />
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="rotulo text-left text-suave">
                <th className="pb-2 font-normal">Indicador</th>
                <th className="pb-2 text-right font-normal">Este período</th>
                <th className="pb-2 text-right font-normal">Comparado</th>
                <th className="pb-2 text-right font-normal">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {linhas.map((l) => {
                const dif = l.a - l.b;
                const igual = Math.abs(dif) < 0.05;
                const num = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`;
                // Margem varia em pontos percentuais; o resto em % sobre o valor comparado.
                const texto =
                  l.tipo === "pct" ? `${num(dif)} p.p.` : l.b === 0 ? (l.a === 0 ? "0%" : "novo") : `${num((dif / Math.abs(l.b)) * 100)}%`;
                const bom = l.menorMelhor ? dif < 0 : dif > 0;
                return (
                  <tr key={l.rotulo} className={cn(l.forte && "font-bold")}>
                    <td className="py-2">{l.rotulo}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{formatarValor(l.a, l.tipo)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-suave">{formatarValor(l.b, l.tipo)}</td>
                    <td className={cn("py-2 text-right font-mono tabular-nums", igual ? "text-suave" : bom ? "text-sucesso" : "text-perigo")}>
                      {!igual && (dif > 0 ? "▲ " : "▼ ")}
                      {texto}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  );
}
