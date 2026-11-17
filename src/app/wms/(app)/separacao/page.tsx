"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useComando, useDados } from "@/components/wms/api-cliente";
import { useWms } from "@/components/wms/contexto";
import { dataHora, Estado, Mensagem, Painel, qtd, Tabela, Titulo } from "@/components/wms/ui";

type T = { id: string; status: string; assigned_to: string | null; version: number; number: string; zone: string | null; wave: string | null; remaining: number; created_at: string };

export default function Separacao() {
  const { armazem, me, pode } = useWms();
  const router = useRouter();
  const [minhas, setMinhas] = useState(!pode("picking.supervise"));
  const lista = useDados<T[]>("picking-tasks", { warehouse_id: armazem!.id, mine: minhas ? 1 : 0 });
  const { executar, enviando, mensagem } = useComando();
  return (
    <div className="space-y-4">
      <Titulo titulo="Separação" descricao="Um responsável por tarefa. Pegue a tarefa antes de começar."
        acoes={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={minhas} onChange={(e) => setMinhas(e.target.checked)} /> Só minhas e livres</label>} />
      <Mensagem m={mensagem} />
      <Painel>
        <Tabela colunas={[{ titulo: "Pedido" }, { titulo: "Zona / onda" }, { titulo: "Pendente" }, { titulo: "Situação" }, { titulo: "Responsável" }, { titulo: "Criada" }, { titulo: "" }]}
          linhas={(lista.dados ?? []).map((t) => ({ chave: t.id, celulas: [t.number, `${t.zone ?? "—"}${t.wave ? ` · ${t.wave}` : ""}`, qtd(t.remaining), <Estado key="s" valor={t.status} />,
            t.assigned_to ? (t.assigned_to === me.user_id ? "Você" : "Outro operador") : "Livre", dataHora(t.created_at),
            t.assigned_to === me.user_id ? <Button key="a" size="sm" onClick={() => router.push(`/wms/separacao/tarefa?id=${t.id}`)}>Continuar</Button>
              : !t.assigned_to ? <Button key="p" size="sm" disabled={enviando} onClick={async () => {
                const r = await executar(`picking-tasks/${t.id}/claim`, { expected_version: t.version }, { ok: "Tarefa sua." });
                if (r) router.push(`/wms/separacao/tarefa?id=${t.id}`); else await lista.recarregar();
              }}>Pegar</Button> : pode("picking.supervise") ? <Button key="v" size="sm" variant="suave" onClick={() => router.push(`/wms/separacao/tarefa?id=${t.id}`)}>Ver</Button> : null] }))}
          vazio="Nenhuma tarefa disponível." />
      </Painel>
    </div>
  );
}
