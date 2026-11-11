"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { History, PackagePlus, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { combina } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { revalidarLoja } from "@/app/admin/acoes";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Produto } from "@/lib/tipos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor, Select } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CabecalhoPagina, Carregando, Vazio } from "../ui";

type Filtro = "controlados" | "baixo" | "todos";

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
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("controlados");
  const [acao, setAcao] = useState<{ produto: Produto; modo: "entrada" | "ajuste" | "historico" } | null>(null);

  const lista = useMemo(() => {
    let l = [...produtos.dados].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (filtro === "controlados") l = l.filter((p) => p.controla_estoque || p.eh_kit);
    if (filtro === "baixo") l = l.filter((p) => !p.eh_kit && p.controla_estoque && p.estoque <= (p.volume_unidade ?? 1) * 5);
    if (busca.trim()) l = l.filter((p) => combina(p.nome, busca));
    return l;
  }, [produtos.dados, filtro, busca]);

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

  const baixos = produtos.dados.filter((p) => !p.eh_kit && p.controla_estoque && p.estoque <= (p.volume_unidade ?? 1) * 5).length;

  if (produtos.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Estoque"
        descricao="Vendas do site e do balcão baixam sozinhas; cancelamentos devolvem."
      />

      <div className="relative mb-3">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-suave" />
        <Input
          type="search"
          aria-label="Buscar produto"
          placeholder="Buscar produto…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="rounded-full pl-12"
        />
      </div>
      <div className="sem-barra -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {(
          [
            ["controlados", "Com controle"],
            ["baixo", `Estoque baixo${baixos ? ` (${baixos})` : ""}`],
            ["todos", "Todos os produtos"],
          ] as [Filtro, string][]
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filtro === id}
            onClick={() => setFiltro(id)}
            className={cn(
              "rotulo h-11 shrink-0 cursor-pointer rounded-full border px-4 font-bold",
              filtro === id ? "border-rosa bg-rosa text-preto" : "border-borda hover:border-rosa/60",
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <Vazio
          titulo={filtro === "controlados" ? "Nenhum produto com controle" : "Nada por aqui"}
          texto={
            filtro === "controlados"
              ? "Abra “Todos os produtos” e ligue o controle nos itens que você quer acompanhar."
              : undefined
          }
          acao={filtro !== "todos" ? <Button variant="suave" onClick={() => setFiltro("todos")}>Ver todos os produtos</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {lista.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-borda bg-superficie p-3">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-superficie-2">
                {p.foto_url && <Image src={p.foto_url} alt="" fill sizes="48px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1 basis-36">
                <p className="font-bold leading-snug">{p.nome}</p>
                {p.eh_kit ? <p className="text-sm text-rosa">Kit · saldo calculado pelos componentes</p> : p.controla_estoque ? (
                  <p
                    className={cn(
                      "font-mono text-sm",
                      p.estoque <= 0 ? "text-perigo" : p.estoque <= 5 ? "text-amarelo" : "text-suave",
                    )}
                  >
                    {p.estoque <= 0 ? "Esgotado · 0" : `${p.estoque} ${p.unidade_estoque ?? "un"} em estoque${p.unidade_estoque === "ml" ? ` · ${(p.estoque / (p.volume_unidade ?? 1)).toFixed(2)} garrafas equivalentes` : ""}`}
                  </p>
                ) : (
                  <p className="text-sm text-suave">Sem controle de estoque</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Interruptor disabled={!!p.eh_kit} checked={p.controla_estoque || !!p.eh_kit} onCheckedChange={() => alternarControle(p)} label={`Controlar estoque de ${p.nome}`} />
                {!p.eh_kit && p.controla_estoque && (
                  <>
                    <Button size="sm" onClick={() => setAcao({ produto: p, modo: "entrada" })} aria-label={`Entrada de ${p.nome}`}>
                      <PackagePlus /> <span className="hidden sm:inline">Entrada</span>
                    </Button>
                    <Button variant="suave" size="icone" onClick={() => setAcao({ produto: p, modo: "ajuste" })} aria-label={`Ajustar contagem de ${p.nome}`}>
                      <SlidersHorizontal />
                    </Button>
                    <Button variant="fantasma" size="icone" onClick={() => setAcao({ produto: p, modo: "historico" })} aria-label={`Histórico de ${p.nome}`}>
                      <History />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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
            {produto.nome} · hoje: <strong className="font-mono text-branco">{produto.estoque} {produto.unidade_estoque ?? "un"}</strong>
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
                  m.quantidade > 0 ? "text-sucesso" : "text-rosa",
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
