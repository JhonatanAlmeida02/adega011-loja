"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { ListaItens } from "@/components/wms/seletor-produto";
import { Campo, dataHora, Estado, Mensagem, Painel, Tabela, Titulo } from "@/components/wms/ui";

type Ped = { id: string; number: string; customer_name: string; status: string; erp_status: string | null; fiscal_status: string; integration_status: string; lines: number; created_at: string; external_id: string | null };
const ESTADOS = ["awaiting_allocation", "allocated", "picking", "picked", "checking", "packed", "ready_to_dispatch", "dispatched", "on_hold", "cancelled"];

export default function Pedidos() {
  const { armazem, pode } = useWms();
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const lista = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status, q: busca, pagina });
  const { executar, enviando, mensagem } = useComando();
  const [marcados, setMarcados] = useState<string[]>([]);
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState("");
  const [itens, setItens] = useState<{ product_id: string; sku: string; quantity: number }[]>([]);
  return (
    <div className="space-y-4">
      <Titulo titulo="Pedidos" descricao="Pedidos do ERP elegíveis para separação. Estados de execução, ERP e fiscal são independentes." />
      <Painel>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Campo id="b" rotulo="Número, cliente ou ID do ERP" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
          <div className="w-56"><label className="rotulo mb-1.5 block text-suave" htmlFor="s">Execução</label>
            <Select id="s" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }}><option value="">Todos</option>{ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
          {pode("waves.manage") && (
            <Button variant="suave" disabled={!marcados.length || enviando} onClick={async () => {
              await executar("waves", { warehouse_id: armazem!.id, order_ids: marcados }, { ok: (r: { results: { allocated: boolean }[] }) => `Onda criada: ${r.results.filter((x) => x.allocated).length} de ${r.results.length} pedidos reservados.` });
              setMarcados([]); await lista.recarregar();
            }}>Criar onda ({marcados.length})</Button>
          )}
        </div>
        <Mensagem m={mensagem} />
        <Tabela colunas={[{ titulo: "" }, { titulo: "Pedido" }, { titulo: "Cliente" }, { titulo: "Execução" }, { titulo: "ERP" }, { titulo: "Fiscal" }, { titulo: "Linhas" }, { titulo: "Entrada" }]}
          linhas={(lista.dados ?? []).map((p) => ({ chave: p.id, onClick: () => router.push(`/wms/pedidos/detalhe?id=${p.id}`), celulas: [
            p.status === "awaiting_allocation" && pode("waves.manage") ? (
              <input key="c" type="checkbox" aria-label={`Selecionar ${p.number}`} className="size-5" checked={marcados.includes(p.id)} onClick={(e) => e.stopPropagation()}
                onChange={(e) => setMarcados(e.target.checked ? [...marcados, p.id] : marcados.filter((x) => x !== p.id))} />) : null,
            p.number, p.customer_name || "—", <Estado key="s" valor={p.status} />, p.erp_status ?? "manual", <Estado key="f" valor={p.fiscal_status} />, p.lines, dataHora(p.created_at)] }))} />
        <div className="mt-3 flex gap-2">
          <Button variant="suave" size="sm" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
          <Button variant="suave" size="sm" disabled={(lista.dados?.length ?? 0) < 50} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
        </div>
      </Painel>
      {pode("orders.reconcile") && (
        <Painel titulo="Pedido manual (sem ERP, auditado)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="num" rotulo="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
            <Campo id="cli" rotulo="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div className="mt-3"><ListaItens itens={itens} onChange={setItens} /></div>
          <Button className="mt-3" disabled={enviando || !numero || !itens.length} onClick={async () => {
            const r = await executar<{ order_id: string }>("orders", { warehouse_id: armazem!.id, number: numero, customer: cliente, items: itens.map(({ product_id, quantity }) => ({ product_id, quantity })) }, { ok: "Pedido criado." });
            if (r) router.push(`/wms/pedidos/detalhe?id=${r.order_id}`);
          }}>Criar pedido</Button>
        </Painel>
      )}
    </div>
  );
}
