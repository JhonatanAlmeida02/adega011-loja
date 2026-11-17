"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { bip, CampoLeitura, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type Tarefa = { id: string; kind: string; quantity: number; sku: string; description: string; lot: string | null; serial: string | null; from_code: string; suggested_code: string | null };
const TIPO: Record<string, string> = { putaway: "Armazenagem", replenishment: "Reabastecimento", return_to_stock: "Retorno ao estoque" };

export default function Armazenagem() {
  const { armazem, pode } = useWms();
  const lista = useDados<Tarefa[]>("putaway-tasks", { warehouse_id: armazem!.id });
  const { executar, enviando, mensagem } = useComando();
  const [sel, setSel] = useState<Tarefa | null>(null);
  const [passo, setPasso] = useState<{ origem?: string; produto?: string }>({});

  const ler = async (codigo: string) => {
    if (!sel) return;
    if (!passo.origem) {
      bip(codigo.toUpperCase() === sel.from_code);
      return setPasso({ origem: codigo });
    }
    if (!passo.produto) return setPasso({ ...passo, produto: codigo });
    const r = await executar<{ to_location: string }>(`putaway-tasks/${sel.id}/confirm`, { from_code: passo.origem, code: passo.produto, to_code: codigo },
      { ok: (x) => `Armazenado em ${x.to_location}.` });
    bip(Boolean(r));
    setPasso({});
    if (r) { setSel(null); await lista.recarregar(); }
  };

  return (
    <div className="space-y-4">
      <Titulo titulo="Armazenagem" descricao="Confirme por leitura: origem → produto → destino."
        acoes={pode("stock.putaway") && <Button variant="suave" onClick={async () => { await executar("stock/replenishment", { warehouse_id: armazem!.id }, { ok: (x: { tasks_created: number }) => `${x.tasks_created} tarefa(s) de reabastecimento.` }); await lista.recarregar(); }}>Gerar reabastecimento</Button>} />
      {sel && (
        <Painel titulo={`${TIPO[sel.kind]}: ${sel.sku}`}>
          <p className="text-lg">{sel.description}</p>
          <p className="mt-1 text-sm">Quantidade: <strong>{qtd(sel.quantity)}</strong> · Origem: <strong>{sel.from_code}</strong> · Sugestão: <strong>{sel.suggested_code ?? "escolha o destino"}</strong>
            {sel.lot && ` · Lote ${sel.lot}`}{sel.serial && ` · Série ${sel.serial}`}</p>
          <ol className="my-3 flex gap-2 text-sm">
            <li className={passo.origem ? "text-sucesso" : "font-bold"}>1. Origem {passo.origem && `✓ ${passo.origem}`}</li>
            <li className={passo.produto ? "text-sucesso" : passo.origem ? "font-bold" : "text-suave"}>2. Produto {passo.produto && "✓"}</li>
            <li className={passo.produto ? "font-bold" : "text-suave"}>3. Destino</li>
          </ol>
          <CampoLeitura id="leitura" rotulo={!passo.origem ? "Leia o endereço de origem" : !passo.produto ? "Leia o produto" : "Leia o endereço de destino"}
            onLeitura={(l) => void ler(l.codigo)} desabilitado={enviando} />
          <Mensagem m={mensagem} />
          <Button variant="fantasma" onClick={() => { setSel(null); setPasso({}); }}>Voltar</Button>
        </Painel>
      )}
      {!sel && (
        <Painel>
          <Mensagem m={mensagem} />
          <Tabela colunas={[{ titulo: "Tipo" }, { titulo: "Produto" }, { titulo: "Qtd" }, { titulo: "De" }, { titulo: "Sugestão" }, { titulo: "" }]}
            linhas={(lista.dados ?? []).map((t) => ({ chave: t.id, celulas: [TIPO[t.kind] ?? t.kind, `${t.sku} · ${t.description}`, qtd(t.quantity), t.from_code, t.suggested_code ?? "—",
              <Button key="b" size="sm" onClick={() => { setSel(t); setPasso({}); }}>Executar</Button>] }))} vazio="Nenhuma tarefa aberta." />
        </Painel>
      )}
    </div>
  );
}
