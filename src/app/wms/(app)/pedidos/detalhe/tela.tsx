"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, dataHora, Estado, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Det = {
  order: { id: string; number: string; customer_name: string; status: string; hold_reason: string | null; erp_status: string | null; fiscal_status: string; integration_status: string; revision: number; allocated_revision: number | null; version: number; external_id: string | null; ship_by: string | null };
  items: { id: string; line_no: number; kind: string; sku: string; description: string; quantity: number }[];
  reservations: { id: string; order_item_id: string; status: string; quantity: number; location: string; lot: string | null }[];
  tasks: { id: string; status: string; assigned_to: string | null; version: number }[];
  packages: { id: string; label_code: string; status: string; items: { sku: string; quantity: number }[] }[];
  revisions: { revision: number; received_at: string }[];
};

export default function Pedido({ id }: { id: string }) {
  const { pode } = useWms();
  const det = useDados<Det>(`orders/${id}`);
  const { executar, enviando, mensagem } = useComando();
  const [motivo, setMotivo] = useState("");
  const o = det.dados?.order;
  if (!o) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const reservado = (item: string, st: string) => det.dados!.reservations.filter((r) => r.order_item_id === item && r.status === st).reduce((a, r) => a + Number(r.quantity), 0);
  const recarregar = () => void det.recarregar();
  return (
    <div className="space-y-4">
      <Titulo titulo={`Pedido ${o.number}`} descricao={`${o.customer_name || "—"}${o.external_id ? ` · ERP #${o.external_id}` : " · manual"}${o.ship_by ? ` · prazo ${dataHora(o.ship_by)}` : ""}`} />
      <div className="flex flex-wrap gap-4 text-sm">
        <span>Execução: <Estado valor={o.status} /></span>
        <span>ERP: <strong>{o.erp_status ?? "—"}</strong></span>
        <span>Fiscal: <Estado valor={o.fiscal_status} /></span>
        <span>Integração: <Estado valor={o.integration_status === "synced" ? "sent" : o.integration_status} /></span>
        <span>Revisão: <strong>{o.revision}</strong>{o.allocated_revision && o.allocated_revision !== o.revision ? ` (reservado na ${o.allocated_revision})` : ""}</span>
      </div>
      {o.status === "on_hold" && <p role="alert" className="rounded-lg border border-amarelo-texto/60 p-3 text-sm">Em espera: {o.hold_reason === "revision_changed" ? "o pedido mudou no ERP depois da reserva. Reconcilie antes de continuar." : o.hold_reason}</p>}
      <Mensagem m={mensagem} />
      <div className="flex flex-wrap gap-2">
        {o.status === "awaiting_allocation" && pode("orders.allocate") && (
          <Button disabled={enviando} onClick={async () => { await executar(`orders/${id}/allocate`, { expected_version: o.version }, { ok: (r: { allocated: boolean }) => r.allocated ? "Reservado e tarefas criadas." : "Estoque insuficiente: nada reservado (ocorrência registrada)." }); recarregar(); }}>Reservar e criar tarefas</Button>
        )}
        {o.status === "on_hold" && o.hold_reason === "revision_changed" && pode("orders.reconcile") && (
          <Button disabled={enviando} onClick={async () => { await executar(`orders/${id}/reconcile`, {}, { ok: "Revisão aplicada; reservas liberadas e retorno físico criado quando necessário." }); recarregar(); }}>Reconciliar revisão</Button>
        )}
        {["picked", "checking"].includes(o.status) && <Button asChild variant="suave"><Link href={`/wms/conferencia/pedido?id=${id}`}>Conferir e embalar</Link></Button>}
      </div>
      <Painel titulo="Itens">
        <Tabela colunas={[{ titulo: "#" }, { titulo: "Produto" }, { titulo: "Pedido" }, { titulo: "Reservado" }, { titulo: "Separado (staging)" }, { titulo: "" }]}
          linhas={det.dados!.items.map((i) => ({ chave: i.id, celulas: [i.line_no, `${i.kind === "kit_parent" ? "Kit: " : i.kind === "kit_component" ? "↳ " : ""}${i.sku} · ${i.description}`, qtd(i.quantity),
            i.kind === "kit_parent" ? "—" : qtd(reservado(i.id, "active")), i.kind === "kit_parent" ? "—" : qtd(reservado(i.id, "staged")),
            i.kind !== "kit_parent" && ["picking", "allocated"].includes(o.status) && pode("picking.supervise") && reservado(i.id, "active") + reservado(i.id, "staged") < Number(i.quantity) ? (
              <Button key="r" size="sm" variant="suave" onClick={async () => { await executar(`order-items/${i.id}/reallocate`, {}, { ok: (r: { reallocated: boolean }) => r.reallocated ? "Realocado em outro endereço." : "Sem estoque para realocar." }); recarregar(); }}>Realocar falta</Button>) : null] }))} />
      </Painel>
      <Painel titulo="Reservas">
        <Tabela colunas={[{ titulo: "Endereço" }, { titulo: "Lote" }, { titulo: "Qtd" }, { titulo: "Situação" }]}
          linhas={det.dados!.reservations.map((r) => ({ chave: r.id, celulas: [r.location, r.lot ?? "—", qtd(r.quantity), r.status === "staged" ? "Em staging" : "No endereço"] }))} vazio="Sem reservas abertas." />
      </Painel>
      <Painel titulo="Tarefas e volumes">
        <ul className="text-sm">{det.dados!.tasks.map((t) => <li key={t.id}><Link className="underline" href={`/wms/separacao/tarefa?id=${t.id}`}>Tarefa {t.id.slice(0, 8)}</Link> · <Estado valor={t.status} /></li>)}</ul>
        <ul className="mt-2 text-sm">{det.dados!.packages.map((p) => <li key={p.id}>Volume {p.label_code} · <Estado valor={p.status} /> · {p.items.map((i) => `${i.sku}×${qtd(i.quantity)}`).join(", ")}</li>)}</ul>
      </Painel>
      {pode("orders.cancel") && !["dispatched", "cancelled"].includes(o.status) && (
        <Painel titulo="Cancelar execução">
          <p className="mb-2 text-sm text-suave">Antes da separação libera a reserva. Depois, cria tarefa de retorno físico do que está em staging.</p>
          <Campo id="motivo" rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <Button variant="perigo" className="mt-2" disabled={!motivo || enviando} onClick={async () => { await executar(`orders/${id}/cancel`, { reason: motivo }, { ok: (r: { return_tasks: number }) => `Cancelado. Tarefas de retorno: ${r.return_tasks}.` }); recarregar(); }}>Cancelar pedido no WMS</Button>
        </Painel>
      )}
      <p className="text-xs text-suave">Revisões recebidas: {det.dados!.revisions.map((r) => `${r.revision} (${dataHora(r.received_at)})`).join(" · ")}</p>
    </div>
  );
}
