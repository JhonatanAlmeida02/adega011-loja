"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, CampoNumero, Estado, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Saldo = { location_code: string; location_type: string; condition: string; quantity: number; reserved: number; available: number; eligible: boolean;
  lot_code: string | null; expiry_date: string | null; product_id: string; sku: string; description: string; base_unit: string };
type Transf = { id: string; code: string; status: string; from_wh: string; to_wh: string; items: { sku: string; quantity: number; shipped: number; received: number }[] };

export default function Estoque() {
  const { armazem, org, pode } = useWms();
  const wh = armazem!.id;
  const [busca, setBusca] = useState("");
  const saldos = useDados<Saldo[]>("stock/balances", { warehouse_id: wh, q: busca, limite: 200 });
  const transferencias = useDados<Transf[]>(pode("transfers.manage") || pode("transfers.receive") ? "transfers" : null, { warehouse_id: wh });
  const { executar, enviando, mensagem } = useComando();
  const [t, setT] = useState({ from: "", to: "", code: "", q: 1, lot: "", reason: "" });
  const [b, setB] = useState({ loc: "", product: "", lot: "", from: "available", to: "blocked", q: 1, reason: "" });
  const [tw, setTw] = useState({ to: "", product: "", loc: "", lot: "", q: 1 });
  const outros = org.warehouses.filter((w) => w.id !== wh);

  return (
    <div className="space-y-4">
      <Titulo titulo="Estoque" descricao="Disponível = físico elegível − reservas. Quarentena, bloqueado, avariado, trânsito e lote vencido ficam fora." />
      <Painel>
        <Campo id="busca" rotulo="Buscar por SKU, descrição, GTIN ou endereço" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="mt-3">
          <Tabela colunas={[{ titulo: "Produto" }, { titulo: "Endereço" }, { titulo: "Lote / validade" }, { titulo: "Condição" }, { titulo: "Físico" }, { titulo: "Reservado" }, { titulo: "Disponível" }]}
            linhas={(saldos.dados ?? []).map((s, i) => ({ chave: `${i}`, celulas: [`${s.sku} · ${s.description}`, `${s.location_code} (${s.location_type})`,
              s.lot_code ? `${s.lot_code} · ${s.expiry_date ?? "sem validade"}` : "—", <Estado key="c" valor={s.condition} />,
              `${qtd(s.quantity)} ${s.base_unit}`, qtd(s.reserved), s.eligible ? qtd(s.available) : "fora do elegível"] }))} />
        </div>
      </Painel>
      <Mensagem m={mensagem} />
      {pode("stock.move") && (
        <Painel titulo="Transferir entre endereços (mesmo armazém)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="t-from" rotulo="Origem" value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })} />
            <Campo id="t-to" rotulo="Destino" value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })} />
            <Campo id="t-code" rotulo="Produto (código lido)" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} />
            <CampoNumero id="t-q" rotulo="Quantidade (unidade lida)" valor={t.q} onChange={(q) => setT({ ...t, q })} />
            <Campo id="t-lot" rotulo="Lote (se houver)" value={t.lot} onChange={(e) => setT({ ...t, lot: e.target.value })} />
            <Campo id="t-r" rotulo="Motivo" value={t.reason} onChange={(e) => setT({ ...t, reason: e.target.value })} />
          </div>
          <Button className="mt-3" disabled={enviando || !t.from || !t.to || !t.code} onClick={async () => {
            const r = await executar("stock/transfers", { warehouse_id: wh, from_code: t.from, to_code: t.to, code: t.code, quantity: t.q, lot_code: t.lot || null, reason: t.reason || null },
              { ok: (x: { quantity_base: number }) => `Transferidas ${qtd(x.quantity_base)} unidades base.` });
            if (r) { setT({ ...t, code: "", q: 1 }); await saldos.recarregar(); }
          }}>Transferir</Button>
        </Painel>
      )}
      {pode("stock.block") && (
        <Painel titulo="Bloquear / liberar estoque">
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo id="b-loc" rotulo="Endereço" value={b.loc} onChange={(e) => setB({ ...b, loc: e.target.value })} />
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="b-p">Produto</label>
              <Select id="b-p" value={b.product} onChange={(e) => setB({ ...b, product: e.target.value })}>
                <option value="">Escolha…</option>{[...new Map((saldos.dados ?? []).map((s) => [s.product_id, s])).values()].map((s) => <option key={s.product_id} value={s.product_id}>{s.sku}</option>)}
              </Select></div>
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="b-from">De</label>
              <Select id="b-from" value={b.from} onChange={(e) => setB({ ...b, from: e.target.value })}>{["available", "blocked", "quarantine", "damaged"].map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="b-to">Para</label>
              <Select id="b-to" value={b.to} onChange={(e) => setB({ ...b, to: e.target.value })}>{["blocked", "available", "quarantine", "damaged"].map((c) => <option key={c}>{c}</option>)}</Select></div>
            <CampoNumero id="b-q" rotulo="Quantidade (base)" valor={b.q} onChange={(q) => setB({ ...b, q })} />
            <Campo id="b-lot" rotulo="Lote" value={b.lot} onChange={(e) => setB({ ...b, lot: e.target.value })} />
            <Campo id="b-r" rotulo="Motivo" value={b.reason} onChange={(e) => setB({ ...b, reason: e.target.value })} />
          </div>
          <Button className="mt-3" disabled={enviando || !b.loc || !b.product || !b.reason} onClick={async () => {
            await executar("stock/condition", { warehouse_id: wh, location_code: b.loc, product_id: b.product, lot_code: b.lot || null, from: b.from, to: b.to, quantity: b.q, reason: b.reason }, { ok: "Condição alterada." });
            await saldos.recarregar();
          }}>Aplicar</Button>
        </Painel>
      )}
      {pode("transfers.manage") && outros.length > 0 && (
        <Painel titulo="Transferência entre armazéns (passa por trânsito)">
          <div className="grid gap-3 sm:grid-cols-5">
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="tw-to">Destino</label>
              <Select id="tw-to" value={tw.to} onChange={(e) => setTw({ ...tw, to: e.target.value })}><option value="">Escolha…</option>{outros.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select></div>
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="tw-p">Produto</label>
              <Select id="tw-p" value={tw.product} onChange={(e) => setTw({ ...tw, product: e.target.value })}>
                <option value="">Escolha…</option>{[...new Map((saldos.dados ?? []).map((s) => [s.product_id, s])).values()].map((s) => <option key={s.product_id} value={s.product_id}>{s.sku}</option>)}
              </Select></div>
            <Campo id="tw-loc" rotulo="Endereço de origem" value={tw.loc} onChange={(e) => setTw({ ...tw, loc: e.target.value })} />
            <Campo id="tw-lot" rotulo="Lote" value={tw.lot} onChange={(e) => setTw({ ...tw, lot: e.target.value })} />
            <CampoNumero id="tw-q" rotulo="Quantidade (base)" valor={tw.q} onChange={(q) => setTw({ ...tw, q })} />
          </div>
          <Button className="mt-3" disabled={enviando || !tw.to || !tw.product || !tw.loc} onClick={async () => {
            const r = await executar<{ transfer_id: string }>("transfers", { from_warehouse_id: wh, to_warehouse_id: tw.to, items: [{ product_id: tw.product, location_code: tw.loc, lot_code: tw.lot || null, quantity: tw.q }] }, { ok: "Transferência criada (rascunho)." });
            if (r) await transferencias.recarregar();
          }}>Criar transferência</Button>
        </Painel>
      )}
      {(transferencias.dados?.length ?? 0) > 0 && (
        <Painel titulo="Transferências">
          <Tabela colunas={[{ titulo: "Código" }, { titulo: "De → para" }, { titulo: "Itens" }, { titulo: "Situação" }, { titulo: "" }]}
            linhas={transferencias.dados!.map((x) => ({ chave: x.id, celulas: [x.code, `${x.from_wh} → ${x.to_wh}`,
              x.items.map((i) => `${i.sku}: ${qtd(i.received)}/${qtd(i.shipped)} de ${qtd(i.quantity)}`).join("; "), <Estado key="s" valor={x.status} />,
              x.status === "draft" && pode("transfers.manage") ? <Button key="e" size="sm" onClick={async () => { await executar(`transfers/${x.id}/ship`, {}, { ok: "Expedida: saldo em trânsito no destino." }); await transferencias.recarregar(); await saldos.recarregar(); }}>Expedir</Button>
                : x.status === "in_transit" && x.to_wh === armazem!.code ? <ReceberTransferencia key="r" id={x.id} onFeito={() => { void transferencias.recarregar(); void saldos.recarregar(); }} /> : null] }))} />
        </Painel>
      )}
    </div>
  );
}

