"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, dataHora, Estado, Mensagem, Painel, Tabela, Titulo } from "@/components/wms/ui";

type Rem = { id: string; code: string; carrier: string; status: string; packages: number; loaded: number; created_at: string; dispatched_at: string | null };

export default function Expedicao() {
  const { armazem, pode } = useWms();
  const router = useRouter();
  const lista = useDados<Rem[]>("shipments", { warehouse_id: armazem!.id });
  const { executar, enviando, mensagem } = useComando();
  const [transp, setTransp] = useState("");
  const [doca, setDoca] = useState("DOCA-1");
  return (
    <div className="space-y-4">
      <Titulo titulo="Expedição" descricao="Despacho é confirmação explícita da saída física, depois de ler todos os volumes." />
      {pode("shipments.manage") && (
        <Painel titulo="Nova remessa (romaneio)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="tr" rotulo="Transportadora" value={transp} onChange={(e) => setTransp(e.target.value)} />
            <Campo id="doca" rotulo="Doca" value={doca} onChange={(e) => setDoca(e.target.value)} />
          </div>
          <Mensagem m={mensagem} />
          <Button className="mt-3" disabled={enviando} onClick={async () => { const r = await executar<{ shipment_id: string }>("shipments", { warehouse_id: armazem!.id, carrier: transp, dock_code: doca || null }, { ok: "Remessa criada." }); if (r) router.push(`/wms/expedicao/remessa?id=${r.shipment_id}`); }}>Criar remessa</Button>
        </Painel>
      )}
      <Painel>
        <Tabela colunas={[{ titulo: "Romaneio" }, { titulo: "Transportadora" }, { titulo: "Volumes lidos" }, { titulo: "Situação" }, { titulo: "Criada" }, { titulo: "Despachada" }]}
          linhas={(lista.dados ?? []).map((s) => ({ chave: s.id, onClick: () => router.push(`/wms/expedicao/remessa?id=${s.id}`), celulas: [s.code, s.carrier || "—", `${s.loaded}/${s.packages}`, <Estado key="s" valor={s.status} />, dataHora(s.created_at), dataHora(s.dispatched_at)] }))} />
      </Painel>
    </div>
  );
}
