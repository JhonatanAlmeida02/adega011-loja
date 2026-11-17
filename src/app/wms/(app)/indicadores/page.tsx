"use client";

import { useState } from "react";
import { useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, Estado, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Taxa = { unit: string; numerator: number; denominator: number; value: number | null };
type K = {
  period: { from: string; to: string };
  orders_by_status: { unit: string; values: Record<string, number> };
  receipt_time: { unit: string; denominator: number; value: number | null };
  putaway_time: { unit: string; denominator: number; value: number | null };
  productivity: { unit: string; by_user: { user_id: string | null; lines: number; units: number; hours: number; lines_per_hour: number | null; units_per_hour: number | null }[] };
  receipt_accuracy: Taxa; inventory_accuracy: Taxa; on_time_dispatch: Taxa;
  integration: { pending: number; failed: number; unknown: number; blocked: number; oldest_pending_minutes: number | null; attempt_failure_rate: Taxa; reauthorization_required: number };
};

const hoje = () => new Date().toISOString().slice(0, 10);
const semanaAtras = () => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

function Cartao({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <p className="text-sm text-suave">{titulo}</p>
      <p className="text-3xl font-bold">{valor}</p>
      <p className="mt-1 text-xs text-suave">{detalhe}</p>
    </div>
  );
}
const taxa = (t: Taxa) => (t.value === null ? "—" : `${qtd(t.value)}%`);

export default function Indicadores() {
  const { armazem } = useWms();
  const [de, setDe] = useState(semanaAtras());
  const [ate, setAte] = useState(hoje());
  const k = useDados<K>("kpis", { warehouse_id: armazem!.id, de: `${de}T00:00:00-03:00`, ate: `${ate}T23:59:59-03:00` });
  const d = k.dados;
  return (
    <div className="space-y-4">
      <Titulo titulo="Indicadores" descricao="Sempre com período, unidade e denominador. Metas ainda não definidas pela empresa." />
      <div className="flex flex-wrap gap-3">
        <Campo id="de" rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        <Campo id="ate" rotulo="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
      </div>
      {k.erro && <p role="alert" className="text-perigo">{k.erro.message}</p>}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Cartao titulo="Tempo de recebimento" valor={d.receipt_time.value === null ? "—" : `${qtd(d.receipt_time.value)} min`} detalhe={`${d.receipt_time.unit} · ${d.receipt_time.denominator} recebimento(s)`} />
            <Cartao titulo="Tempo até armazenagem" valor={d.putaway_time.value === null ? "—" : `${qtd(d.putaway_time.value)} min`} detalhe={`${d.putaway_time.unit} · ${d.putaway_time.denominator} tarefa(s)`} />
            <Cartao titulo="Acuracidade de conferência" valor={taxa(d.receipt_accuracy)} detalhe={`${d.receipt_accuracy.numerator}/${d.receipt_accuracy.denominator} ${d.receipt_accuracy.unit}`} />
            <Cartao titulo="Acuracidade de inventário" valor={taxa(d.inventory_accuracy)} detalhe={`${d.inventory_accuracy.numerator}/${d.inventory_accuracy.denominator} ${d.inventory_accuracy.unit}`} />
            <Cartao titulo="Expedição no prazo" valor={taxa(d.on_time_dispatch)} detalhe={`${d.on_time_dispatch.numerator}/${d.on_time_dispatch.denominator} ${d.on_time_dispatch.unit}`} />
            <Cartao titulo="Falhas de integração" valor={taxa(d.integration.attempt_failure_rate)}
              detalhe={`${d.integration.pending} pendente(s), ${d.integration.failed} erro, ${d.integration.unknown} desconhecido(s); mais antigo ${d.integration.oldest_pending_minutes === null ? "—" : `${qtd(d.integration.oldest_pending_minutes)} min`}`} />
          </div>
          <Painel titulo={`Pedidos por etapa (${d.orders_by_status.unit}, situação atual)`}>
            <div className="flex flex-wrap gap-3">{Object.entries(d.orders_by_status.values).map(([s, n]) => <span key={s} className="flex items-center gap-1"><Estado valor={s} /> {n}</span>)}</div>
          </Painel>
          <Painel titulo={`Produtividade na separação (${d.productivity.unit})`}>
            <p className="mb-2 text-xs text-suave">Horas = início até fim de cada tarefa concluída. Pausas e esperas ainda não são descontadas (pendente).</p>
            <Tabela colunas={[{ titulo: "Operador" }, { titulo: "Linhas" }, { titulo: "Unidades" }, { titulo: "Horas" }, { titulo: "Linhas/h" }, { titulo: "Unid./h" }]}
              linhas={d.productivity.by_user.map((u, i) => ({ chave: `${i}`, celulas: [u.user_id?.slice(0, 8) ?? "—", u.lines, qtd(u.units), qtd(u.hours), u.lines_per_hour === null ? "—" : qtd(u.lines_per_hour), u.units_per_hour === null ? "—" : qtd(u.units_per_hour)] }))}
              vazio="Sem tarefas concluídas no período." />
          </Painel>
        </>
      )}
    </div>
  );
}
