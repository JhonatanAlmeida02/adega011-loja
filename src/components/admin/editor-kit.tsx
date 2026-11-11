"use client";

import { useState } from "react";
import { combina } from "@/lib/busca";
import { ChevronDown, Plus, Search, X } from "lucide-react";
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

  return <details open className="group/composicao rounded-xl border border-borda">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <ChevronDown aria-hidden className="size-4 shrink-0 text-suave transition-transform group-open/composicao:rotate-180" />
      Composição
      <span className="ml-auto text-xs font-normal text-suave">{value.length} {value.length === 1 ? "componente" : "componentes"}</span>
    </summary>
    <div className="space-y-2 border-t border-borda p-3">
    <p className="text-xs text-suave">Itens fixos consumidos por kit. Vincule os ingredientes escolhidos pelo cliente na aba Adicionais.</p>
    {value.map((linha, index) => {
      const produto = produtos.find((p) => p.id === linha.componente_id);
      return <div key={index} className="rounded-lg border border-borda bg-superficie-2 px-3 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_90px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_120px_32px]">
          <div className="min-w-0">
            {produto ? <>
              <p className="text-sm font-medium">{produto.nome}</p>
              <p className="mt-0.5 text-xs text-suave">Saldo: {produto.estoque} {produto.unidade_estoque ?? "un"} · rende {linha.quantidade > 0 ? Math.max(0, Math.floor(produto.estoque / linha.quantidade)) : 0} kits</p>
            </> : <>
            <label htmlFor={`kit-componente-${index}`} className="sr-only">Componente {index + 1}</label>
            <SeletorComponente key={`${index}:${linha.componente_id}`} index={index} value={linha.componente_id} disabled={disabled}
              produtos={produtos.filter((p) => p.id === linha.componente_id || !value.some((l) => l.componente_id === p.id))}
              onChange={(componente_id) => alterar(index, { componente_id })} />
            </>}
          </div>
          <div>
            <label htmlFor={`kit-quantidade-${index}`} className="mb-1 block text-xs text-suave">Consumo ({produto?.unidade_estoque ?? "un"})</label>
            <Input id={`kit-quantidade-${index}`} type="number" min={1} max={1000000} step={1}
              className="h-8 px-2 text-sm"
              disabled={disabled} value={linha.quantidade || ""} onChange={(e) => alterar(index, { quantidade: Number(e.target.value) })} />
          </div>
          <Button type="button" size="icone-sm" variant="fantasma" disabled={disabled} aria-label={`Remover componente ${produto?.nome ?? index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><X /></Button>
        </div>
      </div>;
    })}
    {produtos.length === 0 && <p className="text-sm text-amarelo-texto">Cadastre um produto simples com controle de estoque para usá-lo na composição.</p>}
    <Button type="button" size="sm" variant="suave" disabled={disabled || value.length >= 50} onClick={() => onChange([...value, { componente_id: "", quantidade: 1 }])}><Plus /> Adicionar componente</Button>
    </div>
  </details>;
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
        className="h-8 pl-10 text-sm" onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
    </div>
    <Select id={`kit-componente-${index}`} value={value} disabled={disabled} className="h-8 text-sm"
      onChange={(e) => { onChange(e.target.value); setBusca(""); }}>
      <option value="">Selecione um produto base…</option>
      {opcoes.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.unidade_estoque ?? "un"}</option>)}
    </Select>
    {busca.trim() && <p id={ajudaId} role="status" className="text-xs text-suave">
      {encontrados.length ? `${encontrados.length} ${encontrados.length === 1 ? "produto encontrado" : "produtos encontrados"}. Escolha na lista acima.` : "Nenhum produto encontrado. Altere a busca."}
    </p>}
  </div>;
}
