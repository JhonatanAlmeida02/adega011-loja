"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { bip, Campo, CampoLeitura, CampoNumero, dataHora, Estado, Mensagem, Painel, Progresso, qtd, Tabela, Titulo, type CampoLeituraRef, type Leitura } from "@/components/wms/ui";

type Item = { id: string; line_no: number; sku: string; description: string; expected_qty: number; received_qty: number; damaged_qty: number; rejected_qty: number;
  pending_checked: number; status: string; lot_control: boolean; expiry_control: boolean; serial_control: boolean; overage_approved_qty: number };
type Det = { receipt: { id: string; source_ref: string; supplier_name: string; status: string; version: number; quarantine_on_receipt: boolean };
  items: Item[]; checks: { id: string; sku: string; quantity: number; unit_code: string; lot_code: string | null; serial: string | null; outcome: string; movement_id: string | null; created_at: string }[] };

export default function Recebimento({ id }: { id: string }) {
  const { pode } = useWms();
  const det = useDados<Det>(`receipts/${id}`);
  const { executar, enviando, mensagem } = useComando();
  const leitor = useRef<CampoLeituraRef>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [lote, setLote] = useState("");
  const [validade, setValidade] = useState("");
  const [serie, setSerie] = useState("");
  const [resultado, setResultado] = useState<"accepted" | "damaged" | "rejected">("accepted");
  const [motivo, setMotivo] = useState("");
  const r = det.dados?.receipt;
  const aberto = r && ["expected", "receiving", "partially_received", "awaiting_review"].includes(r.status);

  const ler = async (l: Leitura) => {
    const res = await executar<{ sku: string; quantity_base: number; unit: string }>(`receipts/${id}/scan`, {
      scan_id: l.scanId, code: l.codigo, quantity: l.quantidade ?? quantidade, lot_code: l.lote ?? (lote || null),
      expiry: l.validade ?? (validade || null), serial: l.serie ?? (serie || null), outcome: resultado,
    }, { ok: (x) => `${x.sku}: ${qtd(x.quantity_base)} un base conferidas (${x.unit}).`, chave: l.scanId });
    bip(Boolean(res));
    if (res) { setSerie(""); await det.recarregar(); }
    leitor.current?.focar();
  };

  if (!r) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const total = det.dados!.items.reduce((a, i) => a + Number(i.expected_qty), 0);
  const feito = det.dados!.items.reduce((a, i) => a + Number(i.received_qty) + Number(i.pending_checked), 0);
  return (
    <div className="space-y-4">
      <Titulo titulo={`Recebimento ${r.source_ref}`} descricao={`${r.supplier_name || "Fornecedor não informado"}${r.quarantine_on_receipt ? " · entra em quarentena" : ""}`}
        acoes={<Estado valor={r.status} />} />
      <Progresso feito={feito} total={total} />
      {aberto && pode("receipts.check") && (
        <Painel titulo="Conferência por leitura">
          <div className="grid gap-3 sm:grid-cols-4">
            <CampoNumero id="q" rotulo="Quantidade (na unidade lida)" valor={quantidade} onChange={setQuantidade} />
            <Campo id="lote" rotulo="Lote" value={lote} onChange={(e) => setLote(e.target.value)} />
            <Campo id="val" rotulo="Validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
            <Campo id="serie" rotulo="Série" value={serie} onChange={(e) => setSerie(e.target.value)} />
          </div>
          <div className="mt-3 w-60">
            <label htmlFor="res" className="rotulo mb-1.5 block text-suave">Resultado</label>
            <Select id="res" value={resultado} onChange={(e) => setResultado(e.target.value as typeof resultado)}>
              <option value="accepted">Aceito</option><option value="damaged">Avariado (vai para quarentena)</option><option value="rejected">Recusado na porta</option>
            </Select>
          </div>
          <div className="mt-3"><CampoLeitura ref={leitor} id="leitura" rotulo="Código do produto (GTIN, caixa ou GS1)" onLeitura={ler} desabilitado={enviando} /></div>
          <Mensagem m={mensagem} />
          {pode("receipts.confirm") && (
            <Button size="lg" className="mt-2 h-14 w-full sm:w-auto" disabled={enviando}
              onClick={async () => { await executar(`receipts/${id}/confirm`, { expected_version: r.version }, { ok: (x: { status: string }) => `Confirmado: ${x.status}.` }); await det.recarregar(); }}>
              Confirmar recebimento conferido
            </Button>
          )}
        </Painel>
      )}
      <Painel titulo="Itens">
        <Tabela colunas={[{ titulo: "#" }, { titulo: "Produto" }, { titulo: "Previsto" }, { titulo: "Aceito" }, { titulo: "Avariado" }, { titulo: "Recusado" }, { titulo: "Conferido a confirmar" }, { titulo: "Situação" }, { titulo: "" }]}
          linhas={det.dados!.items.map((i) => ({ chave: i.id, celulas: [i.line_no, `${i.sku} · ${i.description}`, qtd(i.expected_qty), qtd(i.received_qty), qtd(i.damaged_qty), qtd(i.rejected_qty), qtd(i.pending_checked),
            <Estado key="s" valor={i.status} />,
            r.status === "awaiting_review" && pode("receipts.review") ? (
              <Button key="a" size="sm" variant="suave" onClick={async () => {
                const extra = Number(i.received_qty) + Number(i.damaged_qty) + Number(i.pending_checked) - Number(i.expected_qty);
                await executar(`receipt-items/${i.id}/approve-overage`, { approved_qty: Math.max(extra, 0), note: motivo || "Sobra aceita pelo supervisor" }, { ok: "Sobra aprovada." });
                await det.recarregar();
              }}>Aprovar sobra</Button>) : null] }))} />
      </Painel>
      {pode("receipts.review") && aberto && (
        <Painel titulo="Supervisor">
          <Campo id="motivo" rotulo="Motivo / observação" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="suave" disabled={!motivo || enviando} onClick={async () => { await executar(`receipts/${id}/close-short`, { reason: motivo }, { ok: "Encerrado; falta registrada como ocorrência." }); await det.recarregar(); }}>Encerrar com falta</Button>
            <Button variant="perigo" disabled={!motivo || enviando} onClick={async () => { await executar(`receipts/${id}/cancel`, { reason: motivo }, { ok: "Recebimento cancelado." }); await det.recarregar(); }}>Cancelar recebimento</Button>
          </div>
        </Painel>
      )}
      <Painel titulo="Leituras">
        <Tabela colunas={[{ titulo: "Quando" }, { titulo: "Produto" }, { titulo: "Qtd base" }, { titulo: "Lote/Série" }, { titulo: "Resultado" }, { titulo: "Estoque" }, { titulo: "" }]}
          linhas={det.dados!.checks.map((c) => ({ chave: c.id, celulas: [dataHora(c.created_at), c.sku, `${qtd(c.quantity)} (${c.unit_code})`, c.lot_code ?? c.serial ?? "—", c.outcome,
            c.movement_id ? "Confirmado no WMS" : "Aguardando confirmação",
            !c.movement_id && pode("receipts.review") ? <Button key="v" size="sm" variant="fantasma" onClick={async () => {
              await executar(`receipt-checks/${c.id}/void`, { reason: motivo || "Leitura incorreta" }, { ok: "Leitura removida.", chave: crypto.randomUUID() }); await det.recarregar(); }}>Remover</Button> : null] }))} />
      </Painel>
    </div>
  );
}
