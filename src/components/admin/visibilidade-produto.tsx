"use client";

import { Select } from "@/components/ui/campos";
import { OPCOES_VISIBILIDADE, type Visibilidade } from "@/lib/visibilidade";

export function SeletorVisibilidade({ valor, onChange, rotulo = "Visibilidade na loja" }: {
  valor: Visibilidade; onChange: (v: Visibilidade) => void; rotulo?: string;
}) {
  return <Select aria-label={rotulo} value={valor} onChange={(e) => onChange(e.target.value as Visibilidade)} className="min-w-44 text-xs">
    {OPCOES_VISIBILIDADE.map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
  </Select>;
}
