"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados, wmsPost } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, CampoNumero, Estado, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

const PERFIS: Record<string, string> = { admin: "Administrador", supervisor: "Supervisor", receiving: "Recebimento", stocker: "Estoquista", picker: "Separador", checker: "Conferente", shipping: "Expedição", auditor: "Gestor/auditor" };
type Membro = { id: string; user_id: string; active: boolean; all_warehouses: boolean; full_name: string | null; roles: string[] | null; warehouses: string[] | null };
type Local = { id: string; code: string; type: string; pickable: boolean; capacity_units: number | null; blocked: boolean; block_reason: string | null; counting: boolean; zone: string | null; quantity: number };
type Prod = { id: string; sku: string; description: string; gtin: string | null; base_unit: string; lot_control: boolean; expiry_control: boolean; serial_control: boolean; kit_policy: string; units: { code: string; factor: number }[] | null; barcodes: string[] | null };

export default function Administracao() {
  const { org, armazem, pode, recarregar } = useWms();
  const { executar, enviando, mensagem } = useComando();
  const membros = useDados<Membro[]>(pode("users.manage") ? "admin/members" : null, { organization_id: org.organization_id });
  const locais = useDados<Local[]>("locations", { warehouse_id: armazem!.id, limite: 200 });
  const [busca, setBusca] = useState("");
  const produtos = useDados<Prod[]>("products", { q: busca, limite: 100 });
  const [wh, setWh] = useState({ code: "", name: "" });
  const [loc, setLoc] = useState({ code: "", type: "storage", zone: "", pickable: false, cap: 0 });
  const [zona, setZona] = useState({ code: "", name: "" });
  const [p, setP] = useState({ sku: "", description: "", gtin: "", lot: false, exp: false, serial: false, minShelf: 0, kit: "none" });
  const [unidade, setUnidade] = useState({ product: "", code: "CX", factor: 12, barcode: "" });
  const [convite, setConvite] = useState({ email: "", nome: "", roles: ["picker"] as string[], todos: false });
  const ok = (t: string) => ({ ok: t, chave: crypto.randomUUID() });

  return (
    <div className="space-y-4">
      <Titulo titulo="Administração" descricao="Alterações de perfil, armazém e cadastro ficam na auditoria. Administração exige MFA." />
      <Mensagem m={mensagem} />
      {pode("users.manage") && (
        <Painel titulo="Usuários (somente por convite)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="c-email" rotulo="E-mail" type="email" value={convite.email} onChange={(e) => setConvite({ ...convite, email: e.target.value })} />
            <Campo id="c-nome" rotulo="Nome" value={convite.nome} onChange={(e) => setConvite({ ...convite, nome: e.target.value })} />
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="size-5" checked={convite.todos} onChange={(e) => setConvite({ ...convite, todos: e.target.checked })} /> Todos os armazéns (senão: o armazém atual)</label>
          </div>
          <fieldset className="mt-3 flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-suave">Perfis</legend>
            {Object.entries(PERFIS).map(([k, v]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={convite.roles.includes(k)} onChange={(e) => setConvite({ ...convite, roles: e.target.checked ? [...convite.roles, k] : convite.roles.filter((r) => r !== k) })} />{v}</label>)}
          </fieldset>
          <Button className="mt-3" disabled={enviando || !convite.email || !convite.roles.length} onClick={async () => {
            try {
              await wmsPost("admin/members/invite", { organization_id: org.organization_id, email: convite.email, full_name: convite.nome, roles: convite.roles, all_warehouses: convite.todos, warehouse_ids: convite.todos ? [] : [armazem!.id] });
              alert("Convite enviado.");
              setConvite({ email: "", nome: "", roles: ["picker"], todos: false });
              await membros.recarregar();
            } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
          }}>Convidar</Button>
          <div className="mt-4">
            <Tabela colunas={[{ titulo: "Nome" }, { titulo: "Perfis" }, { titulo: "Armazéns" }, { titulo: "Situação" }, { titulo: "" }]}
              linhas={(membros.dados ?? []).map((m) => ({ chave: m.id, celulas: [m.full_name || m.user_id.slice(0, 8), (m.roles ?? []).map((r) => PERFIS[r] ?? r).join(", "),
                m.all_warehouses ? "Todos" : (m.warehouses ?? []).map((w) => org.warehouses.find((x) => x.id === w)?.code ?? "?").join(", ") || "Nenhum",
                <Estado key="s" valor={m.active ? "active" : "cancelled"} />,
                <Button key="b" size="sm" variant={m.active ? "perigo" : "suave"} onClick={async () => { await executar(`admin/members/${m.id}/active`, { active: !m.active }, ok(m.active ? "Acesso desativado: novas operações são negadas mesmo com sessão aberta." : "Reativado.")); await membros.recarregar(); }}>{m.active ? "Desativar" : "Reativar"}</Button>] }))} />
          </div>
        </Painel>
      )}
      {pode("admin.settings") && (
        <Painel titulo="Armazéns">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="wh-code" rotulo="Código" value={wh.code} onChange={(e) => setWh({ ...wh, code: e.target.value.toUpperCase() })} />
            <Campo id="wh-name" rotulo="Nome" value={wh.name} onChange={(e) => setWh({ ...wh, name: e.target.value })} />
            <Button className="self-end" disabled={enviando || !wh.code || !wh.name} onClick={async () => { const r = await executar("admin/warehouses", { organization_id: org.organization_id, code: wh.code, name: wh.name }, { ok: "Armazém criado com endereços técnicos (RECEB, STAGE, QUAR, DEVOL, TRANSITO, DOCA-1)." }); if (r) recarregar(); }}>Criar armazém</Button>
          </div>
          <p className="mt-3 text-sm">Armazém atual <strong>{armazem!.code}</strong>:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="suave" onClick={() => executar(`admin/warehouses/${armazem!.id}`, { require_fiscal_release: true }, ok("Saída exige liberação fiscal."))}>Exigir liberação fiscal na saída</Button>
            <Button size="sm" variant="suave" onClick={() => { if (confirm("Permitir despacho sem nota autorizada? Use só se a política fiscal da empresa permitir.")) void executar(`admin/warehouses/${armazem!.id}`, { require_fiscal_release: false }, ok("Liberação fiscal não exigida neste armazém.")); }}>Não exigir liberação fiscal</Button>
          </div>
        </Painel>
      )}
      {pode("locations.manage") && (
        <Painel titulo={`Zonas e endereços · ${armazem!.code}`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="z-code" rotulo="Zona (código)" value={zona.code} onChange={(e) => setZona({ ...zona, code: e.target.value.toUpperCase() })} />
            <Campo id="z-name" rotulo="Nome da zona" value={zona.name} onChange={(e) => setZona({ ...zona, name: e.target.value })} />
            <Button className="self-end" variant="suave" disabled={!zona.code} onClick={() => executar("admin/zones", { warehouse_id: armazem!.id, code: zona.code, name: zona.name }, ok("Zona salva."))}>Salvar zona</Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            <Campo id="l-code" rotulo="Endereço" value={loc.code} onChange={(e) => setLoc({ ...loc, code: e.target.value.toUpperCase() })} placeholder="A-01-02" />
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="l-type">Tipo</label>
              <Select id="l-type" value={loc.type} onChange={(e) => setLoc({ ...loc, type: e.target.value })}>{["storage", "picking", "receiving", "staging", "packing", "dock", "quarantine", "returns", "transit"].map((t) => <option key={t}>{t}</option>)}</Select></div>
            <Campo id="l-zone" rotulo="Zona" value={loc.zone} onChange={(e) => setLoc({ ...loc, zone: e.target.value.toUpperCase() })} />
            <CampoNumero id="l-cap" rotulo="Capacidade (un, 0 = livre)" valor={loc.cap} onChange={(cap) => setLoc({ ...loc, cap })} />
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="size-5" checked={loc.pickable} onChange={(e) => setLoc({ ...loc, pickable: e.target.checked })} /> Separação (pickable)</label>
          </div>
          <Button className="mt-3" disabled={enviando || !loc.code} onClick={async () => { await executar("admin/locations", { warehouse_id: armazem!.id, code: loc.code, type: loc.type, zone_code: loc.zone || null, pickable: loc.pickable, capacity_units: loc.cap > 0 ? loc.cap : null }, ok("Endereço salvo.")); await locais.recarregar(); }}>Salvar endereço</Button>
          <div className="mt-4">
            <Tabela colunas={[{ titulo: "Endereço" }, { titulo: "Tipo" }, { titulo: "Zona" }, { titulo: "Separação" }, { titulo: "Ocupação" }, { titulo: "Situação" }, { titulo: "" }]}
              linhas={(locais.dados ?? []).map((l) => ({ chave: l.id, celulas: [l.code, l.type, l.zone ?? "—", l.pickable ? "Sim" : "Não", `${qtd(l.quantity)}${l.capacity_units ? ` / ${qtd(l.capacity_units)}` : ""}`,
                l.counting ? "Em inventário" : l.blocked ? `Bloqueado: ${l.block_reason}` : "Livre",
                <Button key="b" size="sm" variant="suave" onClick={async () => { const motivo = l.blocked ? null : prompt("Motivo do bloqueio:"); if (l.blocked || motivo) { await executar(`admin/locations/${l.id}/block`, { blocked: !l.blocked, reason: motivo }, ok(l.blocked ? "Desbloqueado." : "Bloqueado.")); await locais.recarregar(); } }}>{l.blocked ? "Desbloquear" : "Bloquear"}</Button>] }))} />
          </div>
        </Painel>
      )}
      {pode("catalog.manage") && (
        <Painel titulo="Produtos (manuais; os do ERP chegam pela integração)">
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo id="p-sku" rotulo="SKU" value={p.sku} onChange={(e) => setP({ ...p, sku: e.target.value })} />
            <Campo id="p-desc" rotulo="Descrição" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
            <Campo id="p-gtin" rotulo="GTIN (texto, com zeros)" value={p.gtin} onChange={(e) => setP({ ...p, gtin: e.target.value.replace(/\D/g, "") })} />
            <CampoNumero id="p-shelf" rotulo="Validade mínima p/ expedir (dias)" valor={p.minShelf} onChange={(minShelf) => setP({ ...p, minShelf })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.lot} onChange={(e) => setP({ ...p, lot: e.target.checked, exp: e.target.checked && p.exp })} /> Controla lote</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.exp} disabled={!p.lot} onChange={(e) => setP({ ...p, exp: e.target.checked })} /> Controla validade</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={p.serial} onChange={(e) => setP({ ...p, serial: e.target.checked })} /> Controla série</label>
            <label className="flex items-center gap-2">Kit:
              <Select aria-label="Política de kit" value={p.kit} onChange={(e) => setP({ ...p, kit: e.target.value })}><option value="none">Não é kit</option><option value="components">Reserva componentes</option><option value="assembled">Kit montado (estoque próprio)</option></Select></label>
          </div>
          <Button className="mt-3" disabled={enviando || !p.sku || !p.description} onClick={async () => { await executar("admin/products", { organization_id: org.organization_id, sku: p.sku, description: p.description, gtin: p.gtin || null,
            lot_control: p.lot, expiry_control: p.exp, serial_control: p.serial, min_shelf_days: p.minShelf, kit_policy: p.kit }, ok("Produto salvo.")); await produtos.recarregar(); }}>Salvar produto</Button>
          <h3 className="mt-4 font-semibold">Unidade logística (fator explícito)</h3>
          <div className="grid gap-3 sm:grid-cols-5">
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="u-p">Produto</label>
              <Select id="u-p" value={unidade.product} onChange={(e) => setUnidade({ ...unidade, product: e.target.value })}><option value="">Escolha…</option>{(produtos.dados ?? []).map((x) => <option key={x.id} value={x.id}>{x.sku}</option>)}</Select></div>
            <Campo id="u-c" rotulo="Código da unidade" value={unidade.code} onChange={(e) => setUnidade({ ...unidade, code: e.target.value.toUpperCase() })} />
            <CampoNumero id="u-f" rotulo="Fator (unidades base)" valor={unidade.factor} onChange={(factor) => setUnidade({ ...unidade, factor })} />
            <Campo id="u-b" rotulo="Código de barras da unidade" value={unidade.barcode} onChange={(e) => setUnidade({ ...unidade, barcode: e.target.value })} />
            <Button className="self-end" variant="suave" disabled={!unidade.product || !(unidade.factor > 0)} onClick={async () => { await executar(`admin/products/${unidade.product}/units`, { code: unidade.code, factor: unidade.factor, barcode: unidade.barcode || null }, ok("Unidade salva.")); await produtos.recarregar(); }}>Salvar unidade</Button>
          </div>
          <div className="mt-4">
            <Campo id="busca-p" rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Tabela colunas={[{ titulo: "SKU" }, { titulo: "Descrição" }, { titulo: "GTIN" }, { titulo: "Controles" }, { titulo: "Unidades" }, { titulo: "Códigos" }]}
              linhas={(produtos.dados ?? []).map((x) => ({ chave: x.id, celulas: [x.sku, x.description, x.gtin ?? "—",
                [x.lot_control && "lote", x.expiry_control && "validade", x.serial_control && "série", x.kit_policy !== "none" && `kit (${x.kit_policy})`].filter(Boolean).join(", ") || "—",
                (x.units ?? []).map((u) => `${u.code}=${qtd(u.factor)}`).join(", ") || x.base_unit, (x.barcodes ?? []).join(", ") || "—"] }))} />
          </div>
        </Painel>
      )}
    </div>
  );
}
