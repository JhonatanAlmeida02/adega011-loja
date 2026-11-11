"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTema } from "./use-tema";

/** Botão que alterna entre o tema escuro e o claro. */
export function AlternarTema({ className, comTexto = false }: { className?: string; comTexto?: boolean }) {
  const [tema, mudar] = useTema();
  const claro = tema === "claro";
  const rotulo = claro ? "Usar tema escuro" : "Usar tema claro";
  return (
    <button
      type="button"
      onClick={() => mudar(claro ? "escuro" : "claro")}
      aria-label={comTexto ? undefined : rotulo}
      title={rotulo}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-3 rounded-full text-texto transition-colors hover:text-rosa-texto",
        className,
      )}
    >
      {claro ? <Moon aria-hidden className="size-4" /> : <Sun aria-hidden className="size-4" />}
      {comTexto && <span>{claro ? "Tema escuro" : "Tema claro"}</span>}
    </button>
  );
}
