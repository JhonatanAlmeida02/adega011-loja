"use client";

import { useRouter } from "next/navigation";
import { useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { dataHora, Estado, Painel, Tabela, Titulo } from "@/components/wms/ui";

type Ped = { id: string; number: string; customer_name: string; status: string; lines: number; created_at: string };

export default function Conferencia() {
  const { armazem } = useWms();
  const router = useRouter();
  const separados = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status: "picked" });
  const conferindo = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status: "checking" });
  const linhas = [...(conferindo.dados ?? []), ...(separados.dados ?? [])];
  return (
    <div className="space-y-4">
      <Titulo titulo="Conferência" descricao="Leia cada item separado para o volume. Divergência bloqueia o fechamento." />
      <Painel>
        <Tabela colunas={[{ titulo: "Pedido" }, { titulo: "Cliente" }, { titulo: "Situação" }, { titulo: "Linhas" }, { titulo: "Entrada" }]}
          linhas={linhas.map((p) => ({ chave: p.id, onClick: () => router.push(`/wms/conferencia/pedido?id=${p.id}`), celulas: [p.number, p.customer_name || "—", <Estado key="s" valor={p.status} />, p.lines, dataHora(p.created_at)] }))}
          vazio="Nenhum pedido separado aguardando conferência." />
      </Painel>
    </div>
  );
}
