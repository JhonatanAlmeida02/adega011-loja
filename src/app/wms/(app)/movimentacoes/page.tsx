"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { dataHora, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Mov = { id: string; movement_type: string; reason: string | null; erp_posting: string; created_at: string; reverses_movement_id: string | null;
  entries: { location: string; sku: string; lot: string | null; condition: string; quantity: number }[] | null };
const ERP: Record<string, string> = { none: "Sem efeito no ERP", erp_side: "Lançado pelo ERP", outbox: "Pendente/enviado ao ERP", blocked: "Política ERP não definida" };

export default function Movimentacoes() {
  const { armazem, pode } = useWms();
  const [tipo, setTipo] = useState("");
  const [pagina, setPagina] = useState(1);
  const lista = useDados<Mov[]>("stock/movements", { warehouse_id: armazem!.id, tipo, pagina });
  const { executar, mensagem } = useComando();
  return (
    <div className="space-y-4">
      <Titulo titulo="Movimentações" descricao="Ledger permanente: movimentos confirmados não são editados; corrigem-se com movimento inverso vinculado." />
      <Painel>
        <div className="mb-3 w-60"><label htmlFor="tipo" className="rotulo mb-1.5 block text-suave">Tipo</label>
          <Select id="tipo" value={tipo} onChange={(e) => { setTipo(e.target.value); setPagina(1); }}>
            <option value="">Todos</option>{["receipt", "putaway", "transfer", "replenishment", "pick", "dispatch", "inventory_adjustment", "return_receipt", "condition_change", "scrap", "supplier_return", "transfer_out", "transfer_in", "reversal"].map((t) => <option key={t}>{t}</option>)}
          </Select></div>
        <Mensagem m={mensagem} />
        <Tabela colunas={[{ titulo: "Quando" }, { titulo: "Tipo" }, { titulo: "Partidas" }, { titulo: "ERP" }, { titulo: "" }]}
          linhas={(lista.dados ?? []).map((m) => ({ chave: m.id, celulas: [dataHora(m.created_at), `${m.movement_type}${m.reason ? ` · ${m.reason}` : ""}`,
            <ul key="e" className="text-xs">{(m.entries ?? []).map((e, i) => <li key={i}>{e.quantity > 0 ? "+" : ""}{qtd(e.quantity)} {e.sku} @ {e.location}{e.lot ? ` (lote ${e.lot})` : ""} [{e.condition}]</li>)}</ul>,
            ERP[m.erp_posting] ?? m.erp_posting,
            pode("discrepancies.resolve") && ["transfer", "putaway", "replenishment", "condition_change"].includes(m.movement_type) ? (
              <Button key="r" size="sm" variant="suave" onClick={async () => {
                const motivo = prompt("Motivo da reversão (fica na auditoria):");
                if (motivo) { await executar(`stock/movements/${m.id}/reverse`, { reason: motivo }, { ok: "Movimento inverso lançado." }); await lista.recarregar(); }
              }}>Reverter</Button>) : null] }))} />
        <div className="mt-3 flex gap-2">
          <Button variant="suave" size="sm" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
          <Button variant="suave" size="sm" disabled={(lista.dados?.length ?? 0) < 50} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
        </div>
      </Painel>
    </div>
  );
}
