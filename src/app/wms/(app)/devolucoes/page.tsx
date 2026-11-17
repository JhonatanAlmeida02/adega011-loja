"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { ListaItens } from "@/components/wms/seletor-produto";
import { bip, Campo, CampoLeitura, CampoNumero, dataHora, Estado, Mensagem, Painel, qtd, Titulo } from "@/components/wms/ui";

type Dev = { id: string; code: string; status: string; reason: string; created_at: string; order_number: string | null;
  items: { id: string; product_id: string; sku: string; expected: number; received: number; decided: number }[] | null };
type Ped = { id: string; number: string };

export default function Devolucoes() {
  const { armazem, pode } = useWms();
  const wh = armazem!.id;
  const lista = useDados<Dev[]>("returns", { warehouse_id: wh });
  const despachados = useDados<Ped[]>(pode("returns.manage") ? "orders" : null, { warehouse_id: wh, status: "dispatched" });
  const { executar, enviando, mensagem } = useComando();
  const [pedido, setPedido] = useState("");
  const [motivo, setMotivo] = useState("");
  const [itens, setItens] = useState<{ product_id: string; sku: string; quantity: number }[]>([]);
  return (
    <div className="space-y-4">
      <Titulo titulo="Devoluções e qualidade" descricao="Retorno físico entra em quarentena. Estorno fiscal é outro evento, feito no ERP." />
      <Mensagem m={mensagem} />
      {pode("returns.manage") && (
        <Painel titulo="Nova devolução">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="ped">Pedido expedido (opcional)</label>
              <Select id="ped" value={pedido} onChange={(e) => setPedido(e.target.value)}><option value="">Sem vínculo</option>{(despachados.dados ?? []).map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}</Select></div>
            <Campo id="mot" rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="mt-3"><ListaItens itens={itens} onChange={setItens} /></div>
          <Button className="mt-3" disabled={enviando || !itens.length} onClick={async () => {
            const r = await executar("returns", { warehouse_id: wh, order_id: pedido || null, reason: motivo, items: itens.map(({ product_id, quantity }) => ({ product_id, quantity })) }, { ok: "Devolução aberta." });
            if (r) { setItens([]); await lista.recarregar(); }
          }}>Abrir devolução</Button>
        </Painel>
      )}
      {(lista.dados ?? []).map((d) => <Devolucao key={d.id} d={d} onFeito={() => void lista.recarregar()} />)}
    </div>
  );
}

function Devolucao({ d, onFeito }: { d: Dev; onFeito: () => void }) {
  const { armazem, pode } = useWms();
  const { executar, enviando, mensagem } = useComando();
  const [quantidade, setQuantidade] = useState(1);
  const [decisao, setDecisao] = useState("reintegrate");
  const [destino, setDestino] = useState("");
  const [qDec, setQDec] = useState(1);
  return (
    <Painel titulo={`${d.code}${d.order_number ? ` · pedido ${d.order_number}` : ""}`}>
      <p className="mb-2 text-sm"><Estado valor={d.status} /> {d.reason} · {dataHora(d.created_at)}</p>
      <ul className="mb-3 text-sm">{(d.items ?? []).map((i) => <li key={i.id}>{i.sku}: recebido {qtd(i.received)} de {qtd(i.expected)} · decidido {qtd(i.decided)}</li>)}</ul>
      {["expected", "receiving"].includes(d.status) && pode("returns.receive") && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <CampoNumero id={`q-${d.id}`} rotulo="Quantidade" valor={quantidade} onChange={setQuantidade} />
          <CampoLeitura id={`l-${d.id}`} rotulo="Leia o item devolvido" desabilitado={enviando} onLeitura={async (l) => {
            const r = await executar(`returns/${d.id}/receive`, { scan_id: l.scanId, code: l.codigo, quantity: l.quantidade ?? quantidade, lot_code: l.lote ?? null, expiry: l.validade ?? null, serial: l.serie ?? null }, { ok: "Recebido em quarentena.", chave: l.scanId });
            bip(Boolean(r)); if (r) onFeito();
          }} />
        </div>
      )}
      {pode("quality.decide") && (d.items ?? []).filter((i) => i.received > i.decided).map((i) => (
        <div key={i.id} className="mt-3 grid items-end gap-2 rounded-lg border border-borda p-3 sm:grid-cols-4">
          <p className="text-sm font-semibold sm:col-span-4">Decisão de qualidade · {i.sku} (pendente {qtd(i.received - i.decided)})</p>
          <div><label className="rotulo mb-1.5 block text-suave" htmlFor={`d-${i.id}`}>Destino</label>
            <Select id={`d-${i.id}`} value={decisao} onChange={(e) => setDecisao(e.target.value)}>
              <option value="reintegrate">Reintegrar ao estoque</option><option value="repair">Reparo (avariado)</option><option value="discard">Descartar</option><option value="return_to_supplier">Devolver ao fornecedor</option>
            </Select></div>
          <CampoNumero id={`qd-${i.id}`} rotulo="Quantidade" valor={qDec} onChange={setQDec} />
          {decisao === "reintegrate" && <Campo id={`to-${i.id}`} rotulo="Endereço de destino" value={destino} onChange={(e) => setDestino(e.target.value)} />}
          <Button disabled={enviando || (decisao === "reintegrate" && !destino)} onClick={async () => {
            await executar("quality/decisions", { warehouse_id: armazem!.id, from_code: "DEVOL", product_id: i.product_id, from_condition: "quarantine", quantity: qDec,
              decision: decisao, to_code: decisao === "reintegrate" ? destino : null, notes: d.reason, return_item_id: i.id }, { ok: "Decisão registrada." });
            onFeito();
          }}>Registrar decisão</Button>
        </div>
      ))}
      <Mensagem m={mensagem} />
    </Painel>
  );
}
