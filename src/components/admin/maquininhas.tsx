"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { calcularTarifa, formatarPercentual, paraPontosBase, pontosBaseParaCampo, type Maquininha } from "@/lib/tarifas";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor } from "@/components/ui/campos";
import { Cartao, Confirmar } from "./ui";

type Rascunho = { id: string; nome: string; taxa: string; padrao: boolean; ativa: boolean };

const EXEMPLO = 10000; // R$ 100,00

/** Configurações › Maquininhas e taxas: cadastro das maquininhas com a % de cada uma e a % do Pix. */
export function TaxasPagamento() {
  const [maquininhas, setMaquininhas] = useState<Maquininha[] | null>(null);
  const [pixBp, setPixBp] = useState<number | null>(null);
  const [pix, setPix] = useState("");
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    void Promise.all([
      sb.from("maquininhas").select("id,nome,taxa_bp,padrao,ativa").order("nome"),
      sb.from("financeiro_config").select("taxa_pix_bp").eq("id", 1).maybeSingle<{ taxa_pix_bp: number }>(),
    ]).then(([m, c]) => {
      if (!ativo) return;
      if (m.error || c.error) toast.error("Não foi possível carregar as maquininhas.");
      const lista = ((m.data ?? []) as Maquininha[]).sort((a, b) => Number(b.padrao) - Number(a.padrao) || Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome, "pt-BR"));
      setMaquininhas(lista);
      const bp = c.data?.taxa_pix_bp ?? 0;
      setPixBp(bp);
      setPix(pontosBaseParaCampo(bp));
    });
    return () => { ativo = false; };
  }, [versao]);

  const salvarPix = async (e: React.FormEvent) => {
    e.preventDefault();
    const bp = paraPontosBase(pix);
    if (bp === null) return void toast.error("Informe a taxa do Pix entre 0 e 100%, ex.: 0,99.");
    const { error } = await supabaseNavegador().rpc("salvar_taxa_pix", { p_taxa_bp: bp });
    if (error) return void toast.error(error.message);
    setPixBp(bp);
    setPix(pontosBaseParaCampo(bp));
    toast.success(bp ? `Taxa do Pix: ${formatarPercentual(bp)}` : "Pix sem taxa");
  };

  const salvarMaquininha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando || salvando) return;
    const bp = paraPontosBase(editando.taxa);
    if (!editando.nome.trim()) return void toast.error("Informe o nome da maquininha.");
    if (bp === null) return void toast.error("Informe a taxa entre 0 e 100%, ex.: 2,99.");
    setSalvando(true);
    const { error } = await supabaseNavegador().rpc("salvar_maquininha", {
      p_id: editando.id, p_nome: editando.nome.trim(), p_taxa_bp: bp, p_padrao: editando.padrao, p_ativa: editando.ativa,
    });
    setSalvando(false);
    if (error) return void toast.error(error.message);
    toast.success(`Maquininha ${editando.nome.trim()} salva`);
    setEditando(null);
    recarregar();
  };

  const excluir = async (m: Maquininha) => {
    const { error } = await supabaseNavegador().rpc("excluir_maquininha", { p_id: m.id });
    if (error) return void toast.error(error.message);
    toast.success(`${m.nome} excluída`);
    recarregar();
  };

  const nova = () => setEditando({ id: crypto.randomUUID(), nome: "", taxa: "", padrao: !maquininhas?.some((m) => m.padrao && m.ativa), ativa: true });
  const bpRascunho = editando ? paraPontosBase(editando.taxa) : null;

  return (
    <Cartao>
      <h2 className="titulo mb-1 text-3xl">Maquininhas e taxas</h2>
      <p className="mb-4 text-sm text-suave">
        A porcentagem que cada forma de pagamento cobra. O PDV mostra quanto a loja recebe, e o financeiro lança o valor que cai de fato
        (ex.: venda de R$ 100,00 com taxa de 10% → entram R$ 90,00).
      </p>

      {maquininhas === null ? <p className="text-sm text-suave">Carregando…</p> : (
        <ul aria-label="Maquininhas" className="divide-y divide-borda rounded-xl border border-borda">
          {maquininhas.length === 0 && <li className="p-3 text-sm text-suave">Nenhuma maquininha cadastrada. Vendas no cartão ficam sem taxa.</li>}
          {maquininhas.map((m) => (
            <li key={m.id} className={cn("flex flex-wrap items-center gap-3 p-3", !m.ativa && "opacity-60")}>
              <CreditCard className="size-5 shrink-0 text-suave" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {m.nome}
                  {m.padrao && <span className="rounded bg-rosa/15 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-rosa-texto">Padrão</span>}
                  {!m.ativa && <span className="rounded bg-superficie-3 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-suave">Inativa</span>}
                </p>
                <p className="text-sm text-suave">
                  Taxa {formatarPercentual(m.taxa_bp)} · venda de {formatarPreco(EXEMPLO)} → recebe {formatarPreco(EXEMPLO - calcularTarifa(EXEMPLO, m.taxa_bp))}
                </p>
              </div>
              <Button size="sm" variant="suave" aria-label={`Editar ${m.nome}`}
                onClick={() => setEditando({ id: m.id, nome: m.nome, taxa: pontosBaseParaCampo(m.taxa_bp), padrao: m.padrao, ativa: m.ativa ?? true })}>
                <Pencil /> Editar
              </Button>
              <Confirmar titulo={`Excluir ${m.nome}?`} descricao="As vendas antigas continuam com o nome e a taxa que tinham." onConfirmar={() => excluir(m)}>
                <Button size="icone-sm" variant="fantasma" aria-label={`Excluir ${m.nome}`} title="Excluir"><Trash2 /></Button>
              </Confirmar>
            </li>
          ))}
        </ul>
      )}

      {editando ? (
        <form onSubmit={salvarMaquininha} aria-label="Maquininha" className="mt-3 space-y-3 rounded-xl border border-rosa/40 bg-superficie-2 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Nome da maquininha" htmlFor="maq-nome" ajuda="Ex.: Stone crédito, Moderninha débito.">
              <Input id="maq-nome" required maxLength={40} autoFocus value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
            </Campo>
            <Campo label="Taxa (%)" htmlFor="maq-taxa"
              ajuda={bpRascunho != null ? `Venda de ${formatarPreco(EXEMPLO)} → loja recebe ${formatarPreco(EXEMPLO - calcularTarifa(EXEMPLO, bpRascunho))}` : "Use vírgula: 2,99"}>
              <Input id="maq-taxa" inputMode="decimal" required placeholder="2,99" maxLength={6} className="font-mono" value={editando.taxa}
                onChange={(e) => setEditando({ ...editando, taxa: e.target.value.replace(/[^\d,.]/g, "") })} aria-invalid={bpRascunho === null} />
            </Campo>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Interruptor checked={editando.padrao} onCheckedChange={(v) => setEditando({ ...editando, padrao: v })} label="Padrão" />
              Padrão <span className="text-suave">(usada nos pedidos do site pagos no cartão)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Interruptor checked={editando.ativa} onCheckedChange={(v) => setEditando({ ...editando, ativa: v })} label="Ativa" />
              Ativa
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar maquininha"}</Button>
            <Button type="button" variant="suave" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <Button variant="suave" className="mt-3" onClick={nova}><Plus /> Adicionar maquininha</Button>
      )}

      <form onSubmit={salvarPix} className="mt-6 flex flex-wrap items-end gap-3 border-t border-borda pt-4">
        <Campo label="Taxa do Pix (%)" htmlFor="taxa-pix" className="w-64"
          ajuda={pixBp ? `Venda de ${formatarPreco(EXEMPLO)} → recebe ${formatarPreco(EXEMPLO - calcularTarifa(EXEMPLO, pixBp))}` : "0 = sem taxa"}>
          <Input id="taxa-pix" inputMode="decimal" placeholder="0" maxLength={6} className="font-mono" value={pix} onChange={(e) => setPix(e.target.value.replace(/[^\d,.]/g, ""))} />
        </Campo>
        <Button type="submit" variant="suave" className="mb-[1.6rem]">Salvar taxa do Pix</Button>
      </form>
    </Cartao>
  );
}
