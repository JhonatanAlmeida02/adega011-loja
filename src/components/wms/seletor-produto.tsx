"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/campos";
import { wmsGet } from "./api-cliente";

export type ProdutoBusca = { id: string; sku: string; description: string; serial_control: boolean; lot_control: boolean };

/** Lista de itens (produto por SKU/GTIN + quantidade) para previsões, pedidos manuais e devoluções. */
export function ListaItens({ itens, onChange }: { itens: { product_id: string; sku: string; quantity: number }[]; onChange: (i: { product_id: string; sku: string; quantity: number }[]) => void }) {
  const [codigo, setCodigo] = useState("");
  const [qtd, setQtd] = useState(1);
  const [opcoes, setOpcoes] = useState<ProdutoBusca[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const buscar = async () => {
    setErro(null);
    const r = await wmsGet<ProdutoBusca[]>("products", { q: codigo.trim(), limite: 10 });
    const exato = r.filter((p) => p.sku === codigo.trim());
    if (exato.length === 1) return adicionar(exato[0]);
    if (!r.length) setErro("Nenhum produto encontrado.");
    setOpcoes(r);
  };
  const adicionar = (p: ProdutoBusca) => {
    if (!(qtd > 0)) return setErro("Quantidade inválida.");
    onChange([...itens, { product_id: p.id, sku: p.sku, quantity: qtd }]);
    setOpcoes([]);
    setCodigo("");
    setQtd(1);
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
        <div><Label htmlFor="item-cod">SKU, GTIN ou descrição</Label><Input id="item-cod" value={codigo} onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }} /></div>
        <div><Label htmlFor="item-q">Qtd (base)</Label><Input id="item-q" type="number" min={0} step="any" value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></div>
        <Button type="button" variant="suave" onClick={buscar} disabled={!codigo.trim()}>Adicionar</Button>
      </div>
      {erro && <p role="alert" className="text-sm text-perigo">{erro}</p>}
      {opcoes.length > 0 && (
        <ul className="rounded-lg border border-borda">{opcoes.map((p) => (
          <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-superficie-2" onClick={() => adicionar(p)}>{p.sku} · {p.description}</button></li>
        ))}</ul>
      )}
      {itens.length > 0 && (
        <ul className="text-sm">{itens.map((i, n) => (
          <li key={n} className="flex items-center justify-between border-b border-borda/60 py-1">
            <span>{i.sku} × {i.quantity}</span>
            <Button type="button" variant="fantasma" size="sm" onClick={() => onChange(itens.filter((_, k) => k !== n))}>Remover</Button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
