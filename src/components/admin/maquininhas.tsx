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

type Rascunho = { id: string; nome: string; debito: string; credito: string; padrao_pdv: boolean; padrao_site: boolean; ativa: boolean };

/** "R$ 100,00 → recebe R$ 98,63" */
const recebe = (bp: number) => `recebe ${formatarPreco(EXEMPLO - calcularTarifa(EXEMPLO, bp))}`;
const Selo = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded bg-rosa/15 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-rosa-texto">{children}</span>
);

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
      sb.from("maquininhas").select("id,nome,taxa_debito_bp,taxa_credito_bp,padrao_pdv,padrao_site,ativa").order("nome"),
      sb.from("financeiro_config").select("taxa_pix_bp").eq("id", 1).maybeSingle<{ taxa_pix_bp: number }>(),
    ]).then(([m, c]) => {
      if (!ativo) return;
      if (m.error || c.error) toast.error("Não foi possível carregar as maquininhas.");
      const lista = ((m.data ?? []) as Maquininha[]).sort((a, b) => Number(b.padrao_pdv) - Number(a.padrao_pdv) || Number(b.padrao_site) - Number(a.padrao_site) || Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome, "pt-BR"));
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
    const debito = paraPontosBase(editando.debito);
    const credito = paraPontosBase(editando.credito);
    if (!editando.nome.trim()) return void toast.error("Informe o nome da maquininha.");
    if (debito === null || credito === null) return void toast.error("Informe as taxas entre 0 e 100%, ex.: 1,37 e 2,99.");
    setSalvando(true);
    const { error } = await supabaseNavegador().rpc("salvar_maquininha", {
      p_id: editando.id, p_nome: editando.nome.trim(), p_taxa_debito_bp: debito, p_taxa_credito_bp: credito,
      p_padrao_pdv: editando.padrao_pdv, p_padrao_site: editando.padrao_site, p_ativa: editando.ativa,
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

  // A primeira maquininha já vem como padrão do PDV e do site
  const nova = () => setEditando({
    id: crypto.randomUUID(), nome: "", debito: "", credito: "",
    padrao_pdv: !maquininhas?.some((m) => m.padrao_pdv && m.ativa), padrao_site: !maquininhas?.some((m) => m.padrao_site && m.ativa), ativa: true,
  });
  const bpDebito = editando ? paraPontosBase(editando.debito) : null;
  const bpCredito = editando ? paraPontosBase(editando.credito) : null;

  return (
    <Cartao>
      <h2 className="titulo mb-1 text-3xl">Maquininhas e taxas</h2>
      <p className="mb-4 text-sm text-suave">
        A porcentagem que cada forma de pagamento cobra. O PDV mostra quanto a loja recebe, e o financeiro lança o valor que cai de fato
        (ex.: venda de R$ 100,00 com taxa de 10% → entram R$ 90,00). Cada maquininha tem a taxa do débito e a do crédito.
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
                  {m.padrao_pdv && <Selo>Padrão PDV</Selo>}
                  {m.padrao_site && <Selo>Padrão site</Selo>}
                  {!m.ativa && <span className="rounded bg-superficie-3 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-suave">Inativa</span>}
                </p>
                <p className="text-sm text-suave">
                  Débito {formatarPercentual(m.taxa_debito_bp)} · Crédito {formatarPercentual(m.taxa_credito_bp)}
                  <span className="block text-xs">Venda de {formatarPreco(EXEMPLO)}: débito {recebe(m.taxa_debito_bp)} · crédito {recebe(m.taxa_credito_bp)}</span>
                </p>
              </div>
              <Button size="sm" variant="suave" aria-label={`Editar ${m.nome}`}
                onClick={() => setEditando({
                  id: m.id, nome: m.nome, debito: pontosBaseParaCampo(m.taxa_debito_bp), credito: pontosBaseParaCampo(m.taxa_credito_bp),
                  padrao_pdv: m.padrao_pdv, padrao_site: m.padrao_site, ativa: m.ativa ?? true,
                })}>
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
          <Campo label="Nome da maquininha" htmlFor="maq-nome" ajuda="Ex.: Stone, Moderninha, Cielo.">
            <Input id="maq-nome" required maxLength={40} autoFocus value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Taxa no débito (%)" htmlFor="maq-debito"
              ajuda={bpDebito != null ? `Venda de ${formatarPreco(EXEMPLO)} → loja ${recebe(bpDebito)}` : "Use vírgula: 1,37"}>
              <Input id="maq-debito" inputMode="decimal" required placeholder="1,37" maxLength={6} className="font-mono" value={editando.debito}
                onChange={(e) => setEditando({ ...editando, debito: e.target.value.replace(/[^\d,.]/g, "") })} aria-invalid={bpDebito === null} />
            </Campo>
            <Campo label="Taxa no crédito (%)" htmlFor="maq-credito"
              ajuda={bpCredito != null ? `Venda de ${formatarPreco(EXEMPLO)} → loja ${recebe(bpCredito)}` : "Use vírgula: 2,99"}>
              <Input id="maq-credito" inputMode="decimal" required placeholder="2,99" maxLength={6} className="font-mono" value={editando.credito}
                onChange={(e) => setEditando({ ...editando, credito: e.target.value.replace(/[^\d,.]/g, "") })} aria-invalid={bpCredito === null} />
            </Campo>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Interruptor checked={editando.padrao_pdv} onCheckedChange={(v) => setEditando({ ...editando, padrao_pdv: v })} label="Padrão no PDV" />
              Padrão no PDV <span className="text-suave">(já vem escolhida na venda no cartão)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Interruptor checked={editando.padrao_site} onCheckedChange={(v) => setEditando({ ...editando, padrao_site: v })} label="Padrão no site" />
              Padrão no site <span className="text-suave">(pedidos do site pagos no cartão; usa a taxa de crédito)</span>
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
