"use client";

import Link from "next/link";
import { useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Estado, Painel, qtd, Titulo } from "@/components/wms/ui";

type Kpis = { orders_by_status: { values: Record<string, number> }; integration: { pending: number; failed: number; unknown: number; blocked: number; oldest_pending_minutes: number | null; reauthorization_required: number } };
type Oc = { id: string; kind: string; sku: string | null; quantity: number | null; created_at: string };

export default function VisaoGeral() {
  const { armazem, pode } = useWms();
  const wh = armazem!.id;
  const kpis = useDados<Kpis>(pode("reports.read") ? "kpis" : null, { warehouse_id: wh });
  const ocorrencias = useDados<Oc[]>("discrepancies", { warehouse_id: wh, limite: 10 });
  const tarefas = useDados<unknown[]>(pode("picking.execute") ? "picking-tasks" : null, { warehouse_id: wh });
  const armazenagem = useDados<unknown[]>(pode("stock.putaway") ? "putaway-tasks" : null, { warehouse_id: wh });
  const st = kpis.dados?.orders_by_status.values ?? {};
  return (
    <div className="space-y-4">
      <Titulo titulo="Visão geral" descricao={`Armazém ${armazem!.code} · ${armazem!.name}`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pode("picking.execute") && <Atalho href="/wms/separacao" titulo="Tarefas de separação" valor={tarefas.dados?.length} />}
        {pode("stock.putaway") && <Atalho href="/wms/armazenagem" titulo="Armazenagens abertas" valor={armazenagem.dados?.length} />}
        <Atalho href="/wms/pedidos" titulo="Aguardando reserva" valor={st.awaiting_allocation ?? 0} />
        <Atalho href="/wms/pedidos" titulo="Em espera (revisão/ERP)" valor={st.on_hold ?? 0} />
      </div>
      {kpis.dados && (
        <Painel titulo="Pedidos por etapa (unidade: pedidos)">
          <div className="flex flex-wrap gap-3">{Object.entries(st).map(([k, v]) => <span key={k} className="flex items-center gap-2"><Estado valor={k} /> <strong>{v}</strong></span>)}</div>
          <p className="mt-3 text-sm text-suave">
            Integração: {kpis.dados.integration.pending} pendente(s), {kpis.dados.integration.failed} com erro, {kpis.dados.integration.unknown} com resultado desconhecido,
            {" "}{kpis.dados.integration.blocked} bloqueado(s){kpis.dados.integration.oldest_pending_minutes ? ` · mais antigo há ${qtd(kpis.dados.integration.oldest_pending_minutes)} min` : ""}.
            {kpis.dados.integration.reauthorization_required > 0 && <strong className="text-amarelo-texto"> Conexão exige reautorização.</strong>}
          </p>
        </Painel>
      )}
      <Painel titulo="Ocorrências abertas">
        {ocorrencias.dados?.length ? (
          <ul className="space-y-1 text-sm">{ocorrencias.dados.map((o) => <li key={o.id}>• {o.kind} {o.sku ? `· ${o.sku}` : ""} {o.quantity ? `· ${qtd(o.quantity)}` : ""}</li>)}</ul>
        ) : <p className="text-sm text-suave">Nenhuma ocorrência aberta.</p>}
      </Painel>
    </div>
  );
}

function Atalho({ href, titulo, valor }: { href: string; titulo: string; valor: number | undefined }) {
  return (
    <Link href={href} className="rounded-xl border border-borda bg-superficie p-4 hover:bg-superficie-2">
      <p className="text-sm text-suave">{titulo}</p>
      <p className="text-3xl font-bold">{valor ?? "—"}</p>
    </Link>
  );
}
