"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_ORIGEM, NOMES_PAGAMENTO, type FormaPagamento } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Input } from "@/components/ui/campos";
import { CabecalhoPagina, Carregando, Cartao, Vazio } from "../ui";

interface Linha {
  chave: string;
  pedidos: number;
  total: number;
}
interface Relatorio {
  faturamento: number;
  pedidos: number;
  ticket_medio: number;
  descontos: number;
  taxas_entrega: number;
  cancelados: number;
  por_origem: Linha[];
  por_pagamento: Linha[];
  por_dia: { dia: string; pedidos: number; total: number }[];
  top_produtos: { nome: string; quantidade: number; total: number }[];
}

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

const diaCurto = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const NOME_CHAVE: Record<string, string> = {
  ...NOMES_ORIGEM,
  ...Object.fromEntries(Object.entries(NOMES_PAGAMENTO).map(([k, v]) => [k, k === "cartao" ? "Cartão" : v])),
};

export function PaginaRelatorios() {
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [de, setDe] = useState(() => somarDias(hojeSP(), -6));
  const [ate, setAte] = useState(() => hojeSP());
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [inicio, fim] = intervalo(periodo, de, ate);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador()
      .rpc("relatorio_vendas", { p_inicio: inicio, p_fim: fim })
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) toast.error(error.message);
        setDados((data as Relatorio) ?? null);
        setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [inicio, fim]);

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
            onClick={() => {
              setPeriodo(id);
              setCarregando(true);
            }}
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

      {carregando || !dados ? (
        <Carregando />
      ) : dados.pedidos === 0 ? (
        <Vazio titulo="Sem vendas no período" texto={`Nenhuma venda entre ${diaCurto(inicio)} e ${diaCurto(fim)}.`} />
      ) : (
        <div className="space-y-6">
          {/* Números principais */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Numero rotulo="Faturamento" valor={formatarPreco(dados.faturamento)} destaque />
            <Numero rotulo="Pedidos" valor={String(dados.pedidos)} />
            <Numero rotulo="Ticket médio" valor={formatarPreco(dados.ticket_medio)} />
            <Numero rotulo="Taxas de entrega" valor={formatarPreco(dados.taxas_entrega)} />
            <Numero rotulo="Descontos" valor={formatarPreco(dados.descontos)} />
            <Numero rotulo="Cancelados" valor={String(dados.cancelados)} />
          </div>

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
