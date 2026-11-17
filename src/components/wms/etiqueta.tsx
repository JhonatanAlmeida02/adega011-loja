"use client";

import { Button } from "@/components/ui/button";
import { useComando } from "./api-cliente";
import { Mensagem } from "./ui";

/**
 * Etiqueta INTERNA do volume (ID único). Etiqueta de transportadora depende de recurso
 * homologado no ERP e não é gerada aqui. Imprimir/reimprimir só registra (auditado):
 * não cria remessa nem baixa.
 */
/** Janela de impressão com texto puro (textContent: sem HTML vindo de dados externos). */
function abrirImpressao(codigo: string, pedido: string) {
  const w = window.open("", "_blank", "width=420,height=320");
  if (!w) return;
  const doc = w.document;
  doc.title = codigo;
  const corpo = doc.createElement("div");
  corpo.style.cssText = "font-family:monospace;padding:16px;border:2px solid #000;width:320px";
  for (const [texto, tamanho] of [["VOLUME INTERNO", "12px"], [codigo, "28px"], [`Pedido ${pedido}`, "16px"]]) {
    const p = doc.createElement("p");
    p.textContent = texto;
    p.style.cssText = `margin:4px 0;font-size:${tamanho}`;
    corpo.appendChild(p);
  }
  doc.body.appendChild(corpo);
  w.print();
}

export function EtiquetaVolume({ pacote, pedido, onImpresso }: {
  pacote: { id: string; label_code: string; status: string; label_print_count?: number };
  pedido: string;
  onImpresso: () => void;
}) {
  const { executar, enviando, mensagem } = useComando();
  const imprimir = async (reimpressao: boolean) => {
    const motivo = reimpressao ? prompt("Motivo da reimpressão (fica na auditoria):") : null;
    if (reimpressao && !motivo) return;
    const r = await executar(`packages/${pacote.id}/label`, { reason: motivo }, { ok: "Impressão registrada.", chave: crypto.randomUUID() });
    if (r) {
      abrirImpressao(pacote.label_code, pedido);
      onImpresso();
    }
  };
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <p className="font-mono text-xl font-bold">{pacote.label_code}</p>
      <p className="text-sm text-suave">Volume {pacote.status === "closed" ? "fechado" : pacote.status} · pedido {pedido}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={enviando} onClick={() => void imprimir(false)}>Imprimir etiqueta</Button>
        <Button size="sm" variant="suave" disabled={enviando} onClick={() => void imprimir(true)}>Reimprimir</Button>
      </div>
      <Mensagem m={mensagem} />
    </div>
  );
}
