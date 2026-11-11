"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { QTD_MAXIMA } from "@/lib/carrinho";

/** Contador +/− com área de toque de 44px. */
export function SeletorQuantidade({
  quantidade,
  onMais,
  onMenos,
  nome,
  tamanho = "md",
  className,
  maximo,
  minimo = 0,
}: {
  maximo?: number;
  /** Com mínimo 1 o botão "−" para no 1 (sem lixeira). */
  minimo?: number;
  quantidade: number;
  onMais: () => void;
  onMenos: () => void;
  nome: string;
  tamanho?: "md" | "lg";
  className?: string;
}) {
  const botao =
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors active:scale-95 disabled:opacity-40";
  const dim = tamanho === "lg" ? "size-10 [@media(pointer:coarse)]:size-11" : "size-9 [@media(pointer:coarse)]:size-11";
  return (
    <div
      className={cn("flex items-center justify-between gap-1 rounded-full bg-superficie-3 p-0.5", className)}
      role="group"
      aria-label={`Quantidade de ${nome}`}
    >
      <button
        type="button"
        onClick={onMenos}
        className={cn(botao, dim, "text-texto hover:bg-borda")}
        disabled={minimo > 0 && quantidade <= minimo}
        aria-label={quantidade === 1 && minimo === 0 ? `Remover ${nome} do carrinho` : `Diminuir quantidade de ${nome}`}
      >
        {quantidade === 1 && minimo === 0 ? <Trash2 className="size-[18px]" /> : <Minus className="size-4" />}
      </button>
      <span
        key={quantidade}
        className="min-w-7 animate-pulsar text-center font-mono text-base font-bold tabular-nums"
        aria-live="polite"
      >
        {quantidade}
      </span>
      <button
        type="button"
        onClick={onMais}
        disabled={quantidade >= Math.min(QTD_MAXIMA, maximo ?? QTD_MAXIMA)}
        className={cn(botao, dim, "bg-rosa text-preto hover:bg-[#ff7a9f]")}
        aria-label={`Aumentar quantidade de ${nome}`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