function ReceberTransferencia({ id, onFeito }: { id: string; onFeito: () => void }) {
  const { executar, enviando, mensagem } = useComando();
  const { pode } = useWms();
  const [code, setCode] = useState("");
  const [q, setQ] = useState(1);
  const [motivo, setMotivo] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><Campo id={`rt-${id}`} rotulo="Produto" value={code} onChange={(e) => setCode(e.target.value)} /><CampoNumero id={`rq-${id}`} rotulo="Qtd" valor={q} onChange={setQ} /></div>
      <Button size="sm" disabled={enviando || !code} onClick={async () => { const scan = crypto.randomUUID(); await executar(`transfers/${id}/receive`, { scan_id: scan, code, quantity: q }, { ok: "Recebido.", chave: scan }); onFeito(); }}>Receber</Button>
      {pode("discrepancies.resolve") && (<div className="flex gap-2"><Campo id={`rm-${id}`} rotulo="Motivo da divergência" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <Button size="sm" variant="suave" disabled={!motivo} onClick={async () => { await executar(`transfers/${id}/close-discrepancy`, { reason: motivo }, { ok: "Encerrada com ocorrência." }); onFeito(); }}>Encerrar com divergência</Button></div>)}
      <Mensagem m={mensagem} />
    </div>
  );
}
