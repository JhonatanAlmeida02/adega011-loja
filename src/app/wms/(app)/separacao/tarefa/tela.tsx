"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { bip, Campo, CampoLeitura, CampoNumero, Estado, Mensagem, Painel, Progresso, qtd, Titulo, type CampoLeituraRef, type Leitura } from "@/components/wms/ui";

type Item = { id: string; quantity: number; picked_qty: number; short_qty: number; status: string; location: string; sku: string; description: string; image_url: string | null;
  lot_control: boolean; serial_control: boolean; base_unit: string; lot: string | null; expiry_date: string | null };
type Det = { task: { id: string; status: string; number: string; order_status: string; hold_reason: string | null; version: number; assigned_to: string | null }; items: Item[] };

export default function TarefaSeparacao({ id }: { id: string }) {
  const router = useRouter();
  const { pode } = useWms();
  const det = useDados<Det>(`picking-tasks/${id}`);
  const { executar, enviando, mensagem, setMensagem } = useComando();
  const leitor = useRef<CampoLeituraRef>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [serie, setSerie] = useState("");
  const [ultima, setUltima] = useState<Leitura | null>(null);
  const t = det.dados?.task;
  const pendentes = (det.dados?.items ?? []).filter((i) => i.status === "open");
  const atual = pendentes[0];
  const bloqueado = t && (t.order_status === "cancelled" || t.order_status === "on_hold" || !["open", "in_progress"].includes(t.status));

  const enviar = async (l: Leitura, produto?: string) => {
    if (!atual || !local) return;
    const r = await executar<{ sku: string; quantity_base: number; item_remaining: number }>(`picking-tasks/${id}/scan`, {
      scan_id: l.scanId, location_code: local, code: l.codigo, quantity: l.quantidade ?? quantidade,
      lot_code: l.lote ?? atual.lot, serial: l.serie ?? (serie || null), product_id: produto ?? null,
    }, { ok: (x) => `${x.sku}: ${qtd(x.quantity_base)} separado(s). Faltam ${qtd(x.item_remaining)} neste endereço.`, chave: l.scanId });
    bip(Boolean(r));
    if (r) {
      setSerie("");
      setQuantidade(1);
      if (r.item_remaining <= 0) setLocal(null);
      await det.recarregar();
    }
    leitor.current?.focar();
  };

  const ler = async (l: Leitura) => {
    if (!atual) return;
    if (!local) {
      const ok = l.codigo.toUpperCase() === atual.location;
      bip(ok);
      setMensagem(ok ? null : { tipo: "erro", texto: `Endereço lido (${l.codigo}) diferente do indicado (${atual.location}).` });
      if (ok) setLocal(atual.location);
      return;
    }
    setUltima(l);
    await enviar(l);
  };

  // Código ambíguo: o servidor devolve os candidatos; o operador escolhe (nunca arbitrário).
  const candidatos = mensagem?.tipo === "erro" && Array.isArray(mensagem.dados) && (mensagem.dados as { product_id?: string }[])[0]?.product_id
    ? (mensagem.dados as { product_id: string; sku: string; description: string }[]) : null;

  if (!t) return <p className="text-suave">{det.erro?.message ?? "Carregando…"}</p>;
  const total = det.dados!.items.reduce((a, i) => a + Number(i.quantity), 0);
  const feito = det.dados!.items.reduce((a, i) => a + Number(i.picked_qty) + Number(i.short_qty), 0);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Titulo titulo={`Separação · pedido ${t.number}`} acoes={<Estado valor={t.status} />} />
      <Progresso feito={feito} total={total} />
      {bloqueado && <p role="alert" className="rounded-lg border border-perigo/60 p-3 text-sm">Separação bloqueada: pedido {t.order_status}{t.hold_reason ? ` (${t.hold_reason})` : ""}. Não avance; devolva o que já foi separado conforme a tarefa de retorno.</p>}
      {atual && !bloqueado ? (
        <Painel>
          <p className="text-sm text-suave">Vá até o endereço</p>
          <p className="font-mono text-4xl font-bold">{atual.location}</p>
          <div className="mt-3 flex gap-3">
            {atual.image_url && (
              // eslint-disable-next-line @next/next/no-img-element -- imagem externa do cadastro, sem otimização
              <img src={atual.image_url} alt="" className="size-20 rounded object-cover" />
            )}
            <div>
              <p className="font-mono text-lg font-bold">{atual.sku}</p>
              <p>{atual.description}</p>
              <p className="text-sm">Separar <strong className="text-2xl">{qtd(Number(atual.quantity) - Number(atual.picked_qty) - Number(atual.short_qty))}</strong> {atual.base_unit}
                {atual.lot && <> · lote <strong>{atual.lot}</strong> (val. {atual.expiry_date ?? "—"})</>}</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {local && <CampoNumero id="q" rotulo="Quantidade (na unidade do código lido)" valor={quantidade} onChange={setQuantidade} />}
            {local && atual.serial_control && <Campo id="serie" rotulo="Número de série" value={serie} onChange={(e) => setSerie(e.target.value)} />}
            <CampoLeitura ref={leitor} id="leitura" rotulo={local ? "Leia o produto" : "Leia o endereço"} onLeitura={(l) => void ler(l)} desabilitado={enviando} />
          </div>
          {candidatos && ultima && (
            <div className="mt-3 rounded-lg border border-amarelo-texto/60 p-3">
              <p className="mb-2 text-sm font-semibold">Código ambíguo: escolha o produto que está na sua mão</p>
              {candidatos.map((c) => <Button key={c.product_id} variant="suave" className="mb-2 w-full justify-start" onClick={() => void enviar(ultima, c.product_id)}>{c.sku} · {c.description}</Button>)}
            </div>
          )}
          <Mensagem m={mensagem} />
          <div className="mt-2 flex flex-wrap gap-2">
            {local && <Button variant="fantasma" onClick={() => setLocal(null)}>Ler outro endereço</Button>}
            <Button variant="suave" disabled={enviando} onClick={async () => {
              const falta = prompt(`Quantidade NÃO encontrada em ${atual.location}:`, String(Number(atual.quantity) - Number(atual.picked_qty) - Number(atual.short_qty)));
              const motivo = falta ? prompt("Motivo (ex.: posição vazia, avaria):") : null;
              if (falta && motivo) { await executar(`picking-tasks/${id}/short`, { item_id: atual.id, quantity: Number(falta), reason: motivo }, { ok: "Falta registrada como ocorrência. Supervisor decide realocação." }); setLocal(null); await det.recarregar(); }
            }}>Registrar falta</Button>
          </div>
        </Painel>
      ) : !bloqueado && (
        <Painel>
          <p className="mb-3">Todos os itens desta tarefa foram tratados.</p>
          <Mensagem m={mensagem} />
          <Button size="lg" className="h-14 w-full" disabled={enviando || t.status === "completed"} onClick={async () => {
            const r = await executar<{ order_status: string; pending_shortage: boolean }>(`picking-tasks/${id}/complete`, { expected_version: t.version },
              { ok: (x) => x.pending_shortage ? "Tarefa encerrada. Pedido aguarda realocação da falta." : `Tarefa encerrada. Pedido ${x.order_status}.` });
            if (r) router.push("/wms/separacao");
          }}>Encerrar tarefa</Button>
        </Painel>
      )}
      {pode("picking.supervise") && t.assigned_to && <SupervisaoTarefa id={id} versao={t.version} onFeito={() => void det.recarregar()} />}
    </div>
  );
}

function SupervisaoTarefa({ id, versao, onFeito }: { id: string; versao: number; onFeito: () => void }) {
  const { executar, mensagem } = useComando();
  return (
    <Painel titulo="Supervisor">
      <Button variant="suave" onClick={async () => { const r = await executar(`picking-tasks/${id}/assign`, { user_id: null, expected_version: versao }, { ok: "Tarefa liberada para outro operador." }); if (r) onFeito(); }}>Liberar atribuição</Button>
      <Mensagem m={mensagem} />
    </Painel>
  );
}
