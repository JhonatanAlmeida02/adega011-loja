"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfiguracoes } from "@/lib/admin/config";
import { salvar, useTabela } from "@/lib/admin/dados";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Configuracoes, RegiaoEntrega } from "@/lib/tipos";
import { centavosParaCampo, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Cartao, Confirmar, LinhaInterruptor, Vazio } from "../ui";

export function PaginaEntrega() {
  const { config, gravar } = useConfiguracoes();
  const regioes = useTabela<RegiaoEntrega>("regioes_entrega");

  if (!config || regioes.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina titulo="Entrega" descricao="Regiões com taxa, pedido mínimo e modos de entrega." />
      <RegrasGerais config={config} gravar={gravar} />
      <Regioes {...regioes} />
    </>
  );
}

function RegrasGerais({
  config,
  gravar,
}: {
  config: Configuracoes;
  gravar: (c: Partial<Configuracoes>) => Promise<boolean>;
}) {
  const [minimo, setMinimo] = useState(centavosParaCampo(config.pedido_minimo));
  const [tempo, setTempo] = useState(config.tempo_entrega);
  const [erro, setErro] = useState("");

  const salvarRegras = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = minimo.trim() ? paraCentavos(minimo) : 0;
    if (valor === null) return setErro("Valor inválido (ex.: 30,00).");
    setErro("");
    await gravar({ pedido_minimo: valor, tempo_entrega: tempo.trim() });
  };

  return (
    <Cartao className="mb-6">
      <form onSubmit={salvarRegras} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Campo label="Pedido mínimo (R$)" htmlFor="minimo" erro={erro} ajuda="0 = sem mínimo">
          <Input
            id="minimo"
            inputMode="decimal"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value.replace(/[^\d,.]/g, ""))}
            className="font-mono"
          />
        </Campo>
        <Campo label="Tempo de entrega" htmlFor="tempo" ajuda="Aparece no topo da loja">
          <Input id="tempo" placeholder="30–50 min" value={tempo} onChange={(e) => setTempo(e.target.value)} maxLength={30} />
        </Campo>
        <Button type="submit" className="sm:mb-7">
          Salvar
        </Button>
      </form>
      <div className="mt-2 divide-y divide-borda border-t border-borda">
        <LinhaInterruptor
          rotulo="Fazemos entrega"
          checked={config.aceita_entrega}
          onChange={(v) => {
            if (!v && !config.aceita_retirada) return void gravar({ aceita_entrega: false, aceita_retirada: true });
            void gravar({ aceita_entrega: v });
          }}
        />
        <LinhaInterruptor
          rotulo="Retirada na loja"
          checked={config.aceita_retirada}
          onChange={(v) => {
            if (!v && !config.aceita_entrega) return void gravar({ aceita_retirada: false, aceita_entrega: true });
            void gravar({ aceita_retirada: v });
          }}
        />
      </div>
    </Cartao>
  );
}

