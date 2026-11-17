"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { bip, CampoLeitura, Estado, Mensagem, Painel, Tabela, Titulo, type CampoLeituraRef } from "@/components/wms/ui";

type Det = { shipment: { id: string; code: string; carrier: string; status: string; version: number };
  packages: { package_id: string; label_code: string; loaded_at: string | null; number: string; order_id: string; order_status: string; fiscal_status: string }[] };
type Ped = { id: string; number: string; fiscal_status: string };

export default function Remessa({ id }: { id: string }) {
  const { armazem, pode } = useWms();
  const det = useDados<Det>(`shipments/${id}`);
  const embalados = useDados<Ped[]>("orders", { warehouse_id: armazem!.id, status: "packed" });
  const { executar, enviando, mensagem } = useComando();
  const leitor = useRef<CampoLeituraRef>(null);
  const s = det.dados?.shipment;
  const recarregar = () => { void det.recarregar(); void embalados.recarregar(); };
  if (!s) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const aberta = ["open", "loading"].includes(s.status);
  const pedidos = [...new Map(det.dados!.packages.map((p) => [p.order_id, p])).values()];
  const pendentes = det.dados!.packages.filter((p) => !p.loaded_at).length;
  return (
    <div className="space-y-4">
      <Titulo titulo={`Remessa ${s.code}`} descricao={s.carrier || "Transportadora não informada"} acoes={<Estado valor={s.status} />} />
      <Mensagem m={mensagem} />
      {aberta && pode("shipments.load") && (
        <Painel titulo={`Carregamento: ${pendentes} volume(s) a ler`}>
          <CampoLeitura ref={leitor} id="vol" rotulo="Leia a etiqueta do volume" onLeitura={async (l) => {
            const r = await executar(`shipments/${id}/load`, { scan_id: l.scanId, label: l.codigo }, { ok: (x: { pending: number; already_loaded: boolean }) => x.already_loaded ? "Volume já estava lido." : `Volume lido. Faltam ${x.pending}.`, chave: l.scanId });
            bip(Boolean(r)); recarregar(); leitor.current?.focar();
          }} desabilitado={enviando} />
        </Painel>
      )}
      <Painel titulo="Volumes">
        <Tabela colunas={[{ titulo: "Volume" }, { titulo: "Pedido" }, { titulo: "Fiscal" }, { titulo: "Carregado" }, { titulo: "" }]}
          linhas={det.dados!.packages.map((p) => ({ chave: p.package_id, celulas: [p.label_code, p.number, <Estado key="f" valor={p.fiscal_status} />, p.loaded_at ? "Sim" : "Não",
            aberta && pode("shipments.manage") ? <Button key="r" size="sm" variant="fantasma" onClick={async () => { await executar(`shipments/${id}/orders/remove`, { order_id: p.order_id }, { ok: "Pedido retirado da remessa.", chave: crypto.randomUUID() }); recarregar(); }}>Retirar pedido</Button> : null] }))} vazio="Nenhum volume." />
        <p className="mt-2 text-xs text-suave">{pedidos.length} pedido(s). Expedição parcial está desabilitada: todos os volumes de cada pedido precisam estar nesta remessa.</p>
      </Painel>
      {aberta && pode("shipments.manage") && (
        <Painel titulo="Incluir pedidos embalados">
          <ul className="space-y-1">{(embalados.dados ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between"><span>{p.number} · fiscal: <Estado valor={p.fiscal_status} /></span>
              <Button size="sm" onClick={async () => { await executar(`shipments/${id}/orders`, { order_id: p.id }, { ok: "Pedido incluído." }); recarregar(); }}>Incluir</Button></li>))}</ul>
          {!embalados.dados?.length && <p className="text-sm text-suave">Nenhum pedido embalado disponível.</p>}
        </Painel>
      )}
      {aberta && pode("shipments.dispatch") && (
        <Button size="lg" variant="destaque" className="h-14 w-full sm:w-auto" disabled={enviando || det.carregando || pendentes > 0 || !det.dados!.packages.length}
          onClick={async () => { await executar(`shipments/${id}/dispatch`, { expected_version: s.version }, { ok: (r: { erp_posting: string }) => `Saída confirmada no WMS. ERP: ${r.erp_posting === "erp_side" ? "baixa feita pelo ERP (sem segunda baixa)" : r.erp_posting === "outbox" ? "pendente de envio ao ERP" : r.erp_posting === "blocked" ? "política de lançamento não definida" : "sem integração"}.` }); recarregar(); }}>
          Confirmar despacho (saída física)
        </Button>
      )}
    </div>
  );
}
