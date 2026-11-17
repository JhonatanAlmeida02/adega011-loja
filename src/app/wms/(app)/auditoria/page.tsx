"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, dataHora, Painel, Tabela, Titulo } from "@/components/wms/ui";

type A = { id: number; action: string; entity_type: string; entity_id: string | null; data: unknown; actor: string | null; actor_id: string | null; created_at: string; correlation_id: string | null; warehouse: string | null };

export default function Auditoria() {
  const { org } = useWms();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const lista = useDados<A[]>("audit", { organization_id: org.organization_id, q: busca, pagina });
  return (
    <div className="space-y-4">
      <Titulo titulo="Auditoria" descricao="Registros imutáveis: perfis, ajustes, cancelamentos, reimpressões, integração e acesso administrativo." />
      <Painel>
        <Campo id="b" rotulo="Ação ou ID da entidade" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
        <div className="mt-3">
          <Tabela colunas={[{ titulo: "Quando" }, { titulo: "Quem" }, { titulo: "Ação" }, { titulo: "Entidade" }, { titulo: "Armazém" }, { titulo: "Dados" }]}
            linhas={(lista.dados ?? []).map((a) => ({ chave: String(a.id), celulas: [dataHora(a.created_at), a.actor || (a.actor_id ? a.actor_id.slice(0, 8) : "sistema"), a.action,
              `${a.entity_type} ${a.entity_id?.slice(0, 8) ?? ""}`, a.warehouse ?? "—", <code key="d" className="block max-w-md truncate text-xs" title={JSON.stringify(a.data)}>{JSON.stringify(a.data)}</code>] }))} />
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="suave" size="sm" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
          <Button variant="suave" size="sm" disabled={(lista.dados?.length ?? 0) < 50} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
        </div>
      </Painel>
    </div>
  );
}
