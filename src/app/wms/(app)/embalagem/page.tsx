"use client";

import Link from "next/link";
import { useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { EtiquetaVolume } from "@/components/wms/etiqueta";
import { Estado, Painel, Titulo } from "@/components/wms/ui";

type Ped = { id: string; number: string; status: string };
type Det = { packages: { id: string; label_code: string; status: string; label_print_count: number }[] };

export default function Embalagem() {
  const { armazem } = useWms();
  const embalados = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status: "packed" });
  const conferindo = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status: "checking" });
  return (
    <div className="space-y-4">
      <Titulo titulo="Embalagem" descricao="Volumes fechados e etiquetas internas. Peso e dimensões são informados pelo operador (sem integração com balança)." />
      <Painel titulo="Em conferência">
        <ul className="text-sm">{(conferindo.dados ?? []).map((p) => <li key={p.id}><Link className="underline" href={`/wms/conferencia/pedido?id=${p.id}`}>{p.number}</Link> <Estado valor={p.status} /></li>)}</ul>
        {!conferindo.dados?.length && <p className="text-sm text-suave">Nenhum.</p>}
      </Painel>
      <Painel titulo="Embalados (aguardando remessa)">
        <div className="grid gap-3 sm:grid-cols-2">{(embalados.dados ?? []).map((p) => <Volumes key={p.id} pedido={p} />)}</div>
        {!embalados.dados?.length && <p className="text-sm text-suave">Nenhum pedido embalado.</p>}
      </Painel>
    </div>
  );
}

function Volumes({ pedido }: { pedido: Ped }) {
  const det = useDados<Det>(`orders/${pedido.id}`);
  return <>{(det.dados?.packages ?? []).filter((v) => v.status === "closed").map((v) => <EtiquetaVolume key={v.id} pacote={v} pedido={pedido.number} onImpresso={() => void det.recarregar()} />)}</>;
}
