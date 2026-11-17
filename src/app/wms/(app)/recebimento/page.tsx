"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { ListaItens } from "@/components/wms/seletor-produto";
import { Campo, dataHora, Estado, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Rec = { id: string; source_type: string; source_ref: string; supplier_name: string; status: string; expected: number; received: number; created_at: string };

export default function Recebimentos() {
  const { armazem, pode } = useWms();
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busca, setBusca] = useState("");
  const lista = useDados<Rec[]>("receipts", { warehouse_id: armazem!.id, status, q: busca });
  const { executar, enviando, mensagem } = useComando();
  const [doc, setDoc] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [quarentena, setQuarentena] = useState(false);
  const [itens, setItens] = useState<{ product_id: string; sku: string; quantity: number }[]>([]);
  const criar = async () => {
    const r = await executar<{ receipt_id: string }>("receipts", { warehouse_id: armazem!.id, source_ref: doc, supplier: fornecedor, quarantine: quarentena,
      items: itens.map(({ product_id, quantity }) => ({ product_id, quantity })) }, { ok: "Previsão criada (não gera estoque)." });
    if (r) router.push(`/wms/recebimento/conferir?id=${r.receipt_id}`);
  };
  return (
    <div className="space-y-4">
      <Titulo titulo="Recebimento" descricao="A previsão não cria estoque: só o que for conferido e confirmado entra no saldo." />
      <Painel>
        <div className="mb-3 flex flex-wrap gap-2">
          <Campo id="busca" rotulo="Documento ou fornecedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="w-52"><label className="rotulo mb-1.5 block text-suave" htmlFor="st">Situação</label>
            <Select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>{["expected", "receiving", "awaiting_review", "partially_received", "received", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select></div>
        </div>
        <Tabela colunas={[{ titulo: "Documento" }, { titulo: "Origem" }, { titulo: "Fornecedor" }, { titulo: "Situação" }, { titulo: "Recebido / previsto" }, { titulo: "Criado" }]}
          linhas={(lista.dados ?? []).map((r) => ({ chave: r.id, onClick: () => router.push(`/wms/recebimento/conferir?id=${r.id}`),
            celulas: [r.source_ref, r.source_type, r.supplier_name || "—", <Estado key="s" valor={r.status} />, `${qtd(r.received)} / ${qtd(r.expected)}`, dataHora(r.created_at)] }))} />
      </Painel>
      {pode("receipts.create") && (
        <Painel titulo="Previsão manual (sem documento do ERP)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="doc" rotulo="Documento (NF, romaneio)" value={doc} onChange={(e) => setDoc(e.target.value)} />
            <Campo id="forn" rotulo="Fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
          </div>
          <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={quarentena} onChange={(e) => setQuarentena(e.target.checked)} /> Receber em quarentena (inspeção antes de liberar)</label>
          <ListaItens itens={itens} onChange={setItens} />
          <Mensagem m={mensagem} />
          <Button className="mt-3" onClick={criar} disabled={enviando || !doc || !itens.length}>Criar previsão</Button>
        </Painel>
      )}
    </div>
  );
}
