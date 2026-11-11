"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { salvar } from "@/lib/admin/dados";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { GrupoOpcoes, Opcao, Produto } from "@/lib/tipos";
import { centavosParaCampo, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor, Select } from "@/components/ui/campos";
import { Confirmar } from "./ui";

/**
 * Grupos de adicionais de um produto (ex.: "Energético": Baly +3, Red Bull +7).
 * Cada mudança é salva na hora.
 */
export function EditorAdicionais({ produtoId }: { produtoId: string }) {
  const [grupos, setGrupos] = useState<GrupoOpcoes[] | null>(null);
  const [bases, setBases] = useState<Produto[]>([]);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    sb.from("produtos").select("id,nome,unidade_estoque,estoque").eq("eh_kit", false).eq("controla_estoque", true).order("nome").then(({ data, error }) => {
      if (!ativo) return;
      if (error) toast.error("Não foi possível carregar os ingredientes.");
      else setBases((data ?? []) as Produto[]);
    });
    sb.from("grupos_opcoes")
      .select("id,produto_id,nome,minimo,maximo,ordem,opcoes(id,grupo_id,nome,preco,disponivel,ordem,componente_id,quantidade_consumo)")
      .eq("produto_id", produtoId)
      .order("ordem")
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) toast.error(`Erro ao carregar adicionais: ${error.message}`);
        setGrupos(
          ((data ?? []) as GrupoOpcoes[]).map((g) => ({ ...g, opcoes: [...g.opcoes].sort((a, b) => a.ordem - b.ordem) })),
        );
      });
    return () => {
      ativo = false;
    };
  }, [produtoId, versao]);

  const novoGrupo = async () => {
    const ok = await salvar(
      supabaseNavegador()
        .from("grupos_opcoes")
        .insert({ produto_id: produtoId, nome: "Adicionais", minimo: 0, maximo: 1, ordem: grupos?.length ?? 0 }),
      "Grupo criado",
    );
    if (ok) recarregar();
  };

  if (!grupos) return <p className="text-sm text-suave">Carregando adicionais…</p>;

  return (
    <div className="space-y-2">
      {grupos.length === 0 && (
        <p className="text-sm text-suave">
          Sem adicionais. Ex.: no “Copão”, crie o grupo “Energético” com Baly (+ R$ 3,00) e Red Bull (+ R$ 7,00).
        </p>
      )}
      {grupos.map((g) => (
        <Grupo key={g.id} grupo={g} bases={bases} onMudou={recarregar} />
      ))}
      <Button type="button" variant="suave" size="sm" onClick={novoGrupo}>
        <Plus /> Novo grupo de adicionais
      </Button>
    </div>
  );
}

