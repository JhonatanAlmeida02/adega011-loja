"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { bip, Campo, CampoLeitura, CampoNumero, dataHora, Estado, Mensagem, Painel, qtd, Tabela, Titulo, type CampoLeituraRef } from "@/components/wms/ui";

type Det = {
  session: { id: string; code: string; kind: string; status: string; current_round: number; max_rounds: number };
  locations: { code: string; recount_round: number | null }[];
  my_counts: { id: string; location: string; sku: string; counted_qty: number; round: number; counted_at: string }[];
  adjustments: { id: string; status: string; expected_qty: number; counted_qty: number; difference: number; requested_by: string; location: string; sku: string; lot: string | null }[] | null;
};

export default function Inventario({ id }: { id: string }) {
  const { pode, me } = useWms();
  const det = useDados<Det>(`inventory-sessions/${id}`);
  const { executar, enviando, mensagem } = useComando();
  const leitor = useRef<CampoLeituraRef>(null);
  const [local, setLocal] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [lote, setLote] = useState("");
  const [validade, setValidade] = useState("");
  const [motivo, setMotivo] = useState("");
  const s = det.dados?.session;
  const recarregar = () => void det.recarregar();
  if (!s) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const daRodada = det.dados!.locations.filter((l) => s.current_round === 1 || l.recount_round === s.current_round);
  return (
    <div className="space-y-4">
      <Titulo titulo={`Inventário ${s.code}`} descricao={`Rodada ${s.current_round} de ${s.max_rounds}`} acoes={<Estado valor={s.status} />} />
      <Mensagem m={mensagem} />
      {s.status === "draft" && pode("inventory.manage") && (
        <Button size="lg" disabled={enviando} onClick={async () => { await executar(`inventory-sessions/${id}/start`, {}, { ok: "Contagem iniciada: endereços bloqueados." }); recarregar(); }}>Iniciar contagem</Button>
      )}
      {s.status === "counting" && pode("inventory.count") && (
        <Painel titulo="Contar (cego)">
          <p className="mb-2 text-sm">Endereços desta rodada: <strong>{daRodada.map((l) => l.code).join(", ")}</strong></p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo id="loc" rotulo="Endereço" value={local} onChange={(e) => setLocal(e.target.value.toUpperCase())} />
            <CampoNumero id="q" rotulo="Quantidade contada (unidade lida)" valor={quantidade} onChange={setQuantidade} />
            <Campo id="lote" rotulo="Lote" value={lote} onChange={(e) => setLote(e.target.value)} />
            <Campo id="val" rotulo="Validade (se novo lote)" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          </div>
          <div className="mt-3"><CampoLeitura ref={leitor} id="leitura" rotulo="Leia o produto" desabilitado={enviando || !local} onLeitura={async (l) => {
            const r = await executar(`inventory-sessions/${id}/counts`, { count_id: l.scanId, location_code: local, code: l.codigo, quantity: l.quantidade ?? quantidade,
              lot_code: l.lote ?? (lote || null), expiry: l.validade ?? (validade || null) }, { ok: (x: { sku: string; quantity_base: number }) => `Contado: ${x.sku} × ${qtd(x.quantity_base)}.`, chave: l.scanId });
            bip(Boolean(r)); if (r) recarregar(); leitor.current?.focar();
          }} /></div>
          <p className="mt-2 text-xs text-suave">Leituras somam. Se contou errado, registre a correção na rodada seguinte ou peça ao supervisor.</p>
        </Painel>
      )}
      {s.status === "counting" && pode("inventory.manage") && (
        <Button variant="destaque" disabled={enviando} onClick={async () => {
          await executar(`inventory-sessions/${id}/close-round`, {}, { ok: (r: { status: string; recount_locations?: string[]; adjustments?: number }) =>
            r.status === "counting" ? `Divergência acima da tolerância: recontar ${r.recount_locations?.join(", ")}.` : `Rodada encerrada: ${r.adjustments ?? 0} ajuste(s) para aprovação.` });
          recarregar();
        }}>Encerrar rodada</Button>
      )}
      {det.dados!.adjustments && (
        <Painel titulo="Ajustes (aprovação por supervisor distinto, com MFA)">
          <Tabela colunas={[{ titulo: "Endereço" }, { titulo: "Produto" }, { titulo: "Esperado" }, { titulo: "Contado" }, { titulo: "Diferença" }, { titulo: "Situação" }, { titulo: "" }]}
            linhas={det.dados!.adjustments.map((a) => ({ chave: a.id, celulas: [a.location, `${a.sku}${a.lot ? ` · ${a.lot}` : ""}`, qtd(a.expected_qty), qtd(a.counted_qty), qtd(a.difference), <Estado key="s" valor={a.status} />,
              a.status === "pending" && pode("inventory.approve") ? (a.requested_by === me.user_id ? <span key="x" className="text-xs text-suave">Você solicitou: outro supervisor aprova</span> : (
                <div key="b" className="flex gap-1">
                  <Button size="sm" disabled={enviando} onClick={async () => { await executar(`inventory-adjustments/${a.id}/approve`, {}, { ok: "Ajuste aplicado." }); recarregar(); }}>Aprovar</Button>
                  <Button size="sm" variant="suave" disabled={enviando || !motivo} onClick={async () => { await executar(`inventory-adjustments/${a.id}/reject`, { reason: motivo }, { ok: "Ajuste rejeitado." }); recarregar(); }}>Rejeitar</Button>
                </div>)) : null] }))} vazio="Sem divergências." />
          {pode("inventory.approve") && <div className="mt-3"><Campo id="motivo" rotulo="Motivo (para rejeição/cancelamento)" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>}
        </Painel>
      )}
      {["draft", "counting", "review"].includes(s.status) && pode("inventory.manage") && (
        <Button variant="perigo" disabled={enviando || !motivo} onClick={async () => { await executar(`inventory-sessions/${id}/cancel`, { reason: motivo }, { ok: "Inventário cancelado: endereços liberados, histórico mantido." }); recarregar(); }}>Cancelar inventário</Button>
      )}
      {!pode("inventory.approve") && pode("inventory.manage") && <Campo id="motivo2" rotulo="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      <Painel titulo="Minhas contagens">
        <Tabela colunas={[{ titulo: "Quando" }, { titulo: "Endereço" }, { titulo: "Produto" }, { titulo: "Qtd" }, { titulo: "Rodada" }]}
          linhas={det.dados!.my_counts.map((c) => ({ chave: c.id, celulas: [dataHora(c.counted_at), c.location, c.sku, qtd(c.counted_qty), c.round] }))} vazio="Nenhuma contagem sua." />
      </Painel>
    </div>
  );
}