function Regioes({
  dados,
  setDados,
}: {
  dados: RegiaoEntrega[];
  setDados: React.Dispatch<React.SetStateAction<RegiaoEntrega[]>>;
}) {
  const [nome, setNome] = useState("");
  const [taxa, setTaxa] = useState("");

  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const centavos = paraCentavos(taxa || "0");
    if (!nome.trim() || centavos === null) return;
    const resp = await supabaseNavegador()
      .from("regioes_entrega")
      .insert({ nome: nome.trim(), taxa: centavos, ordem: dados.length, ativa: true })
      .select()
      .single();
    if (await salvar(Promise.resolve(resp), "Região adicionada")) {
      setDados((l) => [...l, resp.data as RegiaoEntrega]);
      setNome("");
      setTaxa("");
    }
  };

  const atualizar = async (r: RegiaoEntrega, campos: Partial<RegiaoEntrega>, msg: string | null = "Região salva") => {
    setDados((l) => l.map((x) => (x.id === r.id ? { ...x, ...campos } : x)));
    const ok = await salvar(supabaseNavegador().from("regioes_entrega").update(campos).eq("id", r.id), msg);
    if (!ok) setDados((l) => l.map((x) => (x.id === r.id ? r : x)));
  };

  const reordenar = async (novos: RegiaoEntrega[]) => {
    const comOrdem = novos.map((r, i) => ({ ...r, ordem: i }));
    setDados(comOrdem);
    const sb = supabaseNavegador();
    await salvar(
      Promise.all(comOrdem.map((r) => sb.from("regioes_entrega").update({ ordem: r.ordem }).eq("id", r.id))).then((rs) => ({
        error: rs.find((x) => x.error)?.error ?? null,
      })),
      "Ordem salva",
    );
  };

  const excluir = async (r: RegiaoEntrega) => {
    if (await salvar(supabaseNavegador().from("regioes_entrega").delete().eq("id", r.id), "Região removida")) {
      setDados((l) => l.filter((x) => x.id !== r.id));
    }
  };

  return (
    <>
      <h2 className="titulo mb-3 text-3xl">Regiões e taxas</h2>
      <Cartao className="mb-4">
        <form onSubmit={adicionar} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Campo label="Região / bairros" htmlFor="r-nome">
            <Input id="r-nome" placeholder="Ex.: Pinheiros e Vila Madalena" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
          </Campo>
          <Campo label="Taxa (R$)" htmlFor="r-taxa">
            <Input id="r-taxa" inputMode="decimal" placeholder="5,00" value={taxa} onChange={(e) => setTaxa(e.target.value.replace(/[^\d,.]/g, ""))} className="font-mono" />
          </Campo>
          <Button type="submit" disabled={!nome.trim()}>
            <Plus /> Adicionar
          </Button>
        </form>
      </Cartao>

      {dados.length === 0 ? (
        <Vazio titulo="Nenhuma região" texto="Sem regiões ativas o cliente só consegue escolher retirada." />
      ) : (
        <ListaOrdenavel
          itens={dados}
          rotulo={(r) => r.nome}
          onReordenar={reordenar}
          renderizar={(r) => <LinhaRegiao key={`${r.id}-${r.nome}-${r.taxa}`} regiao={r} onSalvar={atualizar} onExcluir={excluir} />}
        />
      )}
    </>
  );
}

function LinhaRegiao({
  regiao: r,
  onSalvar,
  onExcluir,
}: {
  regiao: RegiaoEntrega;
  onSalvar: (r: RegiaoEntrega, c: Partial<RegiaoEntrega>, msg?: string | null) => void;
  onExcluir: (r: RegiaoEntrega) => void;
}) {
  const [nome, setNome] = useState(r.nome);
  const [taxa, setTaxa] = useState(centavosParaCampo(r.taxa));
  const centavos = paraCentavos(taxa || "0");
  const mudou = nome.trim() !== r.nome || centavos !== r.taxa;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim() && centavos !== null) onSalvar(r, { nome: nome.trim(), taxa: centavos });
      }}
    >
      <label htmlFor={`rn-${r.id}`} className="sr-only">
        Nome da região
      </label>
      <Input id={`rn-${r.id}`} value={nome} onChange={(e) => setNome(e.target.value)} className="h-11 min-w-0 flex-[2_1_10rem]" maxLength={80} />
      <label htmlFor={`rt-${r.id}`} className="sr-only">
        Taxa de {r.nome} em reais
      </label>
      <div className="relative flex-[1_1_6rem]">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-suave">R$</span>
        <Input id={`rt-${r.id}`} inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value.replace(/[^\d,.]/g, ""))} className="h-11 pl-10 font-mono" />
      </div>
      {mudou ? (
        <Button type="submit" size="sm" className="h-11" aria-label={`Salvar ${r.nome}`}>
          Salvar
        </Button>
      ) : (
        <span className="preco hidden w-20 text-right text-sm sm:inline">{formatarPreco(r.taxa)}</span>
      )}
      <Interruptor checked={r.ativa} onCheckedChange={(v) => onSalvar(r, { ativa: v }, null)} label={`Região ${r.nome} ativa`} />
      <Confirmar titulo="Remover região?" descricao={`“${r.nome}” deixa de aparecer no checkout.`} rotuloConfirmar="Remover" onConfirmar={() => onExcluir(r)}>
        <Button type="button" variant="fantasma" size="icone" aria-label={`Remover ${r.nome}`}>
          <Trash2 />
        </Button>
      </Confirmar>
    </form>
  );
}
