"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados, wmsPost } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { AvisoSimulado, Campo, dataHora, Estado, Mensagem, Painel, Tabela, Titulo } from "@/components/wms/ui";

type Conn = { id: string; name: string; adapter: string; status: string; status_reason: string | null; write_enabled: boolean; eligible_order_statuses: string[]; settings: Record<string, unknown>; access_token_expires_at: string | null };
type Integ = {
  connections: Conn[];
  deposits: { connection_id: string; external_id: string; name: string; warehouse_id: string | null }[];
  policies: { connection_id: string; warehouse_id: string; outbound_policy: string; inbound_policy: string; validated_at: string | null; notes: string }[];
  outbox: { status: string; n: number; oldest: string }[];
  inbox: { status: string; n: number; oldest: string }[];
  jobs: { id: string; kind: string; status: string; last_error: string | null; created_at: string; finished_at: string | null }[];
};
type Ev = { id: string; event_type: string; status: string; blocked_reason: string | null; attempts: number; last_error: string | null; external_ref: string | null; created_at: string; needs_verification: boolean };
type In = { id: string; source: string; event_type: string; entity_external_id: string | null; status: string; attempts: number; last_error: string | null; received_at: string };

export default function Integracoes() {
  const { org, pode } = useWms();
  const oauth = useSearchParams().get("oauth");
  const dados = useDados<Integ>("integrations", { organization_id: org.organization_id });
  const [filtro, setFiltro] = useState("");
  const eventos = useDados<Ev[]>("integration-events", { organization_id: org.organization_id, status: filtro });
  const inbox = useDados<In[]>("integration-inbox", { organization_id: org.organization_id });
  const { executar, enviando, mensagem } = useComando();
  const gerir = pode("integrations.manage");
  const recarregar = () => { void dados.recarregar(); void eventos.recarregar(); void inbox.recarregar(); };
  return (
    <div className="space-y-4">
      <Titulo titulo="Integrações · ERP Olist" descricao="WMS confirma a operação física; o ERP recebe o lançamento conforme a política validada por depósito." />
      {oauth && <p role="status" className="rounded-lg border border-borda p-3 text-sm">Autorização Olist: {oauth === "ok" ? "concluída." : `não concluída (${oauth}).`}</p>}
      <Mensagem m={mensagem} />
      {(dados.dados?.connections ?? []).map((c) => (
        <Painel key={c.id} titulo={`${c.name} · ${c.adapter === "mock" ? "simulador" : "Olist API V3"}`}>
          {c.adapter === "mock" && <AvisoSimulado />}
          <p className="mb-2 text-sm"><Estado valor={c.status} /> {c.status_reason ?? ""} · escrita no ERP: <strong>{c.write_enabled ? "habilitada na conexão" : "desabilitada"}</strong>
            {c.adapter !== "mock" && ` · token até ${dataHora(c.access_token_expires_at)}`}</p>
          {gerir && <ConfigConexao c={c} onFeito={recarregar} executar={executar} enviando={enviando} />}
          <h3 className="mt-4 font-semibold">Depósitos do ERP → armazéns</h3>
          <Tabela colunas={[{ titulo: "Depósito" }, { titulo: "Armazém WMS" }, { titulo: "Política (saída / entrada)" }]}
            linhas={(dados.dados?.deposits ?? []).filter((d) => d.connection_id === c.id).map((d) => {
              const pol = dados.dados!.policies.find((p) => p.connection_id === c.id && p.warehouse_id === d.warehouse_id);
              return { chave: d.external_id, celulas: [`${d.external_id} · ${d.name}`,
                gerir ? <Select key="w" aria-label={`Armazém do depósito ${d.external_id}`} value={d.warehouse_id ?? ""} onChange={async (e) => { if (e.target.value) { await executar(`integrations/connections/${c.id}/deposits/map`, { external_id: d.external_id, warehouse_id: e.target.value }, { ok: "Depósito mapeado.", chave: crypto.randomUUID() }); recarregar(); } }}>
                  <option value="">Não mapeado</option>{org.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select> : (org.warehouses.find((w) => w.id === d.warehouse_id)?.code ?? "não mapeado"),
                d.warehouse_id ? (gerir ? <Politica key="p" conn={c.id} wh={d.warehouse_id} atual={pol} onFeito={recarregar} /> : `${pol?.outbound_policy ?? "undefined"} / ${pol?.inbound_policy ?? "undefined"}`) : "—"] };
            })} vazio="Importe os depósitos para mapear." />
        </Painel>
      ))}
      {gerir && <NovaConexao onFeito={recarregar} />}
      <Painel titulo="Filas">
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span>Saída (outbox): {(dados.dados?.outbox ?? []).map((o) => `${o.status} ${o.n}`).join(" · ") || "vazia"}</span>
          <span>Entrada (inbox): {(dados.dados?.inbox ?? []).map((o) => `${o.status} ${o.n}`).join(" · ") || "vazia"}</span>
        </div>
        <div className="mb-3 w-56"><label className="rotulo mb-1.5 block text-suave" htmlFor="f">Eventos de saída</label>
          <Select id="f" value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todos</option>{["pending", "processing", "sent", "failed", "unknown", "blocked", "cancelled"].map((s) => <option key={s}>{s}</option>)}</Select></div>
        <Tabela colunas={[{ titulo: "Criado" }, { titulo: "Evento" }, { titulo: "Situação" }, { titulo: "Tentativas" }, { titulo: "Detalhe" }, { titulo: "" }]}
          linhas={(eventos.dados ?? []).map((e) => ({ chave: e.id, celulas: [dataHora(e.created_at), e.event_type, <Estado key="s" valor={e.status} />, e.attempts,
            e.blocked_reason ?? e.last_error ?? e.external_ref ?? (e.needs_verification ? "verificar efeito externo" : "—"),
            gerir && ["failed", "unknown", "blocked"].includes(e.status) ? <AcoesEvento key="a" ev={e} onFeito={recarregar} /> : null] }))} />
        <h3 className="mt-4 font-semibold">Avisos recebidos (webhook/consulta)</h3>
        <Tabela colunas={[{ titulo: "Recebido" }, { titulo: "Origem" }, { titulo: "Tipo" }, { titulo: "ID" }, { titulo: "Situação" }, { titulo: "Erro" }, { titulo: "" }]}
          linhas={(inbox.dados ?? []).map((e) => ({ chave: e.id, celulas: [dataHora(e.received_at), e.source, e.event_type, e.entity_external_id ?? "—", <Estado key="s" valor={e.status} />, e.last_error ?? "—",
            gerir && e.status === "failed" ? <Button key="r" size="sm" variant="suave" onClick={async () => { await executar(`integration-inbox/${e.id}/retry`, {}, { ok: "Reenfileirado.", chave: crypto.randomUUID() }); recarregar(); }}>Reprocessar</Button> : null] }))} />
        <h3 className="mt-4 font-semibold">Sincronizações</h3>
        <ul className="text-sm">{(dados.dados?.jobs ?? []).map((j) => <li key={j.id}>{j.kind} · <Estado valor={j.status} /> · {dataHora(j.created_at)} {j.last_error ? `· ${j.last_error}` : ""}</li>)}</ul>
      </Painel>
    </div>
  );
}

function ConfigConexao({ c, onFeito, executar, enviando }: { c: Conn; onFeito: () => void; executar: ReturnType<typeof useComando>["executar"]; enviando: boolean }) {
  const [elegiveis, setElegiveis] = useState(c.eligible_order_statuses.join(","));
  const [cancelados, setCancelados] = useState(((c.settings.cancelled_order_statuses as string[] | undefined) ?? ["2"]).join(","));
  const lista = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id={`el-${c.id}`} rotulo="Situações do pedido elegíveis (códigos do ERP)" value={elegiveis} onChange={(e) => setElegiveis(e.target.value)} placeholder="ex.: 3,4" />
        <Campo id={`ca-${c.id}`} rotulo="Situações que cancelam (códigos do ERP)" value={cancelados} onChange={(e) => setCancelados(e.target.value)} />
      </div>
      <p className="text-xs text-suave">Referência V3 documentada: 0 Aberta, 3 Aprovada, 4 Preparando envio, 1 Faturada, 7 Pronto envio, 5 Enviada, 6 Entregue, 2 Cancelada… A escolha é decisão de negócio.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={enviando} onClick={async () => { await executar(`integrations/connections/${c.id}`, { eligible_statuses: lista(elegiveis), cancelled_statuses: lista(cancelados) }, { ok: "Configuração salva.", chave: crypto.randomUUID() }); onFeito(); }}>Salvar situações</Button>
        <Button size="sm" variant={c.write_enabled ? "perigo" : "suave"} disabled={enviando} onClick={async () => {
          if (!c.write_enabled && !confirm("Habilitar escrita no ERP? Só faça isso depois de validar a política de lançamento em ambiente apropriado.")) return;
          await executar(`integrations/connections/${c.id}`, { write_enabled: !c.write_enabled }, { ok: "Escrita atualizada.", chave: crypto.randomUUID() }); onFeito();
        }}>{c.write_enabled ? "Desabilitar escrita" : "Habilitar escrita"}</Button>
        <Button size="sm" variant="suave" disabled={enviando} onClick={async () => { await executar(`integrations/connections/${c.id}`, { paused: c.status === "active" }, { ok: "Atualizado.", chave: crypto.randomUUID() }); onFeito(); }}>{c.status === "paused" ? "Retomar" : "Pausar"}</Button>
        {c.adapter === "olist_v3" && (
          <Button size="sm" onClick={async () => {
            try {
              const r = await wmsPost<{ url: string }>("authorize", { connection_id: c.id }, crypto.randomUUID(), "/api/integrations/olist/");
              location.href = r.url;
            } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
          }}>{c.status === "active" ? "Reautorizar na Olist" : "Autorizar na Olist"}</Button>
        )}
        {["import_deposits", "import_products", "import_orders", "reconcile_stock"].map((k) => (
          <Button key={k} size="sm" variant="suave" disabled={enviando} onClick={async () => { await executar(`integrations/connections/${c.id}/sync`, { kind: k }, { ok: (r: { already_queued: boolean }) => r.already_queued ? "Já estava na fila." : "Sincronização enfileirada (o worker processa).", chave: crypto.randomUUID() }); onFeito(); }}>
            {{ import_deposits: "Importar depósitos", import_products: "Importar produtos", import_orders: "Buscar pedidos", reconcile_stock: "Conciliar estoque" }[k]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Politica({ conn, wh, atual, onFeito }: { conn: string; wh: string; atual?: { outbound_policy: string; inbound_policy: string; validated_at: string | null }; onFeito: () => void }) {
  const [saida, setSaida] = useState(atual?.outbound_policy ?? "undefined");
  const [entrada, setEntrada] = useState(atual?.inbound_policy ?? "undefined");
  const { executar, enviando, mensagem } = useComando();
  return (
    <div className="space-y-2 text-sm">
      <Select aria-label="Política de saída" value={saida} onChange={(e) => setSaida(e.target.value)}>
        <option value="undefined">Saída: não definida (nada é enviado)</option><option value="erp_on_invoice">Saída: ERP baixa no faturamento/pedido (WMS só reconhece)</option><option value="wms_on_dispatch">Saída: WMS lança ao despachar</option>
      </Select>
      <Select aria-label="Política de entrada" value={entrada} onChange={(e) => setEntrada(e.target.value)}>
        <option value="undefined">Entrada: não definida</option><option value="erp_on_document">Entrada: nota/ordem de compra lança no ERP</option><option value="wms_on_receipt">Entrada: WMS lança ao confirmar recebimento</option>
      </Select>
      <p className="text-xs text-suave">{atual?.validated_at ? `Validada em ${dataHora(atual.validated_at)}` : "Não validada"}</p>
      <Button size="sm" disabled={enviando} onClick={async () => {
        const nota = prompt("Como a política foi validada (ambiente, data, quem)? Sem validação, deixe vazio para salvar como não validada.") ?? "";
        await executar(`integrations/connections/${conn}/policy`, { warehouse_id: wh, outbound: saida, inbound: entrada, validated: nota.trim().length > 0, notes: nota }, { ok: "Política salva.", chave: crypto.randomUUID() });
        onFeito();
      }}>Salvar política</Button>
      <Mensagem m={mensagem} />
    </div>
  );
}

function AcoesEvento({ ev, onFeito }: { ev: Ev; onFeito: () => void }) {
  const { executar, enviando } = useComando();
  const agir = async (action: "retry" | "mark_applied" | "cancel") => {
    const exigeNota = action !== "retry" || ev.status === "unknown";
    const nota = exigeNota ? prompt(ev.status === "unknown" && action === "retry"
      ? "Resultado desconhecido: confirme no ERP que o lançamento NÃO existe e descreva a verificação:"
      : "Descreva a análise (fica na auditoria):") : "";
    if (exigeNota && !nota) return;
    await executar(`integration-events/${ev.id}/resolve`, { action, note: nota }, { ok: "Atualizado." });
    onFeito();
  };
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="suave" disabled={enviando} onClick={() => void agir("retry")}>Reprocessar</Button>
      {["unknown", "failed"].includes(ev.status) && <Button size="sm" variant="suave" disabled={enviando} onClick={() => void agir("mark_applied")}>Já aplicado no ERP</Button>}
      <Button size="sm" variant="fantasma" disabled={enviando} onClick={() => void agir("cancel")}>Cancelar</Button>
    </div>
  );
}

function NovaConexao({ onFeito }: { onFeito: () => void }) {
  const { org } = useWms();
  const { executar, enviando, mensagem } = useComando();
  const [adapter, setAdapter] = useState("mock");
  return (
    <Painel titulo="Nova conexão">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64"><label htmlFor="ad" className="rotulo mb-1.5 block text-suave">Tipo</label>
          <Select id="ad" value={adapter} onChange={(e) => setAdapter(e.target.value)}><option value="mock">Simulador (desenvolvimento)</option><option value="olist_v3">Olist API V3 (OAuth)</option></Select></div>
        <Button disabled={enviando} onClick={async () => { await executar("integrations/connections", { organization_id: org.organization_id, adapter, name: adapter === "mock" ? "ERP simulado" : "Olist ERP" },
          { ok: (r: { webhook_ref: string }) => `Conexão criada. URL do webhook: ${location.origin}/api/webhooks/olist/${r.webhook_ref}?tipo=vendas (repita para enviados, estoque e notas).` }); onFeito(); }}>Criar</Button>
      </div>
      <Mensagem m={mensagem} />
    </Painel>
  );
}
