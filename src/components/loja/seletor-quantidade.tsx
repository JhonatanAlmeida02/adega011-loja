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
}: {
  quantidade: number;
  onMais: () => void;
  onMenos: () => void;
  nome: string;
  tamanho?: "md" | "lg";
  className?: string;
}) {
  const botao =
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors active:scale-95 disabled:opacity-40";
  const dim = tamanho === "lg" ? "size-12" : "size-11";
  return (
    <div
      className={cn("flex items-center justify-between gap-1 rounded-full bg-superficie-3 p-0.5", className)}
      role="group"
      aria-label={`Quantidade de ${nome}`}
    >
      <button
        type="button"
        onClick={onMenos}
        className={cn(botao, dim, "text-branco hover:bg-borda")}
        aria-label={quantidade === 1 ? `Remover ${nome} do carrinho` : `Diminuir quantidade de ${nome}`}
      >
        {quantidade === 1 ? <Trash2 className="size-[18px]" /> : <Minus className="size-5" />}
      </button>
      <span
        key={quantidade}
        className="min-w-7 animate-pulsar text-center font-mono text-lg font-bold tabular-nums"
        aria-live="polite"
      >
        {quantidade}
      </span>
      <button
        type="button"
        onClick={onMais}
        disabled={quantidade >= QTD_MAXIMA}
        className={cn(botao, dim, "bg-rosa text-preto hover:bg-[#ff7a9f]")}
        aria-label={`Aumentar quantidade de ${nome}`}
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
