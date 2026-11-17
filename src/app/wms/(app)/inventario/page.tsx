"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { Campo, CampoNumero, dataHora, Estado, Mensagem, Painel, Tabela, Titulo } from "@/components/wms/ui";

type S = { id: string; code: string; kind: string; status: string; current_round: number; max_rounds: number; locations: number; created_at: string };
const TIPO: Record<string, string> = { cycle: "Cíclico", full: "Geral", initial_load: "Carga inicial" };

export default function Inventarios() {
  const { armazem, pode } = useWms();
  const router = useRouter();
  const lista = useDados<S[]>("inventory-sessions", { warehouse_id: armazem!.id });
  const { executar, enviando, mensagem } = useComando();
  const [tipo, setTipo] = useState("cycle");
  const [locais, setLocais] = useState("");
  const [tolQ, setTolQ] = useState(0);
  const [tolP, setTolP] = useState(0);
  const [rodadas, setRodadas] = useState(2);
  return (
    <div className="space-y-4">
      <Titulo titulo="Inventário" descricao="Contagem cega: quem conta não vê o saldo. Endereços em contagem ficam bloqueados para movimento e reserva." />
      {pode("inventory.manage") && (
        <Painel titulo="Novo inventário">
          <div className="grid gap-3 sm:grid-cols-5">
            <div><label className="rotulo mb-1.5 block text-suave" htmlFor="tipo">Tipo</label>
              <Select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div className="sm:col-span-2"><Campo id="locais" rotulo="Endereços (separados por vírgula)" value={locais} onChange={(e) => setLocais(e.target.value)} placeholder="A-01, A-02" /></div>
            <CampoNumero id="tq" rotulo="Tolerância (unidades)" valor={tolQ} onChange={setTolQ} />
            <CampoNumero id="tp" rotulo="Tolerância (%)" valor={tolP} onChange={setTolP} />
            <CampoNumero id="rod" rotulo="Máx. rodadas" valor={rodadas} onChange={setRodadas} min={1} />
          </div>
          {tipo === "initial_load" && <p className="mt-2 text-xs text-suave">Carga inicial por endereço: o saldo só entra depois da aprovação de um supervisor distinto. Importar o total do ERP não distribui saldo entre endereços.</p>}
          <Mensagem m={mensagem} />
          <Button className="mt-3" disabled={enviando || !locais.trim()} onClick={async () => {
            const r = await executar<{ session_id: string }>("inventory-sessions", { warehouse_id: armazem!.id, kind: tipo, location_codes: locais.split(",").map((s) => s.trim()).filter(Boolean),
              tolerance_qty: tolQ, tolerance_pct: tolP, max_rounds: rodadas }, { ok: "Inventário criado." });
            if (r) router.push(`/wms/inventario/sessao?id=${r.session_id}`);
          }}>Criar</Button>
        </Painel>
      )}
      <Painel>
        <Tabela colunas={[{ titulo: "Código" }, { titulo: "Tipo" }, { titulo: "Endereços" }, { titulo: "Rodada" }, { titulo: "Situação" }, { titulo: "Criado" }]}
          linhas={(lista.dados ?? []).map((s) => ({ chave: s.id, onClick: () => router.push(`/wms/inventario/sessao?id=${s.id}`), celulas: [s.code, TIPO[s.kind], s.locations, `${s.current_round}/${s.max_rounds}`, <Estado key="s" valor={s.status} />, dataHora(s.created_at)] }))} />
      </Painel>
    </div>
  );
}
