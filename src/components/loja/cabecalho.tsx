"use client";

import { AlternarTema } from "@/components/tema/alternar-tema";
import { LogoTema, SELO } from "@/components/tema/logo-tema";
import { Clock, Bike } from "lucide-react";
import { IconeInstagram as Instagram } from "@/components/marca/icones";
import type { Configuracoes } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { useStatusLoja } from "./use-status-loja";

export function Cabecalho({ config }: { config: Configuracoes }) {
  const status = useStatusLoja(config);

  return (
    <header className="mx-auto w-full max-w-6xl px-4 pt-3 pb-2 sm:pt-4">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <LogoTema {...SELO} alt="" width={48} height={48} preload className="size-10 shrink-0 sm:size-12" />
        <div className="min-w-0 flex-1">
          <p className="titulo truncate text-2xl sm:text-3xl">{config.nome}</p>
          <p className="rotulo truncate text-[.65rem] text-rosa-texto">{config.slogan}</p>
        </div>
        <AlternarTema className="size-9 border border-borda hover:border-rosa [@media(pointer:coarse)]:size-11" />
        {config.instagram && (
          <a
            href={`https://instagram.com/${config.instagram.replace(/^@/, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="grid size-9 [@media(pointer:coarse)]:size-11 shrink-0 place-items-center rounded-full border border-borda text-texto transition-colors hover:border-rosa hover:text-rosa-texto"
            aria-label={`Instagram @${config.instagram.replace(/^@/, "")} (abre em nova aba)`}
          >
            <Instagram className="size-4" />
          </a>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
        <span
          className={cn(
            "inline-flex h-7 items-center gap-2 rounded-full border px-2.5 text-xs font-bold transition-colors",
            !status && "border-borda text-suave",
            status?.aberta && "border-sucesso/50 bg-sucesso/10 text-sucesso",
            status && !status.aberta && "border-rosa/50 bg-rosa/10 text-rosa-texto",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              !status && "bg-suave",
              status?.aberta && "animate-pulse bg-sucesso",
              status && !status.aberta && "bg-rosa",
            )}
          />
          {status ? (
            <>
              {status.titulo}
              <span className="font-normal text-texto/80">· {status.detalhe}</span>
            </>
          ) : (
            "Verificando horário…"
          )}
        </span>
        {config.tempo_entrega && (
          <span className="rotulo inline-flex h-7 items-center gap-1.5 rounded-full border border-borda px-2.5 text-[.65rem] text-suave">
            <Bike aria-hidden className="size-4" /> {config.tempo_entrega}
          </span>
        )}
        {config.pedido_minimo > 0 && (
          <span className="rotulo inline-flex h-7 items-center gap-1.5 rounded-full border border-borda px-2.5 text-[.65rem] text-suave">
            <Clock aria-hidden className="size-4" /> Mínimo {formatarPreco(config.pedido_minimo)}
          </span>
        )}
      </div>
    </header>
  );
}
