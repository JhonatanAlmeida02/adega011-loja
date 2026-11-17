"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { bip, Campo, CampoLeitura, CampoNumero, Estado, Mensagem, Painel, qtd, Tabela, Titulo, type CampoLeituraRef, type Leitura } from "@/components/wms/ui";
import { EtiquetaVolume } from "@/components/wms/etiqueta";

type Det = {
  order: { id: string; number: string; status: string };
  items: { id: string; kind: string; sku: string; description: string; quantity: number }[];
  reservations: { order_item_id: string; status: string; quantity: number }[];
  packages: { id: string; label_code: string; status: string; items: { id: string; sku: string; quantity: number }[] }[];
};

export default function ConferenciaPedido({ id }: { id: string }) {
  const det = useDados<Det>(`orders/${id}`);
  const { executar, enviando, mensagem } = useComando();
  const leitor = useRef<CampoLeituraRef>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [lote, setLote] = useState("");
  const [serie, setSerie] = useState("");
  const [peso, setPeso] = useState(0);
  const o = det.dados?.order;
  const aberto = det.dados?.packages.find((p) => p.status === "open");
  const recarregar = () => void det.recarregar();

  const ler = async (l: Leitura) => {
    if (!aberto) return;
    const r = await executar<{ sku: string; quantity_base: number; line_remaining: number }>(`packages/${aberto.id}/scan`, {
      scan_id: l.scanId, code: l.codigo, quantity: l.quantidade ?? quantidade, lot_code: l.lote ?? (lote || null), serial: l.serie ?? (serie || null),
    }, { ok: (x) => `${x.sku}: +${qtd(x.quantity_base)} no volume. Faltam ${qtd(x.line_remaining)} desta linha.`, chave: l.scanId });
    bip(Boolean(r));
    if (r) { setSerie(""); setQuantidade(1); recarregar(); }
    leitor.current?.focar();
  };

  if (!o) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const separado = (item: string) => det.dados!.reservations.filter((r) => r.order_item_id === item && r.status === "staged").reduce((a, r) => a + Number(r.quantity), 0);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Titulo titulo={`Conferência · pedido ${o.number}`} acoes={<Estado valor={o.status} />} />
      <Mensagem m={mensagem} />
      {o.status === "picked" && <Button size="lg" className="h-14" disabled={enviando} onClick={async () => { await executar(`orders/${id}/packing/start`, {}, { ok: "Conferência iniciada." }); recarregar(); }}>Iniciar conferência</Button>}
      {o.status === "checking" && (
        <>
          {!aberto && <Button size="lg" className="h-14" disabled={enviando} onClick={async () => { await executar(`orders/${id}/packages`, {}, { ok: (r: { label_code: string }) => `Volume ${r.label_code} aberto.` }); recarregar(); }}>Abrir volume</Button>}
          {aberto && (
            <Painel titulo={`Volume aberto ${aberto.label_code}`}>
              <div className="grid gap-3 sm:grid-cols-3">
                <CampoNumero id="q" rotulo="Quantidade (unidade lida)" valor={quantidade} onChange={setQuantidade} />
                <Campo id="lote" rotulo="Lote" value={lote} onChange={(e) => setLote(e.target.value)} />
                <Campo id="serie" rotulo="Série" value={serie} onChange={(e) => setSerie(e.target.value)} />
              </div>
              <div className="mt-3"><CampoLeitura ref={leitor} id="leitura" rotulo="Leia o item" onLeitura={(l) => void ler(l)} desabilitado={enviando} /></div>
              <ul className="mt-3 text-sm">{aberto.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between border-b border-borda/60 py-1">{i.sku} × {qtd(i.quantity)}
                  <Button size="sm" variant="fantasma" onClick={async () => { const m = prompt("Motivo da retirada do volume:"); if (m) { await executar(`package-items/${i.id}/remove`, { quantity: i.quantity, reason: m }, { ok: "Item retirado do volume.", chave: crypto.randomUUID() }); recarregar(); } }}>Retirar</Button>
                </li>))}</ul>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <CampoNumero id="peso" rotulo="Peso (kg, informado)" valor={peso} onChange={setPeso} passo={0.01} />
                <Button disabled={enviando || !aberto.items.length} onClick={async () => { await executar(`packages/${aberto.id}/close`, { weight_kg: peso > 0 ? peso : null }, { ok: "Volume fechado." }); recarregar(); }}>Fechar volume</Button>
              </div>
            </Painel>
          )}
          <Button size="lg" variant="destaque" className="h-14" disabled={enviando || Boolean(aberto)} onClick={async () => { await executar(`orders/${id}/packing/complete`, {}, { ok: "Conferência concluída: pedido embalado." }); recarregar(); }}>Concluir conferência</Button>
        </>
      )}
      <Painel titulo="Itens do pedido">
        <Tabela colunas={[{ titulo: "Produto" }, { titulo: "Pedido" }, { titulo: "Separado" }]}
          linhas={det.dados!.items.filter((i) => i.kind !== "kit_parent").map((i) => ({ chave: i.id, celulas: [`${i.sku} · ${i.description}`, qtd(i.quantity), qtd(separado(i.id))] }))} />
      </Painel>
      {det.dados!.packages.filter((p) => p.status === "closed").map((p) => <EtiquetaVolume key={p.id} pacote={p} pedido={o.number} onImpresso={recarregar} />)}
    </div>
  );
}
