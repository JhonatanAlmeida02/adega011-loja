"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { salvar } from "@/lib/admin/dados";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { GrupoOpcoes, Opcao } from "@/lib/tipos";
import { centavosParaCampo, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor } from "@/components/ui/campos";
import { Confirmar } from "./ui";

/**
 * Grupos de adicionais de um produto (ex.: "Energético": Baly +3, Red Bull +7).
 * Cada mudança é salva na hora.
 */
export function EditorAdicionais({ produtoId }: { produtoId: string }) {
  const [grupos, setGrupos] = useState<GrupoOpcoes[] | null>(null);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador()
      .from("grupos_opcoes")
      .select("id,produto_id,nome,minimo,maximo,ordem,opcoes(id,grupo_id,nome,preco,disponivel,ordem)")
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
    <div className="space-y-4">
      {grupos.length === 0 && (
        <p className="text-sm text-suave">
          Sem adicionais. Ex.: no “Copão”, crie o grupo “Energético” com Baly (+ R$ 3,00) e Red Bull (+ R$ 7,00).
        </p>
      )}
      {grupos.map((g) => (
        <Grupo key={`${g.id}-${g.nome}-${g.minimo}-${g.maximo}`} grupo={g} onMudou={recarregar} />
      ))}
      <Button type="button" variant="suave" size="sm" onClick={novoGrupo}>
        <Plus /> Novo grupo de adicionais
      </Button>
    </div>
  );
}

function Grupo({ grupo, onMudou }: { grupo: GrupoOpcoes; onMudou: () => void }) {
  const [nome, setNome] = useState(grupo.nome);
  const [obrigatorio, setObrigatorio] = useState(grupo.minimo > 0);
  const [maximo, setMaximo] = useState(String(grupo.maximo));
  const [novaOpcao, setNovaOpcao] = useState({ nome: "", preco: "" });
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
    <div className="rounded-2xl border border-borda bg-superficie-2 p-3">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`g-${grupo.id}`}>
          Nome do grupo
        </label>
        <Input
          id={`g-${grupo.id}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome.trim() && nome !== grupo.nome && void salvarGrupo({ nome: nome.trim() })}
          className="h-11 font-bold"
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
          <Button type="button" variant="fantasma" size="icone" aria-label={`Apagar grupo ${grupo.nome}`}>
            <Trash2 />
          </Button>
        </Confirmar>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-sm">
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
            className="h-10 w-16 px-2 text-center"
            aria-label={`Máximo de escolhas em ${grupo.nome}`}
          />
        </label>
      </div>

      <ul className="mt-3 space-y-1.5">
        {grupo.opcoes.map((o) => (
          <LinhaOpcao key={`${o.id}-${o.nome}-${o.preco}`} opcao={o} onMudou={onMudou} />
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
          className="h-11"
          maxLength={60}
        />
        <label className="sr-only" htmlFor={`np-${grupo.id}`}>
          Preço do novo adicional
        </label>
        <div className="relative w-28 shrink-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-suave">+R$</span>
          <Input
            id={`np-${grupo.id}`}
            inputMode="decimal"
            placeholder="3,00"
            value={novaOpcao.preco}
            onChange={(e) => setNovaOpcao((x) => ({ ...x, preco: e.target.value.replace(/[^\d,.]/g, "") }))}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void adicionarOpcao())}
            className="h-11 pl-11 font-mono"
          />
        </div>
        <Button type="button" size="icone" onClick={adicionarOpcao} aria-label={`Adicionar opção em ${grupo.nome}`}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function LinhaOpcao({ opcao, onMudou }: { opcao: Opcao; onMudou: () => void }) {
  const [nome, setNome] = useState(opcao.nome);
  const [preco, setPreco] = useState(centavosParaCampo(opcao.preco));
  const [disponivel, setDisponivel] = useState(opcao.disponivel);
  const sb = supabaseNavegador();

  const salvarCampos = async (campos: Partial<Opcao>, msg: string | null = null) => {
    if (await salvar(sb.from("opcoes").update(campos).eq("id", opcao.id), msg)) onMudou();
  };

  return (
    <li className="flex items-center gap-2 rounded-xl bg-superficie px-2 py-1.5">
      <label className="sr-only" htmlFor={`on-${opcao.id}`}>
        Nome do adicional
      </label>
      <Input
        id={`on-${opcao.id}`}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => nome.trim() && nome !== opcao.nome && void salvarCampos({ nome: nome.trim() }, "Adicional salvo")}
        className="h-10 flex-1"
        maxLength={60}
      />
      <label className="sr-only" htmlFor={`op-${opcao.id}`}>
        Preço de {opcao.nome}
      </label>
      <div className="relative w-28 shrink-0">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-suave">+R$</span>
        <Input
          id={`op-${opcao.id}`}
          inputMode="decimal"
          value={preco}
          onChange={(e) => setPreco(e.target.value.replace(/[^\d,.]/g, ""))}
          onBlur={() => {
            const c = paraCentavos(preco || "0");
            if (c !== null && c !== opcao.preco) void salvarCampos({ preco: c }, `${opcao.nome}: ${formatarPreco(c)}`);
          }}
          className="h-10 pl-11 font-mono"
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
    </li>
  );
}