function Grupo({ grupo, bases, onMudou }: { grupo: GrupoOpcoes; bases: Produto[]; onMudou: () => void }) {
  const [nome, setNome] = useState(grupo.nome);
  const [obrigatorio, setObrigatorio] = useState(grupo.minimo > 0);
  const [maximo, setMaximo] = useState(String(grupo.maximo));
  const [novaOpcao, setNovaOpcao] = useState({ nome: "", preco: "" });
  const [aberto, setAberto] = useState(grupo.opcoes.length === 0);
  const sb = supabaseNavegador();

  const salvarGrupo = async (campos: Partial<GrupoOpcoes>, msg: string | null = "Grupo salvo") => {
    if (await salvar(sb.from("grupos_opcoes").update(campos).eq("id", grupo.id), msg)) onMudou();
  };

  const aplicarRegras = (obrig: boolean, max: string) => {
    const m = Math.max(1, Math.min(20, Number(max) || 1));
    void salvarGrupo({ minimo: obrig ? 1 : 0, maximo: m }, null);
  };

  const adicionarOpcao = async () => {
    const preco = paraCentavos(novaOpcao.preco || "0");
    if (!novaOpcao.nome.trim() || preco === null) return toast.error("Informe nome e preço do adicional.");
    const ok = await salvar(
      sb.from("opcoes").insert({ grupo_id: grupo.id, nome: novaOpcao.nome.trim(), preco, ordem: grupo.opcoes.length }),
      "Adicional criado",
    );
    if (ok) {
      setNovaOpcao({ nome: "", preco: "" });
      onMudou();
    }
  };

  return (
    <details className="group/adicionais rounded-xl border border-borda bg-superficie-2" open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="size-4 shrink-0 text-suave transition-transform group-open/adicionais:rotate-180" />
        <span className="min-w-0 flex-1 font-semibold">{grupo.nome}</span>
        <span className="text-xs text-suave">{grupo.opcoes.length} opções · {grupo.minimo > 0 ? "Obrigatório" : "Opcional"}</span>
      </summary>
      <div className="border-t border-borda p-2.5">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`g-${grupo.id}`}>
          Nome do grupo
        </label>
        <Input
          id={`g-${grupo.id}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome.trim() && nome !== grupo.nome && void salvarGrupo({ nome: nome.trim() })}
          className="h-8 text-sm font-bold"
          maxLength={60}
        />
        <Confirmar
          titulo="Apagar grupo?"
          descricao={`“${grupo.nome}” e seus adicionais serão apagados.`}
          rotuloConfirmar="Apagar"
          onConfirmar={async () => {
            if (await salvar(sb.from("grupos_opcoes").delete().eq("id", grupo.id), "Grupo apagado")) onMudou();
          }}
        >
          <Button type="button" variant="fantasma" size="icone-sm" aria-label={`Apagar grupo ${grupo.nome}`}>
            <Trash2 />
          </Button>
        </Confirmar>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs">
        <label className="flex items-center gap-2">
          <Interruptor
            checked={obrigatorio}
            onCheckedChange={(v) => {
              setObrigatorio(v);
              aplicarRegras(v, maximo);
            }}
            label={`Escolha obrigatória em ${grupo.nome}`}
          />
          Obrigatório
        </label>
        <label className="flex items-center gap-2">
          Escolher até
          <Input
            type="number"
            min={1}
            max={20}
            value={maximo}
            onChange={(e) => setMaximo(e.target.value)}
            onBlur={() => aplicarRegras(obrigatorio, maximo)}
            className="h-8 w-14 px-2 text-center text-sm"
            aria-label={`Máximo de escolhas em ${grupo.nome}`}
          />
        </label>
      </div>

      <ul className="mt-2 space-y-1">
        {grupo.opcoes.map((o) => (
          <LinhaOpcao key={`${o.id}-${o.nome}-${o.preco}-${o.componente_id}-${o.quantidade_consumo}`} opcao={o} bases={bases} onMudou={onMudou} />
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`no-${grupo.id}`}>
          Nome do novo adicional
        </label>
        <Input
          id={`no-${grupo.id}`}
          placeholder="Novo adicional (ex.: Baly)"
          value={novaOpcao.nome}
          onChange={(e) => setNovaOpcao((x) => ({ ...x, nome: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void adicionarOpcao())}
          className="h-8 min-w-0 text-sm"
          maxLength={60}
        />
        <label className="sr-only" htmlFor={`np-${grupo.id}`}>
          Preço do novo adicional
        </label>
        <div className="flex w-24 shrink-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs text-suave" aria-hidden="true">+R$</span>
          <Input
            id={`np-${grupo.id}`}
            inputMode="decimal"
            placeholder="3,00"
            value={novaOpcao.preco}
            onChange={(e) => setNovaOpcao((x) => ({ ...x, preco: e.target.value.replace(/[^\d,.]/g, "") }))}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void adicionarOpcao())}
            className="h-8 min-w-0 flex-1 px-2 font-mono text-sm"
          />
        </div>
        <Button type="button" size="icone-sm" onClick={adicionarOpcao} aria-label={`Adicionar opção em ${grupo.nome}`}>
          <Plus />
        </Button>
      </div>
      </div>
    </details>
  );
}

function LinhaOpcao({ opcao, bases, onMudou }: { opcao: Opcao; bases: Produto[]; onMudou: () => void }) {
  const [nome, setNome] = useState(opcao.nome);
  const [componente, setComponente] = useState(opcao.componente_id ?? "");
  const [quantidade, setQuantidade] = useState(String(opcao.quantidade_consumo ?? 1));
  const [buscaBase, setBuscaBase] = useState("");
  const base = bases.find((p) => p.id === componente);
  const filtradas = bases.filter((p) => p.id === componente || p.nome.toLocaleLowerCase().includes(buscaBase.toLocaleLowerCase()));
  const [preco, setPreco] = useState(centavosParaCampo(opcao.preco));
  const [disponivel, setDisponivel] = useState(opcao.disponivel);
  const sb = supabaseNavegador();

  const salvarCampos = async (campos: Partial<Opcao>, msg: string | null = null) => {
    if (await salvar(sb.from("opcoes").update(campos).eq("id", opcao.id), msg)) onMudou();
  };

  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-lg bg-superficie px-2 py-1">
      <label className="sr-only" htmlFor={`on-${opcao.id}`}>
        Nome do adicional
      </label>
      <Input
        id={`on-${opcao.id}`}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => nome.trim() && nome !== opcao.nome && void salvarCampos({ nome: nome.trim() }, "Adicional salvo")}
        className="h-8 min-w-0 flex-1 px-2 text-sm"
        maxLength={60}
      />
      <label className="sr-only" htmlFor={`op-${opcao.id}`}>
        Preço de {opcao.nome}
      </label>
      <div className="flex w-24 shrink-0 items-center gap-1.5">
        <span className="shrink-0 font-mono text-xs text-suave" aria-hidden="true">+R$</span>
        <Input
          id={`op-${opcao.id}`}
          inputMode="decimal"
          value={preco}
          onChange={(e) => setPreco(e.target.value.replace(/[^\d,.]/g, ""))}
          onBlur={() => {
            const c = paraCentavos(preco || "0");
            if (c !== null && c !== opcao.preco) void salvarCampos({ preco: c }, `${opcao.nome}: ${formatarPreco(c)}`);
          }}
          className="h-8 min-w-0 flex-1 px-2 font-mono text-sm"
        />
      </div>
      <Interruptor
        checked={disponivel}
        onCheckedChange={(v) => {
          setDisponivel(v);
          void salvarCampos({ disponivel: v });
        }}
        label={`${opcao.nome} disponível`}
      />
      <Button
        type="button"
        variant="fantasma"
        size="icone-sm"
        aria-label={`Apagar ${opcao.nome}`}
        onClick={async () => {
          if (await salvar(sb.from("opcoes").delete().eq("id", opcao.id), "Adicional apagado")) onMudou();
        }}
      >
        <Trash2 />
      </Button>
      <details className="basis-full border-t border-borda pt-1 text-xs">
        <summary className="cursor-pointer text-suave">Baixa no estoque{opcao.componente_id ? ` · ${opcao.quantidade_consumo} ${base?.unidade_estoque ?? "un"} de ${base?.nome ?? "ingrediente"}` : " · sem vínculo"}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
          <div className="space-y-2">
            <Input className="h-8 text-sm" type="search" placeholder="Pesquisar ingrediente…" aria-label={`Pesquisar ingrediente de ${opcao.nome}`} value={buscaBase} onChange={(e) => setBuscaBase(e.target.value)} />
            <Select className="h-8 text-sm" aria-label={`Ingrediente de ${opcao.nome}`} value={componente} onChange={(e) => setComponente(e.target.value)}><option value="">Sem baixa de ingrediente</option>{filtradas.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.unidade_estoque ?? "un"}</option>)}</Select>
          </div>
          <div><label htmlFor={`consumo-${opcao.id}`} className="mb-1 block text-suave">Consumo ({base?.unidade_estoque ?? "un"})</label><Input className="h-8 text-sm" id={`consumo-${opcao.id}`} type="number" min={1} max={1000000} step={1} disabled={!componente} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} /></div>
          <Button type="button" variant="suave" size="sm" onClick={() => {
            const n = Number(quantidade);
            if (componente && (!Number.isInteger(n) || n < 1 || n > 1000000)) return toast.error("Informe um consumo inteiro positivo.");
            void salvarCampos({ componente_id: componente || null, quantidade_consumo: componente ? n : null }, "Consumo salvo");
          }}>Salvar consumo</Button>
        </div>
        <p className="mt-2 text-suave">Baixa somente o ingrediente escolhido, na quantidade informada por copão. O preço acima é o acréscimo cobrado do cliente.</p>
      </details>
    </li>
  );
}
