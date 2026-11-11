"use client";

import { useState } from "react";
import { combina } from "@/lib/busca";
import { Plus, Search, Trash2 } from "lucide-react";
import type { Produto } from "@/lib/tipos";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/campos";

export interface ComponenteKit { componente_id: string; quantidade: number }

/** Draft recipe: saved together with the product by the parent form. */
export function EditorKit({ produtos, value, onChange, disabled = false }: {
  produtos: Produto[];
  value: ComponenteKit[];
  onChange: (linhas: ComponenteKit[]) => void;
  disabled?: boolean;
}) {
  const alterar = (index: number, campos: Partial<ComponenteKit>) =>
    onChange(value.map((l, i) => i === index ? { ...l, ...campos } : l));

  return <div className="space-y-3">
    <p className="text-sm text-suave">Selecione os produtos base e quanto cada unidade deste kit consome. A composição será salva junto com o cadastro.</p>
    {value.map((linha, index) => {
      const produto = produtos.find((p) => p.id === linha.componente_id);
      return <div key={index} className="rounded-xl border border-borda bg-superficie-2 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_44px] sm:items-end">
          <div>
            <label htmlFor={`kit-componente-${index}`} className="mb-2 block text-xs font-medium text-suave">Componente {index + 1}</label>
            <SeletorComponente key={`${index}:${linha.componente_id}`} index={index} value={linha.componente_id} disabled={disabled}
              produtos={produtos.filter((p) => p.id === linha.componente_id || !value.some((l) => l.componente_id === p.id))}
              onChange={(componente_id) => alterar(index, { componente_id })} />
          </div>
          <div>
            <label htmlFor={`kit-quantidade-${index}`} className="mb-2 block text-xs font-medium text-suave">Consumo por kit ({produto?.unidade_estoque ?? "un"})</label>
            <Input id={`kit-quantidade-${index}`} type="number" min={1} max={1000000} step={1}
              disabled={disabled} value={linha.quantidade || ""} onChange={(e) => alterar(index, { quantidade: Number(e.target.value) })} />
          </div>
          <Button type="button" size="icone" variant="fantasma" disabled={disabled} aria-label={`Remover componente ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 /></Button>
        </div>
        {produto && <p className="mt-3 text-xs text-suave">Saldo atual: {produto.estoque} {produto.unidade_estoque ?? "un"} · rende {linha.quantidade > 0 ? Math.max(0, Math.floor(produto.estoque / linha.quantidade)) : 0} kits</p>}
      </div>;
    })}
    {produtos.length === 0 && <p className="text-sm text-amarelo">Cadastre um produto simples com controle de estoque para usá-lo na composição.</p>}
    <Button type="button" size="sm" variant="suave" disabled={disabled || value.length >= 50} onClick={() => onChange([...value, { componente_id: "", quantidade: 1 }])}><Plus /> Adicionar componente</Button>
  </div>;
}


function SeletorComponente({ index, value, produtos, disabled, onChange }: {
  index: number; value: string; produtos: Produto[]; disabled: boolean; onChange: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const encontrados = produtos.filter((p) => combina(`${p.nome} ${p.familia_nome ?? ""} ${p.variacao_nome ?? ""}`, busca));
  // Keep the saved component selected even when a different product is searched.
  const opcoes = produtos.filter((p) => p.id === value || encontrados.some((v) => v.id === p.id));
  const ajudaId = `kit-busca-ajuda-${index}`;

  return <div className="space-y-2">
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
      <Input type="search" aria-label={`Pesquisar componente ${index + 1}`} placeholder="Buscar nome, sabor ou tamanho…"
        autoComplete="off" value={busca} disabled={disabled} aria-describedby={busca.trim() ? ajudaId : undefined}
        className="pl-10" onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
    </div>
    <Select id={`kit-componente-${index}`} value={value} disabled={disabled}
      onChange={(e) => { onChange(e.target.value); setBusca(""); }}>
      <option value="">Selecione um produto base…</option>
      {opcoes.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.unidade_estoque ?? "un"}</option>)}
    </Select>
    {busca.trim() && <p id={ajudaId} role="status" className="text-xs text-suave">
      {encontrados.length ? `${encontrados.length} ${encontrados.length === 1 ? "produto encontrado" : "produtos encontrados"}. Escolha na lista acima.` : "Nenhum produto encontrado. Altere a busca."}
    </p>}
  </div>;
}
