"use client";

import Image from "next/image";
import { Clock, Bike } from "lucide-react";
import { IconeInstagram as Instagram } from "@/components/marca/icones";
import type { Configuracoes } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { useStatusLoja } from "./use-status-loja";

export function Cabecalho({ config }: { config: Configuracoes }) {
  const status = useStatusLoja(config);

  return (
    <header className="mx-auto w-full max-w-6xl px-4 pt-4 pb-3 sm:pt-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <Image
          src="/logo-selo.svg"
          alt=""
          width={64}
          height={64}
          preload
          className="size-14 shrink-0 sm:size-16"
        />
        <div className="min-w-0 flex-1">
          <p className="titulo truncate text-3xl sm:text-4xl">{config.nome}</p>
          <p className="rotulo truncate text-rosa">{config.slogan}</p>
        </div>
        {config.instagram && (
          <a
            href={`https://instagram.com/${config.instagram.replace(/^@/, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-borda text-branco transition-colors hover:border-rosa hover:text-rosa"
            aria-label={`Instagram @${config.instagram.replace(/^@/, "")} (abre em nova aba)`}
          >
            <Instagram className="size-5" />
          </a>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-live="polite">
        <span
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-bold transition-colors",
            !status && "border-borda text-suave",
            status?.aberta && "border-sucesso/50 bg-sucesso/10 text-sucesso",
            status && !status.aberta && "border-rosa/50 bg-rosa/10 text-rosa",
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
              <span className="font-normal text-branco/80">· {status.detalhe}</span>
            </>
          ) : (
            "Verificando horário…"
          )}
        </span>
        {config.tempo_entrega && (
          <span className="rotulo inline-flex h-9 items-center gap-1.5 rounded-full border border-borda px-3 text-suave">
            <Bike aria-hidden className="size-4" /> {config.tempo_entrega}
          </span>
        )}
        {config.pedido_minimo > 0 && (
          <span className="rotulo inline-flex h-9 items-center gap-1.5 rounded-full border border-borda px-3 text-suave">
            <Clock aria-hidden className="size-4" /> Mínimo {formatarPreco(config.pedido_minimo)}
          </span>
        )}
      </div>
    </header>
  );
}
